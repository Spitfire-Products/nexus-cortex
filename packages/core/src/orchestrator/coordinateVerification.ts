/**
 * Stage 3 — deterministic coordinate verification.
 *
 * Q1 established the fabrication is intrinsic regurgitation: grok emits
 * `(line 446)` from training priors even when nothing asks for it and
 * nothing forbids it. Steering and self-attestation plateaued ~5/6 because
 * a model can rubber-stamp. The only thing that closes it is mechanically
 * rejecting a coordinate that does not correspond to something actually
 * read this turn.
 *
 * Rule (Edit `old_string` standard, applied to coordinates): a line number
 * appearing in the answer is valid IFF some EndTurn citation's
 * `verbatim_source` actually occurs at that exact line in this turn's
 * `cat -n` tool output. A bare prose number with no backing citation is
 * unverifiable → violation (forces quote-or-drop, the empirically-6/6
 * behavior). When there is no parseable `cat -n` output we cannot verify,
 * so we do not false-reject.
 */

export interface CitationEvidence {
  reference: string;
  verbatim_source: string;
}

export interface CoordinateViolation {
  /** The raw claim substring from the answer, e.g. "line 446". */
  claim: string;
  /** The fabricated/unbacked line number. */
  line: number;
}

export interface CoordinateVerificationResult {
  ok: boolean;
  violations: CoordinateViolation[];
}

const MIN_SOURCE_LEN = 8;

function normalize(s: string): string {
  return s
    .replace(/`+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse Read `cat -n` output → Map<lineNo, normalizedCode>. Tolerates the
 *  ` N→code`, `N\tcode`, and `N | code` shapes. */
function parseLineMap(toolOutputs: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const raw of toolOutputs.split('\n')) {
    const m = raw.match(/^\s*(\d{1,7})(?:→|\t|\s\|\s)\s?(.*)$/);
    if (!m) continue;
    const n = parseInt(m[1]!, 10);
    if (!Number.isFinite(n)) continue;
    map.set(n, normalize(m[2] ?? ''));
  }
  return map;
}

/** Distinct line-number claims in the answer, with the raw matched text. */
function extractClaims(answerText: string): Array<{ claim: string; line: number }> {
  const out: Array<{ claim: string; line: number }> = [];
  const seen = new Set<number>();
  const patterns: RegExp[] = [
    /\blines?\s*#?\s*(\d{1,6})/gi,
    /[\w./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|rs|py|go|java|rb|c|cpp|h|hpp):(\d{1,6})/g,
    /\(\s*lines?\s*(\d{1,6})/gi,
    /\bL(\d{1,6})\b/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(answerText)) !== null) {
      const line = parseInt(m[1]!, 10);
      if (!Number.isFinite(line) || seen.has(line)) continue;
      seen.add(line);
      out.push({ claim: m[0], line });
    }
  }
  return out;
}

/**
 * @param answerText   the model's drafted final answer
 * @param toolOutputs  concatenated this-turn tool result text (Read = cat -n)
 * @param citations    EndTurn attestation citations (Stage 2 evidence)
 */
export function verifyCoordinates(
  answerText: string,
  toolOutputs: string,
  citations: CitationEvidence[] | undefined,
): CoordinateVerificationResult {
  const lineMap = parseLineMap(toolOutputs);
  if (lineMap.size === 0) {
    // No parseable cat -n reads this turn → nothing to verify against.
    return { ok: true, violations: [] };
  }

  const claims = extractClaims(answerText);
  if (claims.length === 0) {
    return { ok: true, violations: [] };
  }

  // Which line numbers are *backed* by a citation whose verbatim_source
  // actually appears at that line in this turn's reads.
  const backedLines = new Set<number>();
  for (const c of citations ?? []) {
    const src = normalize(c?.verbatim_source ?? '');
    if (src.length < MIN_SOURCE_LEN) continue;
    for (const [lineNo, code] of lineMap) {
      if (code.includes(src) || src.includes(code)) {
        backedLines.add(lineNo);
      }
    }
  }

  const violations = claims.filter((c) => !backedLines.has(c.line));
  return { ok: violations.length === 0, violations };
}

/**
 * Deterministic-only score in [0,1] for the audit-OFF path (no EndTurn
 * citations exist). Signal: of the line-number claims in the answer, what
 * fraction correspond to a line that actually exists in this turn's
 * `cat -n` reads. With the ReadFileTool root-cause fix the model
 * transcribes real numbers (→ 1.0); a regurgitated prior (446 in a
 * 260-line file) won't exist (→ lower). No coordinate claims = no risk
 * taken (1.0). Claims but no numbered reads = cannot verify (0.5,
 * conservative). Pure → unit-tested.
 */
export function deterministicCoordinateScore(
  answerText: string,
  toolOutputs: string,
): number {
  const claims = extractClaims(answerText);
  if (claims.length === 0) return 1; // no coordinate assertions → nothing fabricated
  const lineMap = parseLineMap(toolOutputs);
  if (lineMap.size === 0) return 0.5; // claims present, no numbered reads → uncertain
  const grounded = claims.filter((c) => lineMap.has(c.line)).length;
  return grounded / claims.length;
}
