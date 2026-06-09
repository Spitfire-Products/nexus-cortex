/**
 * Permission profile audit — regression tests that catch silent breakage of
 * the whitelist/graylist tier system across all shipped profiles.
 *
 * Coverage:
 *   1. Every tool name listed in `test.json` and `prod.json` whitelists
 *      exists in the canonical tool set (mistyped names silently no-op,
 *      letting a "secured" profile actually allow nothing).
 *   2. Every tool name in `DefaultPolicies.whitelistTools` is canonical.
 *   3. Every shipped profile uses an approval handler that works headless
 *      (`auto-approve` or `deny-all`) — `cli` would hang HTTP requests.
 *   4. The `prod.json` whitelist contains the agreed minimum read-only
 *      tools needed for production read-only operation.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Canonical tool names. Two sources:
//   • ExecutorRegistry.registerAllExecutors() — 35 tools registered as
//     executors (file ops, web tools, search, todos, agents, etc.)
//   • CortexOrchestrator switch/case for orchestrator-managed tools
//     that aren't in the executor registry.
const EXECUTOR_REGISTRY_TOOLS = [
  'AskUserQuestion', 'Bash', 'BashOutput', 'CodeExecute', 'CreateArtifactTool',
  'Edit', 'ExitPlanMode', 'GetConversationSegment', 'Glob', 'Grep',
  'InspectSandbox', 'InteractWithSandbox', 'KillShell',
  'ListCompactionBoundaries', 'ListSessions', 'LoadSession',
  'ModifySandbox', 'NotebookEdit', 'PRAgent', 'Read',
  'RequestHistoricalContext', 'SearchConversationHistory', 'SearchTools',
  'Skill', 'SlashCommand', 'StopSandbox', 'Task', 'TmuxSession',
  'TodoCreate', 'TodoList', 'TodoUpdate', 'WebFetch', 'WebSearch',
  'WorkspaceManager', 'Write',
];

const ORCHESTRATOR_MANAGED_TOOLS = [
  'ConfigureMcpServer', 'DisableMcpServer', 'EnableMcpServer',
  'GetMcpConfig', 'InitCortexContext', 'InitMcpConfig',
  'ListAvailableMcpServers', 'SearchMcpServers',
];

const CANONICAL_TOOL_NAMES = new Set([
  ...EXECUTOR_REGISTRY_TOOLS,
  ...ORCHESTRATOR_MANAGED_TOOLS,
]);

// Read-only tools that any profile (including prod) should be safe to permit.
const PROD_READ_ONLY_TOOLS = [
  'Read', 'Glob', 'Grep', 'BashOutput',
  'WebSearch', 'WebFetch',
  'GetMcpConfig', 'ListAvailableMcpServers', 'SearchMcpServers',
  'ListSessions', 'LoadSession',
  'RequestHistoricalContext', 'SearchConversationHistory',
  'GetConversationSegment', 'ListCompactionBoundaries',
  'TodoList', 'SearchTools',
];

// Approval handlers that can run safely without an interactive TTY.
const HEADLESS_SAFE_APPROVAL_HANDLERS = new Set(['auto-approve', 'deny-all']);

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');

function loadProfile(filename: string): any | null {
  const dotted = path.join(REPO_ROOT, '.cortex', `permissions.${filename}.json`);
  const sub = path.join(REPO_ROOT, '.cortex', 'permissions', `${filename}.json`);
  for (const candidate of [dotted, sub]) {
    if (fs.existsSync(candidate)) {
      return { path: candidate, config: JSON.parse(fs.readFileSync(candidate, 'utf-8')) };
    }
  }
  return null;
}

function whitelistToolsOf(config: any): string[] {
  const out: string[] = [];
  for (const p of config.policies ?? []) {
    if (p.type === 'whitelist' && Array.isArray(p.config?.allowedTools)) {
      out.push(...p.config.allowedTools);
    }
  }
  return out;
}

// ── #1: All whitelisted tool names are canonical ─────────────────────────────

describe('Permission profile audit — tool name canonicalization', () => {
  for (const profile of ['dev', 'test', 'prod']) {
    it(`${profile}.json whitelist tool names are all canonical`, () => {
      const loaded = loadProfile(profile);
      expect(loaded, `profile ${profile} not found`).not.toBeNull();
      const names = whitelistToolsOf(loaded!.config);
      const unknown = names.filter((n) => !CANONICAL_TOOL_NAMES.has(n));
      expect(unknown, `${profile}: unknown tool names`).toEqual([]);
    });
  }
});

// ── #2: DefaultPolicies whitelist names are canonical ────────────────────────

describe('Permission profile audit — DefaultPolicies fallback whitelist', () => {
  it('every name in DefaultPolicies.whitelistTools is a canonical tool', async () => {
    const file = path.join(
      REPO_ROOT,
      'packages',
      'core',
      'src',
      'middleware',
      'permissions',
      'DefaultPolicies.ts',
    );
    const src = fs.readFileSync(file, 'utf-8');
    const arrayMatch = src.match(/whitelistTools\s*=\s*\[([\s\S]*?)\]/);
    expect(arrayMatch, 'whitelistTools array not found').not.toBeNull();

    const names = Array.from(arrayMatch![1].matchAll(/'([A-Z][A-Za-z0-9_]+)'/g)).map(
      (m) => m[1]!,
    );
    expect(names.length).toBeGreaterThan(0);

    const unknown = names.filter((n) => !CANONICAL_TOOL_NAMES.has(n));
    expect(unknown, 'DefaultPolicies.whitelistTools: unknown names').toEqual([]);
  });
});

// ── #3: Every shipped profile uses a headless-safe approval handler ──────────

describe('Permission profile audit — approval handler is headless-safe', () => {
  for (const profile of ['dev', 'test', 'prod']) {
    it(`${profile}.json approvalHandler runs cleanly without a TTY`, () => {
      const loaded = loadProfile(profile);
      expect(loaded, `profile ${profile} not found`).not.toBeNull();
      const handler = loaded!.config.approvalHandler;
      expect(
        HEADLESS_SAFE_APPROVAL_HANDLERS.has(handler),
        `${profile}: approvalHandler "${handler}" is not headless-safe (must be one of ${[...HEADLESS_SAFE_APPROVAL_HANDLERS].join(', ')})`,
      ).toBe(true);
    });
  }
});

// ── #4: prod.json includes the agreed read-only tool set ─────────────────────

describe('Permission profile audit — prod.json minimum read-only allowlist', () => {
  it('prod.json whitelist includes every tool in PROD_READ_ONLY_TOOLS', () => {
    const loaded = loadProfile('prod');
    expect(loaded, 'prod profile not found').not.toBeNull();
    const names = new Set(whitelistToolsOf(loaded!.config));
    const missing = PROD_READ_ONLY_TOOLS.filter((t) => !names.has(t));
    expect(missing, 'prod.json: missing required read-only tools').toEqual([]);
  });
});
