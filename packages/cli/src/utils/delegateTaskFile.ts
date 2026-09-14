/**
 * File-driven agent-mode (R147 HB-HERDR-DELEGATES).
 *
 * The IPC child (SubAgentProcessManager -> fork) receives its start payload over
 * process.send; a herdr-pane delegate has no IPC channel, so the same agent-mode
 * entry reads the payload from `--task-file <path>` and writes its SubAgentResult
 * to `--result-file <path>` (env fallbacks: CORTEX_AGENT_TASK_FILE / CORTEX_AGENT_RESULT_FILE).
 * The task file is the IPCStartMessage payload plus `permissionMode` (auto|interactive).
 */

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import type { IPCStartMessage, SubAgentResult } from '@nexus-cortex/core';

export type DelegateTaskPayload = IPCStartMessage['payload'] & {
  permissionMode?: 'auto' | 'interactive';
  /** Parent env snapshot + overrides (the pane shell's env is the herdr server's, not the parent's). */
  env?: Record<string, string>;
};

export interface DelegateArgs {
  taskFile?: string;
  resultFile?: string;
}

export function parseDelegateArgs(argv: string[], env: NodeJS.ProcessEnv = {}): DelegateArgs {
  const out: DelegateArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--task-file' && argv[i + 1]) out.taskFile = argv[++i];
    else if (a.startsWith('--task-file=')) out.taskFile = a.slice('--task-file='.length);
    else if (a === '--result-file' && argv[i + 1]) out.resultFile = argv[++i];
    else if (a.startsWith('--result-file=')) out.resultFile = a.slice('--result-file='.length);
  }
  if (!out.taskFile && env.CORTEX_AGENT_TASK_FILE) out.taskFile = env.CORTEX_AGENT_TASK_FILE;
  if (!out.resultFile && env.CORTEX_AGENT_RESULT_FILE) out.resultFile = env.CORTEX_AGENT_RESULT_FILE;
  return out;
}

/**
 * `consume` unlinks the file after a successful parse: it carries the parent's env snapshot
 * (API keys), and the child is its only reader.
 */
export function readDelegateTaskFile(path: string, opts: { consume?: boolean } = {}): DelegateTaskPayload {
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<DelegateTaskPayload>;
  for (const key of ['agentId', 'agentDefinition', 'taskPrompt', 'modelId', 'projectPath'] as const) {
    if (parsed[key] === undefined || parsed[key] === null || parsed[key] === '') {
      throw new Error(`delegate task file ${path} is missing "${key}"`);
    }
  }
  if (opts.consume) {
    try { unlinkSync(path); } catch { /* best effort */ }
  }
  return {
    ...(parsed as DelegateTaskPayload),
    timeoutMs: Number.isFinite(parsed.timeoutMs) && (parsed.timeoutMs as number) > 0 ? (parsed.timeoutMs as number) : 300_000,
    maxTurns: Number.isFinite(parsed.maxTurns) && (parsed.maxTurns as number) > 0 ? (parsed.maxTurns as number) : 50,
    permissionMode: parsed.permissionMode === 'interactive' ? 'interactive' : 'auto',
  };
}

/** Apply the task file's env to the process: overrides win, HERDR_* (own pane identity) is never touched. */
export function applyDelegateEnv(env: Record<string, string> | undefined, target: NodeJS.ProcessEnv = process.env): void {
  if (!env) return;
  for (const [k, v] of Object.entries(env)) {
    if (k.startsWith('HERDR_') || typeof v !== 'string') continue;
    target[k] = v;
  }
}

/** Atomic write (tmp + rename) so a reader never sees a half-written result. */
export function writeDelegateResult(path: string, result: SubAgentResult): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(result), 'utf-8');
  renameSync(tmp, path);
}
