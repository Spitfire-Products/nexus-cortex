// Sub-agent nesting guard (2026-11-12): every tool child carries CORTEX_TOOL_PARENT_DEPTH; bin/cortex.js refuses to start another agent
// from a marked process (tests here: the marker; the bin refusal is exercised through the real bin below).
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { toolChildEnv } from '../secretsVault.js';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../cli/bin/cortex.js');
const run = (args: string[], env: Record<string, string>) =>
  spawnSync(process.execPath, [BIN, ...args], { env: { ...process.env, PORT: '4999', ...env }, encoding: 'utf8', timeout: 30_000 });

describe('sub-agent nesting marker', () => {
  it('tool children carry the depth of the agent that started them', () => {
    expect(toolChildEnv({}, 'Bash').CORTEX_TOOL_PARENT_DEPTH).toBe('0');
    expect(toolChildEnv({ CORTEX_AGENT_DEPTH: '1' }, 'Bash').CORTEX_TOOL_PARENT_DEPTH).toBe('1');
    expect(toolChildEnv({ CORTEX_AGENT_MODE: 'true' }, 'Bash').CORTEX_TOOL_PARENT_DEPTH).toBe('1');
    expect(toolChildEnv({ CORTEX_AGENT_DEPTH: '2' }).CORTEX_AGENT_DEPTH).toBe('2');   // the real depth var is never rewritten
  });
  it('the cortex bin refuses to start an agent from a marked process, info commands still run', () => {
    for (const args of [['hello-prompt'], ['agent', 'x'], ['run', 'x'], ['autoresearch', 'status']]) {
      const r = run(args, { CORTEX_TOOL_PARENT_DEPTH: '1' });
      expect(r.status, args.join(' ')).toBe(3);
      expect(r.stderr).toMatch(/Use the Task tool/);
    }
    expect(run(['--version'], { CORTEX_TOOL_PARENT_DEPTH: '1' }).status).toBe(0);
    expect(run(['--help'], { CORTEX_TOOL_PARENT_DEPTH: '1' }).status).toBe(0);
  });
  it('an empty marker is unmarked (test configs blank it) and the override lets --version through either way', () => {
    expect(run(['--version'], { CORTEX_TOOL_PARENT_DEPTH: '' }).status).toBe(0);
    expect(run(['--version'], { CORTEX_TOOL_PARENT_DEPTH: '1', CORTEX_ALLOW_NESTED_AGENT: 'true' }).status).toBe(0);
  });
});
