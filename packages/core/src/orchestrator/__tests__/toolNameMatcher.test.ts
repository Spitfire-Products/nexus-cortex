/**
 * Tests for closestToolMatches — the suggestion helper used when the model
 * calls an unknown tool. Levenshtein-distance-ranked, case-insensitive,
 * cheap enough to run on every "Unknown tool" error.
 *
 * Motivation: round-10 benchmark caught cortex/gemini-2.5-pro hallucinating
 * `Gorp` (typo of `Grep`) and stalling for 2 iterations on the
 * "Unknown tool: Gorp" error. Suggestions inline in the error message let
 * the model self-correct.
 */

import { describe, it, expect } from 'vitest';
import { closestToolMatches } from '../toolNameMatcher.js';

const TOOLS = [
  'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'BashOutput',
  'WebSearch', 'WebFetch', 'TodoCreate', 'TodoUpdate', 'TodoList',
];

describe('closestToolMatches', () => {
  it('returns the obvious typo correction first', () => {
    const matches = closestToolMatches('Gorp', TOOLS, 3);
    expect(matches[0]).toBe('Grep');
  });

  it('returns up to N suggestions ranked by distance', () => {
    const matches = closestToolMatches('Glo', TOOLS, 3);
    expect(matches.length).toBeLessThanOrEqual(3);
    // `Glob` is distance 1 (one insertion) — should be first.
    expect(matches[0]).toBe('Glob');
  });

  it('is case-insensitive (model may PascalCase a snake_case name)', () => {
    const matches = closestToolMatches('grep', TOOLS, 3);
    expect(matches[0]).toBe('Grep');
  });

  it('returns [] when no candidate is within reasonable distance', () => {
    // 12 chars different from every tool — no useful suggestion.
    const matches = closestToolMatches('xxxxxxxxxxxxxxxxxxxx', TOOLS, 3);
    expect(matches).toEqual([]);
  });

  it('caps the suggestion count even with many close candidates', () => {
    // "Todo" is close to TodoCreate / TodoUpdate / TodoList. Limit=2 should
    // return exactly 2, not all three.
    const matches = closestToolMatches('Todo', TOOLS, 2);
    expect(matches.length).toBe(2);
  });

  it('handles empty inputs gracefully', () => {
    expect(closestToolMatches('', TOOLS, 3)).toEqual([]);
    expect(closestToolMatches('Grep', [], 3)).toEqual([]);
  });

  it('exact (case-mismatched) match still ranks first', () => {
    // 'BASH' should resolve to 'Bash' as the top suggestion.
    const matches = closestToolMatches('BASH', TOOLS, 3);
    expect(matches[0]).toBe('Bash');
  });

  it('does not suggest tools too dissimilar (distance > half of input length)', () => {
    // "WebSearch" → distance to "Bash" is 8, well over half of 9. Should
    // not be suggested as a fix for someone typing "Bash" badly.
    const matches = closestToolMatches('Bash', TOOLS, 3);
    expect(matches).not.toContain('WebSearch');
  });
});
