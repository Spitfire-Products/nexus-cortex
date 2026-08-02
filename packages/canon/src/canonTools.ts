/**
 * canonTools — Phase E rung 1 of the tool-ontology ladder (layer 2 of the
 * cross-harness handoff problem; CANON_CROSS_HARNESS_PLAN.md P4/§27r).
 *
 * Three levers:
 *  - deriveToolInventory: the OBSERVED tool vocabulary per harness, scanned
 *    from the canonical line itself (empirical, not spec-read).
 *  - TOOL_CONCEPTS: the cross-harness name-mapping table, seeded from the
 *    real four-harness corpus (2026-08-02) — canonical concept → per-harness
 *    tool names. Rung 1 is the NAME map; arg-schema morphisms are rung 2.
 *  - toolCompatibility: classify a session's tool references against a
 *    target harness — the pull-time compatibility report. Key doctrine
 *    (§27b): canon stores RESULTS, so comprehension of a foreign session is
 *    never capability-bound; only future AGENCY needs mapping/relay.
 *
 * @module canonTools
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';

export type HarnessName = 'claude-code' | 'nexus-cortex' | 'grok-build' | 'gemini-cli';
export const HARNESSES: HarnessName[] = ['claude-code', 'nexus-cortex', 'grok-build', 'gemini-cli'];

/**
 * Canonical concept → per-harness tool names. Seeded from the observed
 * four-harness corpus plus each CLI's documented surface; extend as the
 * §27n roster lands. A name may map to several concepts' worth of behavior —
 * rung 1 keeps it 1:1 on the dominant sense.
 */
export const TOOL_CONCEPTS: Record<string, Partial<Record<HarnessName, string[]>>> = {
  shell:        { 'claude-code': ['Bash'], 'nexus-cortex': ['Bash'], 'grok-build': ['run_terminal_command'], 'gemini-cli': ['run_shell_command'] },
  read_file:    { 'claude-code': ['Read'], 'nexus-cortex': ['Read'], 'grok-build': ['read_file'], 'gemini-cli': ['read_file', 'read_many_files'] },
  write_file:   { 'claude-code': ['Write'], 'nexus-cortex': ['Write'], 'grok-build': ['write'], 'gemini-cli': ['write_file'] },
  edit_file:    { 'claude-code': ['Edit'], 'nexus-cortex': ['Edit'], 'grok-build': ['search_replace'], 'gemini-cli': ['replace'] },
  list_dir:     { 'nexus-cortex': ['ListDirectory'], 'grok-build': ['list_dir'], 'gemini-cli': ['list_directory'] },
  glob:         { 'claude-code': ['Glob'], 'nexus-cortex': ['Glob'], 'gemini-cli': ['glob'] },
  grep:         { 'claude-code': ['Grep'], 'nexus-cortex': ['Grep'], 'grok-build': ['grep'], 'gemini-cli': ['search_file_content'] },
  web_search:   { 'claude-code': ['WebSearch'], 'nexus-cortex': ['WebSearch'], 'grok-build': ['web_search'], 'gemini-cli': ['google_web_search'] },
  web_fetch:    { 'claude-code': ['WebFetch'], 'nexus-cortex': ['WebFetch'], 'gemini-cli': ['web_fetch'] },
  spawn_agent:  { 'claude-code': ['Agent'], 'nexus-cortex': ['Task'], 'gemini-cli': ['invoke_agent'] },
  todo:         { 'claude-code': ['TaskCreate', 'TaskUpdate'], 'nexus-cortex': ['TodoWrite', 'TodoCreate', 'TodoUpdate'] },
  plan_mode:    { 'claude-code': ['EnterPlanMode', 'ExitPlanMode'], 'gemini-cli': ['enter_plan_mode'] },
  tool_search:  { 'claude-code': ['ToolSearch'], 'nexus-cortex': ['SearchTools'] },
  skill:        { 'claude-code': ['Skill'], 'nexus-cortex': ['Skill'] },
};

/** name (per harness) → concept, inverted from TOOL_CONCEPTS. */
function nameToConcept(): Map<string, string> {
  const m = new Map<string, string>();
  for (const [concept, byHarness] of Object.entries(TOOL_CONCEPTS)) {
    for (const names of Object.values(byHarness)) for (const n of names!) m.set(n, concept);
  }
  return m;
}

export interface ToolInventory { [harness: string]: Record<string, number> }

/** Scan the canonical line for observed tool_use names per harness. */
export async function deriveToolInventory(store: string): Promise<ToolInventory> {
  const inv: ToolInventory = {};
  const root = path.join(store, 'canon');
  const walk = async (dir: string, harness?: string) => {
    let es: fs.Dirent[] = [];
    try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { await walk(p, harness ?? (HARNESSES.includes(e.name as HarnessName) ? e.name : undefined)); continue; }
      if (!harness || e.name.endsWith('.events.jsonl') || !/\.jsonl(\.part-\d{4})?$/.test(e.name)) continue;
      const rl = readline.createInterface({ input: fs.createReadStream(p), crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line.includes('"tool_use"')) continue;
        try {
          const r = JSON.parse(line);
          const c = r?.message?.content;
          if (!Array.isArray(c)) continue;
          for (const b of c) if (b?.type === 'tool_use' && b.name) ((inv[harness] ??= {})[b.name] = (inv[harness]![b.name] ?? 0) + 1);
        } catch { /* lint's job */ }
      }
    }
  };
  await walk(root);
  return inv;
}

export interface ToolCompatReport {
  target: HarnessName;
  referenced: string[];
  mapped: { name: string; concept: string; targetNames: string[] }[];
  native: string[];          // already the target's own names
  mcp: string[];             // MCP tools — attach the server or relay to origin
  unmapped: string[];        // no rung-1 mapping — relay or intent re-expression
}

/** Classify one session's tool references against a target harness. */
export function toolCompatibility(referenced: string[], target: HarnessName): ToolCompatReport {
  const n2c = nameToConcept();
  const targetNames = new Set<string>();
  for (const byHarness of Object.values(TOOL_CONCEPTS)) for (const n of byHarness[target] ?? []) targetNames.add(n);
  const report: ToolCompatReport = { target, referenced: [...referenced].sort(), mapped: [], native: [], mcp: [], unmapped: [] };
  for (const name of report.referenced) {
    if (name.startsWith('mcp__')) { report.mcp.push(name); continue; }
    if (targetNames.has(name)) { report.native.push(name); continue; }
    const concept = n2c.get(name);
    const tn = concept ? TOOL_CONCEPTS[concept]![target] : undefined;
    if (concept && tn?.length) report.mapped.push({ name, concept, targetNames: tn });
    else report.unmapped.push(name);
  }
  return report;
}

/** Extract the tool_use names referenced in one canonical session file. */
export async function sessionToolNames(file: string): Promise<string[]> {
  const names = new Set<string>();
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.includes('"tool_use"')) continue;
    try {
      const c = JSON.parse(line)?.message?.content;
      if (Array.isArray(c)) for (const b of c) if (b?.type === 'tool_use' && b.name) names.add(b.name);
    } catch { /* skip */ }
  }
  return [...names].sort();
}

/** Render the compatibility report for terminal output. */
export function renderCompat(r: ToolCompatReport): string {
  const lines: string[] = [];
  lines.push(`[canon] tool compatibility vs ${r.target}: ${r.referenced.length} referenced — ` +
    `${r.native.length} native, ${r.mapped.length} mapped, ${r.mcp.length} mcp, ${r.unmapped.length} unmapped`);
  for (const m of r.mapped) lines.push(`  map   ${m.name} → ${m.targetNames.join('|')} (${m.concept})`);
  if (r.mcp.length) lines.push(`  mcp   ${r.mcp.join(', ')} — attach the MCP server(s) or relay to origin`);
  if (r.unmapped.length) lines.push(`  gap   ${r.unmapped.join(', ')} — no rung-1 mapping: relay to origin harness or let the model re-express intent`);
  lines.push(`  note  comprehension is unaffected either way — canon stores tool RESULTS verbatim; only future agency is capability-bound`);
  return lines.join('\n');
}
