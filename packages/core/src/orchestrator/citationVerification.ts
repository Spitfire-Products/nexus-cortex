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

/**
 * @param citations  the EndTurn attestation's citation list
 * @param toolOutputs concatenated text of THIS turn's tool results
 */
export function verifyCitationsGrounded(
  citations: CitationEvidence[] | undefined,
  toolOutputs: string,
): CitationVerificationResult {
  if (!Array.isArray(citations) || citations.length === 0) {
    return { grounded: true, ungrounded: [] };
  }
  const haystack = normalize(toolOutputs);
  const ungrounded: CitationEvidence[] = [];

  for (const c of citations) {
    const src = normalize(c?.verbatim_source ?? '');
    if (src.length < MIN_SOURCE_LEN) continue; // too short to verify meaningfully
    if (!haystack.includes(src)) {
      ungrounded.push(c);
    }
  }

  return { grounded: ungrounded.length === 0, ungrounded };
}
