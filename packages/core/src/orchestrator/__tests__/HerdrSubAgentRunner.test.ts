import { describe, it, expect, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  runDelegateInHerdr,
  resolveSubAgentRuntime,
  readSubAgentRuntimeLever,
  readKeepDelegatePanes,
  shellQuote,
  type DelegateExecFn,
  type DelegateExecResult,
} from '../HerdrSubAgentRunner.js';
import type { AgentDefinition, SubAgentResult } from '../SubAgentTypes.js';

const BIN = '/fake/bin/herdr';
const PARENT = 'w1:p1';
const PANE = 'w1:p9';

const agentDef: AgentDefinition = {
  name: 'explore',
  description: 'test agent',
  systemPrompt: '',
  tools: 'all',
  model: 'inherit',
  location: 'builtin',
  filePath: '/fake/explore.md',
};

function ok(result: unknown): DelegateExecResult {
  return { stdout: JSON.stringify({ id: 'x', result }), stderr: '', code: 0 };
}
function err(code: string, message = code): DelegateExecResult {
  return { stdout: '', stderr: JSON.stringify({ id: 'x', error: { code, message } }), code: 1 };
}
function text(stdout: string): DelegateExecResult {
  return { stdout, stderr: '', code: 0 };
}

function fakeResult(over: Partial<SubAgentResult> = {}): SubAgentResult {
  const start = new Date('2026-09-14T00:00:00Z');
  return {
    agentId: 'explore-1',
    agentName: 'explore',
    model: 'deepseek-v4-flash',
    startTime: start,
    endTime: new Date(start.getTime() + 1234),
    durationMs: 1234,
    turnCount: 2,
    status: 'completed',
    summary: 'done',
    fullResponse: 'DELEGATE-OK',
    toolsUsed: [],
    filesRead: [],
    filesModified: ['/tmp/x.ts'],
    cost: { inputTokens: 10, outputTokens: 5, estimatedCost: 0.0001, cacheHits: 0 },
    ...over,
  };
}

interface Scripted {
  calls: string[][];
  exec: DelegateExecFn;
  runCommand: () => string;
  resultPath: () => string | undefined;
  taskPath: () => string | undefined;
}

/**
 * Scripted herdr: `waits` is the sequence of `agent wait` outcomes; `onWait(i)` can
 * side-effect (e.g. write result.json) before the i-th outcome is returned.
 */
function scripted(opts: {
  waits: Array<'not_found' | 'timeout' | 'idle' | 'done'>;
  onWait?: (i: number, s: Scripted) => void;
  paneText?: string;
}): Scripted {
  const calls: string[][] = [];
  let waitIdx = 0;
  let run = '';
  const s: Scripted = {
    calls,
    runCommand: () => run,
    resultPath: () => run.match(/--result-file '([^']+)'/)?.[1],
    taskPath: () => run.match(/--task-file '([^']+)'/)?.[1],
    exec: vi.fn(async (_bin, args) => {
      calls.push(args);
      const verb = args.slice(0, 2).join(' ');
      if (verb === 'pane split') return ok({ pane: { pane_id: PANE }, type: 'pane_info' });
      if (verb === 'pane rename') return ok({ type: 'ok' });
      if (verb === 'pane run') { run = args[3]!; return text(''); }
      if (verb === 'agent wait') {
        const i = waitIdx++;
        opts.onWait?.(i, s);
        const w = opts.waits[Math.min(i, opts.waits.length - 1)];
        if (w === 'not_found') return err('agent_not_found', `agent target ${PANE} not found`);
        if (w === 'timeout') return err('timeout', 'timed out waiting for agent status');
        return ok({ agent: { pane_id: PANE, agent_status: w }, type: 'agent_info' });
      }
      if (verb === 'agent rename') return ok({ agent: { pane_id: PANE, name: args[3] } });
      if (verb === 'pane report-agent' || verb === 'pane report-metadata') return text('');
      if (verb === 'pane read') return text(opts.paneText ?? 'runner@repl:/tmp$ node agent-mode.js\nhello from pane\n');
      if (verb === 'pane send-keys') return text('');
      if (verb === 'pane close') return ok({ type: 'ok' });
      throw new Error(`unexpected herdr call: ${args.join(' ')}`);
    }),
  };
  return s;
}

function baseOpts(s: Scripted, extra: Record<string, unknown> = {}) {
  return {
    agentDef,
    taskPrompt: 'Reply with exactly the word DELEGATE-OK.',
    name: 'explore-ab12',
    cwd: '/work',
    timeoutMs: 120_000,
    modelOverride: 'deepseek-v4-flash',
    bin: BIN,
    parentPaneId: PARENT,
    exec: s.exec,
    env: { HERDR_ENV: '1', HERDR_PANE_ID: PARENT, PARENT_ONLY: 'yes' },
    envOverrides: { CORTEX_SUBAGENT_TEMPERATURE: '0.3' },
    nodeBin: '/usr/bin/node',
    agentModulePath: '/app/cli/dist/agent-mode.js',
    tmpRoot: mkdtempSync(join(tmpdir(), 'herdr-runner-test-')),
    sleep: async () => {},
    ...extra,
  };
}

describe('runDelegateInHerdr — happy path argv sequence', () => {
  it('split -> rename -> run -> wait (not_found, then idle) -> agent rename -> read; keeps the pane by default', async () => {
    const s = scripted({
      waits: ['not_found', 'idle'],
      onWait: (i, sc) => { if (i === 1) writeFileSync(sc.resultPath()!, JSON.stringify(fakeResult())); },
    });
    const opts = baseOpts(s);
    const result = await runDelegateInHerdr(opts as any);

    const verbs = s.calls.map((c) => c.slice(0, 2).join(' '));
    expect(verbs).toEqual([
      'pane split', 'pane rename', 'pane run',
      'agent wait', 'pane read', // agent_not_found -> exit-sentinel check
      'agent wait',
      'agent rename', 'pane read',
      'pane report-agent', 'pane report-metadata', // runner reports the terminal state for the pane
    ]);
    // split from the parent pane, down, no focus, cwd; NO --env (env rides the 0600 task file, never argv)
    const split = s.calls[0]!;
    expect(split).toEqual(['pane', 'split', PARENT, '--direction', 'down', '--no-focus', '--cwd', '/work']);
    expect(split.join(' ')).not.toContain('--env');
    // rename uses the delegate name
    expect(s.calls[1]).toEqual(['pane', 'rename', PANE, 'explore-ab12']);
    // the pane command runs the parent's agent-mode entry with task/result files + an exit sentinel
    const run = s.calls[2]!;
    expect(run[2]).toBe(PANE);
    expect(s.runCommand()).toMatch(/^'\/usr\/bin\/node' '\/app\/cli\/dist\/agent-mode\.js' --task-file '.+task\.json' --result-file '.+result\.json'; printf '__CORTEX_DELEGATE_EXIT_[0-9a-f]+_%s__\\n' \$\?$/);
    // wait targets the new pane, accepts idle or done, with a bounded slice
    expect(s.calls[3]!.slice(0, 3)).toEqual(['agent', 'wait', PANE]);
    expect(s.calls[3]).toContain('idle');
    expect(s.calls[3]).toContain('done');
    expect(s.calls[3]).toContain('--timeout');
    expect(s.calls[6]).toEqual(['agent', 'rename', PANE, 'explore-ab12']);
    expect(s.calls[7]!.slice(0, 5)).toEqual(['pane', 'read', PANE, '--source', 'recent-unwrapped']);
    expect(s.calls[8]).toEqual(['pane', 'report-agent', PANE, '--source', 'custom:nexus-cortex', '--agent', 'explore-ab12', '--state', 'idle']);
    expect(s.calls[9]!.slice(0, 5)).toEqual(['pane', 'report-metadata', PANE, '--source', 'custom:nexus-cortex-display']);
    expect(s.calls[9]).toContain('summary=delegate:completed');
    expect(verbs).not.toContain('pane close');

    // the task file carried the agent definition + prompt + model + timeout
    const task = JSON.parse(readFileSync(s.taskPath()!, 'utf-8'));
    expect(task.taskPrompt).toBe('Reply with exactly the word DELEGATE-OK.');
    expect(task.agentDefinition.name).toBe('explore');
    expect(task.modelId).toBe('deepseek-v4-flash');
    expect(task.timeoutMs).toBe(120_000);
    expect(task.projectPath).toBe('/work');
    expect(task.permissionMode).toBe('auto');
    // env parity: parent snapshot (minus HERDR_*) + controls + overrides, in the task file
    expect(task.env.CORTEX_HERDR_AGENT_NAME).toBe('explore-ab12');
    expect(task.env.CORTEX_TURN_DEADLINE_MS).toBe('120000');
    expect(task.env.CORTEX_AGENT_MODE).toBe('true');
    expect(task.env.CORTEX_AGENT_ID).toMatch(/^explore-/);
    expect(task.env.PARENT_ONLY).toBe('yes');
    expect(task.env.CORTEX_SUBAGENT_TEMPERATURE).toBe('0.3');
    expect(task.env.HERDR_PANE_ID).toBeUndefined();
    expect(task.env.HERDR_ENV).toBeUndefined();

    // result.json parsed into the SubAgentResult shape, dates revived, pane + runtime banked
    expect(result.status).toBe('completed');
    expect(result.fullResponse).toBe('DELEGATE-OK');
    expect(result.filesModified).toEqual(['/tmp/x.ts']);
    expect(result.cost.inputTokens).toBe(10);
    expect(result.startTime).toBeInstanceOf(Date);
    expect(result.endTime).toBeInstanceOf(Date);
    expect(result.paneId).toBe(PANE);
    expect(result.runtime).toBe('herdr');
    expect(result.transcriptTail).toContain('hello from pane');
    rmSync(opts.tmpRoot, { recursive: true, force: true });
  });

  it('CORTEX_HERDR_KEEP_DELEGATE_PANES=0 closes the pane and removes the temp dir after completion', async () => {
    const s = scripted({
      waits: ['idle'],
      onWait: (_i, sc) => writeFileSync(sc.resultPath()!, JSON.stringify(fakeResult())),
    });
    const opts = baseOpts(s, { env: { HERDR_ENV: '1', HERDR_PANE_ID: PARENT, CORTEX_HERDR_KEEP_DELEGATE_PANES: '0' } });
    const result = await runDelegateInHerdr(opts as any);
    const verbs = s.calls.map((c) => c.slice(0, 2).join(' '));
    expect(verbs[verbs.length - 1]).toBe('pane close');
    expect(s.calls[s.calls.length - 1]).toEqual(['pane', 'close', PANE]);
    expect(result.status).toBe('completed');
    expect(existsSync(s.resultPath()!)).toBe(false);
    rmSync(opts.tmpRoot, { recursive: true, force: true });
  });

  it('treats a reported idle rendered as done as completion', async () => {
    const s = scripted({
      waits: ['done'],
      onWait: (_i, sc) => writeFileSync(sc.resultPath()!, JSON.stringify(fakeResult())),
    });
    const opts = baseOpts(s);
    const result = await runDelegateInHerdr(opts as any);
    expect(result.status).toBe('completed');
    rmSync(opts.tmpRoot, { recursive: true, force: true });
  });

  it('result.json present before the agent is ever seen (fast child) completes without an agent rename', async () => {
    const s = scripted({
      waits: ['not_found'],
      onWait: (_i, sc) => writeFileSync(sc.resultPath()!, JSON.stringify(fakeResult())),
    });
    const opts = baseOpts(s);
    const result = await runDelegateInHerdr(opts as any);
    expect(result.status).toBe('completed');
    expect(s.calls.map((c) => c.slice(0, 2).join(' '))).not.toContain('agent rename');
    rmSync(opts.tmpRoot, { recursive: true, force: true });
  });
});

describe('runDelegateInHerdr — failure paths', () => {
  it('timeout: sends C-c, returns status timeout with the partial transcript, still keeps the pane', async () => {
    let now = 1_000_000;
    const s = scripted({
      waits: ['not_found', 'timeout', 'timeout'],
      onWait: () => { now += 60_000; },
      paneText: 'partial output line\n',
    });
    const opts = baseOpts(s, { timeoutMs: 100_000, now: () => now });
    const result = await runDelegateInHerdr(opts as any);
    const verbs = s.calls.map((c) => c.slice(0, 2).join(' '));
    expect(verbs).toContain('pane send-keys');
    const sk = s.calls.find((c) => c[1] === 'send-keys')!;
    expect(sk).toEqual(['pane', 'send-keys', PANE, 'C-c']);
    expect(result.status).toBe('timeout');
    expect(result.paneId).toBe(PANE);
    expect(result.transcriptTail).toContain('partial output line');
    expect(result.fullResponse).toContain('partial output line');
    expect(verbs).not.toContain('pane close');
    rmSync(opts.tmpRoot, { recursive: true, force: true });
  });

  it('child exited (exit sentinel in the pane) without writing result.json -> status error carrying the exit code', async () => {
    const s = scripted({ waits: ['not_found', 'not_found'], paneText: 'boom\n__CORTEX_DELEGATE_EXIT_deadbeef_1__\n' });
    // the sentinel token is random; make the read echo whatever token the run used
    (s.exec as any).mockImplementation(async (_bin: string, args: string[]) => {
      s.calls.push(args);
      const verb = args.slice(0, 2).join(' ');
      if (verb === 'pane split') return ok({ pane: { pane_id: PANE } });
      if (verb === 'pane rename') return ok({ type: 'ok' });
      if (verb === 'pane run') { (s as any)._run = args[3]; return text(''); }
      if (verb === 'agent wait') return err('agent_not_found');
      if (verb === 'pane report-agent' || verb === 'pane report-metadata') return text('');
      if (verb === 'pane read') {
        const tok = String((s as any)._run).match(/__CORTEX_DELEGATE_EXIT_([0-9a-f]+)_/)![1];
        return text(`boom\n__CORTEX_DELEGATE_EXIT_${tok}_1__\n`);
      }
      throw new Error(`unexpected ${verb}`);
    });
    const opts = baseOpts(s);
    const result = await runDelegateInHerdr(opts as any);
    expect(result.status).toBe('error');
    expect(result.error?.message).toMatch(/exited with code 1/);
    expect(result.transcriptTail).toContain('boom');
    rmSync(opts.tmpRoot, { recursive: true, force: true });
  });

  it('pane split failure surfaces as a thrown error (the caller falls back / reports)', async () => {
    const exec: DelegateExecFn = async () => err('pane_not_found', 'no such pane');
    await expect(runDelegateInHerdr({ ...baseOpts({ exec } as any), exec } as any)).rejects.toThrow(/pane split/);
  });
});

describe('resolveSubAgentRuntime / lever', () => {
  it('reads the lever with auto as the default', () => {
    expect(readSubAgentRuntimeLever({})).toBe('auto');
    expect(readSubAgentRuntimeLever({ CORTEX_SUBAGENT_RUNTIME: 'herdr' })).toBe('herdr');
    expect(readSubAgentRuntimeLever({ CORTEX_SUBAGENT_RUNTIME: 'PROCESS' })).toBe('process');
    expect(readSubAgentRuntimeLever({ CORTEX_SUBAGENT_RUNTIME: 'bogus' })).toBe('auto');
  });

  it('auto: herdr only when available AND the parent auto-approves; otherwise process', () => {
    expect(resolveSubAgentRuntime({ lever: 'auto', herdrAvailable: true, parentAutoApprove: true }).runtime).toBe('herdr');
    expect(resolveSubAgentRuntime({ lever: 'auto', herdrAvailable: true, parentAutoApprove: false }).runtime).toBe('process');
    expect(resolveSubAgentRuntime({ lever: 'auto', herdrAvailable: false, parentAutoApprove: true }).runtime).toBe('process');
  });

  it('explicit lever process wins over availability; explicit herdr falls back to process with a warning when unavailable', () => {
    expect(resolveSubAgentRuntime({ lever: 'process', herdrAvailable: true, parentAutoApprove: true }).runtime).toBe('process');
    const warn = vi.fn();
    const r = resolveSubAgentRuntime({ lever: 'herdr', herdrAvailable: false, parentAutoApprove: true, warn });
    expect(r.runtime).toBe('process');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(resolveSubAgentRuntime({ lever: 'herdr', herdrAvailable: true, parentAutoApprove: false }).runtime).toBe('herdr');
  });

  it('per-dispatch Task input `runtime` overrides the lever', () => {
    expect(resolveSubAgentRuntime({ lever: 'herdr', requested: 'process', herdrAvailable: true, parentAutoApprove: true }).runtime).toBe('process');
    expect(resolveSubAgentRuntime({ lever: 'process', requested: 'herdr', herdrAvailable: true, parentAutoApprove: false }).runtime).toBe('herdr');
    const warn = vi.fn();
    expect(resolveSubAgentRuntime({ lever: 'auto', requested: 'herdr', herdrAvailable: false, parentAutoApprove: true, warn }).runtime).toBe('process');
    expect(warn).toHaveBeenCalled();
    expect(resolveSubAgentRuntime({ lever: 'auto', requested: 'nonsense', herdrAvailable: true, parentAutoApprove: true }).runtime).toBe('herdr');
  });

  it('keep-panes default is true; 0/false turn it off', () => {
    expect(readKeepDelegatePanes({})).toBe(true);
    expect(readKeepDelegatePanes({ CORTEX_HERDR_KEEP_DELEGATE_PANES: '1' })).toBe(true);
    expect(readKeepDelegatePanes({ CORTEX_HERDR_KEEP_DELEGATE_PANES: '0' })).toBe(false);
    expect(readKeepDelegatePanes({ CORTEX_HERDR_KEEP_DELEGATE_PANES: 'false' })).toBe(false);
  });

  it('shellQuote single-quotes and escapes embedded quotes', () => {
    expect(shellQuote('/a/b c')).toBe("'/a/b c'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});
