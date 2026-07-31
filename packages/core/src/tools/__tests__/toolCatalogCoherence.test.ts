/**
 * Tool catalog coherence guard.
 *
 * Port of the nexus-terminal guard born from the 2026-07 grok doom-loop: never
 * mandate (or enforce) a tool the model cannot see. The browser bug was a
 * half-port of THIS harness's design — the mandate text without the
 * essential-tier guarantee. This test pins the guarantee on the CLI side and
 * catches the drift the guard's first probe actually found here: ToolFactory's
 * hardcoded backstop set named 'ReadFile'/'WriteFile'/'EditFile'/'Shell' —
 * names that no longer exist in the registry (canonical: Read/Write/Edit/Bash),
 * so the backstop silently matched nothing.
 *
 * Rules:
 *  1. Backstop names hardcoded in ToolFactory.getEssentialTools() must all be
 *     real registry tool names (a stale backstop is dead safety code).
 *  2. ShellTool's runtime redirect messages ("Use the X tool instead") REJECT
 *     the user's bash command and mandate X — X must exist and be essential,
 *     or the model is wedged between an enforced mandate and a missing tool.
 *  3. Tool-call examples (`Name({ ... })`) in tool descriptions and the
 *     always-injected system docs must name real tools.
 *  4. The file/shell tools stay essential-tier (regression pin).
 *  5. Case convention (2026-07 audit, operator-ratified Option A): model-visible
 *     text uses canonical PascalCase names; the wire may present snake_case per
 *     provider (GatewayTranslationLayer). Docs/descriptions must not reference
 *     tools by their snake_case wire form — the only permitted snake mention is
 *     the explanatory case-note line (sentinel: "may appear in a different case").
 *     Cross-provider probe evidence (2026-07-30, 5 providers, 30 runs): case has
 *     no behavioral effect and Pascal-docs-over-snake-wire resolves 10/10.
 *  6. Lowercase single-word phrasing ("use the read tool") is likewise banned in
 *     model-visible text — canonical is "the Read tool".
 *  7. Agent-profile frontmatter (.cortex/agents/*.md `tools:` lists) must name
 *     canonical tools EXACTLY. This is runtime access config, not docs: the
 *     2026-07 deep audit found snake_case entries (web_search, research_backlog)
 *     that SubAgentPermissionChecker silently denied — the autoresearch-agent
 *     ran without its own required tools. The checker now normalizes separators
 *     too, but profiles must still be canonical so greps and docs agree.
 *  8. Sandbox-family tool names (SandboxScan, InspectSandbox, …) must not appear
 *     in snake_case anywhere in the executor addon sources. These tools are
 *     registered via AddonToolRegistry at runtime, so their model-visible
 *     description/output strings live in executor files that rules 1-6 (which
 *     read BaseToolRegistry) never scan — that gap let `sandbox_scan`/
 *     `interact_with_sandbox` reach the model until the 2026-07-30 exhaustive
 *     sweep. Unlike web_search/code_execution (real provider server-side tools),
 *     the sandbox family has zero legitimate snake usage, so this scan is safe.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BaseToolRegistry } from '../registries/BaseToolRegistry';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE_SRC = join(HERE, '../..');
const MESSAGES_DIR = join(CORE_SRC, 'system-messages/messages');
const TOOL_FACTORY = join(CORE_SRC, 'tools/ToolFactory.ts');
const SHELL_TOOL = join(CORE_SRC, '../../executors/src/implementations/execution/ShellTool.ts');

const ALWAYS_INJECTED_DOCS = ['SYSTEM_PROMPT.md', 'WORK_QUALITY.md', 'TOOL_USAGE_GUIDE.md'];

/** JS globals that legitimately appear in `Name({` position in prose/examples. */
const NOT_TOOLS = new Set(['Set', 'Map', 'Object', 'Array', 'JSON', 'Promise', 'Error', 'Date', 'RegExp']);

describe('tool catalog coherence (doom-loop guard)', () => {
  const registry = new BaseToolRegistry();
  const tools = registry.getAllTools();
  const names = new Set(tools.map((t) => t.name));
  const essential = new Set(
    tools.filter((t) => t.discoveryTier === 'essential').map((t) => t.name),
  );

  it('ToolFactory backstop names all exist in the registry (no stale backstop)', () => {
    const src = readFileSync(TOOL_FACTORY, 'utf8');
    const block = src.match(/ESSENTIAL_TOOL_NAMES = new Set\(\[([\s\S]*?)\]\)/);
    expect(block, 'ESSENTIAL_TOOL_NAMES set not found in ToolFactory.ts').toBeTruthy();
    const hardcoded = [...block![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(hardcoded.length).toBeGreaterThan(0);
    const stale = hardcoded.filter((n) => !names.has(n));
    expect(stale, `Stale backstop names (registry has no such tools): ${stale.join(', ')}`).toEqual([]);
  });

  it('ShellTool runtime redirects only mandate tools that exist AND are essential', () => {
    const src = readFileSync(SHELL_TOOL, 'utf8');
    const targets = [...new Set([...src.matchAll(/Use the (\w+) tool instead/g)].map((m) => m[1]))];
    expect(targets.length, 'expected ShellTool redirect messages').toBeGreaterThan(0);
    const missing = targets.filter((t) => !names.has(t));
    expect(missing, `ShellTool rejects bash and mandates nonexistent tools: ${missing.join(', ')}`).toEqual([]);
    const deferred = targets.filter((t) => names.has(t) && !essential.has(t));
    expect(
      deferred,
      'ShellTool rejects bash and mandates DEFERRED tools (enforced wedge — model cannot ' +
        `comply): ${deferred.join(', ')}. Promote them to discoveryTier 'essential'.`,
    ).toEqual([]);
  });

  it('tool-call examples in descriptions and always-injected docs name real tools', () => {
    const surfaces: Array<{ source: string; text: string }> = [
      ...tools.map((t) => ({ source: `tool:${t.name}`, text: t.description ?? '' })),
      ...ALWAYS_INJECTED_DOCS.map((f) => ({
        source: f,
        text: readFileSync(join(MESSAGES_DIR, f), 'utf8'),
      })),
    ];
    const dangling: string[] = [];
    for (const { source, text } of surfaces) {
      const calls = [...new Set([...text.matchAll(/\b([A-Z][A-Za-z]+)\(\{/g)].map((m) => m[1]))];
      for (const c of calls) {
        if (!names.has(c) && !NOT_TOOLS.has(c) && `tool:${c}` !== source) {
          dangling.push(`${source} -> ${c}({`);
        }
      }
    }
    expect(dangling, `Call examples referencing nonexistent tools:\n${dangling.join('\n')}`).toEqual([]);
  });

  it('file/shell tools stay essential (regression pin)', () => {
    for (const name of ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep']) {
      expect(essential.has(name), `${name} must be discoveryTier 'essential'`).toBe(true);
    }
  });

  // ── Case-convention rules (audit P2/P3) ──────────────────────────────────

  const ALL_DOCS = [
    'SYSTEM_PROMPT.md', 'WORK_QUALITY.md', 'TOOL_USAGE_GUIDE.md',
    'EXAMPLES.md', 'TASK_AGENT_GUIDE.md', 'ACTIVE_DISCOVERY.md',
    'REASONING_GUIDE.md', 'PERIODIC_REMINDER.md', 'ENVIRONMENT_INFO.md',
  ];
  const CASE_NOTE_SENTINEL = /may appear in a different case/i;
  const toSnake = (n: string) => n.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  // Multi-word canonical names have unambiguous snake forms (todo_create, web_search…).
  // Single-word names (read, bash…) collide with prose and are covered by rule 6.
  const snakeForms = new Map(
    [...names]
      .filter((n) => /[a-z][A-Z]/.test(n))
      .map((n) => [toSnake(n), n] as const),
  );

  function modelVisibleSurfaces(): Array<{ source: string; text: string }> {
    return [
      ...tools.map((t) => ({ source: `tool:${t.name}`, text: t.description ?? '' })),
      ...ALL_DOCS.map((f) => ({ source: f, text: readFileSync(join(MESSAGES_DIR, f), 'utf8') })),
    ];
  }

  it('model-visible text does not reference tools by snake_case wire form (rule 5)', () => {
    const violations: string[] = [];
    for (const { source, text } of modelVisibleSurfaces()) {
      for (const [lineNo, line] of text.split('\n').entries()) {
        if (CASE_NOTE_SENTINEL.test(line)) continue;
        for (const [snake, canonical] of snakeForms) {
          if (new RegExp(`\\b${snake}\\b`).test(line)) {
            violations.push(`${source}:${lineNo + 1} uses '${snake}' — write '${canonical}'`);
          }
        }
      }
    }
    expect(violations, `snake_case tool references in model-visible text:\n${violations.join('\n')}`).toEqual([]);
  });

  it('agent-profile tools: frontmatter uses exact canonical names (rule 7)', () => {
    const { readdirSync, existsSync } = require('node:fs') as typeof import('node:fs');
    const agentsDir = join(CORE_SRC, '../../../.cortex/agents');
    expect(existsSync(agentsDir), `.cortex/agents not found at ${agentsDir}`).toBe(true);
    const violations: string[] = [];
    for (const f of readdirSync(agentsDir).filter((f) => f.endsWith('.md'))) {
      const text = readFileSync(join(agentsDir, f), 'utf8');
      const fm = text.match(/^---\n([\s\S]*?)\n---/);
      if (!fm) continue;
      // [ \t]* (not \s*) — \s matches newlines and would swallow the first list item
      const toolsBlock = fm[1].match(/^tools:[ \t]*(.*)$([\s\S]*?)(?=^\S|\s*$)/m);
      if (!toolsBlock) continue;
      const entries: string[] = [];
      if (toolsBlock[1].trim() && toolsBlock[1].trim() !== '') {
        entries.push(...toolsBlock[1].split(',').map((t) => t.trim()).filter(Boolean));
      }
      for (const m of toolsBlock[2].matchAll(/^\s*-\s*(\S+)\s*$/gm)) entries.push(m[1]);
      for (const entry of entries) {
        if (entry === 'all' || entry === 'inherit') continue;
        if (!names.has(entry)) {
          const canonical = [...names].find((n) => n.toLowerCase().replace(/[_-]/g, '') === entry.toLowerCase().replace(/[_-]/g, ''));
          violations.push(`${f}: '${entry}'${canonical ? ` — write '${canonical}'` : ' — no such tool'}`);
        }
      }
    }
    expect(violations, `Non-canonical tool names in agent profiles:\n${violations.join('\n')}`).toEqual([]);
  });

  it('sandbox-family tools never appear in snake_case in executor addon sources (rule 8)', () => {
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    const ADDON_DIR = join(CORE_SRC, '../../executors/src/implementations/addon');
    const SANDBOX_SNAKE = [
      'sandbox_scan', 'sandbox_grab', 'sandbox_detect_framework',
      'sandbox_render_trace', 'sandbox_component_tree',
      'interact_with_sandbox', 'inspect_sandbox', 'stop_sandbox', 'modify_sandbox',
    ];
    const violations: string[] = [];
    for (const f of readdirSync(ADDON_DIR).filter((f) => f.endsWith('.ts'))) {
      const text = readFileSync(join(ADDON_DIR, f), 'utf8');
      for (const [lineNo, line] of text.split('\n').entries()) {
        for (const snake of SANDBOX_SNAKE) {
          if (new RegExp(`\\b${snake}\\b`).test(line)) {
            const canonical = snake.replace(/(?:^|_)([a-z])/g, (_m, c) => c.toUpperCase());
            violations.push(`${f}:${lineNo + 1} '${snake}' — write '${canonical}'`);
          }
        }
      }
    }
    expect(violations, `snake_case sandbox tool names in addon sources:\n${violations.join('\n')}`).toEqual([]);
  });

  it('model-visible text does not use lowercase single-word tool phrasing (rule 6)', () => {
    const phrase = /\b(?:the|use|call|via|prefer) (read|write|edit|bash|grep|glob|task|skill|browse) tool\b/g;
    const violations: string[] = [];
    for (const { source, text } of modelVisibleSurfaces()) {
      for (const [lineNo, line] of text.split('\n').entries()) {
        const hits = [...line.matchAll(phrase)].map((m) => m[1]);
        if (hits.length > 0) {
          violations.push(`${source}:${lineNo + 1} — lowercase '${hits.join(', ')} tool'`);
        }
      }
    }
    expect(violations, `lowercase tool phrasing (canonical is PascalCase):\n${violations.join('\n')}`).toEqual([]);
  });
});
