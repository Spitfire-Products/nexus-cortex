/**
 * `cortex autoresearch judge` — LLM-as-judge qualitative gate over a candidate diff.
 *
 * The auto-research statistical gate (`cortex autoresearch experiment`) answers
 * "is this a REAL improvement?" (effect size, CI, FWER, holdout). This subcommand
 * answers the orthogonal question "is the output actually GOOD?" — coherent,
 * on-task, no hallucination, no obvious regression or unsafe change — by reading
 * the candidate's git diff (READ-ONLY) and scoring it against a caller-supplied
 * rubric. It is the qualitative half of `mergeEligible = gate-keep ∧ judge-approve`
 * used by the opt-in judge gate in `cortex autoresearch loop`.
 *
 * BOUNDARY: this NEVER edits files. It reads `git diff <base>..<candidate>` (the
 * change under test is supplied inline in the prompt — no task sets, no verifiers)
 * and returns a structured verdict. It mirrors the NPC-swarm judge persona's
 * verdict shape (`{approve, score, confidence, rationale}`).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createOrchestrator } from '@nexus-cortex/core';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface AutoResearchJudgeOptions {
  cwd?: string;
  baseRef?: string;
  candidateRef?: string;
  rubric?: string;
  rubricFile?: string;
  /** optional extra framing for what this judge is evaluating. */
  mission?: string;
  model?: string;
  /** cap the diff fed to the model (chars). Default 60000. */
  maxDiffChars?: string;
  json?: boolean;
}

/** Extract the first JSON object containing an "approve" field from model text. */
function parseVerdict(text: string): { approve: boolean; score: number; confidence: number; rationale: string } | null {
  const tryParse = (s: string) => {
    try {
      const v = JSON.parse(s);
      if (v && typeof v === 'object' && 'approve' in v) return v as Record<string, unknown>;
    } catch { /* not JSON */ }
    return null;
  };
  // Whole-string, then the widest brace span, then a fenced block.
  const candidates: string[] = [text.trim()];
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(text.slice(firstBrace, lastBrace + 1));
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) candidates.push(fence[1].trim());
  for (const c of candidates) {
    const v = tryParse(c);
    if (v) {
      return {
        approve: v.approve === true,
        score: Math.max(0, Math.min(100, Number(v.score ?? 0))),
        confidence: Math.max(0, Math.min(1, Number(v.confidence ?? 0))),
        rationale: typeof v.rationale === 'string' ? v.rationale : '',
      };
    }
  }
  return null;
}

export async function autoResearchJudge(options: AutoResearchJudgeOptions): Promise<void> {
  const theme = ThemeManager.getTheme();
  const json = !!options.json;

  const cwd = options.cwd ?? process.cwd();
  const model = options.model ?? process.env.DEFAULT_MODEL_ID ?? 'deepseek-v4-flash';
  const baseRef = options.baseRef;
  const candidateRef = options.candidateRef;
  const rubric = options.rubricFile ? readFileSync(options.rubricFile, 'utf8') : options.rubric;

  if (!baseRef || !candidateRef) {
    const err = 'provide --base-ref <ref> and --candidate-ref <ref>';
    if (json) console.log(JSON.stringify({ error: err }, null, 2));
    else console.error(theme.colors.error(`Error: ${err}`));
    process.exit(1);
  }
  if (!rubric) {
    const err = 'provide --rubric <text> or --rubric-file <path>';
    if (json) console.log(JSON.stringify({ error: err }, null, 2));
    else console.error(theme.colors.error(`Error: ${err}`));
    process.exit(1);
  }

  // READ-ONLY: capture the candidate diff. Both refs are reachable from the
  // candidate worktree (a worktree of the same repo).
  let diff: string;
  try {
    diff = execFileSync('git', ['-C', cwd, 'diff', `${baseRef}`, `${candidateRef}`], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e: any) {
    const err = `git diff ${baseRef}..${candidateRef} failed: ${e?.message ?? e}`;
    if (json) console.log(JSON.stringify({ error: err }, null, 2));
    else console.error(theme.colors.error(`Error: ${err}`));
    process.exit(1);
    return;
  }

  const maxDiffChars = Number(options.maxDiffChars ?? '60000');
  let diffForPrompt = diff;
  let truncated = false;
  if (diff.length > maxDiffChars) {
    diffForPrompt = diff.slice(0, maxDiffChars);
    truncated = true;
  }

  const prompt = [
    'You are an impartial JUDGE evaluating a candidate code change for quality. You are READ-ONLY:',
    'do NOT use any tools, do NOT edit, create, or run files. Base your judgment ONLY on the diff and',
    'rubric below.',
    '',
    options.mission ? `## What you are evaluating\n${options.mission}\n` : '',
    '## Rubric',
    rubric,
    '',
    `## Candidate diff (${baseRef}..${candidateRef})${truncated ? ' [TRUNCATED]' : ''}`,
    '```diff',
    diffForPrompt,
    '```',
    '',
    '## Output',
    'Respond with ONE JSON object and NOTHING else:',
    '{"approve": <boolean>, "score": <0-100 integer>, "confidence": <0.0-1.0>, "rationale": "<one or two sentences>"}',
    'Approve only if the change is correct, coherent, on-task, and free of hallucination, obvious',
    'regression, or unsafe edits. Be skeptical: when in doubt, do not approve.',
  ].filter((l) => l !== '').join('\n');

  // Headless evaluation: no MCP overhead, no router record noise. permissionMode
  // 'auto' avoids interactive hangs in headless mode; the prompt is evaluative
  // (the model returns a verdict, not edits) and carries the diff inline so no
  // file/tool access is needed.
  process.env.MCP_AUTO_INJECT = process.env.MCP_AUTO_INJECT ?? 'false';
  process.env.MODEL_ROUTER_RECORD = 'false';

  try {
    const orchestrator = await createOrchestrator({
      projectPath: cwd,
      workingDirectory: cwd,
      defaultModelId: model,
      permissionMode: 'auto',
    } as any);
    await orchestrator.createSession(cwd, model);

    if (!json) console.log(theme.colors.muted(` judging ${baseRef}..${candidateRef} with ${model}…`));
    const response: any = await orchestrator.sendMessage(prompt, { modelId: model } as any);

    const text = typeof response?.content === 'string'
      ? response.content
      : Array.isArray(response?.content)
        ? response.content.filter((b: any) => b?.type === 'text' || typeof b?.text === 'string').map((b: any) => b.text ?? '').join('')
        : '';

    const verdict = parseVerdict(text);
    if (!verdict) {
      // Could not parse a verdict — fail-closed (approve:false) so a required
      // judge never lets an unevaluated candidate through.
      const out = { approve: false, score: 0, confidence: 0, rationale: 'judge produced no parseable verdict', parseError: true, model: response?.model?.id ?? model };
      if (json) console.log(JSON.stringify(out, null, 2));
      else console.log(` ${theme.colors.error('No parseable verdict')} — treating as not-approved`);
      process.exit(0);
    }

    const out = {
      baseRef, candidateRef,
      model: response?.model?.id ?? model,
      approve: verdict.approve,
      score: verdict.score,
      confidence: verdict.confidence,
      rationale: verdict.rationale,
      diffTruncated: truncated,
    };

    if (json) { console.log(JSON.stringify(out, null, 2)); }
    else {
      console.log();
      console.log(` ${theme.colors.highlight('Verdict')}    ${out.approve ? theme.colors.success('APPROVE') : theme.colors.error('reject')}  score ${out.score}/100  conf ${out.confidence}`);
      console.log(` ${theme.colors.highlight('Rationale')}  ${theme.colors.muted(out.rationale)}`);
      console.log();
    }
    process.exit(0);
  } catch (error: any) {
    if (json) console.log(JSON.stringify({ error: error.message, approve: false }, null, 2));
    else console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
