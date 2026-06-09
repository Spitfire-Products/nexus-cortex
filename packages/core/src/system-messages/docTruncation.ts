/**
 * Document truncation for system-message injection.
 *
 * Large project docs (CLAUDE.md, MEMORY.md, AGENTS.md, GEMINI.md, CORTEX.md)
 * are injected on every fresh-session turn-0 request. A 32KB CLAUDE.md alone
 * costs ~8K input tokens per fresh request. For benchmark / one-shot curl
 * usage that always starts a new session, this is pure overhead — the model
 * can Read the file on demand if it actually needs the deeper content.
 *
 * `SYSTEM_MESSAGE_DOC_MAX_BYTES` is opt-in: leave unset (or `0`) to preserve
 * the existing behavior of injecting docs verbatim. Set a positive integer
 * to cap each doc's content at that many bytes. Truncation appends a marker
 * that tells the model how to retrieve the rest.
 */
export interface TruncateOptions {
  /** Max bytes to retain (0 or undefined → no truncation) */
  maxBytes?: number;
  /** Filesystem path included in the truncation marker (so the model knows how to Read more) */
  sourcePath?: string;
  /** Human-readable doc label included in the marker */
  label?: string;
}

export function truncateDocForInjection(content: string, opts: TruncateOptions = {}): string {
  const cap = opts.maxBytes && opts.maxBytes > 0 ? opts.maxBytes : 0;
  if (!cap || content.length <= cap) return content;

  const head = content.slice(0, cap);
  const truncatedBytes = content.length - cap;
  const label = opts.label || 'this doc';
  const pathHint = opts.sourcePath ? ` (path: ${opts.sourcePath})` : '';
  return (
    head +
    `\n\n<!-- [${label} truncated${pathHint}: ${truncatedBytes.toLocaleString()} of ${content.length.toLocaleString()} bytes omitted from injection; use the Read tool on this file if you need the full content] -->`
  );
}

/**
 * Resolve the per-doc byte cap from environment.
 *
 * Returns 0 (= no cap, preserve full content) by default. Operators opt in
 * by setting `SYSTEM_MESSAGE_DOC_MAX_BYTES` to a positive integer.
 */
export function resolveDocMaxBytes(envValue: string | undefined): number {
  if (!envValue) return 0;
  const n = Number.parseInt(envValue, 10);
  if (Number.isNaN(n) || n < 0) return 0;
  return n;
}
