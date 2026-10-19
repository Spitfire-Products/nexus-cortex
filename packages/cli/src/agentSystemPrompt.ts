import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * R266 (2026-10-19): a delegated agent definition's `systemPrompt` was never delivered — the forked
 * child built its OrchestratorConfig without it, so every delegate (Browse included) ran the parent
 * card's boot-minimal "coding agent, run orient via Bash" prompt. The system_prompt override channel
 * that already exists is a FILE (OrchestratorConfig.systemPromptFile / CORTEX_SYSTEM_PROMPT_FILE, which
 * also makes SystemMessageMiddleware skip the card preset), so the prompt is materialized to one.
 * Returns the file path, or undefined when the definition has no prompt or an override is already set.
 */
export function materializeAgentSystemPrompt(
  agentDef: { name?: string; systemPrompt?: unknown },
  env: NodeJS.ProcessEnv = process.env,
  dir: string = os.tmpdir(),
): string | undefined {
  if ((env.CORTEX_SYSTEM_PROMPT_FILE ?? '').trim()) return undefined;
  const prompt = typeof agentDef.systemPrompt === 'string' ? agentDef.systemPrompt.trim() : '';
  if (!prompt) return undefined;
  const safe = String(agentDef.name ?? 'agent').replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 40) || 'agent';
  const file = path.join(dir, `cortex-agent-prompt-${safe}-${process.pid}.md`);
  fs.writeFileSync(file, prompt + '\n', { encoding: 'utf-8', mode: 0o600 });
  return file;
}
