/**
 * `cortex autoresearch list` — show recorded keep/discard decisions from
 * `.cortex/experiments.jsonl` (latest snapshot per experimentTag).
 */
import { ExperimentLedger, type ExperimentDecision } from '@nexus-cortex/core';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { findProjectRoot } from '../config/utils.js';

export interface AutoResearchListOptions {
  decision?: string; // keep | discard | pending
  json?: boolean;
}

export async function autoResearchList(options: AutoResearchListOptions): Promise<void> {
  const theme = ThemeManager.getTheme();
  const ledger = new ExperimentLedger(findProjectRoot());

  const filter = options.decision
    ? { decision: options.decision as ExperimentDecision }
    : {};
  const records = ledger.list(filter);

  if (options.json) {
    console.log(JSON.stringify(records, null, 2));
    return;
  }

  if (records.length === 0) {
    console.log(theme.colors.muted(' No experiments recorded.'));
    return;
  }

  console.log();
  for (const r of records) {
    const decColor =
      r.decision === 'keep' ? theme.colors.success
      : r.decision === 'discard' ? theme.colors.error
      : theme.colors.muted;
    console.log(
      ` ${decColor(r.decision.toUpperCase().padEnd(8))} ${theme.colors.highlight(r.experimentTag.padEnd(16))} ` +
      `${r.baseRef}→${r.candidateRef}  ` +
      `p=${r.pValue ?? '—'} CI[${r.ciLow ?? '—'},${r.ciHigh ?? '—'}] ` +
      `${r.fwerAdjusted ? '' : theme.colors.muted('(unadjusted) ')}` +
      `${r.results.length} task(s)`
    );
  }
  console.log();
  console.log(theme.colors.muted(` ${records.length} experiment(s)`));
  console.log();
}
