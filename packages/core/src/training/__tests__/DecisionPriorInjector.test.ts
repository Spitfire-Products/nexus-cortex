/**
 * Tests for formatPriorReminder — builds the <system-reminder> block that
 * surfaces past decisions to the model before its next tool call.
 *
 * Design rules:
 *   • Empty stats → null (no noise when there are no priors).
 *   • Only successes → null (no value warning about a known-good pattern).
 *   • Any failure → emit a reminder that names the tool, summarises the
 *     hit count, surfaces the most recent error, and includes up to 3
 *     specific recent outcomes when supplied (matches the recent-outcomes
 *     `witty-tracing-narwhal` pattern).
 *   • Output is wrapped in <system-reminder>...</system-reminder> so the
 *     model's verbatim-quote heuristics filter it out of any subsequent
 *     Write/Edit content.
 */

import { describe, it, expect } from 'vitest';
import { formatPriorReminder } from '../DecisionPriorInjector.js';
import type { Decision } from '../DecisionStore.js';

describe('formatPriorReminder', () => {
  it('returns null when stats are empty', () => {
    expect(
      formatPriorReminder('Read', { total: 0, successes: 0, failures: 0 }),
    ).toBeNull();
  });

  it('returns null when all priors are successes (no warning needed)', () => {
    expect(
      formatPriorReminder('Read', { total: 3, successes: 3, failures: 0 }),
    ).toBeNull();
  });

  it('emits a <system-reminder> block with tool name and counts when failures exist', () => {
    const out = formatPriorReminder('WebFetch', {
      total: 3,
      successes: 1,
      failures: 2,
      lastError: 'timeout after 10s',
    });
    expect(out).not.toBeNull();
    expect(out!).toContain('<system-reminder>');
    expect(out!).toContain('</system-reminder>');
    expect(out!).toContain('WebFetch');
    expect(out!).toMatch(/2\s*(?:failures?|failed)/i);
    expect(out!).toContain('timeout after 10s');
  });

  it('surfaces the failure ratio even without an error snippet', () => {
    const out = formatPriorReminder('Bash', {
      total: 2,
      successes: 0,
      failures: 2,
    });
    expect(out).not.toBeNull();
    expect(out!).toMatch(/2\s*(?:failures?|failed)/i);
  });

  it('ends in a newline so the actual tool result follows cleanly', () => {
    const out = formatPriorReminder('Bash', {
      total: 1,
      successes: 0,
      failures: 1,
      lastError: 'permission denied',
    });
    expect(out!.endsWith('\n')).toBe(true);
  });

  // ── Recent decisions enhancement ─────────────────────────────────────
  it('includes up to 3 recent outcomes when supplied', () => {
    const recent: Decision[] = [
      { ts: 3, sessionId: 's3', toolName: 'WebFetch', inputHash: 'h', inputSummary: '{"u":"x"}', success: false, errorSnippet: 'timeout' },
      { ts: 2, sessionId: 's2', toolName: 'WebFetch', inputHash: 'h', inputSummary: '{"u":"x"}', success: false, errorSnippet: 'dns' },
      { ts: 1, sessionId: 's1', toolName: 'WebFetch', inputHash: 'h', inputSummary: '{"u":"x"}', success: true },
    ];
    const out = formatPriorReminder(
      'WebFetch',
      { total: 3, successes: 1, failures: 2, lastError: 'timeout' },
      recent,
    );
    expect(out).not.toBeNull();
    // Recent outcomes appear in the reminder body
    expect(out!.toLowerCase()).toContain('recent');
    expect(out!).toContain('timeout');
    expect(out!).toContain('dns');
    // Most recent is listed first
    const timeoutIdx = out!.indexOf('timeout');
    const dnsIdx = out!.indexOf('dns');
    expect(timeoutIdx).toBeGreaterThan(0);
    expect(dnsIdx).toBeGreaterThan(timeoutIdx);
  });

  it('still works without recent decisions (back-compat)', () => {
    const out = formatPriorReminder('X', { total: 1, successes: 0, failures: 1, lastError: 'oops' });
    expect(out).not.toBeNull();
    expect(out!).toContain('oops');
  });

  it('truncates recent list at 3 even if more provided', () => {
    const mk = (i: number): Decision => ({
      ts: i,
      sessionId: `s${i}`,
      toolName: 'X',
      inputHash: 'h',
      inputSummary: '{}',
      success: false,
      errorSnippet: `err${i}`,
    });
    const recent = [mk(5), mk(4), mk(3), mk(2), mk(1)];
    const out = formatPriorReminder(
      'X',
      { total: 5, successes: 0, failures: 5, lastError: 'err5' },
      recent,
    );
    expect(out).not.toBeNull();
    // Should only include err5, err4, err3 — not err2 or err1
    expect(out!).toContain('err5');
    expect(out!).toContain('err4');
    expect(out!).toContain('err3');
    expect(out!).not.toContain('err2');
    expect(out!).not.toContain('err1');
  });
});
