/**
 * `cortex autoresearch fix` — headless, autonomous coding-agent edit of a worktree.
 *
 * The auto-research swarm's Fixer needs a PRODUCTION way to make a candidate edit
 * on disk (NOT the Vite dev server, which is dev-only). `cortex message` is just
 * an HTTP client to a running server; this runs the orchestrator IN-PROCESS with
 * the real Edit/Write/Bash executors, `permissionMode: 'auto'` (YOLO — no
 * approval prompts), scoped to `--cwd` (the candidate worktree). It EDITS but
 * does NOT commit — the caller (the swarm Fixer) does `git add -A` + commit, so
 * the candidate ref differs from base.
 *
 * BOUNDARY: the cortex harness owns this invocation (editing harness code with its own
 * executors is the harness's domain); the swarm owns WHICH deficiency/strategy
 * and the commit/FWER orchestration. The prompt is supplied by the caller
 * (deficiency description + repro + strategy flavor) and MUST NOT contain task
 * sets — that overfitting trip-wire is the caller's structural guarantee.
 */
import { readFileSync } from 'node:fs';
import { createOrchestrator } from '@nexus-cortex/core';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface AutoResearchFixOptions {
  cwd?: string;
  prompt?: string;
  promptFile?: string;
  model?: string;
  maxIterations?: string;
  json?: boolean;
}

export async function autoResearchFix(options: AutoResearchFixOptions): Promise<void> {
  const theme = ThemeManager.getTheme();
  const json = !!options.json;

  const cwd = options.cwd ?? process.cwd();
  const model = options.model ?? process.env.DEFAULT_MODEL_ID ?? 'deepseek-v4-flash';
  const prompt = options.promptFile ? readFileSync(options.promptFile, 'utf8') : options.prompt;

  if (!prompt) {
    console.error(theme.colors.error('Error: provide --prompt <text> or --prompt-file <path>'));
    process.exit(1);
  }

  // Headless autonomous edit: no MCP overhead, no router auto-record noise.
  if (options.maxIterations) process.env.MAX_TOOL_ITERATIONS = options.maxIterations;
  process.env.MCP_AUTO_INJECT = process.env.MCP_AUTO_INJECT ?? 'false';
  process.env.MODEL_ROUTER_RECORD = 'false';

  try {
    const orchestrator = await createOrchestrator({
      projectPath: cwd,
      workingDirectory: cwd,
      defaultModelId: model,
      permissionMode: 'auto', // YOLO — autonomous, no approval prompts
    } as any);
    await orchestrator.createSession(cwd, model);

    if (!json) console.log(theme.colors.muted(` fixing in ${cwd} with ${model}…`));
    const response: any = await orchestrator.sendMessage(prompt, { modelId: model } as any);

    const toolUses: any[] = Array.isArray(response?.toolUses) ? response.toolUses : [];
    const editTools = toolUses.filter(t => /^(Edit|Write|MultiEdit|ApplyPatch)$/i.test(t?.name ?? ''));
    const filesEdited = [...new Set(editTools.map(t => t?.input?.file_path ?? t?.input?.path).filter(Boolean))];
    const iterations = response?.metadata?.toolCallIterations ?? 0;
    const text = typeof response?.content === 'string'
      ? response.content
      : Array.isArray(response?.content)
        ? response.content.filter((b: any) => b?.type === 'text' || typeof b?.text === 'string').map((b: any) => b.text ?? '').join('')
        : '';

    const out = {
      cwd,
      model: response?.model?.id ?? model,
      changed: editTools.length > 0,
      filesEdited,
      toolCallCount: toolUses.length,
      iterations,
      summary: text.slice(0, 2000),
    };

    if (json) { console.log(JSON.stringify(out, null, 2)); }
    else {
      console.log();
      console.log(` ${theme.colors.highlight('Edited')}     ${out.changed ? theme.colors.success(filesEdited.join(', ') || `${editTools.length} edit(s)`) : theme.colors.muted('no file edits')}`);
      console.log(` ${theme.colors.highlight('Tools')}      ${out.toolCallCount} call(s) over ${iterations} iteration(s)`);
      console.log(theme.colors.muted(` (uncommitted — the caller commits to produce the candidate ref)`));
      console.log();
    }
    // Orchestrator may hold timers/handles; exit cleanly after a one-shot edit.
    process.exit(0);
  } catch (error: any) {
    if (json) console.log(JSON.stringify({ error: error.message }, null, 2));
    else console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
