/**
 * Prefix-stability (prompt-cache) MEASUREMENT harness — test-only.
 *
 * Drives the REAL orchestrator + REAL APIClient request builders + REAL provider SDKs, and intercepts at the HTTP boundary
 * (globalThis.fetch — every SDK and raw path goes through cortexProxyFetch, which reads globalThis.fetch at call time) or at the
 * @gradio/client boundary (hf-space, mocked in the test file). A scripted fake model answers each MAIN request in the transport's own
 * wire format; helper/mentor/judge calls (anything outside the main APIClient.sendRequest) get a generic helper reply.
 *
 * For each pair of consecutive MAIN requests it compares the canonical serialization of the cacheable prefix and reports the FIRST
 * divergence (request index, JSON path, before/after snippet). It never asserts stability — it is a measurement.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { APIClient, type APIResponse } from '../../APIClient.js';

// ─────────────────────────────────────────────────────────────────────────────
// Transports
// ─────────────────────────────────────────────────────────────────────────────
export type Wire = 'anthropic' | 'xai-messages' | 'chat' | 'responses' | 'gemini-http' | 'gemini-sdk' | 'hf-space';

export interface TransportSpec {
  key: string;          // table label
  modelId: string;      // registry card
  wire: Wire;
  /** chat-family: include reasoning_content on replies (DeepSeek / HF thinking models). */
  reasoningContent?: boolean;
  /** transport-specific env overrides (applied after .env.defaults). */
  env?: Record<string, string>;
}

export const TRANSPORTS: TransportSpec[] = [
  { key: 'anthropic-messages', modelId: 'claude-haiku-4-5', wire: 'anthropic' },
  // ENABLE_SERVER_SIDE_TOOLS=true (shipped default) moves xAI "messages" cards onto /v1/responses (hybrid server+client tools,
  // ServerSideToolDetection.ts) — so the default row exercises Responses; the second row pins the real /v1/messages builder.
  { key: 'xai-messages(default→responses)', modelId: 'grok-4.3', wire: 'responses' },
  { key: 'xai-messages(server-tools off)', modelId: 'grok-4.3', wire: 'xai-messages', env: { ENABLE_SERVER_SIDE_TOOLS: 'false' } },
  { key: 'chat-openai', modelId: 'gpt-4.1', wire: 'chat' },
  { key: 'chat-deepseek', modelId: 'deepseek-v4-flash', wire: 'chat', reasoningContent: true },
  { key: 'responses-openai', modelId: 'gpt-5-codex', wire: 'responses' },
  { key: 'responses-xai', modelId: 'grok-4.6-responses', wire: 'responses' },
  { key: 'gemini-generateContent', modelId: 'gemini-2.5-flash', wire: 'gemini-http' },
  { key: 'google-sdk', modelId: 'gemini-2.5-flash-sdk', wire: 'gemini-sdk' },
  { key: 'hf-space', modelId: 'hf-space', wire: 'hf-space', reasoningContent: true },
  // PREFIX_EFFORT_ROWS=1 (opt-in, so the default matrix is unchanged): reasoning cards for the effort-transport flags
  // (CORTEX_OPENAI_TOOLS_REASONING / CORTEX_ANTHROPIC_EFFORT / CORTEX_GEMINI_TOOLS_THINKING). Prove a flag with
  // PREFIX_DUMP_DIR off vs on + PREFIX_HARNESS_ENV='{"CORTEX_ACTION_EFFORT":"max",...}'.
  ...(process.env.PREFIX_EFFORT_ROWS === '1' ? [
    // gpt-5.6 declares supportsServerSideTools: with the shipped ENABLE_SERVER_SIDE_TOOLS=true it rides /v1/responses;
    // server-side tools off pins the chat/completions builder (the R19b drop site).
    { key: 'effort-chat-openai(gpt-5.6, server-tools off)', modelId: 'gpt-5.6', wire: 'chat' as Wire, env: { ENABLE_SERVER_SIDE_TOOLS: 'false' } },
    { key: 'effort-responses-openai(gpt-5.6 default)', modelId: 'gpt-5.6', wire: 'responses' as Wire },
    { key: 'effort-anthropic-adaptive(sonnet-5)', modelId: 'claude-sonnet-5', wire: 'anthropic' as Wire },
    { key: 'effort-anthropic-budget(sonnet-4.6)', modelId: 'claude-sonnet-4-6', wire: 'anthropic' as Wire },
    { key: 'effort-gemini3-rest(3.7-flash)', modelId: 'gemini-3.7-flash', wire: 'gemini-http' as Wire },
  ] : []),
];

// ─────────────────────────────────────────────────────────────────────────────
// Scripted fake model
// ─────────────────────────────────────────────────────────────────────────────
export interface ToolCallSpec { tool: string; input: Record<string, unknown> }
export type Action =
  | { kind: 'tools'; calls: ToolCallSpec[] }
  | { kind: 'text'; text: string }
  | { kind: 'wall' };

/** idx = 0-based MAIN request index; toolNames = the tool names present in THIS request (provider spelling). */
export type Script = (idx: number, ctx: { toolNames: string[]; body: any }) => Action;

export interface Captured {
  seq: number;            // global sequence (main + helper)
  role: 'main' | 'helper';
  mainIdx?: number;
  url: string;
  wire: Wire | 'unknown';
  body: any;              // parsed request body (hf-space: { messages, tools, max_tokens, temperature })
  responseId?: string;    // responses wire: id we returned
  responseOutput?: any[]; // responses wire: output items we returned
  action?: Action;
}

const mainCtx = new AsyncLocalStorage<{ main: true }>();

/** Real APIClient whose requests are tagged MAIN (helper middleware never goes through this instance). */
export class TaggingAPIClient extends APIClient {
  override async sendRequest(req: any, cfg: any): Promise<APIResponse> {
    return mainCtx.run({ main: true }, () => super.sendRequest(req, cfg));
  }
  override streamRequest(req: any, cfg: any): any {
    return mainCtx.run({ main: true }, () => super.streamRequest(req, cfg));
  }
}

const BIG_WALL = 'spiral '.repeat(4000);

function wireOfUrl(url: string): Wire | 'unknown' {
  if (url.includes('api.anthropic.com') && url.includes('/messages')) return 'anthropic';
  if (url.includes('api.x.ai') && url.includes('/messages')) return 'xai-messages';
  if (url.includes('/chat/completions')) return 'chat';
  if (url.includes('/responses')) return 'responses';
  if (url.includes('generativelanguage.googleapis.com') && url.includes('generateContent')) return 'gemini-http';
  return 'unknown';
}

export function toolNamesOf(wire: Wire | 'unknown', body: any): string[] {
  const t = body?.tools;
  if (!Array.isArray(t)) return [];
  switch (wire) {
    case 'anthropic': case 'xai-messages': return t.map((x: any) => x?.name).filter(Boolean);
    case 'chat': case 'hf-space': return t.map((x: any) => x?.function?.name ?? x?.name).filter(Boolean);
    case 'responses': return t.map((x: any) => x?.name ?? x?.function?.name ?? x?.type).filter(Boolean);
    case 'gemini-http': case 'gemini-sdk':
      return t.flatMap((x: any) => (x?.function_declarations ?? x?.functionDeclarations ?? []).map((d: any) => d?.name)).filter(Boolean);
    default: return [];
  }
}

/** Map a logical tool name ('bash', 'grep', 'web_fetch'…) to the provider spelling present in the request (or a best guess). */
export function resolveToolName(logical: string, available: string[]): string {
  const norm = (s: string) => s.toLowerCase().replace(/[_\-\s]/g, '');
  const hit = available.find((n) => norm(n) === norm(logical));
  if (hit) return hit;
  // Not in this request's tools array (deferred): guess the naming convention from what IS there.
  const snake = available.some((n) => /_/.test(n) || /^[a-z]+$/.test(n));
  const pascal = available.some((n) => /^[A-Z]/.test(n));
  if (pascal && !snake) return logical.split(/[_\s-]/).map((p) => p[0]!.toUpperCase() + p.slice(1)).join('');
  return logical.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
}

let callCounter = 0;
function render(wire: Wire, spec: TransportSpec | undefined, action: Action, n: number, toolNames: string[]): { json?: any; raw?: string; responseId?: string; output?: any[] } {
  const calls = action.kind === 'tools' ? action.calls.map((c) => ({ id: `call_${n}_${++callCounter}`, name: resolveToolName(c.tool, toolNames), input: c.input })) : [];
  const reasoning = `plan step ${n}`;
  switch (wire) {
    case 'anthropic': case 'xai-messages': {
      const content: any[] = [];
      let stop = 'end_turn';
      if (action.kind === 'wall') { content.push({ type: 'thinking', thinking: BIG_WALL, signature: `sigw${n}` }); stop = 'max_tokens'; }
      else {
        content.push({ type: 'thinking', thinking: reasoning, signature: `sig${n}` });
        if (action.kind === 'text') content.push({ type: 'text', text: action.text });
        for (const c of calls) content.push({ type: 'tool_use', id: `toolu_${c.id}`, name: c.name, input: c.input });
        if (calls.length) stop = 'tool_use';
      }
      return { json: { id: `msg_${n}`, type: 'message', role: 'assistant', model: 'm', content, stop_reason: stop, stop_sequence: null,
        usage: { input_tokens: 1000 + 10 * n, output_tokens: action.kind === 'wall' ? 65536 : 20 } } };
    }
    case 'chat': case 'hf-space': {
      const msg: any = { role: 'assistant', content: action.kind === 'text' ? action.text : (action.kind === 'wall' ? '' : null) };
      if (spec?.reasoningContent) msg.reasoning_content = action.kind === 'wall' ? BIG_WALL : reasoning;
      if (calls.length) msg.tool_calls = calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } }));
      const finish = action.kind === 'wall' ? 'length' : calls.length ? 'tool_calls' : 'stop';
      if (wire === 'hf-space') {
        let raw = spec?.reasoningContent ? `<think>${action.kind === 'wall' ? BIG_WALL : reasoning}</think>\n` : '';
        if (action.kind === 'text') raw += action.text;
        for (const c of calls) raw += `<tool_call>${JSON.stringify({ name: c.name, arguments: c.input })}</tool_call>`;
        return { raw };
      }
      return { json: { id: `chatcmpl-${n}`, object: 'chat.completion', created: 1700000000 + n, model: 'm',
        choices: [{ index: 0, message: msg, finish_reason: finish, logprobs: null }],
        usage: { prompt_tokens: 1000 + 10 * n, completion_tokens: action.kind === 'wall' ? 65536 : 20, total_tokens: 1020 + 10 * n } } };
    }
    case 'responses': {
      const output: any[] = [];
      if (action.kind === 'wall') output.push({ type: 'reasoning', id: `rs_${n}`, summary: [{ type: 'summary_text', text: BIG_WALL }] });
      else {
        output.push({ type: 'reasoning', id: `rs_${n}`, summary: [{ type: 'summary_text', text: reasoning }] });
        if (action.kind === 'text') output.push({ type: 'message', id: `msg_${n}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: action.text, annotations: [] }] });
        for (const c of calls) output.push({ type: 'function_call', id: `fc_${c.id}`, call_id: c.id, name: c.name, arguments: JSON.stringify(c.input), status: 'completed' });
      }
      const id = `resp_${n}_${Math.random().toString(36).slice(2, 8)}`;
      return { responseId: id, output, json: { id, object: 'response', created_at: 1700000000 + n, model: 'm',
        status: action.kind === 'wall' ? 'incomplete' : 'completed',
        incomplete_details: action.kind === 'wall' ? { reason: 'max_output_tokens' } : null,
        output, usage: { input_tokens: 1000 + 10 * n, output_tokens: action.kind === 'wall' ? 65536 : 20, total_tokens: 1020 + 10 * n } } };
    }
    case 'gemini-http': case 'gemini-sdk': {
      const parts: any[] = [];
      let finish = 'STOP';
      // The harness never sets thinkingConfig.includeThoughts, so Gemini returns NO thought parts (only thoughtsTokenCount):
      // a reasoning wall is MAX_TOKENS with an empty candidate.
      if (action.kind === 'wall') { finish = 'MAX_TOKENS'; }
      else {
        if (action.kind === 'text') parts.push({ text: action.text });
        for (const c of calls) parts.push({ functionCall: { name: c.name, args: c.input } });
      }
      return { json: { candidates: [{ content: { role: 'model', parts }, finishReason: finish, index: 0 }],
        usageMetadata: { promptTokenCount: 1000 + 10 * n, candidatesTokenCount: action.kind === 'wall' ? 0 : 20, thoughtsTokenCount: action.kind === 'wall' ? 65536 : 10, totalTokenCount: 1020 + 10 * n },
        modelVersion: 'm', responseId: `g_${n}` } };
    }
  }
}

const HELPER_TEXT = 'CONCLUDED: inspected the workspace\nSTUCK ON: nothing\nNEXT: run the next command';

function jsonResponse(obj: any): Response {
  return new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });
}

/** A recorder + fake network for one session. */
export class FakeNetwork {
  public captured: Captured[] = [];
  private seq = 0;
  private mainIdx = 0;
  private origFetch: typeof fetch | undefined;
  constructor(public readonly spec: TransportSpec, public script: Script) {}

  get mains(): Captured[] { return this.captured.filter((c) => c.role === 'main'); }

  install(): void {
    this.origFetch = globalThis.fetch;
    const self = this;
    globalThis.fetch = (async (input: any, init?: any): Promise<Response> => {
      let url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url ?? String(input);
      let bodyText: string | undefined = typeof init?.body === 'string' ? init.body : undefined;
      if (bodyText === undefined && input && typeof input === 'object' && typeof input.text === 'function' && !(input instanceof URL)) {
        try { bodyText = await input.clone().text(); } catch { /* ignore */ }
      }
      if (bodyText === undefined && init?.body && typeof init.body !== 'string') {
        try { bodyText = await new Response(init.body).text(); } catch { /* ignore */ }
      }
      const wire = wireOfUrl(url);
      if (wire === 'unknown') {
        // Never let a request leave the process.
        return new Response('not found (prefix harness)', { status: 404 });
      }
      let body: any = undefined;
      try { body = bodyText ? JSON.parse(bodyText) : undefined; } catch { body = bodyText; }
      const isMain = !!mainCtx.getStore();
      const effWire: Wire = (wire === 'gemini-http' && self.spec.wire === 'gemini-sdk' && isMain) ? 'gemini-sdk' : wire;
      return jsonResponse(self.respond(url, effWire, body, isMain).json);
    }) as typeof fetch;
  }

  /** hf-space boundary (@gradio/client predict) — called by the test's vi.mock. */
  gradioPredict(args: any[]): { data: any[] } {
    const isMain = !!mainCtx.getStore();
    let messages: any, tools: any;
    try { messages = JSON.parse(args[0]); } catch { messages = args[0]; }
    try { tools = args[1] ? JSON.parse(args[1]) : undefined; } catch { tools = args[1]; }
    const body = { messages, tools, max_tokens: args[2], temperature: args[3] };
    const r = this.respond('gradio:/run', 'hf-space', body, isMain);
    return { data: [r.raw ?? ''] };
  }

  private respond(url: string, wire: Wire, body: any, isMain: boolean): { json?: any; raw?: string } {
    const seq = ++this.seq;
    if (!isMain) {
      const r = render(wire, undefined, { kind: 'text', text: HELPER_TEXT }, 900 + seq, []);
      this.captured.push({ seq, role: 'helper', url, wire, body });
      return r;
    }
    const idx = this.mainIdx++;
    const toolNames = toolNamesOf(wire, body);
    let action: Action;
    try { action = this.script(idx, { toolNames, body }); } catch { action = { kind: 'text', text: 'FINAL: done.' }; }
    const r = render(wire, this.spec, action, idx + 1, toolNames);
    this.captured.push({ seq, role: 'main', mainIdx: idx, url, wire, body, action, responseId: r.responseId, responseOutput: r.output });
    return r;
  }

  uninstall(): void { if (this.origFetch) globalThis.fetch = this.origFetch; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Prefix canonicalization + divergence
// ─────────────────────────────────────────────────────────────────────────────
/** Ordered prefix units: [label, value]. cache_control markers are stripped (they are breakpoint markers, not prefix content). */
export type Unit = [string, unknown];

function stripCacheControl(v: any): any {
  if (Array.isArray(v)) return v.map(stripCacheControl);
  if (v && typeof v === 'object') {
    const o: any = {};
    for (const k of Object.keys(v)) if (k !== 'cache_control') o[k] = stripCacheControl(v[k]);
    return o;
  }
  return v;
}

export function prefixUnits(wire: Wire, body: any): Unit[] {
  const b = stripCacheControl(body ?? {});
  const units: Unit[] = [];
  const msgs = (label: string, arr: any) => { if (Array.isArray(arr)) arr.forEach((m, i) => units.push([`${label}[${i}]`, m])); };
  switch (wire) {
    case 'anthropic': case 'xai-messages':
      // Anthropic cache hierarchy: tools → system → messages; thinking / tool_choice changes invalidate messages.
      units.push(['tools', b.tools ?? null], ['system', b.system ?? null], ['thinking', b.thinking ?? null], ['tool_choice', b.tool_choice ?? null]);
      msgs('messages', b.messages);
      break;
    case 'chat': case 'hf-space':
      units.push(['tools', b.tools ?? null], ['tool_choice', b.tool_choice ?? null]);
      msgs('messages', b.messages);
      break;
    case 'responses':
      units.push(['instructions', b.instructions ?? null], ['tools', b.tools ?? null], ['tool_choice', b.tool_choice ?? null]);
      msgs('input', b.input);
      break;
    case 'gemini-http':
      units.push(['system_instruction', b.system_instruction ?? b.systemInstruction ?? null], ['tools', b.tools ?? null], ['tool_config', b.tool_config ?? b.toolConfig ?? null]);
      msgs('contents', b.contents);
      break;
    case 'gemini-sdk':
      units.push(['systemInstruction', b.systemInstruction ?? b.system_instruction ?? null], ['tools', b.tools ?? null], ['toolConfig', b.toolConfig ?? b.tool_config ?? null]);
      msgs('contents', b.contents);
      break;
  }
  return units;
}

/** First differing JSON path between a and b ('' when equal). */
export function firstDiffPath(a: any, b: any, path = ''): string {
  if (a === b) return '';
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return path || '(root)';
  if (Array.isArray(a) !== Array.isArray(b)) return path || '(root)';
  if (Array.isArray(a)) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) { const p = firstDiffPath(a[i], b[i], `${path}[${i}]`); if (p) return p; }
    return a.length !== b.length ? `${path}.length(${a.length}→${b.length})` : '';
  }
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  for (const k of keys) {
    if (!(k in a)) return `${path}.${k}(added)`;
    if (!(k in b)) return `${path}.${k}(removed)`;
    const p = firstDiffPath(a[k], b[k], `${path}.${k}`);
    if (p) return p;
  }
  return '';
}

function getAt(v: any, path: string): any {
  const parts = path.replace(/\(.*\)$/, '').match(/[^.[\]]+/g) ?? [];
  let cur = v;
  for (const p of parts) { if (cur == null) return undefined; cur = cur[/^\d+$/.test(p) ? Number(p) : p]; }
  return cur;
}

function snip(v: any, max = 160): string {
  if (v === undefined) return '(absent)';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s === undefined) return String(v);
  if (s.length <= max) return s;
  return `${s.slice(0, Math.floor(max / 2))} … ${s.slice(-Math.floor(max / 2))} [${s.length} chars]`;
}

/** For strings: show the region around the first differing character. */
function strDiffSnip(a: string, b: string): { before: string; after: string } {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - 40);
  return { before: `@${i}: …${a.slice(from, i + 80)}…`, after: `@${i}: …${b.slice(from, i + 80)}…` };
}

export interface Divergence {
  from: number;           // main request index N (compared against N+1)
  unit: string;           // first divergent unit label
  path: string;           // full JSON path
  before: string;
  after: string;
  tailOnly: boolean;      // divergence is in N's LAST message unit (cache up to the previous message survives)
  keptPct: number;        // % of N's prefix units (by serialized bytes) that precede the divergence
  note?: string;
}

export interface PairResult { n: number; stable: boolean; div?: Divergence; divs: Divergence[]; chained?: boolean; paramChanges: string[] }

/** Cache-relevant request parameters outside the prefix units (reasoning / thinking mode). Reported, not counted as divergence
 *  (Anthropic `thinking` IS a prefix unit — it invalidates the messages cache). */
function paramChanges(wire: Wire, a: any, b: any): string[] {
  const keys: string[][] = wire === 'chat' || wire === 'hf-space' ? [['reasoning_effort'], ['thinking']]
    : wire === 'responses' ? [['reasoning']]
    : wire === 'gemini-http' ? [['generation_config', 'thinkingConfig'], ['generation_config', 'thinking_config']]
    : wire === 'gemini-sdk' ? [['generationConfig', 'thinkingConfig']]
    : [['output_config']];
  const out: string[] = [];
  for (const k of keys) {
    const va = k.reduce((o: any, p) => (o == null ? o : o[p]), a); const vb = k.reduce((o: any, p) => (o == null ? o : o[p]), b);
    if (JSON.stringify(va) !== JSON.stringify(vb)) out.push(`${k.join('.')}: ${JSON.stringify(va) ?? '—'}→${JSON.stringify(vb) ?? '—'}`);
  }
  return out;
}

const isMsgUnit = (label: string) => /\[\d+\]$/.test(label);

/** Compare request N (prev) → N+1 (next). Reports up to two divergences: the first HEAD unit (tools/system/instructions/…) and the
 *  first MESSAGE unit — so a tools-array change does not mask a history rewrite in the same pair. */
export function comparePair(wire: Wire, prev: Captured, next: Captured, n: number): PairResult {
  const pu = prefixUnits(wire, prev.body);
  const nu = prefixUnits(wire, next.body);
  const divs: Divergence[] = [];
  // Responses chaining: N+1 carries previous_response_id → the server holds N's context; N+1.input must only APPEND.
  const chained = wire === 'responses' && !!next.body?.previous_response_id;
  if (chained) {
    for (const lbl of ['instructions', 'tools', 'tool_choice']) {
      const a = pu.find((u) => u[0] === lbl)?.[1]; const b = nu.find((u) => u[0] === lbl)?.[1];
      const p = firstDiffPath(a, b, lbl);
      if (p) { divs.push(mkDiv(n, lbl, p, a, b, false, 0, 'chained request: head changed')); break; }
    }
    if (next.body.previous_response_id !== prev.responseId) {
      divs.push({ from: n, unit: 'previous_response_id', path: 'previous_response_id', before: String(prev.responseId), after: String(next.body.previous_response_id), tailOnly: false, keptPct: 0, note: 'chain points at a response other than N' });
    } else {
      // duplicate replay: any N+1 input item equal to an item N already sent / the server already holds
      const prevItems = new Set([...(prev.body?.input ?? []), ...(prev.responseOutput ?? [])].map((x: any) => JSON.stringify(stripCacheControl(x))));
      const dup = (next.body?.input ?? []).findIndex((x: any) => prevItems.has(JSON.stringify(stripCacheControl(x))));
      if (dup >= 0) divs.push({ from: n, unit: `input[${dup}]`, path: `input[${dup}]`, before: '(already held server-side)', after: snip(next.body.input[dup]), tailOnly: false, keptPct: 100, note: 'chained request re-sends an item the server already holds' });
    }
    return { n, stable: divs.length === 0, div: divs[0], divs, chained, paramChanges: paramChanges(wire, prev.body, next.body) };
  }
  const total = pu.reduce((s, u) => s + JSON.stringify(u[1] ?? null).length, 0) || 1;
  let kept = 0; let headDone = false;
  const lastMsgLabel = [...pu].reverse().find((u) => isMsgUnit(u[0]))?.[0];
  for (let i = 0; i < pu.length; i++) {
    const [lbl, a] = pu[i]!;
    const msg = isMsgUnit(lbl);
    if (!msg && headDone) { kept += JSON.stringify(a ?? null).length; continue; }
    const nuHit = nu.find((u) => u[0] === lbl);
    const pct = () => Math.round((100 * kept) / total);
    if (!nuHit) {
      divs.push(mkDiv(n, lbl, `${lbl}(missing in N+1)`, a, undefined, lbl === lastMsgLabel, pct()));
      if (msg) break; headDone = true; continue;
    }
    const p = firstDiffPath(a, nuHit[1], lbl);
    if (p) {
      divs.push(mkDiv(n, lbl, p, a, nuHit[1], lbl === lastMsgLabel, pct()));
      if (msg) break; headDone = true; continue;
    }
    kept += JSON.stringify(a ?? null).length;
  }
  return { n, stable: divs.length === 0, div: divs[0], divs, paramChanges: paramChanges(wire, prev.body, next.body) };
}

/** Tool names in a request body (provider spelling), for tools-array diffs. */
export function toolList(wire: Wire, body: any): string[] { return toolNamesOf(wire, body); }

function mkDiv(n: number, unit: string, path: string, a: any, b: any, tailOnly: boolean, keptPct: number, note?: string): Divergence {
  const rel = path.startsWith(unit) ? path.slice(unit.length) : path;
  const va = rel ? getAt(a, rel) : a; const vb = rel ? getAt(b, rel) : b;
  let before = snip(va), after = snip(vb);
  if (typeof va === 'string' && typeof vb === 'string') ({ before, after } = strDiffSnip(va, vb));
  return { from: n, unit, path, before, after, tailOnly, keptPct, ...(note ? { note } : {}) };
}

export function analyse(wire: Wire, mains: Captured[]): PairResult[] {
  const out: PairResult[] = [];
  for (let i = 0; i + 1 < mains.length; i++) out.push(comparePair(wire, mains[i]!, mains[i + 1]!, i));
  return out;
}
