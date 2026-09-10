/**
 * Stage 2 — deterministic citation grounding.
 *
 * Stage 1 (generative attestation) plateaued ~5/6: a model can reconstruct a
 * plausible-looking `verbatim_source` and still ship a fabricated
 * coordinate, because the fabrication is a regurgitated training prior, not
 * an observation. Steering/attestation cannot close that — only mechanically
 * rejecting a citation whose source does NOT occur in this turn's actual
 * tool output can. This is the Edit `old_string` forcing function applied to
 * citations: it must match what was really read, or it is rejected.
 *
 * Matching is intentionally tolerant of presentation (markdown backticks,
 * indentation, whitespace runs) but NOT of content: an elided/`...`
 * "quote", a re-typed-from-memory line, or an invented snippet will not be a
 * substring of the normalized tool output and is rejected. Sources too short
 * to be a meaningful transcription claim are skipped (a stray `{` is not the
 * fabrication risk and would match everything).
 */

export interface CitationEvidence {
  reference: string;
  verbatim_source: string;
}

export interface CitationVerificationResult {
  grounded: boolean;
  ungrounded: CitationEvidence[];
}

/** Min normalized length for a source to be worth verifying. */
const MIN_SOURCE_LEN = 8;

function normalize(s: string): string {
  return s
    .replace(/`+/g, '') // markdown code fences/inline ticks
    .replace(/\s+/g, ' ') // collapse all whitespace runs
    .trim();
}

/** 4.91.1: models annotate a verbatim_source as `$ cmd → OUTPUT` / `cmd:\n OUTPUT` (the format the
 *  requirements nudge teaches for verified_how bled into citations) — the raw tool output has no such
 *  wrapper, so the exact-substring check false-rejects it. Return the candidate forms to try: the whole
 *  string AND the tail after a leading shell-prompt-command-arrow (or a trailing `→`). Grounding still
 *  requires the real OUTPUT to be present verbatim, so this tolerates annotation without admitting fabrication. */
function sourceForms(src: string): string[] {
  const forms = [src];
  // strip a leading `$ ...→` or `> ...→` or `# ...→` command-echo prefix
  const arrow = src.replace(/^[\s]*[$>#][^\n→]*(?:→|=>|->)\s*/, '');
  if (arrow !== src && arrow.length >= MIN_SOURCE_LEN) forms.push(arrow);
  // if there is an arrow anywhere, also try just the part after the LAST arrow (cmd → output)
  const lastArrow = src.split(/→|=>|->/).pop()?.trim() ?? '';
  if (lastArrow && lastArrow !== src && lastArrow.length >= MIN_SOURCE_LEN) forms.push(lastArrow);
  return forms;
}

/**
 * @param citations  the EndTurn attestation's citation list
 * @param toolOutputs concatenated text of THIS turn's tool results
 */
export interface CitationVerificationOptions {
  /**
   * 4.100.0 (cell-d-k3 distill, 2026-09-10): accept a MULTI-LINE verbatim_source when every non-trivial
   * line of it is present verbatim in the corpus, even if the block as a whole is not contiguous there.
   * Measured on 84 rejected citations: 47% were "near-verbatim" — real lines the model stitched from
   * several outputs (test runs, a heredoc it wrote then cat'd) — and were rejected as a block while every
   * line was genuine evidence. Line granularity keeps the anti-fabrication guarantee (an invented line
   * still fails); only contiguity relaxes. Default on; CORTEX_ENDTURN_CITATION_LINEWISE=false restores
   * whole-block matching.
   */
  linewise?: boolean;
}

export function verifyCitationsGrounded(
  citations: CitationEvidence[] | undefined,
  toolOutputs: string,
  opts: CitationVerificationOptions = {},
): CitationVerificationResult {
  if (!Array.isArray(citations) || citations.length === 0) {
    return { grounded: true, ungrounded: [] };
  }
  const haystack = normalize(toolOutputs);
  const ungrounded: CitationEvidence[] = [];
  const present = (f: string) => haystack.includes(normalize(f));

  for (const c of citations) {
    const raw = c?.verbatim_source ?? '';
    const src = normalize(raw);
    if (src.length < MIN_SOURCE_LEN) continue; // too short to verify meaningfully
    // grounded if the source — or its de-annotated form (raw output after a `$ cmd →` wrapper) — is present
    if (sourceForms(src).some(present)) continue;
    if (opts.linewise) {
      const lines = String(raw).split(/\r?\n/).map(normalize).filter((l) => l.length >= MIN_SOURCE_LEN);
      if (lines.length >= 2 && lines.every((l) => sourceForms(l).some(present))) continue;
    }
    ungrounded.push(c);
  }

  return { grounded: ungrounded.length === 0, ungrounded };
}
