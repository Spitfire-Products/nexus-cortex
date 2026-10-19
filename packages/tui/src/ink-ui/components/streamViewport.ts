/**
 * streamViewport — keep the live streaming turn inside the terminal (R265, 2026-10-19).
 *
 * Ink can only erase/reposition lines that are still on screen; once the dynamic region
 * grows past the terminal height every frame scrolls and the view "jumps". While a turn
 * streams we therefore show only the TAIL of its text that fits the budget; the full turn
 * is rendered into the Static history when it completes (unchanged behaviour).
 */
export interface ViewportItem {
  type: 'user' | 'text' | 'thinking' | 'tool';
  content?: string;
  id: string;
  [k: string]: unknown;
}

export interface ViewportResult<T extends ViewportItem> {
  items: T[];
  /** Wrapped lines hidden above the window (0 = nothing trimmed). */
  hiddenLines: number;
}

/** Greedy word wrap that also hard-breaks words longer than `width`. */
export function wrapLines(text: string, width: number): string[] {
  const w = Math.max(1, Math.floor(width));
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    if (raw.length <= w) { out.push(raw); continue; }
    let line = '';
    for (const word of raw.split(' ')) {
      let piece = word;
      while (piece.length > w) {
        if (line) { out.push(line); line = ''; }
        out.push(piece.slice(0, w)); piece = piece.slice(w);
      }
      if (!line) line = piece;
      else if (line.length + 1 + piece.length <= w) line += ' ' + piece;
      else { out.push(line); line = piece; }
    }
    out.push(line);
  }
  return out;
}

/** Keep the last `keep` lines of `text`; reopen a code fence the cut left dangling. */
export function tailText(text: string, keep: number, width: number): { text: string; hidden: number } {
  const lines = text.split('\n');
  // Count wrapped rows from the end until the budget is spent.
  let rows = 0; let i = lines.length;
  while (i > 0 && rows < keep) { rows += wrapLines(lines[i - 1]!, width).length; i--; }
  if (i === 0) return { text, hidden: 0 };
  const dropped = lines.slice(0, i); const kept = lines.slice(i);
  const openFence = dropped.filter((l) => /^\s*```/.test(l)).length % 2 === 1;
  const hidden = dropped.reduce((n, l) => n + wrapLines(l, width).length, 0);
  return { text: (openFence ? '```\n' : '') + kept.join('\n'), hidden };
}

/** Approximate rows an item occupies (tool rows are small and fixed). */
function itemRows(item: ViewportItem, width: number): number {
  if (item.type === 'tool') return 3;
  if (item.type === 'user') return wrapLines(item.content ?? '', width).length + 2;
  return wrapLines(item.content ?? '', width).length;
}

/**
 * Trim consolidated stream items to the tail that fits `budget` rows. Items are dropped
 * from the front; the first kept text/thinking item is cut to its tail. Infinity = no-op.
 */
export function windowForViewport<T extends ViewportItem>(items: T[], budget: number, width: number): ViewportResult<T> {
  if (!Number.isFinite(budget) || items.length === 0) return { items, hiddenLines: 0 };
  const total = items.reduce((n, it) => n + itemRows(it, width), 0);
  if (total <= budget) return { items, hiddenLines: 0 };
  let rows = 0; let i = items.length; let hidden = 0;
  const kept: T[] = [];
  while (i > 0) {
    const it = items[i - 1]!; const r = itemRows(it, width);
    if (rows + r <= budget) { kept.unshift(it); rows += r; i--; continue; }
    const room = budget - rows;
    if ((it.type === 'text' || it.type === 'thinking') && room >= 2) {
      const t = tailText(it.content ?? '', room, width);
      kept.unshift({ ...it, content: t.text }); hidden += t.hidden;
    } else hidden += r;
    i--;
    break;
  }
  for (let k = 0; k < i; k++) hidden += itemRows(items[k]!, width);
  return { items: kept, hiddenLines: hidden };
}
