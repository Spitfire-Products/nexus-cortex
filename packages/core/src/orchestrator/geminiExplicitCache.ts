/**
 * HB-GEMINI-EXPLICIT-CACHE (DARK, CORTEX_GEMINI_EXPLICIT_CACHE; 2026-10-03).
 *
 * Gemini implicit caching is partial on gemini-3-flash-preview (a fixed ~12K head, the growing conversation is
 * not cached) and absent on gemini-3.8-flash (.cortex/research/stack-portability-2026-10-02.md §"GEMINI
 * CHAT/COMPLETIONS"). Explicit `cachedContents` caches cached 13,405/13,414 prompt tokens on both (§"GEMINI
 * EXPLICIT cachedContents FEASIBILITY"). This module turns that into an append-only cache for the tool loop:
 *
 * - HEAD = (model, systemInstruction, tools, toolConfig) as the request body would have sent them. A SLOT per
 *   (session, head) holds at most one live snapshot {name, prefixLen, prefixHash, expiresAt}. Several heads per
 *   session coexist (a helper call with its own system prompt does not evict the main loop's snapshot); LRU cap.
 * - SNAPSHOT = cachedContents.create(head + contents[0..prefixLen)), prefixLen = contents.length - 1 (the newest
 *   turn is always sent live). Created the first time head+prefix is estimated (chars/4) at or above the model's
 *   minimum cache size; re-created when the uncached tail (contents after prefixLen, newest turn excluded) exceeds
 *   CORTEX_GEMINI_CACHE_RESNAPSHOT_TOKENS, or when the snapshot is (nearly) expired. The superseded snapshot is
 *   DELETEd. A head change (system/tools/toolConfig change — e.g. the anchor lift) is a new slot = new snapshot
 *   (the one intended bust).
 * - USE: the request drops systemInstruction/tools/toolConfig (Gemini 400s when they are set beside
 *   cachedContent — they live in the cache) and sends cachedContent + contents.slice(prefixLen). The prefix is
 *   verified by hash before every use; a rewritten history (compaction, prune, wall drop, image TTL) fails the
 *   hash → re-snapshot (or full request when too small).
 * - TTL: CORTEX_GEMINI_CACHE_TTL_S (default 300); PATCHed (fire-and-forget) when used in the second half of its
 *   life. disposeAll() DELETEs every live snapshot (orchestrator cleanup).
 * - FALLBACK: cache management never blocks a request. A create failure sends the normal full request and backs
 *   off re-creating until the prefix has grown by another resnapshot threshold; a 400/403/404 on a cached request
 *   invalidates the slot and the caller re-sends the normal full request once.
 * - A request carrying a forced toolConfig (per-turn tool_choice) bypasses the cache: Gemini cannot take
 *   toolConfig beside cachedContent, and a per-turn snapshot would cost a full-price creation for one request.
 *
 * Off (unset) = callers never construct a plan → byte-identical requests.
 */
import { createHash } from 'crypto';

function flagOn(raw: string | undefined): boolean {
  const v = String(raw ?? '').trim().toLowerCase();
  return v === 'on' || v === 'true' || v === '1';
}

export function isGeminiExplicitCacheEnabled(): boolean {
  return flagOn(process.env.CORTEX_GEMINI_EXPLICIT_CACHE);
}

function intEnv(name: string, dflt: number, min: number): number {
  const n = Number.parseInt(String(process.env[name] ?? '').trim(), 10);
  return Number.isFinite(n) && n >= min ? n : dflt;
}

export function geminiCacheTtlSeconds(): number {
  return intEnv('CORTEX_GEMINI_CACHE_TTL_S', 300, 60);
}
export function geminiCacheResnapshotTokens(): number {
  return intEnv('CORTEX_GEMINI_CACHE_RESNAPSHOT_TOKENS', 16000, 1024);
}

/**
 * Minimum cacheable input tokens (ai.google.dev/gemini-api/docs/caching, read 2026-10-03: Gemini 3.5–3.8 Flash
 * and 3.1 Pro Preview 4,096; 2.5 Flash / 2.5 Pro 2,048; gemini-3-flash-preview not listed → 4,096 assumed).
 * CORTEX_GEMINI_CACHE_MIN_TOKENS overrides.
 */
export function geminiMinCacheTokens(modelId: string): number {
  const o = intEnv('CORTEX_GEMINI_CACHE_MIN_TOKENS', 0, 1);
  if (o > 0) return o;
  return /gemini-2\.5/.test(modelId) ? 2048 : 4096;
}

/** Rough token estimate used for every threshold (chars / 4 of the JSON wire form). */
export function estimateTokens(value: unknown): number {
  if (value === undefined || value === null) return 0;
  return Math.ceil(JSON.stringify(value).length / 4);
}

function sha(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

/** Body field names: REST (snake_case, top level) vs @google/genai SDK (camelCase, inside config). */
export type GeminiBodyFlavor = 'rest' | 'sdk';
const FIELDS: Record<GeminiBodyFlavor, { system: string; tools: string; toolConfig: string; cached: string }> = {
  rest: { system: 'system_instruction', tools: 'tools', toolConfig: 'tool_config', cached: 'cachedContent' },
  sdk: { system: 'systemInstruction', tools: 'tools', toolConfig: 'toolConfig', cached: 'cachedContent' },
};

interface Slot {
  key: string; // session|headHash
  name?: string; // cachedContents/… (undefined = none live)
  prefixLen: number;
  prefixHash: string;
  expiresAt: number; // ms
  lastUsed: number;
  createFailedAtTokens?: number;
  extending?: boolean;
}

export interface GeminiCachePlan {
  slotKey: string;
  name: string;
  prefixLen: number;
  /** 'created' (new snapshot this request) | 'reused' */
  mode: 'created' | 'reused';
}

export interface GeminiCacheContext {
  sessionId?: string;
  /** bare model id (no models/ prefix, no -sdk suffix) */
  modelId: string;
  /** API key + header used for the cachedContents REST calls */
  apiKey: string;
  /** v1beta base, e.g. https://generativelanguage.googleapis.com/v1beta */
  baseUrl?: string;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<any>;
}>;

export const GEMINI_V1BETA_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** `https://…/v1beta/models` (card endpoint) → `https://…/v1beta`. */
export function geminiBaseFromEndpoint(endpoint: string | undefined): string {
  if (!endpoint) return GEMINI_V1BETA_BASE;
  return endpoint.replace(/\/+$/, '').replace(/\/models$/, '');
}

function toContent(system: unknown): unknown {
  // REST system_instruction is already a Content; the SDK accepts a bare string.
  if (typeof system === 'string') return { parts: [{ text: system }] };
  return system;
}

function log(msg: string): void {
  // One line per cache event; quiet unless the lever is on (callers only reach here with it on).
  if (process.env.CORTEX_GEMINI_CACHE_QUIET === 'true') return;
  console.error(`[gemini-cache] ${msg}`);
}

const MAX_SLOTS = 8;
const EXPIRY_SAFETY_MS = 15_000;

export class GeminiExplicitCacheManager {
  private slots = new Map<string, Slot>();
  private fetchImpl: FetchLike;
  private now: () => number;

  constructor(opts: { fetchImpl?: FetchLike; now?: () => number } = {}) {
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => (globalThis.fetch as any)(url, init));
    this.now = opts.now ?? (() => Date.now());
  }

  /** Live snapshot names (tests / telemetry). */
  liveNames(): string[] {
    return [...this.slots.values()].map((s) => s.name).filter((n): n is string => !!n);
  }

  /**
   * Decide + (if needed) create the snapshot for this request. Returns the plan and the rewritten body, or null
   * (send the original body unchanged). Never throws.
   *
   * @param holder the object that carries system/tools/toolConfig (REST: the body; SDK: body.config)
   */
  async prepare(
    ctx: GeminiCacheContext,
    flavor: GeminiBodyFlavor,
    body: Record<string, any>,
  ): Promise<{ plan: GeminiCachePlan; body: Record<string, any> } | null> {
    try {
      return await this.prepareInner(ctx, flavor, body);
    } catch (e: any) {
      log(`fallback reason=prepare_error ${String(e?.message ?? e).slice(0, 200)}`);
      return null;
    }
  }

  private async prepareInner(
    ctx: GeminiCacheContext,
    flavor: GeminiBodyFlavor,
    body: Record<string, any>,
  ): Promise<{ plan: GeminiCachePlan; body: Record<string, any> } | null> {
    const f = FIELDS[flavor];
    const holder: Record<string, any> = flavor === 'sdk' ? (body.config ?? {}) : body;
    // SDK legacy path (CORTEX_GEMINI_SYSTEM_FIX off) sets a top-level systemInstruction the SDK drops; mirror what is
    // actually sent (config.systemInstruction only), so the cached head equals the uncached request's head.
    const contents: any[] = Array.isArray(body.contents) ? body.contents : [];
    if (contents.length < 2) return null; // nothing to cache before the newest turn
    if (holder.tool_config !== undefined || holder.toolConfig !== undefined) {
      log(`bypass reason=tool_config (forced tool_choice is per-turn; cannot ride a cache)`);
      return null;
    }
    const system = holder[f.system];
    const tools = holder[f.tools];
    const headHash = sha({ m: ctx.modelId, s: system ?? null, t: tools ?? null, c: null });
    const slotKey = `${ctx.sessionId ?? 'default'}|${headHash}`;
    const base = ctx.baseUrl ?? GEMINI_V1BETA_BASE;
    const now = this.now();

    let slot = this.slots.get(slotKey);
    const prefixLenWanted = contents.length - 1;

    // 1. Is the live snapshot usable as-is?
    if (slot?.name) {
      const valid =
        slot.prefixLen <= prefixLenWanted &&
        slot.expiresAt - EXPIRY_SAFETY_MS > now &&
        sha(contents.slice(0, slot.prefixLen)) === slot.prefixHash;
      if (!valid) {
        const why = slot.expiresAt - EXPIRY_SAFETY_MS <= now ? 'expired' : 'prefix_changed';
        log(`invalidate reason=${why} name=${slot.name}`);
        this.deleteRemote(base, ctx.apiKey, slot.name);
        slot.name = undefined;
      } else {
        const tailTokens = estimateTokens(contents.slice(slot.prefixLen, prefixLenWanted));
        if (tailTokens <= geminiCacheResnapshotTokens()) {
          slot.lastUsed = now;
          this.maybeExtend(base, ctx.apiKey, slot);
          return { plan: { slotKey, name: slot.name, prefixLen: slot.prefixLen, mode: 'reused' }, body: this.rewrite(flavor, body, slot.name, slot.prefixLen) };
        }
        log(`resnapshot reason=tail_tokens~${tailTokens} name=${slot.name}`);
        // fall through: create a longer snapshot, then delete the old one
      }
    }

    // 2. Create (or re-create) a snapshot of head + contents[0..prefixLenWanted).
    const prefix = contents.slice(0, prefixLenWanted);
    const est = estimateTokens(system) + estimateTokens(tools) + estimateTokens(prefix);
    const min = geminiMinCacheTokens(ctx.modelId);
    if (est < min) {
      // Still usable old snapshot (tail-threshold path)? keep using it.
      if (slot?.name) return { plan: { slotKey, name: slot.name, prefixLen: slot.prefixLen, mode: 'reused' }, body: this.rewrite(flavor, body, slot.name, slot.prefixLen) };
      return null;
    }
    if (slot?.createFailedAtTokens !== undefined && est < slot.createFailedAtTokens + geminiCacheResnapshotTokens()) {
      if (slot.name) return { plan: { slotKey, name: slot.name, prefixLen: slot.prefixLen, mode: 'reused' }, body: this.rewrite(flavor, body, slot.name, slot.prefixLen) };
      return null; // backoff after a failed create
    }

    const ttl = geminiCacheTtlSeconds();
    const createBody: Record<string, any> = { model: `models/${ctx.modelId}`, contents: prefix, ttl: `${ttl}s` };
    if (system !== undefined) createBody.systemInstruction = toContent(system);
    if (tools !== undefined) createBody.tools = tools;
    const res = await this.fetchImpl(`${base}/cachedContents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': ctx.apiKey },
      body: JSON.stringify(createBody),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      log(`fallback reason=create_${res.status} est~${est} ${txt.replace(/\s+/g, ' ').slice(0, 200)}`);
      if (!slot) {
        slot = { key: slotKey, prefixLen: 0, prefixHash: '', expiresAt: 0, lastUsed: now };
        this.slots.set(slotKey, slot);
      }
      slot.createFailedAtTokens = est;
      if (slot.name) return { plan: { slotKey, name: slot.name, prefixLen: slot.prefixLen, mode: 'reused' }, body: this.rewrite(flavor, body, slot.name, slot.prefixLen) };
      return null;
    }
    const created = await res.json();
    const name: string | undefined = created?.name;
    if (!name) {
      log('fallback reason=create_no_name');
      return null;
    }
    const old = slot?.name;
    const expireMs = Date.parse(created?.expireTime ?? '');
    const fresh: Slot = {
      key: slotKey,
      name,
      prefixLen: prefixLenWanted,
      prefixHash: sha(prefix),
      expiresAt: Number.isFinite(expireMs) ? expireMs : now + ttl * 1000,
      lastUsed: now,
    };
    this.slots.delete(slotKey);
    this.slots.set(slotKey, fresh);
    log(`created name=${name} model=${ctx.modelId} prefixLen=${prefixLenWanted} est~${est} tokens=${created?.usageMetadata?.totalTokenCount ?? '?'} ttl=${ttl}s`);
    if (old) this.deleteRemote(base, ctx.apiKey, old);
    this.evict(base, ctx.apiKey);
    return { plan: { slotKey, name, prefixLen: prefixLenWanted, mode: 'created' }, body: this.rewrite(flavor, body, name, prefixLenWanted) };
  }

  /** Body for a cached request: no system/tools/toolConfig, cachedContent + the uncached tail. Never mutates the input. */
  rewrite(flavor: GeminiBodyFlavor, body: Record<string, any>, name: string, prefixLen: number): Record<string, any> {
    const f = FIELDS[flavor];
    const out: Record<string, any> = { ...body, contents: body.contents.slice(prefixLen) };
    if (flavor === 'sdk') {
      const config = { ...(body.config ?? {}) };
      delete config[f.system];
      delete config[f.tools];
      delete config[f.toolConfig];
      config[f.cached] = name;
      out.config = config;
      delete out.systemInstruction; // legacy top-level slot (never valid beside a cache)
    } else {
      delete out[f.system];
      delete out.systemInstruction;
      delete out[f.tools];
      delete out[f.toolConfig];
      delete out.toolConfig;
      out[f.cached] = name;
    }
    return out;
  }

  /** The cached request failed: drop the snapshot so the caller's full-request retry (and later turns) start clean. */
  invalidate(plan: GeminiCachePlan, reason: string, ctx?: GeminiCacheContext): void {
    const slot = this.slots.get(plan.slotKey);
    log(`fallback reason=${reason} name=${plan.name}`);
    if (slot && slot.name === plan.name) {
      slot.name = undefined;
      if (ctx) this.deleteRemote(ctx.baseUrl ?? GEMINI_V1BETA_BASE, ctx.apiKey, plan.name);
    }
  }

  /** Telemetry for a completed cached request. */
  recordUsage(plan: GeminiCachePlan, usage: any): void {
    const cached = usage?.cachedContentTokenCount ?? 0;
    const prompt = usage?.promptTokenCount ?? 0;
    log(`${plan.mode === 'created' ? 'used(new)' : 'reused'} name=${plan.name} prefixLen=${plan.prefixLen} cachedContentTokenCount=${cached} promptTokenCount=${prompt}`);
  }

  private maybeExtend(base: string, apiKey: string, slot: Slot): void {
    const ttl = geminiCacheTtlSeconds();
    if (slot.extending || slot.expiresAt - this.now() > (ttl * 1000) / 2 || !slot.name) return;
    slot.extending = true;
    const name = slot.name;
    void this.fetchImpl(`${base}/${name}?updateMask=ttl`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ ttl: `${ttl}s` }),
    })
      .then(async (r) => {
        if (r.ok) {
          const j = await r.json().catch(() => ({}));
          const e = Date.parse(j?.expireTime ?? '');
          if (slot.name === name) slot.expiresAt = Number.isFinite(e) ? e : this.now() + ttl * 1000;
          log(`extended name=${name} ttl=${ttl}s`);
        } else {
          log(`extend_failed status=${r.status} name=${name}`);
        }
      })
      .catch((e) => log(`extend_failed ${String(e?.message ?? e).slice(0, 120)}`))
      .finally(() => { slot.extending = false; });
  }

  private deleteRemote(base: string, apiKey: string, name: string): void {
    void this.fetchImpl(`${base}/${name}`, { method: 'DELETE', headers: { 'x-goog-api-key': apiKey } })
      .then((r) => log(`deleted name=${name} status=${r.status}`))
      .catch((e) => log(`delete_failed name=${name} ${String(e?.message ?? e).slice(0, 120)}`));
  }

  private evict(base: string, apiKey: string): void {
    while (this.slots.size > MAX_SLOTS) {
      let oldest: Slot | undefined;
      for (const s of this.slots.values()) if (!oldest || s.lastUsed < oldest.lastUsed) oldest = s;
      if (!oldest) return;
      if (oldest.name) this.deleteRemote(base, apiKey, oldest.name);
      this.slots.delete(oldest.key);
    }
  }

  /** Best-effort DELETE of every live snapshot (session end). */
  async disposeAll(apiKey: string | undefined, baseUrl: string = GEMINI_V1BETA_BASE): Promise<void> {
    const names = this.liveNames();
    this.slots.clear();
    if (!apiKey || names.length === 0) return;
    await Promise.all(
      names.map((name) =>
        this.fetchImpl(`${baseUrl}/${name}`, { method: 'DELETE', headers: { 'x-goog-api-key': apiKey } })
          .then((r) => log(`deleted name=${name} status=${r.status} (dispose)`))
          .catch(() => undefined),
      ),
    );
  }
}

/** HTTP statuses on a cached request that mean "the cache is the problem" → invalidate + full retry once. */
export function isCacheUseFailure(status: number | undefined): boolean {
  return status === 400 || status === 403 || status === 404;
}
