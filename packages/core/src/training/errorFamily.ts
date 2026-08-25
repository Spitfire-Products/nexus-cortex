/**
 * classifyErrorFamily — normalize an error snippet into a stable "family"
 * key so the decision store can recognize REPEATED-APPROACH failures across
 * non-identical inputs (AHE borrow, 2026-08-23: the TB2 #1 harness's
 * execution_risk_hints middleware hints on error-FAMILY repetition, where
 * our exact-input prior only catches byte-identical retries).
 *
 * Normalization is deliberately crude and deterministic: first meaningful
 * line, lowercased, with the volatile tokens (paths, digits, hex ids,
 * quoted strings) collapsed to placeholders. Two snippets from the same
 * failing approach should collide; different error classes should not.
 * Empty input returns '' (callers treat that as "no family").
 */

const MAX_FAMILY_LEN = 96;

export function classifyErrorFamily(snippet: string): string {
  if (!snippet) return '';
  // First non-blank line carries the error class in practice (shell errors,
  // Python tracebacks lead with the exception line, node errors likewise).
  const line = snippet
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return '';
  let fam = line.toLowerCase();
  // Quoted strings first (may contain paths/digits).
  fam = fam.replace(/"[^"]*"/g, '<q>').replace(/'[^']*'/g, '<q>');
  // Hex ids (container ids, hashes) BEFORE the generic digit collapse so
  // mixed hex like a3f9b2 doesn't leave letter residue that differs per id.
  fam = fam.replace(/\b[0-9a-f]{6,}\b/g, '<hex>');
  // Path-like tokens (absolute or ./relative with at least one slash).
  fam = fam.replace(/(?:\.{0,2}\/)[^\s:,;)]+/g, '<path>');
  // Remaining digits.
  fam = fam.replace(/\d+/g, '#');
  // Collapse whitespace.
  fam = fam.replace(/\s+/g, ' ').trim();
  return fam.slice(0, MAX_FAMILY_LEN);
}
