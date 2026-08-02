/**
 * Served-model drift detector (grok-build dialect-archaeology follow-up,
 * 2026-08-01). Pins: real-drift detection, exact-match no-op, dated-snapshot
 * tolerance, empty-input safety, and warn-once bookkeeping.
 *
 * The live cases this guards (xAI backend aliasing): grok-4-1-fast-* served by
 * grok-4.3; grok-code-fast-1 served by grok-build-0.1.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  detectServedModelDrift,
  noteServedModel,
  formatDriftWarning,
  resetServedModelDriftRegistry,
} from '../servedModelDrift.js';

describe('detectServedModelDrift', () => {
  it('flags real backend aliasing as drift', () => {
    expect(detectServedModelDrift('grok-4-1-fast-non-reasoning', 'grok-4.3'))
      .toEqual({ drift: true, snapshotVariant: false });
    expect(detectServedModelDrift('grok-code-fast-1', 'grok-build-0.1'))
      .toEqual({ drift: true, snapshotVariant: false });
  });

  it('is a no-op when requested equals served', () => {
    expect(detectServedModelDrift('claude-haiku-4-5', 'claude-haiku-4-5'))
      .toEqual({ drift: false, snapshotVariant: false });
  });

  it('treats a dated snapshot suffix as the same model, not drift', () => {
    expect(detectServedModelDrift('gpt-5-nano', 'gpt-5-nano-2025-08-07'))
      .toEqual({ drift: false, snapshotVariant: true });
    // compact YYYYMMDD form
    expect(detectServedModelDrift('claude-haiku-4-5', 'claude-haiku-4-5-20251001'))
      .toEqual({ drift: false, snapshotVariant: true });
  });

  it('does NOT treat an arbitrary longer id sharing a prefix as a snapshot', () => {
    // shares the "grok-4" prefix but the remainder is not a -date suffix
    expect(detectServedModelDrift('grok-4', 'grok-4-1-fast'))
      .toEqual({ drift: true, snapshotVariant: false });
    // a suffix that is not a date
    expect(detectServedModelDrift('gpt-5-nano', 'gpt-5-nano-preview'))
      .toEqual({ drift: true, snapshotVariant: false });
  });

  it('is safe on empty / missing inputs', () => {
    expect(detectServedModelDrift('', 'grok-4.3')).toEqual({ drift: false, snapshotVariant: false });
    expect(detectServedModelDrift('grok-4.3', '')).toEqual({ drift: false, snapshotVariant: false });
    expect(detectServedModelDrift('', '')).toEqual({ drift: false, snapshotVariant: false });
  });

  it('trims whitespace before comparing', () => {
    expect(detectServedModelDrift(' grok-4.3 ', 'grok-4.3'))
      .toEqual({ drift: false, snapshotVariant: false });
  });
});

describe('noteServedModel — warn-once bookkeeping', () => {
  beforeEach(() => resetServedModelDriftRegistry());

  it('reports firstSighting only on the first drift for a pair', () => {
    const a = noteServedModel('grok-code-fast-1', 'grok-build-0.1');
    expect(a).toEqual({ drift: true, snapshotVariant: false, firstSighting: true });
    const b = noteServedModel('grok-code-fast-1', 'grok-build-0.1');
    expect(b).toEqual({ drift: true, snapshotVariant: false, firstSighting: false });
  });

  it('tracks distinct pairs independently', () => {
    expect(noteServedModel('grok-code-fast-1', 'grok-build-0.1').firstSighting).toBe(true);
    expect(noteServedModel('grok-4-1-fast-non-reasoning', 'grok-4.3').firstSighting).toBe(true);
    expect(noteServedModel('grok-code-fast-1', 'grok-build-0.1').firstSighting).toBe(false);
  });

  it('never reports firstSighting for a non-drift pair', () => {
    expect(noteServedModel('gpt-5-nano', 'gpt-5-nano-2025-08-07'))
      .toEqual({ drift: false, snapshotVariant: true, firstSighting: false });
    expect(noteServedModel('claude-haiku-4-5', 'claude-haiku-4-5').firstSighting).toBe(false);
  });
});

describe('formatDriftWarning', () => {
  it('names both models and states budgets are not auto-adjusted', () => {
    const w = formatDriftWarning('grok-4-1-fast-non-reasoning', 'grok-4.3');
    expect(w).toContain('grok-4-1-fast-non-reasoning');
    expect(w).toContain('grok-4.3');
    expect(w.toLowerCase()).toContain('not auto-adjusted');
  });
});
