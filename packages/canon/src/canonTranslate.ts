/**
 * canonTranslate — the canon gateway leg, graduated from
 * `scripts/canon/canon-translate.ts` (Phase C part 2; the script is now a thin
 * wrapper over this module, so the cron and the CLI run ONE implementation).
 *
 * Reads native session files in the canon store and maintains the canonical
 * line: /native/claude-code/** → /canon/claude-code/**, /native/nexus-cortex/**
 * → /canon/nexus-cortex/** (≈ identity), plus /projections refs and the
 * self-documenting MAPPING/TRANSLATED/PROJECTIONS docs.
 *
 * The transform bodies are the script's PROVEN logic, transplanted verbatim
 * (byte-identical output is the graduation's regression gate). The canonical
 * record schema authority is `@nexus-cortex/types` / MessageTypes.ts — the
 * transforms operate structurally on raw JSONL records BY DESIGN (canon =
 * verbatim superset; `message` bodies pass through untouched), so they neither
 * construct nor need typed Message values.
 *
 * @module canon/canonTranslate
 */
import { requireCanonRepo, redactRepoUrl, canonGit } from './canonRepo.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';

export interface CanonTranslateOptions {
  /** Canon store working clone (default /tmp/canon-store — off-quota; auto-cloned). */
  store?: string;
  /** Home dir for the incremental manifest (default $HOME). */
  home?: string;
  /** Report what would translate; write nothing. */
  dryRun?: boolean;
  /** Store remote for the auto-clone (default env CANON_REPO or the canonical repo). */
  repoUrl?: string;
}

export interface CanonTranslateResult {
  translated: number;
  unchanged: number;
  errors: string[];
  summary: string;
  pushed: boolean;
}

export async function canonTranslate(o: CanonTranslateOptions = {}): Promise<CanonTranslateResult> {
  const HOME = o.home ?? process.env.HOME ?? '/home/runner/workspace';
  const DRY = o.dryRun ?? false;
  const STORE = o.store ?? '/tmp/canon-store';
const MANIFEST_PATH = path.join(HOME, '.canon', 'translate-manifest.json');
const MAX_BYTES = 50 * 1024 * 1024;
const PART_BYTES = 25 * 1024 * 1024;
const SCRIPT_VERSION = 'a3.17'; // bump to force full re-translate

const MESSAGE_TYPES = new Set(['user', 'assistant', 'system', 'file-history-snapshot']);

type Manifest = Record<string, string>;
const manifest: Manifest = fs.existsSync(MANIFEST_PATH)
  ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  : {};

const errors: string[] = [];
const stats: Record<string, { files: number; messages: number; events: number }> = {};
const eventTypeCounts: Record<string, number> = {};
let unchanged = 0;
let dupResults = 0;
let orphanRepairs = 0;
let blobs: Map<string, string> = new Map(); // set in main, before discovery

// ── discovery: group .part-NNNN chunks into logical files ──────────────────
interface LogicalFile { rel: string; parts: string[]; sig: string }

/** path (store-relative) → git blob SHA. Stable across clones/mtimes; the
 *  Merkle anchor for both provenance and the incremental manifest. */
function blobMap(): Map<string, string> {
  const out = new Map<string, string>();
  const ls = canonGit(STORE, 'canon-translate')(['ls-files', '-s', '--', 'native']);
  for (const line of ls.split('\n')) {
    const m = line.match(/^\d+ ([0-9a-f]{40}) \d\t(.+)$/);
    if (m) out.set(m[2]!, m[1]!.slice(0, 12));
  }
  return out;
}

function discover(rootAbs: string, relPrefix: string): LogicalFile[] {
  const groups = new Map<string, string[]>();
  const walk = (dir: string) => {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.isFile()) continue;
      const m = e.name.match(/^(.*\.jsonl)\.part-\d{4}$/);
      const logical = m ? path.join(dir, m[1]!) : p;
      if (!logical.endsWith('.jsonl')) continue;
      const g = groups.get(logical) ?? [];
      g.push(p);
      groups.set(logical, g);
    }
  };
  walk(rootAbs);
  const out: LogicalFile[] = [];
  for (const [logical, parts] of groups) {
    parts.sort();
    // Signature = git blob SHAs (content-stable across clones; mtime:size only
    // as a fallback for not-yet-committed files, which then retry next run).
    const sig = SCRIPT_VERSION + '|' + parts
      .map((p) => blobs.get(path.relative(STORE, p))
        ?? (() => { const st = fs.statSync(p); return `${st.mtimeMs}:${st.size}`; })())
      .join('|');
    out.push({ rel: path.join(relPrefix, path.relative(rootAbs, logical)), parts, sig });
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** yields [line, blobShaOfThePartContainingIt] */
async function* logicalLines(parts: string[]): AsyncGenerator<[string, string]> {
  for (const p of parts) {
    const blob = blobs.get(path.relative(STORE, p)) ?? 'untracked';
    const rl = readline.createInterface({ input: fs.createReadStream(p), crlfDelay: Infinity });
    for await (const line of rl) if (line.trim()) yield [line, blob];
  }
}

// ── chunk-aware output: single file ≤50MB, else 25MB .part-NNNN files ──────
function finalizeOutput(destAbs: string, tmpAbs: string) {
  const size = fs.statSync(tmpAbs).size;
  const staleParts = () => {
    const dir = path.dirname(destAbs); const base = path.basename(destAbs);
    let names: string[] = [];
    try { names = fs.readdirSync(dir); } catch { return []; }
    return names.filter((n) => n.startsWith(base + '.part-')).map((n) => path.join(dir, n));
  };
  if (size <= MAX_BYTES) {
    for (const p of staleParts()) fs.unlinkSync(p);
    fs.renameSync(tmpAbs, destAbs);
    return;
  }
  // split at line boundaries into parts; remove single-file form + extra parts
  const content = fs.readFileSync(tmpAbs, 'utf8');
  let offset = 0, part = 0;
  while (offset < content.length) {
    let end = Math.min(offset + PART_BYTES, content.length);
    if (end < content.length) {
      const nl = content.lastIndexOf('\n', end);
      if (nl > offset) end = nl + 1;
    }
    fs.writeFileSync(`${destAbs}.part-${String(part).padStart(4, '0')}`, content.slice(offset, end));
    offset = end; part++;
  }
  for (const p of staleParts()) {
    const idx = Number(p.slice(-4));
    if (idx >= part) fs.unlinkSync(p);
  }
  try { fs.unlinkSync(destAbs); } catch { /* none */ }
  fs.unlinkSync(tmpAbs);
}

function writeIfChanged(abs: string, content: string) {
  if (fs.existsSync(abs) && fs.readFileSync(abs, 'utf8') === content) return;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

// ── claude-code fragment merging ───────────────────────────────────────────
// Claude Code's writer emits ONE RECORD PER CONTENT BLOCK: a response with
// parallel tool calls becomes N assistant records (same requestId/message.id),
// and their results N separate user records. Canon's contract is one canonical
// message per logical API message — strict providers (ChatCompletions) reject
// assistant→assistant→tool sequences, and orphan-repair heuristics misfire on
// fragments. Reconstruct true boundaries here so EVERY consumer is healed.
// parentUuid links to merged-away fragments are remapped (children always
// follow parents in an append-only log, so a forward-pass map suffices).
// Native granularity is fully retained in /native; merged canon records carry
// mergedFrom (absorbed uuids) for traceability.

function asBlocks(content: unknown): any[] {
  if (Array.isArray(content)) return content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return [];
}
function isToolResultOnly(rec: any): boolean {
  const c = rec?.message?.content;
  return Array.isArray(c) && c.length > 0 && c.every((b: any) => b?.type === 'tool_result');
}
function asstGroupKey(rec: any): string {
  return rec.requestId ?? rec.message?.id ?? rec.uuid;
}
function mergeFragments(frags: any[]): any {
  if (frags.length === 1) return frags[0];
  const merged = { ...frags[0] };
  merged.message = { ...frags[0].message };
  merged.message.content = frags.flatMap((f) => asBlocks(f.message?.content));
  // usage/model: the last fragment carrying them describes the full response
  for (const f of frags) {
    if (f.message?.usage) merged.message.usage = f.message.usage;
    if (f.message?.model) merged.message.model = f.message.model;
  }
  merged.mergedFrom = frags.slice(1).map((f) => f.uuid).filter(Boolean);
  return merged;
}

// ── claude-code → canon record transform ───────────────────────────────────
interface Ctx { sessionId: string; nativeRel: string; ref: string; line: number; turn: number }

function toCanonClaude(rec: any, ctx: Ctx): { canon?: any; event?: any } {
  const t = rec.type;
  if (!MESSAGE_TYPES.has(t)) return { event: rec };
  if (t === 'user') {
    const c = rec.message?.content;
    const isToolResult = Array.isArray(c) && c.some((b: any) => b?.type === 'tool_result');
    if (!isToolResult) ctx.turn++;
  }
  const canon: any = { ...rec };
  if (t === 'file-history-snapshot') {
    canon.uuid = canon.uuid ?? `fhs-${rec.messageId}`;
    canon.timestamp = canon.timestamp ?? rec.snapshot?.timestamp;
  }
  // Canon SystemMessage.content is a required string; Claude Code emits
  // metadata-only system events (turn_duration, stop_hook_summary) without one.
  if (t === 'system' && canon.content === undefined) canon.content = '';
  const sid = rec.sessionId ?? ctx.sessionId;
  canon.timeline = {
    sessionId: sid,
    conversationId: sid, // claude-code has no sub-session conversations
    turnNumber: Math.max(0, ctx.turn),
  };
  if (t === 'assistant' && rec.message?.model) {
    canon.model = { id: rec.message.model, provider: 'anthropic', apiPattern: 'messages' };
  }
  const u = t === 'assistant' ? rec.message?.usage : undefined;
  if (u) {
    canon.usage = {
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cache: {
        cacheCreationTokens: u.cache_creation_input_tokens,
        cacheReadTokens: u.cache_read_input_tokens,
      },
    };
  }
  canon.provenance = { harness: 'claude-code', native: ctx.nativeRel, line: ctx.line, ref: ctx.ref };
  return { canon };
}

// ── translate one logical native file ──────────────────────────────────────
async function translateFile(lf: LogicalFile, harness: 'claude-code' | 'nexus-cortex' | 'browser-cortex' | 'grok-build' | 'gemini-cli') {
  if (manifest[lf.rel] === lf.sig) { unchanged++; return; }
  const st = (stats[harness] ??= { files: 0, messages: 0, events: 0 });
  const destRel = path.join('canon', lf.rel);
  const destAbs = path.join(STORE, destRel);
  const eventsAbs = destAbs.replace(/\.jsonl$/, '.events.jsonl');
  const ctx: Ctx = {
    sessionId: path.basename(lf.rel, '.jsonl'),
    nativeRel: path.join('native', lf.rel),
    ref: '', line: 0, turn: -1,
  };
  let msgCount = 0;
  const events: string[] = [];
  const fileErrors: string[] = [];
  if (DRY) {
    st.files++;
    return;
  }
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  const tmpAbs = destAbs + '.tmp';
  const out = fs.createWriteStream(tmpAbs);
  type Frag = { rec: any; line: number; ref: string };
  const remap = new Map<string, string>();
  // Sidecarred events (attachments, snapshots) can sit INSIDE the parentUuid
  // chain. Claude Code's renderer walks that chain and silently EXCLUDES
  // everything upstream of a broken link (measured: a 555KB skill doc vanished
  // from rendered context). Re-parent chain children through sidecarred
  // events to the nearest surviving message ancestor.
  const eventParent = new Map<string, string | null>();
  const emittedUuids = new Set<string>();
  let lastEmittedUuid: string | null = null;
  const resolveParent = (p: any): any => {
    const seen = new Set<string>();
    while (typeof p === 'string' && !seen.has(p)) {
      seen.add(p);
      if (remap.has(p)) { p = remap.get(p); continue; }
      if (eventParent.has(p)) { p = eventParent.get(p); continue; }
      break;
    }
    return p ?? null;
  };
  const usesSeen = new Set<string>();
  const cortexUses = new Set<string>();
  const cortexAnswered = new Set<string>();
  let cortexOpen: { id: string; name?: string }[] = []; // pending calls from the last assistant
  // claude-code abandoned-call repair: tool_use ids emitted by flushAsst but
  // not yet answered by a flushRes. When a non-result MESSAGE record interposes
  // (a user interrupted a long tool call mid-conversation), the call is
  // abandoned — synthesize an error-marked result so the A4 pairing lint and
  // strict providers accept the history. Mirror of the nexus-cortex path's
  // repair; only true tail calls (EOF) stay open ("next sync completes them").
  // Fixes the A4 red streak: the claude-code path had orphan-RESULT repair but
  // no abandoned-CALL repair — built on the wrong assumption that Claude Code
  // always writes "[interrupted]" results (this session is the counterexample).
  let ccOpen: { id: string; name?: string }[] = [];
  const grokTurns = new Map<string, number>(); // grok-build: per-session prompt turn counter
  const gmBuf: { rec: any; line: string; lineNo: number; blob: string }[] = []; // gemini-cli: buffered (supersede-by-id)
  // last-seen valid native timestamp — fallback for synthetic repair records
  // whose stranding/current source record carries none (e.g. Claude Code's
  // file-history-snapshot records: {type,messageId,snapshot,isSnapshotUpdate},
  // no timestamp field). Without this, drainAbandoned wrote timestamp:undefined
  // → JSON.stringify dropped the key → verify's 'missing timestamp' failure.
  let lastTs: any = undefined;
  let pendAsst: Frag[] = [];
  let pendRes: Frag[] = [];
  const emitCanon = (rec: any, line: number, ref: string) => {
    if (rec.parentUuid) rec.parentUuid = resolveParent(rec.parentUuid);
    // Chain integrity is an ABSOLUTE invariant of the canonical line (lint-
    // enforced): a parent that still doesn't resolve (dropped upstream for any
    // reason) re-parents to the previous emitted record.
    if (typeof rec.parentUuid === 'string' && !emittedUuids.has(rec.parentUuid)) {
      rec.parentUuid = lastEmittedUuid;
    }
    const bs = Array.isArray(rec.message?.content) ? rec.message.content : [];
    for (const b of bs) if (b?.type === 'tool_use' && b.id) usesSeen.add(b.id);
    ctx.line = line;
    ctx.ref = ref;
    const { canon } = toCanonClaude(rec, ctx);
    if (canon.uuid) { emittedUuids.add(canon.uuid); lastEmittedUuid = canon.uuid; }
    out.write(JSON.stringify(canon) + '\n');
    msgCount++;
  };
  const flushAsst = () => {
    if (!pendAsst.length) return;
    const first = pendAsst[0]!;
    const merged = mergeFragments(pendAsst.map((g) => g.rec));
    for (const g of pendAsst.slice(1)) if (g.rec.uuid) remap.set(g.rec.uuid, first.rec.uuid);
    emitCanon(merged, first.line, first.ref);
    for (const b of asBlocks(merged.message?.content)) if (b?.type === 'tool_use' && b.id) ccOpen.push({ id: b.id, name: b.name });
    pendAsst = [];
  };
  // Emit synthetic error results for any calls abandoned mid-conversation
  // (called only when a non-result record definitively strands them). True
  // tail calls are never drained — the loop's final flush leaves ccOpen intact.
  const drainAbandoned = (ts: any, line: number, blob: string) => {
    if (!ccOpen.length) return;
    orphanRepairs += ccOpen.length;
    out.write(JSON.stringify({
      uuid: `synth-result-${ccOpen[0]!.id}`,
      timestamp: ts,
      type: 'user',
      synthetic: 'canon-abandoned-call-repair',
      message: {
        role: 'user',
        content: ccOpen.map((o) => ({
          type: 'tool_result', tool_use_id: o.id, is_error: true,
          content: '[canon repair: no result was recorded for this call — the harness turn was interrupted]',
        })),
      },
      provenance: { harness, native: ctx.nativeRel, line, ref: blob },
    }) + '\n');
    msgCount++;
    ccOpen = [];
  };
  // Orphan-result repair happens at result-group flush, preserving STRICT pair
  // interleaving (assistant-uses → its results ; synth-use → orphan results).
  // Observed source: user-backgrounded tools — Claude Code skips the assistant
  // tool_use record on mid-turn interruption but still writes the result,
  // sometimes interleaved INSIDE another pair. Emitting the synthetic use
  // adjacent to the orphan result (and only after the real pair closes) keeps
  // the canonical line valid for every consumer. Explicit, never silent.
  const flushRes = () => {
    if (!pendRes.length) return;
    const first = pendRes[0]!;
    const merged = mergeFragments(pendRes.map((g) => g.rec));
    for (const g of pendRes.slice(1)) if (g.rec.uuid) remap.set(g.rec.uuid, first.rec.uuid);
    const bs = asBlocks(merged.message?.content);
    for (const b of bs) if (b?.type === 'tool_result' && b.tool_use_id) ccOpen = ccOpen.filter((o) => o.id !== b.tool_use_id);
    const orphans = bs.filter((b: any) => b?.type === 'tool_result' && b.tool_use_id && !usesSeen.has(b.tool_use_id));
    if (!orphans.length) {
      emitCanon(merged, first.line, first.ref);
    } else {
      const paired = bs.filter((b: any) => !orphans.includes(b));
      if (paired.length) {
        emitCanon({ ...merged, message: { ...merged.message, content: paired } }, first.line, first.ref);
      }
      emitCanon({
        uuid: `synth-use-${orphans[0].tool_use_id}`,
        timestamp: merged.timestamp,
        type: 'assistant',
        synthetic: 'canon-orphan-result-repair',
        sessionId: merged.sessionId,
        message: {
          role: 'assistant',
          content: orphans.map((b: any) => ({
            type: 'tool_use', id: b.tool_use_id, name: b.tool_name ?? 'unknown_tool', input: {},
          })),
        },
      }, first.line, first.ref);
      emitCanon({
        ...merged,
        uuid: paired.length ? `${merged.uuid}-orphan-results` : merged.uuid,
        message: { ...merged.message, content: orphans },
      }, first.line, first.ref);
    }
    pendRes = [];
  };

  let lineNo = 0;
  for await (const [line, blob] of logicalLines(lf.parts)) {
    lineNo++;
    let rec: any;
    try { rec = JSON.parse(line); }
    catch (e) {
      fileErrors.push(`${ctx.nativeRel}:${lineNo} — unparseable JSON: ${String(e).slice(0, 120)}`);
      continue;
    }
    if (rec && rec.timestamp) lastTs = rec.timestamp; // track for synthetic-record fallback
    if (harness === 'gemini-cli') {
      // Buffered — the chats format is a mini event-sourced log (see
      // HARNESS_ONBOARDING.md Appendix C): header + {$set:{...}} patches +
      // typed MessageRecords where a RE-APPENDED id SUPERSEDES the earlier
      // record (tool results arrive via update). Files cap at 50 messages
      // (MAX_HISTORY_MESSAGES) so buffering is bounded by construction.
      gmBuf.push({ rec, line, lineNo, blob });
      continue;
    }
    if (harness === 'grok-build') {
      // MIXED-GRADE harness (HARNESS_ONBOARDING.md Appendix B): sessions that
      // carry chat_history.jsonl are TRANSCRIPT-grade (full messages, OpenAI
      // tool_calls dialect + xAI reasoning + model provenance); sessions
      // without it are telemetry-only. Record-shape dispatch, per record:
      //  - prompt_history entries ({prompt, session_id}) -> canonical user Message
      //  - chat_history entries ({type: system|user|assistant|tool_result})
      //    -> canonical Messages (thinking/tool_use/tool_result blocks)
      //  - everything else (events telemetry) -> event sidecar, verbatim (D8)
      // chat_history records carry NO ids/timestamps: uuid = gbc-<sess>-<line>
      // (deterministic); timestamp derived from the session dir's uuidv7
      // (first 48 bits = ms epoch), marked timestamp_source.
      if (typeof rec.prompt === 'string' && typeof rec.session_id === 'string') {
        const turn = (grokTurns.get(rec.session_id) ?? 0) + 1;
        grokTurns.set(rec.session_id, turn);
        const canon: any = {
          ...rec,
          uuid: `gbp-${rec.session_id}-${lineNo}`,
          type: 'user',
          message: { role: 'user', content: [{ type: 'text', text: rec.prompt }] },
          timeline: { sessionId: rec.session_id, conversationId: rec.session_id, turnNumber: turn },
          provenance: { harness, native: ctx.nativeRel, line: lineNo, ref: blob },
        };
        out.write(JSON.stringify(canon) + '\n');
        msgCount++;
      } else if (['system', 'user', 'assistant', 'tool_result'].includes(rec.type)) {
        const segs = ctx.nativeRel.split(path.sep);
        const sess = segs.length >= 3 ? segs[segs.length - 2]! : ctx.sessionId;
        let ts = lastTs;
        const hex = sess.replace(/-/g, '').slice(0, 12);
        if (/^[0-9a-f]{12}$/.test(hex)) ts = new Date(parseInt(hex, 16)).toISOString();
        const canon: any = {
          ...rec,
          uuid: `gbc-${sess}-${lineNo}`,
          timestamp: ts,
          timestamp_source: 'uuidv7-session',
          timeline: { sessionId: sess, conversationId: sess, turnNumber: Math.max(1, grokTurns.get(sess) ?? 1) },
          provenance: { harness, native: ctx.nativeRel, line: lineNo, ref: blob },
        };
        if (rec.type === 'user') {
          grokTurns.set(sess, (grokTurns.get(sess) ?? 0) + 1);
          canon.timeline.turnNumber = grokTurns.get(sess)!;
          const blocks = Array.isArray(rec.content) ? rec.content : [{ type: 'text', text: String(rec.content ?? '') }];
          canon.message = { role: 'user', content: blocks };
        } else if (rec.type === 'assistant') {
          const blocks: any[] = [];
          if (rec.reasoning?.text) blocks.push({ type: 'thinking', thinking: rec.reasoning.text });
          if (typeof rec.content === 'string' && rec.content) blocks.push({ type: 'text', text: rec.content });
          else if (Array.isArray(rec.content)) blocks.push(...rec.content);
          for (const tc of rec.tool_calls ?? []) {
            let input: any;
            try { input = JSON.parse(tc.arguments); } catch { input = { raw: tc.arguments }; }
            blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input });
          }
          canon.message = { role: 'assistant', content: blocks };
          canon.model = { id: rec.model_id ?? 'grok-build', provider: 'xai', apiPattern: 'chat_completions' };
        } else if (rec.type === 'tool_result') {
          canon.type = 'user';
          canon.message = { role: 'user', content: [{ type: 'tool_result', tool_use_id: rec.tool_call_id, content: rec.content }] };
        } else {
          // system: canonical SystemMessage — content stays the string it is.
          canon.content = typeof rec.content === 'string' ? rec.content : JSON.stringify(rec.content ?? '');
        }
        out.write(JSON.stringify(canon) + '\n');
        msgCount++;
      } else {
        if (rec.type) eventTypeCounts[rec.type] = (eventTypeCounts[rec.type] ?? 0) + 1;
        events.push(line);
      }
      continue;
    }
    if (harness === 'nexus-cortex' || harness === 'browser-cortex') {
      // browser-cortex: the SPA's CanonSyncService serializes IndexedDB sessions
      // into this same canonical envelope (uuid/parentUuid/type/message/timeline,
      // secret-scrubbed at browser write time) — so it rides the identity branch
      // and inherits the same structural repairs.
      // Identity — EXCEPT structural repairs the A4 pairing lint demands:
      // (1) wrapped-block normalization: older JSONLHistoryStore versions
      //     wrote {type:'tool_use', toolUse:{id,name,input,metadata}} instead
      //     of the flat Anthropic wire shape the canon spec declares;
      // (2) duplicate tool_results dropped (legacy retry-loop artifact wrote
      //     the same results dozens of times — providers reject duplicate
      //     responses; count is reported, native keeps them verbatim);
      // (3) orphan tool_results get a marked synthetic tool_use, same repair
      //     contract as the claude-code path.
      if (Array.isArray(rec.message?.content)) {
        rec.message.content = rec.message.content.map((b: any) =>
          b?.type === 'tool_use' && b.toolUse
            ? { type: 'tool_use', id: b.toolUse.id, name: b.toolUse.name, input: b.toolUse.input, ...(b.toolUse.metadata ? { metadata: b.toolUse.metadata } : {}) }
            : b);
        const kept: any[] = [];
        const orphanIds: { id: string; name?: string }[] = [];
        for (const b of rec.message.content) {
          if (b?.type === 'tool_use' && b.id) { cortexUses.add(b.id); kept.push(b); continue; }
          if (b?.type === 'tool_result' && b.tool_use_id) {
            if (cortexAnswered.has(b.tool_use_id)) { dupResults++; continue; }
            if (!cortexUses.has(b.tool_use_id)) orphanIds.push({ id: b.tool_use_id, name: b.tool_name });
            cortexAnswered.add(b.tool_use_id);
          }
          kept.push(b);
        }
        if (!kept.length) continue; // record was entirely duplicate results
        rec.message.content = kept;
        // Abandoned-call repair (mirror of orphan-result): a pending call
        // followed by a non-result record never got its result recorded
        // (crashed/killed turn — Claude Code writes "[interrupted]" results
        // itself; older cortex server sessions did not). Synthesize an
        // error-marked result so strict providers accept the history. Tail
        // in-flight calls (EOF) stay untouched — next sync completes them.
        const hasResult = kept.some((b: any) => b?.type === 'tool_result');
        if (!hasResult && cortexOpen.length) {
          orphanRepairs += cortexOpen.length;
          out.write(JSON.stringify({
            uuid: `synth-result-${cortexOpen[0]!.id}`,
            timestamp: rec.timestamp ?? lastTs,
            type: 'user',
            synthetic: 'canon-abandoned-call-repair',
            message: {
              role: 'user',
              content: cortexOpen.map((o) => ({
                type: 'tool_result', tool_use_id: o.id, is_error: true,
                content: '[canon repair: no result was recorded for this call — the harness turn was interrupted]',
              })),
            },
            provenance: { harness, native: ctx.nativeRel, line: lineNo, ref: blob },
          }) + '\n');
          msgCount++;
          for (const o of cortexOpen) cortexAnswered.add(o.id);
          cortexOpen = [];
        }
        for (const b of kept) {
          if (b?.type === 'tool_use' && b.id) cortexOpen.push({ id: b.id, name: b.name });
          if (b?.type === 'tool_result' && b.tool_use_id) cortexOpen = cortexOpen.filter((o) => o.id !== b.tool_use_id);
        }
        if (orphanIds.length) {
          orphanRepairs += orphanIds.length;
          for (const o of orphanIds) cortexUses.add(o.id);
          out.write(JSON.stringify({
            uuid: `synth-use-${orphanIds[0]!.id}`,
            timestamp: rec.timestamp ?? lastTs,
            type: 'assistant',
            synthetic: 'canon-orphan-result-repair',
            message: { role: 'assistant', content: orphanIds.map((o) => ({ type: 'tool_use', id: o.id, name: o.name ?? 'unknown_tool', input: {} })) },
            provenance: { harness, native: ctx.nativeRel, line: lineNo, ref: blob },
          }) + '\n');
          msgCount++;
        }
      }
      // same chain-integrity guarantee on the identity path (second-generation
      // files — pulled sessions re-synced as cortex natives — carry parents
      // that were sidecarred in their first translation)
      if (typeof rec.parentUuid === 'string' && !emittedUuids.has(rec.parentUuid)) {
        rec.parentUuid = lastEmittedUuid;
      }
      if (rec.uuid) { emittedUuids.add(rec.uuid); lastEmittedUuid = rec.uuid; }
      rec.provenance = { harness, native: ctx.nativeRel, line: lineNo, ref: blob };
      out.write(JSON.stringify(rec) + '\n');
      msgCount++;
      continue;
    }
    if (!MESSAGE_TYPES.has(rec.type)) {
      // sidecar events never break a fragment run (attachments etc. interleave)
      if (rec.uuid) eventParent.set(rec.uuid, rec.parentUuid ?? null);
      events.push(line);
      eventTypeCounts[rec.type ?? '?'] = (eventTypeCounts[rec.type ?? '?'] ?? 0) + 1;
      continue;
    }
    if (rec.type === 'assistant') {
      flushRes();
      if (pendAsst.length && asstGroupKey(pendAsst[0]!.rec) !== asstGroupKey(rec)) flushAsst();
      pendAsst.push({ rec, line: lineNo, ref: blob });
    } else if (rec.type === 'user' && isToolResultOnly(rec)) {
      flushAsst();
      pendRes.push({ rec, line: lineNo, ref: blob });
    } else {
      flushAsst();
      flushRes();
      // A non-result message record interposes — any still-open call from the
      // just-flushed assistant was abandoned mid-conversation. Repair before
      // emitting this record so the tool_use/tool_result pair stays adjacent.
      drainAbandoned(rec.timestamp ?? lastTs, lineNo, blob);
      emitCanon(rec, lineNo, blob);
    }
  }
  if (harness === 'gemini-cli' && gmBuf.length) {
    // Pass 1 — resolve the event-sourced log: typed records supersede by id
    // (keep-LAST content at FIRST-seen order); messages inside {$set:{messages}}
    // patches join the same map; header/$set/info/error/warning → sidecar.
    const order: string[] = [];
    const latest = new Map<string, { rec: any; lineNo: number; blob: string }>();
    const takeMsg = (m: any, lineNo: number, blob: string) => {
      if (!m || typeof m.id !== 'string' || !m.type) return false;
      if (!latest.has(m.id)) order.push(m.id);
      latest.set(m.id, { rec: m, lineNo, blob });
      return true;
    };
    for (const { rec, line, lineNo, blob } of gmBuf) {
      if (rec && typeof rec === 'object' && rec.$set) {
        for (const m of rec.$set.messages ?? []) takeMsg(m, lineNo, blob);
        eventTypeCounts['$set'] = (eventTypeCounts['$set'] ?? 0) + 1;
        events.push(line);
      } else if (takeMsg(rec, lineNo, blob)) {
        /* typed message, buffered */
      } else {
        eventTypeCounts[rec?.type ?? 'header'] = (eventTypeCounts[rec?.type ?? 'header'] ?? 0) + 1;
        events.push(line);
      }
    }
    // Pass 2 — emit canonical messages. gemini records embed toolCalls WITH
    // results: assistant gets thinking (thoughts) + text + tool_use blocks;
    // one paired user tool_result message follows (missing results become
    // synthetic marked errors — the established repair pattern).
    let turn = 0;
    for (const id of order) {
      const { rec, lineNo, blob } = latest.get(id)!;
      const prov = { harness, native: ctx.nativeRel, line: lineNo, ref: blob };
      const base = { uuid: rec.id, timestamp: rec.timestamp, provenance: prov };
      const partsToBlocks = (c: any): any[] => {
        if (typeof c === 'string') return c ? [{ type: 'text', text: c }] : [];
        if (!Array.isArray(c)) return c && typeof c === 'object' ? [c] : [];
        return c.map((p: any) => (typeof p === 'string' ? { type: 'text', text: p } : p?.text !== undefined ? { type: 'text', text: p.text } : p)).filter(Boolean);
      };
      if (rec.type === 'user') {
        // functionResponse parts are the WIRE-level duplicate of results the
        // gemini record already embeds in toolCalls (and their ids differ
        // from the ToolCallRecord ids, so pairing them is impossible) —
        // sidecar them verbatim; keep genuine text parts as the message.
        const raw = Array.isArray(rec.content) ? rec.content : [rec.content];
        const frOnly = raw.length > 0 && raw.every((p: any) => p && typeof p === 'object' && p.functionResponse);
        if (frOnly) {
          eventTypeCounts['user-functionResponse'] = (eventTypeCounts['user-functionResponse'] ?? 0) + 1;
          events.push(JSON.stringify(rec));
          continue;
        }
        const blocks = partsToBlocks(Array.isArray(rec.content) ? rec.content.filter((p: any) => !(p && typeof p === 'object' && p.functionResponse)) : rec.content);
        turn++;
        out.write(JSON.stringify({ ...rec, ...base, type: 'user',
          message: { role: 'user', content: blocks },
          timeline: { sessionId: ctx.sessionId, conversationId: ctx.sessionId, turnNumber: turn } }) + '\n');
        msgCount++;
      } else if (rec.type === 'gemini') {
        const blocks: any[] = [];
        for (const th of rec.thoughts ?? []) {
          const t = [th.subject, th.description].filter(Boolean).join(': ');
          if (t) blocks.push({ type: 'thinking', thinking: t });
        }
        blocks.push(...partsToBlocks(rec.content));
        for (const tc of rec.toolCalls ?? []) blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args ?? {} });
        const canon: any = { ...rec, ...base, type: 'assistant',
          message: { role: 'assistant', content: blocks },
          timeline: { sessionId: ctx.sessionId, conversationId: ctx.sessionId, turnNumber: Math.max(1, turn) } };
        if (rec.model) canon.model = { id: rec.model, provider: 'google', apiPattern: 'generate_content' };
        if (rec.tokens) canon.usage = { inputTokens: rec.tokens.input ?? 0, outputTokens: rec.tokens.output ?? 0, cache: { cacheReadTokens: rec.tokens.cached } };
        out.write(JSON.stringify(canon) + '\n');
        msgCount++;
        if ((rec.toolCalls ?? []).length) {
          const results = (rec.toolCalls ?? []).map((tc: any) => tc.result != null
            ? { type: 'tool_result', tool_use_id: tc.id, content: typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result) }
            : { type: 'tool_result', tool_use_id: tc.id, is_error: true, content: '[canon repair: no result was recorded for this call]' });
          if ((rec.toolCalls ?? []).some((tc: any) => tc.result == null)) orphanRepairs++;
          out.write(JSON.stringify({ uuid: `gmr-${rec.id}`, timestamp: rec.timestamp, type: 'user',
            message: { role: 'user', content: results },
            timeline: { sessionId: ctx.sessionId, conversationId: ctx.sessionId, turnNumber: Math.max(1, turn) },
            provenance: prov }) + '\n');
          msgCount++;
        }
      } else {
        // info / error / warning notices → sidecar
        eventTypeCounts[rec.type] = (eventTypeCounts[rec.type] ?? 0) + 1;
        events.push(JSON.stringify(rec));
      }
    }
  }
  // EOF flush: tail in-flight calls are deliberately left in ccOpen (undrained)
  // — verify's tail window allows them; the next sync completes the pair.
  flushAsst();
  flushRes();
  await new Promise<void>((res, rej) => out.end((e: any) => (e ? rej(e) : res())));
  if (msgCount === 0 && events.length === 0 && fileErrors.length === 0) {
    // nothing translatable (e.g. empty file) — visible, not silent
    fs.unlinkSync(tmpAbs);
    errors.push(`${ctx.nativeRel} — empty logical file (0 records)`);
    manifest[lf.rel] = lf.sig;
    return;
  }
  finalizeOutput(destAbs, tmpAbs);
  if (events.length) fs.writeFileSync(eventsAbs, events.join('\n') + '\n');
  else if (fs.existsSync(eventsAbs)) fs.unlinkSync(eventsAbs);
  // projection: canon IS the nexus-cortex dialect — materialize by reference
  writeIfChanged(path.join(STORE, 'projections', 'nexus-cortex', lf.rel + '.ref'), destRel + '\n');
  errors.push(...fileErrors);
  if (!fileErrors.length) manifest[lf.rel] = lf.sig; // failed files retry next run
  st.files++; st.messages += msgCount; st.events += events.length;
}

// ── docs the store carries about its own translation ───────────────────────
const MAPPING_MD = `# /canon — the canonical line

One canonical Message per line (schema: nexus-cortex \`packages/core/src/session/MessageTypes.ts\`,
spec: \`docs/CANON.md\`). Derived from /native by \`canon-translate\`; re-derivable at any time.

## claude-code → canon
- \`user\` / \`assistant\` / \`system\` / \`file-history-snapshot\` → canon Message.
  \`message\` bodies are VERBATIM (canonical ContentBlock is the Anthropic wire shape).
  Added: \`timeline\` {sessionId, conversationId=sessionId, turnNumber}, top-level
  \`model\` {id: message.model, provider: anthropic, apiPattern: messages}, top-level
  \`usage\` (camelCase view of message.usage), \`provenance\` {harness, native, line, ref}.
  All native fields retained — canon is a superset; nothing is lost at write time.
- turnNumber semantics: increments on each user PROMPT (user message with no
  tool_result block); assistant/tool/system records share the current turn.
- FRAGMENT MERGING: Claude Code's writer emits one record per content block
  (parallel tool calls = N assistant records sharing a requestId; results = N
  user records). Canon reconstructs the TRUE message boundary: consecutive
  same-requestId assistant fragments merge into one canonical assistant message
  (content blocks concatenated; \`mergedFrom\` lists absorbed uuids; parentUuid
  links into absorbed fragments are remapped), and consecutive tool-result-only
  user records merge likewise. Native fragment granularity remains in /native.
- ORPHAN-RESULT REPAIR: a tool_result whose tool_use record was never written
  (user-backgrounded tools interrupted mid-turn) gets a SYNTHETIC assistant
  tool_use emitted before it, marked \`synthetic: canon-orphan-result-repair\` —
  the canonical line is structurally valid for every consumer, and the repair
  is explicit, never silent. Tail-side DANGLING tool_use (live session snapshotted
  mid-call) is left as-is: the receiving harness's crash-repair handles it and
  the next sync completes the pair append-only.
- Every other record type (mode, permission-mode, last-prompt, ai-title, attachment,
  queue-operation, file-history-delta, started, result, unknown) → the
  \`<session>.events.jsonl\` sidecar, verbatim. Carried, never dropped.
- \`file-history-snapshot\` lacks uuid/timestamp natively → uuid=\`fhs-<messageId>\`,
  timestamp from snapshot.timestamp.

## nexus-cortex → canon
Identity + \`provenance\` stamp (the harness's native format IS canon).

## browser-cortex → canon
Identity + \`provenance\` stamp, same branch as nexus-cortex: the SPA's
CanonSyncService serializes browser CORTEX sessions (IndexedDB) into the
canonical envelope at capture time (secret-scrubbed in the browser), so
translation is identity plus the shared structural repairs (wrapped-block
normalization, duplicate-result drop, orphan-result synthetic repair).

## gemini-cli → canon (transcript-grade, chats format)
Per-session \`chats/session-*.jsonl\` (current CLI; subagent files under
\`chats/<sessionId>/\` share the format) — a mini event-sourced log: header +
\`{$set:{...}}\` patches + typed MessageRecords where a re-appended \`id\`
SUPERSEDES the earlier record (keep-last content at first-seen order; messages
inside \`$set.messages\` join the same resolution). \`user\` → user Message
(Parts→blocks); \`gemini\` → assistant: \`thoughts\` (subject: description) →
thinking blocks + content + \`toolCalls\` → \`tool_use\` (args as input), with
ONE paired user tool_result message following (embedded results; missing
results become synthetic marked errors); \`model\`/\`tokens\` → model/usage.
User records whose parts are all \`functionResponse\` (the wire-level duplicate
of the embedded toolCall results, with non-matching ids) → the event sidecar,
verbatim — never double-paired. Native ids/timestamps retained. info/error/
warning notices + header + \`$set\` patches → the event sidecar, verbatim.

## grok-build → canon (mixed-grade)
Per-session \`chat_history.jsonl\` (TRANSCRIPT-grade, where present): system →
SystemMessage; user → user Message (blocks passed through); assistant →
thinking block (xAI \`reasoning.text\`) + text + \`tool_calls\` (OpenAI flat
{id,name,arguments}) → \`tool_use\` blocks (arguments JSON-parsed, raw kept on
failure) + per-message \`model\` {model_id, xai, chat_completions};
tool_result → user tool_result block. Records carry NO native ids/timestamps:
uuid = \`gbc-<session>-<line>\` (deterministic), timestamp derived from the
session dir uuidv7 (first 48 bits = ms epoch), marked \`timestamp_source\`.
\`prompt_history.jsonl\` → user Messages (\`gbp-<session_id>-<line>\`).
Per-session \`events.jsonl\` telemetry (tool names/timings/phases, no content)
→ the \`.events.jsonl\` sidecar, verbatim. All native fields retained (superset).

## Provenance
\`provenance.ref\` = git BLOB SHA (12 hex) of the native file (or .part chunk)
containing the source line — content-stable, so re-translating unchanged natives
yields byte-identical canon. Each record is Merkle-anchored to its verbatim
native source through git's object model.

## Not yet translated
grok-build and gemini-cli natives are stored but have no adapter yet — see
TRANSLATED.md. Adapters live in the nexus-cortex library and arrive with Phase C.
`;

const PROJECTIONS_MD = `# /projections — canon fanned back out into each harness dialect

## nexus-cortex/
Canon IS the nexus-cortex dialect, so these projections are materialized BY
REFERENCE: each \`<path>.ref\` file contains the store-relative path of the canon
file to load. Resolution: read the ref, open that path (a \`.jsonl\`, or its
\`.part-NNNN\` chunks concatenated in order). To resume a session in the
nexus-cortex TUI, copy/cat the resolved file into \`.cortex/sessions/\`.

Byte-duplicating identity projections would double the repo for zero information;
refs keep the "repo speaks every dialect" contract explicit and cheap.

## Other dialects
Divergent projections (claude-code, gemini, grok renderings of canon) are produced
by the library's gateway adapters and arrive with Phase C (\`cortex canon translate\`).
Until then their absence is stated here rather than implied.
`;
  if (!fs.existsSync(path.join(STORE, '.git'))) {
    // Working clone is disposable (quota lesson 2026-07-27: keep it OFF the
    // workspace quota — pass --store /tmp/canon-store); remote is the truth.
    const CANON_REPO = requireCanonRepo(o.repoUrl, STORE, 'canon-translate');
    console.log(`[canon-translate] no store at ${STORE} — cloning ${redactRepoUrl(CANON_REPO)}`);
    canonGit(null, 'canon-translate')(['clone', '-q', CANON_REPO, STORE]);
  }
  const git = canonGit(STORE, 'canon-translate');
  blobs = blobMap();

  const claudeFiles = discover(path.join(STORE, 'native', 'claude-code'), 'claude-code');
  const cortexFiles = discover(path.join(STORE, 'native', 'nexus-cortex'), 'nexus-cortex');
  const browserFiles = discover(path.join(STORE, 'native', 'browser-cortex'), 'browser-cortex');
  const grokFiles = discover(path.join(STORE, 'native', 'grok-build'), 'grok-build');
  const geminiFiles = discover(path.join(STORE, 'native', 'gemini-cli'), 'gemini-cli');
  for (const lf of claudeFiles) await translateFile(lf, 'claude-code');
  for (const lf of cortexFiles) await translateFile(lf, 'nexus-cortex');
  for (const lf of browserFiles) await translateFile(lf, 'browser-cortex');
  for (const lf of grokFiles) await translateFile(lf, 'grok-build');
  for (const lf of geminiFiles) await translateFile(lf, 'gemini-cli');

  const translated = Object.values(stats).reduce((n, s) => n + s.files, 0);
  const repairNote = dupResults + orphanRepairs > 0 ? `, ${orphanRepairs} orphan-repair(s), ${dupResults} dup result(s) dropped` : '';
  const summary = `${translated} translated, ${unchanged} unchanged, ${errors.length} error(s)${repairNote}`;

  if (DRY) {
    console.log(`[canon-translate DRY] would translate ${translated} logical file(s), ${unchanged} unchanged`);
    return { translated, unchanged, errors, summary, pushed: false };
  }

  if (translated || errors.length) {
  const statLines = Object.entries(stats)
    .map(([h, s]) => `| ${h} | ${s.files} | ${s.messages} | ${s.events} |`)
    .join('\n');
  const eventLines = Object.entries(eventTypeCounts).sort()
    .map(([t, n]) => `- \`${t}\`: ${n}`).join('\n');
  writeIfChanged(path.join(STORE, 'canon', 'TRANSLATED.md'),
    `# Translation census (regenerated by canon-translate; counts are per-run deltas)\n\n` +
    `| harness | files (this run) | messages | events |\n|---|---|---|---|\n${statLines || '| — | 0 | 0 | 0 |'}\n\n` +
    `Sidecar event records this run:\n${eventLines || '- none'}\n\n` +
    `## Native-only (no adapter yet — visible, not silent)\n- gemini-cli legacy \`logs.json\` prompt logs (pre-chats versions — metadata stays native)\n` +
    `- nexus-cortex \`*.json\` metadata files (session metadata stays native)\n` +
    `- grok-build \`*.json\` sidecars (prompt_context/summary — metadata stays native)\n\n` +
    `## grok-build (MIXED-GRADE — see docs/HARNESS_ONBOARDING.md Appendix B)\n` +
    `Sessions carrying chat_history.jsonl are TRANSCRIPT-grade: full canonical\n` +
    `Messages (thinking from xAI reasoning.text, OpenAI tool_calls -> tool_use,\n` +
    `tool_result, per-message model provenance). Sessions without it are\n` +
    `telemetry-only (events sidecar + prompt_history user Messages). chat_history\n` +
    `records carry no native ids/timestamps: uuids are deterministic\n` +
    `gbc-<session>-<line>; timestamps derive from the session uuidv7.\n`);
  writeIfChanged(path.join(STORE, 'canon', 'MAPPING.md'), MAPPING_MD);
  writeIfChanged(path.join(STORE, 'projections', 'nexus-cortex', 'PROJECTIONS.md'), PROJECTIONS_MD);
  }

  const errPath = path.join(STORE, 'canon', 'TRANSLATE_ERRORS.md');
  if (errors.length) {
    fs.writeFileSync(errPath,
      `# Translate errors (current as of last run — failed files retry next run)\n\n` +
      errors.map((e) => `- ${e}\n`).join(''));
  } else if (fs.existsSync(errPath)) fs.unlinkSync(errPath);

  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest));

  let pushed = false;
  git(['add', '-A']);
  if (git(['status', '--porcelain']).trim()) {
    git(['commit', '-q', '-m', `canon-translate: ${summary}`]);
    git(['push', '-q', 'origin', 'main']);
    console.log(`[canon-translate] pushed: ${summary}`);
    pushed = true;
  } else {
    console.log(`[canon-translate] no changes (${summary})`);
  }
  if (errors.length) {
    for (const e of errors.slice(0, 10)) console.error('  error:', e);
  }
  return { translated, unchanged, errors, summary, pushed };
}
