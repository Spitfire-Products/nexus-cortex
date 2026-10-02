/**
 * PREFIX-STABILITY (prompt-cache) MEASUREMENT — every transport × scripted session scenario.
 *
 * Real orchestrator + real middleware + real GatewayTranslationLayer + real APIClient builders + real provider SDKs; the network is
 * faked at globalThis.fetch (and @gradio/client for hf-space) by prefix/prefixHarness.ts. Env = the shipped `.env.defaults`
 * (production defaults, exactly as bootstrapEnv layers them) + each scenario's levers. For every pair of consecutive MAIN requests the
 * canonical cacheable prefix is compared and the FIRST divergence is reported.
 *
 * This is a MEASUREMENT: it passes whether or not divergences exist (only crashes fail). The table is printed and written to
 * omniclaude-v4/.cortex/research/prefix-stability-2026-10-02.md.
 *
 * Two loop modes: `send` = orchestrator.sendMessage (non-streaming loop, the headless/bench path); `stream` = orchestrator.streamMessage
 * (streaming loop) — in stream mode the wire request is still built by the NON-streaming APIClient builder (the fake network answers
 * JSON, not SSE), so `stream` measures the streaming ORCHESTRATOR loop's history construction, not the streaming body builders.
 */
import { describe, it, vi, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const H = vi.hoisted(() => { process.env.HF_SPACE_ID = 'prefix-harness/fake-space'; return { net: null as any }; });
vi.mock('@gradio/client', () => ({ Client: { connect: async () => ({ predict: async (_ep: string, args: any[]) => H.net.gradioPredict(args) }) } }));

import { createOrchestrator } from '../OrchestratorFactory.js';
import { parseEnvFile } from '../../config/SettingsLoader.js';
import { FakeNetwork, TaggingAPIClient, TRANSPORTS, analyse, toolList, type Action, type Captured, type Divergence, type PairResult, prefixUnits, type TransportSpec, type Wire } from './prefix/prefixHarness.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../../..'); // omniclaude-v4
const OUT = path.join(REPO, '.cortex/research/prefix-stability-2026-10-02.md');
// Flag A/B: PREFIX_EXTRA_ENV='{"CORTEX_X":"on"}' layers levers over every cell (after the scenario env); PREFIX_OUT_TAG names the
// partial report (prefix-stability-2026-10-02.<tag>.partial.md) so flag-on runs never overwrite the baseline.
const EXTRA_ENV: Record<string, string> = (() => { try { return JSON.parse(process.env.PREFIX_EXTRA_ENV || '{}'); } catch { return {}; } })();
const OUT_TAG = (process.env.PREFIX_OUT_TAG || '').replace(/[^A-Za-z0-9_-]/g, '');

// ─────────────────────────────────────────────────────────────────────────────
// env
// ─────────────────────────────────────────────────────────────────────────────
const HARNESS_ENV_PREFIX = /^(CORTEX_|ENABLE_|ANTHROPIC_|HELPER_|DEFAULT_MODEL|MENTORSHIP_|XAI_|OPENAI_|DEEPSEEK_|GEMINI_|GOOGLE_|HF_|TOOL_|DEBUG)/;
function applyProductionEnv(overrides: Record<string, string>): () => void {
  const saved = { ...process.env };
  // PREFIX_HARNESS_ENV='{"FLAG":"on",...}' layers extra levers over every cell (prove a dark fix with a filtered -t run).
  let extra: Record<string, string> = {};
  try { extra = JSON.parse(process.env.PREFIX_HARNESS_ENV || '{}'); } catch { /* ignore malformed */ }
  for (const k of Object.keys(process.env)) if (HARNESS_ENV_PREFIX.test(k) && k !== 'HF_SPACE_ID') delete process.env[k];
  const defaults = parseEnvFile(fs.readFileSync(path.join(REPO, '.env.defaults'), 'utf-8')) as Record<string, string | undefined>;
  for (const [k, v] of Object.entries(defaults)) if (v !== undefined && v !== '' && process.env[k] === undefined) process.env[k] = v;
  for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'DEEPSEEK_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'HF_TOKEN']) process.env[k] = 'fake-key-prefix-harness';
  process.env.HF_SPACE_ID = 'prefix-harness/fake-space';
  delete process.env.CORTEX_PROXY_BASE_URL;
  for (const [k, v] of Object.entries(overrides)) process.env[k] = v;
  for (const [k, v] of Object.entries(extra)) process.env[k] = String(v);
  return () => { process.env = saved; };
}

// ─────────────────────────────────────────────────────────────────────────────
// scripted turns
// ─────────────────────────────────────────────────────────────────────────────
type Step = Action | { act: Action; before: (orch: any) => void };
const bash = (command: string): Action => ({ kind: 'tools', calls: [{ tool: 'bash', input: { command, description: 'step' } }] });
const bash2 = (a: string, b: string): Action => ({ kind: 'tools', calls: [{ tool: 'bash', input: { command: a, description: 'a' } }, { tool: 'bash', input: { command: b, description: 'b' } }] });
const tool = (name: string, input: Record<string, unknown>): Action => ({ kind: 'tools', calls: [{ tool: name, input }] });
const WALL: Action = { kind: 'wall' };
const END_TURN: Action = tool('end_turn', {
  citations: [], verification: [{ command: 'echo one', observed_result: 'one' }], summary: 'Ran the requested steps.', open_items: [],
  self_review: 'Only echo/ls commands were run; nothing else was verified.',
});

interface Scenario {
  id: string;
  title: string;
  env: Record<string, string>;
  turns: Step[][];           // one step list per user message
  gitInit?: boolean;
  loopControl?: Record<string, number>;
  /** scenario-specific observations from the captured requests. */
  probe?: (mains: Captured[], wire: Wire) => string;
}

const hasText = (c: Captured, s: string) => JSON.stringify(c.body ?? '').includes(s);
const forcedChoice = (b: any) => !!(b?.tool_choice && typeof b.tool_choice === 'object' && (b.tool_choice.name || b.tool_choice.function || b.tool_choice.type === 'function' || b.tool_choice.type === 'tool'))
  || !!(b?.tool_config?.function_calling_config?.mode === 'ANY' || b?.toolConfig?.functionCallingConfig?.mode === 'ANY');

const SCENARIOS: Scenario[] = [
  {
    id: 'a', title: 'plain multi-step Bash loop', env: {},
    turns: [[bash('echo one'), bash2('echo two', 'echo three'), bash('ls')]],
  },
  {
    id: 'b', title: 'first use of a non-essential tool mid-session (SearchTools discovery → list_sessions) + anchor lift', env: {},
    turns: [[bash('echo one'), bash('echo two'), tool('search_tools', { query: 'list sessions' }), tool('list_sessions', {}), bash('echo three')]],
    probe: (m, w) => {
      const counts = m.map((c) => (Array.isArray(c.body?.tools) ? (w.startsWith('gemini') && c.body.tools[0]?.function_declarations ? c.body.tools[0].function_declarations.length : c.body.tools.length) : 0));
      return `tool counts per request: ${counts.join(',')}`;
    },
  },
  {
    id: 'c1', title: 'reasoning-exhaustion WALL, CORTEX_WALL_DROP=on', env: { CORTEX_WALL_DROP: 'on' },
    turns: [[bash('echo one'), WALL, bash('echo two'), bash('echo three')]],
    probe: (m) => wallProbe(m),
  },
  {
    id: 'c2', title: 'WALL with CORTEX_WALL_DROP=on + CORTEX_WALL_SUMMARY=on (helper stubbed by the fake network)', env: { CORTEX_WALL_DROP: 'on', CORTEX_WALL_SUMMARY: 'on' },
    turns: [[bash('echo one'), WALL, bash('echo two'), bash('echo three')]],
    probe: (m) => wallProbe(m) + (m.some((c) => hasText(c, 'summary written by the harness')) ? '; summary delivered' : '; summary NOT seen in any request'),
  },
  {
    id: 'c3', title: 'WALL with CORTEX_WALL_DROP=on + CORTEX_RESPONSES_STOP_REASON=on (R216: Responses stop reason, so the wall is classifiable there)',
    env: { CORTEX_WALL_DROP: 'on', CORTEX_RESPONSES_STOP_REASON: 'on' },
    turns: [[bash('echo one'), WALL, bash('echo two'), bash('echo three')]],
    probe: (m) => wallProbe(m),
  },
  {
    id: 'c0', title: 'WALL with drop unset (production default)', env: {},
    turns: [[bash('echo one'), WALL, bash('echo two'), bash('echo three')]],
    probe: (m) => wallProbe(m),
  },
  {
    id: 'd', title: 'forced mentor tool_choice (CORTEX_MENTOR_FORCE=true + failing Bash thrash; thrash thresholds lowered so it fires before the LoopLadder break)',
    env: { CORTEX_MENTOR_FORCE: 'true', CORTEX_THRASH_FAILS: '2', CORTEX_THRASH_WINDOW: '3', CORTEX_THRASH_MIN_TURNS: '2' },
    turns: [[bash('cat /nonexistent-a'), bash('ls /nonexistent-b'), bash('stat /nonexistent-c'), bash('echo ok'), bash('echo ok2')]],
    probe: (m) => {
      const idx = m.filter((c) => forcedChoice(c.body)).map((c) => c.mainIdx);
      return idx.length ? `forced tool_choice on request(s) ${idx.join(',')}` : 'forced tool_choice NEVER reached';
    },
  },
  {
    id: 'e', title: 'mentor insight injected mid-loop (injectGuidance) + turn-end cleanup, then a 2nd user turn', env: {},
    turns: [[bash('echo one'), { act: bash('echo two'), before: (o) => o.injectGuidance('Try listing the directory first.', 'guidance') }, bash('echo three')],
      [bash('echo four')]],
    probe: (m) => {
      const seen = m.filter((c) => hasText(c, 'AI Mentor Insight')).map((c) => c.mainIdx);
      return seen.length ? `mentor insight present in request(s) ${seen.join(',')}` : 'mentor insight never on the wire';
    },
  },
  {
    id: 'f', title: 'first-turn injected content (git repo-state + deferred-tool announcement) vs continuations, 2 user turns', env: {}, gitInit: true,
    turns: [[bash('echo one'), bash('echo two')], [bash('echo three')]],
    probe: (m) => {
      const inj = m.filter((c) => hasText(c, '<harness-note')).map((c) => c.mainIdx);
      return `harness-note present in request(s) ${inj.join(',') || 'none'}`;
    },
  },
  {
    id: 'g', title: 'steering appends: TURN_STATUS=on + deadline, tool-budget + outcome-ladder signals', env: { CORTEX_TURN_STATUS: 'on', CORTEX_TURN_DEADLINE_MS: '3600000' },
    loopControl: { toolBudgetSoft: 3 },
    turns: [[bash('ls /nonexistent-zz'), bash('ls /nonexistent-zz'), bash('ls /nonexistent-zz'), bash('ls /nonexistent-zz'), bash('echo ok'), bash('echo ok2')]],
    probe: (m) => {
      const kinds = ['STATUS:', 'WALL BUDGET', 'tool calls', 'same approach'].filter((s) => m.some((c) => hasText(c, s)));
      return `signals seen: ${kinds.join(', ') || 'none'}`;
    },
  },
  {
    id: 'h', title: 'Responses chaining across a multi-step loop + 2nd user turn (previous_response_id slicing)', env: {},
    turns: [[bash('echo one'), bash2('echo two', 'echo three'), bash('echo four')], [bash('echo five'), bash('echo six')]],
    probe: (m, w) => (w === 'responses' ? `previous_response_id on: ${m.map((c) => (c.body?.previous_response_id ? 'Y' : 'n')).join('')}` : ''),
  },
];

function wallProbe(m: Captured[]): string {
  const wallIdx = m.findIndex((c) => c.action?.kind === 'wall');
  if (wallIdx < 0) return 'wall never scripted';
  const after = m.slice(wallIdx + 1);
  const carries = after.map((c) => (hasText(c, 'spiral spiral') ? 'W' : '.')).join('');
  const nudge = after.map((c) => (hasText(c, 'ENTIRE output budget') ? 'N' : '.')).join('');
  return `after the wall (req ${wallIdx}): walled-turn-on-wire=${carries} nudge-on-wire=${nudge}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// runner
// ─────────────────────────────────────────────────────────────────────────────
type Mode = 'send' | 'stream';

/** In stream mode: drive the streaming loop but build/answer the request through the non-streaming APIClient builder. */
class StreamViaSendClient extends TaggingAPIClient {
  override streamRequest(req: any, cfg: any): any {
    // The gateway set parameters.stream=true for the streaming loop; the non-streaming builder must not forward it (the SDKs would
    // return a Stream object). Everything else in the request is untouched.
    const { stream: _s, ...parameters } = req.parameters ?? {};
    const p = this.sendRequest({ ...req, parameters }, cfg).then((r) => r.data);
    async function* none(): AsyncGenerator<any> { /* finalMessage carries the content */ }
    return { chunks: none(), finalMessage: p };
  }
}

interface CellResult { scenario: Scenario; spec: TransportSpec; mode: Mode; mains: Captured[]; helpers: number; pairs: PairResult[]; error?: string; probe?: string }
const RESULTS: CellResult[] = [];

async function runCell(scenario: Scenario, spec: TransportSpec, mode: Mode): Promise<CellResult> {
  const restore = applyProductionEnv({ ...(spec.env ?? {}), ...scenario.env, ...EXTRA_ENV });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prefix-'));
  if (scenario.gitInit) {
    try {
      fs.writeFileSync(path.join(dir, 'README.md'), '# fixture\n');
      execSync('git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm init && echo dirty >> README.md', { cwd: dir, stdio: 'ignore' });
    } catch { /* git missing → probe will show it */ }
  }
  let orchRef: any;
  let turn = 0;
  const queues = scenario.turns.map((t) => [...t]);
  const endTurnCalled = scenario.turns.map(() => false);
  const perTurnCalls = scenario.turns.map(() => 0);
  const net = new FakeNetwork(spec, (_idx, ctx) => {
    const t = Math.min(turn, queues.length - 1);
    perTurnCalls[t]! += 1;
    if (perTurnCalls[t]! > 30) return { kind: 'text', text: 'FINAL: stopping.' };
    if (forcedChoice(ctx.body)) return tool('ask_for_advice', { question: 'Why do my ls commands keep failing?' });
    const q = queues[t]!;
    if (q.length) {
      const s = q.shift()!;
      if ('before' in s) { s.before(orchRef); return s.act; }
      return s;
    }
    if (!endTurnCalled[t]) { endTurnCalled[t] = true; return END_TURN; }
    return { kind: 'text', text: 'FINAL: done.' };
  });
  H.net = net;
  net.install();
  let error: string | undefined;
  try {
    const orch = await createOrchestrator({
      defaultModelId: spec.modelId, projectPath: dir, storageDir: path.join(dir, '.cortex/sessions'), debug: !!process.env.TS_DEBUG,
      loopControl: { maxConsecutiveErrors: 999, maxToolIterations: 40, maxLoopRepetitions: 999, ...(scenario.loopControl ?? {}) },
      __apiClientOverride: mode === 'send' ? new TaggingAPIClient() : new StreamViaSendClient(),
    } as any, { enablePermissions: false });
    orchRef = orch;
    await orch.createSession(dir, spec.modelId);
    for (turn = 0; turn < scenario.turns.length; turn++) {
      const prompt = turn === 0 ? 'Run the shell steps for this task and report.' : 'Now continue with one more step.';
      if (mode === 'send') await orch.sendMessage(prompt);
      else for await (const _c of orch.streamMessage(prompt)) { /* drain */ }
    }
    await orch.cleanup().catch(() => {});
  } catch (e: any) {
    error = String(e?.message ?? e).slice(0, 300);
  } finally {
    net.uninstall();
    restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const mains = net.mains;
  if (process.env.PREFIX_DUMP_DIR) {
    try { fs.mkdirSync(process.env.PREFIX_DUMP_DIR, { recursive: true }); fs.writeFileSync(path.join(process.env.PREFIX_DUMP_DIR, `${mode}-${scenario.id}-${spec.key}.json`), JSON.stringify(net.captured, null, 1)); } catch { /* ignore */ }
  }
  const pairs = analyse(spec.wire, mains);
  let probe = scenario.probe?.(mains, spec.wire) ?? '';
  if (spec.wire === 'anthropic' && mains[0]) {
    const b = mains[mains.length - 1]!.body;
    const msgMarks = JSON.stringify(b.messages ?? []).split('cache_control').length - 1;
    const sysMark = JSON.stringify(b.system ?? '').includes('cache_control');
    const toolMark = JSON.stringify((b.tools ?? []).slice(-1)).includes('cache_control');
    probe += `${probe ? '; ' : ''}anthropic breakpoints (last req): system=${sysMark} lastTool=${toolMark} messages=${msgMarks}`;
  }
  const r: CellResult = { scenario, spec, mode, mains, helpers: net.captured.length - mains.length, pairs, error, probe: probe || undefined };
  RESULTS.push(r);
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// attribution (heuristic — the report traces each to file:line by hand)
// ─────────────────────────────────────────────────────────────────────────────
function unitJson(c: Captured, wire: Wire, unit: string): string {
  const u = prefixUnits(wire, c.body).find((x) => x[0] === unit);
  return u ? JSON.stringify(u[1]) : '';
}

function toolsDiff(prev: Captured, next: Captured, wire: Wire): string {
  const a = toolList(wire, prev.body), b = toolList(wire, next.body);
  const added = b.filter((x) => !a.includes(x)), removed = a.filter((x) => !b.includes(x));
  const common = a.filter((x) => b.includes(x));
  const reordered = common.join(',') !== b.filter((x) => a.includes(x)).join(',');
  const firstAddedAt = added.length ? b.indexOf(added[0]!) : -1;
  return `${a.length}→${b.length} tools${added.length ? ` +[${added.join(',')}]${firstAddedAt >= 0 && firstAddedAt < b.length - added.length ? ` (inserted mid-array at ${firstAddedAt})` : ' (appended)'}` : ''}${removed.length ? ` -[${removed.join(',')}]` : ''}${reordered ? ' REORDERED' : ''}`;
}

function attribute(d: Divergence, prev: Captured, next: Captured, wire: Wire): string {
  const b = d.before, a = d.after;
  const pu = unitJson(prev, wire, d.unit), nu = unitJson(next, wire, d.unit);
  if (d.note?.startsWith('chained request: head')) {
    if (d.unit === 'tools') return `Responses chained request changed tools: ${toolsDiff(prev, next, wire)}`;
    return `Responses chained request changed ${d.unit}${d.unit === 'instructions' ? ' (F8: reminders extracted from the CURRENT sliced input into instructions)' : ''}`;
  }
  if (d.unit === 'previous_response_id') return 'Responses chain points elsewhere';
  if (d.note?.includes('re-sends')) return 'NEW-R: Responses request with previous_response_id replays FULL history (non-continuation path does not slice)';
  if (d.unit === 'tools' || d.unit === 'tool_choice' || d.unit === 'toolConfig' || d.unit === 'tool_config') {
    const forced = forcedChoice(prev.body) !== forcedChoice(next.body);
    const td = toolsDiff(prev, next, wire);
    if (forced) return `F5 forced tool_choice ${forcedChoice(next.body) ? 'ON' : 'OFF'} (${td})`;
    const nl = toolList(wire, next.body), pl = toolList(wire, prev.body);
    if (nl.length === 1 && /ask_?for_?advice/i.test(nl[0]!)) return `F5 forced mentor choice delivered as tools-narrowing only (no tool_choice on this wire) (${td})`;
    if (pl.length === 1 && /ask_?for_?advice/i.test(pl[0]!)) return `F5 tools restored after the forced mentor request (${td})`;
    if (toolList(wire, next.body).length === 0) return `tools REMOVED (tools-suppressed synthesis/forced-answer request) (${td})`;
    if (toolList(wire, prev.body).length === 0) return `tools RESTORED after a tools-suppressed request (${td})`;
    if (d.from === 0 || /REORDERED/.test(td) && toolList(wire, prev.body).length < 8) return `anchor lift (CORTEX_TOOL_ANCHOR / card anchor) — ${td}`;
    return `F2 tools array changed — ${td}`;
  }
  if (pu.includes('<harness-note') && !nu.includes('<harness-note')) return 'F3 first-request injectedContent not kept in history';
  if (pu.includes('AI Mentor Insight') && !nu.includes('AI Mentor Insight')) return 'F9 ephemeral mentor message removed from mid-history at turn end';
  if (/spiral spiral/.test(pu) !== /spiral spiral/.test(nu)) return 'walled turn on/off the wire (F1 family)';
  if (/ENTIRE output budget/.test(pu) && !/ENTIRE output budget/.test(nu)) return 'F1 wall nudge vanished from the carrier tool_result (stale canonical cache)';
  if (/CONTEXT COMPACTED/.test(nu) && !/CONTEXT COMPACTED/.test(pu)) return 'F12 context compaction/pruning rewrote history';
  if (d.unit === 'instructions') return 'F8 Responses instructions changed';
  if (d.unit === 'system' || d.unit === 'system_instruction' || d.unit === 'systemInstruction') return 'system prompt changed';
  if (d.unit === 'thinking') return 'thinking config changed (invalidates messages)';
  if (/STATUS:|WALL BUDGET|ENTIRE output budget|system-reminder/.test(a) && d.tailOnly) return 'steering/nudge appended to the tail tool_result (cache-safe tail edit)';
  if (d.tailOnly) return 'tail message rewritten (N’s last message differs in N+1)';
  {
    const strip = (x: string) => x.replace(/[\]}"]+$/, '');
    if (pu && nu && nu.length > pu.length && nu.startsWith(strip(pu))) return 'text appended in place to an earlier wire message (the newest canonical tool_result; chat wire splits it into tool + user messages)';
  }
  return `mid-history rewrite (before ${b.slice(0, 60)} / after ${a.slice(0, 60)})`;
}

function shortWhy(d: Divergence, r: CellResult): string {
  const w = attribute(d, r.mains[d.from]!, r.mains[d.from + 1]!, r.spec.wire);
  const m = /^(F\d+)/.exec(w) ?? /\((F\d+)\)/.exec(w);
  if (m) return m[1]!;
  if (w.startsWith('anchor lift')) return 'lift';
  if (w.startsWith('tools REMOVED')) return 'tools-off';
  if (w.startsWith('tools RESTORED')) return 'tools-on';
  if (w.startsWith('NEW-R')) return 'NEW-R';
  if (w.startsWith('steering')) return 'steer-tail';
  if (w.startsWith('tail')) return 'tail';
  if (w.startsWith('Responses chained input re-sends')) return 'resp-dup';
  if (w.startsWith('Responses chained request changed')) return `resp-${d.unit}`;
  if (w.startsWith('walled')) return 'wall';
  if (w.startsWith('mid-history')) return 'MID';
  if (w.startsWith('text appended in place')) return 'append-in-place';
  return d.unit;
}

function cellLabel(r: CellResult): string {
  if (r.error) return `CRASH (${r.mains.length} req)`;
  if (!r.mains.length) return 'no requests';
  const divPairs = r.pairs.filter((p) => !p.stable);
  if (!divPairs.length) return `stable (${r.mains.length} req)`;
  const parts = divPairs.map((p) => `${p.n}→${p.n + 1} ${[...new Set(p.divs.map((d) => shortWhy(d, r)))].join('+')}`);
  return `${divPairs.length}/${r.pairs.length}: ${parts.join('; ')}`;
}

function renderReport(): string {
  const lines: string[] = [];
  lines.push('# Prefix-stability measurement — every transport × scenario (2026-10-02)');
  lines.push('');
  lines.push('Generated by `packages/core/src/orchestrator/__tests__/prefixStability.integration.test.ts` (harness: `__tests__/prefix/prefixHarness.ts`).');
  lines.push('Real orchestrator → middleware → GatewayTranslationLayer → APIClient builders → provider SDKs; network faked at `globalThis.fetch` / `@gradio/client`.');
  lines.push('Env = shipped `.env.defaults` + the scenario levers. Prefix units: Anthropic/xAI-messages tools→system→thinking→tool_choice→messages[i]; chat (OpenAI/DeepSeek/hf-space) tools→tool_choice→messages[i] (system is messages[0]);');
  lines.push('Responses instructions→tools→tool_choice→input[i] (chained requests: head must be equal and input must not re-send held items); Gemini system_instruction→tools→tool_config→contents[i]. `cache_control` markers are stripped.');
  lines.push('A cell is `stable` when every request N\'s units appear byte-identically at the head of N+1. `(tail)` = only N\'s LAST message differs (the cache up to the previous message survives).');
  if (Object.keys(EXTRA_ENV).length) lines.push(`EXTRA ENV (every cell): ${JSON.stringify(EXTRA_ENV)}`);
  lines.push('`send` = sendMessage loop; `stream` = streamMessage loop (history construction of the streaming loop; wire still built by the non-streaming builders).');
  lines.push('');
  for (const mode of ['send', 'stream'] as Mode[]) {
    lines.push(`## Table — ${mode}`);
    lines.push('');
    lines.push(`| transport | ${SCENARIOS.map((s) => s.id).join(' | ')} |`);
    lines.push(`|---|${SCENARIOS.map(() => '---').join('|')}|`);
    for (const spec of TRANSPORTS) {
      const cells = SCENARIOS.map((s) => {
        const r = RESULTS.find((x) => x.scenario.id === s.id && x.spec.key === spec.key && x.mode === mode);
        return r ? cellLabel(r) : '—';
      });
      lines.push(`| ${spec.key} (${spec.modelId}) | ${cells.join(' | ')} |`);
    }
    lines.push('');
  }
  lines.push('## Scenarios');
  for (const s of SCENARIOS) lines.push(`- **${s.id}** — ${s.title}${Object.keys(s.env).length ? ` — env ${JSON.stringify(s.env)}` : ''}`);
  lines.push('');
  lines.push('## Divergences (every non-stable pair)');
  for (const r of RESULTS) {
    const divs = r.pairs.filter((p) => !p.stable);
    const head = `### ${r.mode} · ${r.spec.key} · ${r.scenario.id} — ${r.mains.length} main req, ${r.helpers} helper req${r.error ? ` — CRASH: ${r.error}` : ''}`;
    if (!divs.length && !r.error && !r.probe) continue;
    lines.push(head);
    if (r.probe) lines.push(`- probe: ${r.probe}`);
    for (const d of divs.flatMap((p) => p.divs.map((dd) => ({ ...dd, chained: p.chained })))) {
      const p = d;
      const why = attribute(d, r.mains[d.from]!, r.mains[d.from + 1]!, r.spec.wire);
      lines.push(`- ${d.from}→${d.from + 1}${p.chained ? ' [chained]' : ''}: \`${d.path}\`${d.tailOnly ? ' (tail)' : ''} kept≈${d.keptPct}% — **${why}**${d.note ? ` (${d.note})` : ''}`);
      lines.push(`  - before: \`${d.before.replace(/`/g, "'").replace(/\n/g, '⏎')}\``);
      lines.push(`  - after:  \`${d.after.replace(/`/g, "'").replace(/\n/g, '⏎')}\``);
    }
    for (const p of r.pairs) if (p.paramChanges.length) lines.push(`- params ${p.n}→${p.n + 1}: ${p.paramChanges.join('; ')}`);
  }
  lines.push('');
  return lines.join('\n');
}

describe('prefix stability (measurement)', () => {
  for (const mode of ['send', 'stream'] as Mode[]) {
    for (const scenario of SCENARIOS) {
      for (const spec of TRANSPORTS) {
        it(`${mode} · ${scenario.id} · ${spec.key}`, async () => {
          const r = await runCell(scenario, spec, mode);
          if (r.error) throw new Error(`orchestrator crashed: ${r.error}`); // a crash is a harness failure; divergences are not
        }, 120000);
      }
    }
  }
  afterAll(() => {
    const md = renderReport();
    // A filtered run (-t) writes a .partial.md so it never clobbers the full matrix. Hand-written analysis above the marker survives.
    const full = RESULTS.length === 2 * SCENARIOS.length * TRANSPORTS.length;
    const target = full && !OUT_TAG ? OUT : OUT.replace(/\.md$/, `${OUT_TAG ? `.${OUT_TAG}` : ''}.partial.md`);
    const MARK = '<!-- GENERATED BELOW (prefixStability.integration.test.ts) -->';
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const prev = fs.existsSync(target) ? fs.readFileSync(target, 'utf-8') : '';
      const head = prev.includes(MARK) ? prev.slice(0, prev.indexOf(MARK)) : '';
      fs.writeFileSync(target, `${head}${MARK}\n\n${md}`);
    } catch (e) { console.error('[prefix] could not write report', e); }
    console.log(`\n${md}\n[prefix] report written to ${target}`);
  });
});
