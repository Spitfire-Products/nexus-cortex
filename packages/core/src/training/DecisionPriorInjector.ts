/**
 * DecisionPriorInjector — formats a <system-reminder> block from past
 * decision stats so the orchestrator can prepend it to the next tool
 * result, giving the model evidence-based priors about how a given
 * (toolName, input) pattern has fared in past sessions.
 *
 * Only emits a reminder when at least one prior FAILED — pure-success
 * histories produce no output (no actionable signal, just noise).
 *
 * When `recent` is supplied, the reminder body includes up to 3 specific
 * recent outcomes (newest first) — matching the
 * "up to 3 prior outcomes" pattern. Specific
 * recent entries give the model far more actionable signal than the
 * aggregate count alone (e.g. "the last 2 attempts both timed out").
 */

import type { Decision, DecisionStats } from './DecisionStore.js';

const RECENT_LIMIT = 3;

export function formatPriorReminder(
  toolName: string,
  stats: DecisionStats,
  recent?: Decision[],
): string | null {
  if (stats.failures === 0) return null;

  const ratio = `${stats.failures} ${stats.failures === 1 ? 'failure' : 'failures'} of ${stats.total} prior call${stats.total === 1 ? '' : 's'}`;
  const errorPart = stats.lastError ? ` Last error: ${stats.lastError}.` : '';

  let recentBlock = '';
  if (recent && recent.length > 0) {
    const top = recent.slice(0, RECENT_LIMIT);
    const lines = top.map((d, i) => {
      const status = d.success ? 'success' : 'failed';
      const err = d.success || !d.errorSnippet ? '' : `: ${d.errorSnippet}`;
      return ` ${i + 1}. ${status}${err}`;
    });
    recentBlock = ` Recent outcomes (newest first):\n${lines.join('\n')}`;
  }

  return (
    `<system-reminder>PRIOR DECISIONS for tool "${toolName}" with this exact input: ${ratio}.${errorPart}${recentBlock} Consider checking inputs or trying an alternate approach before retrying the same call.</system-reminder>\n\n`
  );
}


/**
 * Family-level reminder (AHE borrow): fires when the SAME error family has
 * failed on >=2 DIFFERENT inputs — the agent is retrying variations of one
 * failing approach. Identical-input retries stay the exact-input reminder's
 * job (require distinctInputs >= 2 so the two never stack for one cause).
 */
export function formatFamilyReminder(
  toolName: string,
  family: string,
  count: number,
  distinctInputs: number,
  recent: Decision[],
): string | null {
  if (count < 2 || distinctInputs < 2) return null;
  let recentBlock = '';
  if (recent.length > 0) {
    const lines = recent.slice(0, RECENT_LIMIT).map((d, i) => {
      const err = d.errorSnippet ? `: ${d.errorSnippet}` : '';
      return ` ${i + 1}. failed${err}`;
    });
    recentBlock = ` Recent similar failures (newest first):\n${lines.join('\n')}`;
  }
  return (
    `<system-reminder>REPEATED FAILURE PATTERN for tool "${toolName}": ${count} similar failures ` +
    `across ${distinctInputs} different inputs (error family: "${family}").` +
    `${recentBlock} Stop retrying variations of the same approach — inspect the contract/path/` +
    `signature once, then switch to a different strategy.</system-reminder>\n\n`
  );
}
