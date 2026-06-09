/**
 * Emits review-records schema-compatible with an external training-corpus ingester
 * (verified at the leaf: tables/training_streams.rs RouterTrainingSample /
 * ReasonerTrainingSample, training_fanout.rs sample_id/channel rules).
 *
 * These are local JSONL rows shaped for
 * later ingestion by the nexus pipeline. They fill the slot the schema
 * explicitly reserves but nexus leaves empty: outcome_score "from the
 * alignment scorer or CHALLENGE-graded review" (training_streams.rs:71-72).
 * Pure builders → unit-tested.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, statSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildRouterSample, buildReasonerSample, appendJsonlRotating } from '../cortexTrainingRecord.js';

describe('appendJsonlRotating (cortex-samples.jsonl bound)', () => {
  let dir: string;
  let fp: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ctr-rot-')); fp = join(dir, 'sub', 'cortex-samples.jsonl'); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

  it('creates parent dirs and appends a line', () => {
    appendJsonlRotating(fp, '{"a":1}', 100_000);
    expect(existsSync(fp)).toBe(true);
    expect(readFileSync(fp, 'utf-8')).toBe('{"a":1}\n');
  });

  it('no .1 below the cap', () => {
    appendJsonlRotating(fp, '{"a":1}', 100_000);
    appendJsonlRotating(fp, '{"a":2}', 100_000);
    expect(existsSync(fp + '.1')).toBe(false);
  });

  it('rotates to a single .1 when over cap; newest line always retained; no .2', () => {
    for (let i = 0; i < 50; i++) appendJsonlRotating(fp, JSON.stringify({ i, pad: 'z'.repeat(40) }), 300);
    expect(existsSync(fp + '.1')).toBe(true);
    expect(existsSync(fp + '.2')).toBe(false);
    expect(statSync(fp).size).toBeLessThanOrEqual(300 * 2);
    // the last write is in main (written after the rotate check)
    expect(readFileSync(fp, 'utf-8').trim().split('\n').pop()).toContain('"i":49');
  });
});

describe('cortexTrainingRecord builders', () => {
  it('Router sample mirrors the Rust schema field names + cortex channel', () => {
    const r = buildRouterSample({
      decisionId: 'cortex-sess1-3-ab12cd34',
      sessionId: 'sess1',
      inputContext: 'Explain the mkdir memo',
      selectedTool: 'Read',
      selectedArgsJson: '{"file_path":"x.ts"}',
      outcomeScore: 0.8,
      trainingWeight: 1.0,
      timestampMs: 1700000000000,
    });
    expect(r.sample_id).toMatch(/^router-cortex-sess1-3-ab12cd34-[0-9a-f]{16}$/);
    expect(r.decision_id).toBe('cortex-sess1-3-ab12cd34');
    expect(r.agent_id).toBe('cortex-sess1');
    expect(r.channel_source).toBe('cortex'); // exact lowercase — corpus-cap gotcha
    expect(r.agent_kind).toBeNull(); // unsupported new values clamp downstream → leave None
    expect(r.input_context).toBe('Explain the mkdir memo');
    expect(r.selected_tool).toBe('Read');
    expect(r.selected_args_json).toBe('{"file_path":"x.ts"}');
    expect(r.outcome_score).toBe(0.8);
    expect(r.training_weight).toBe(1.0);
    expect(r.timestamp_ms).toBe(1700000000000);
    expect(r.exported).toBe(false);
  });

  it('outcome_score is clamped to [0,1]', () => {
    expect(buildRouterSample({ decisionId: 'd', sessionId: 's', inputContext: '', outcomeScore: 1.7, timestampMs: 1 }).outcome_score).toBe(1);
    expect(buildRouterSample({ decisionId: 'd', sessionId: 's', inputContext: '', outcomeScore: -0.4, timestampMs: 1 }).outcome_score).toBe(0);
  });

  it('sample_id is deterministic for the same (kind, decisionId, agentId)', () => {
    const a = buildRouterSample({ decisionId: 'd1', sessionId: 's', inputContext: '', outcomeScore: 1, timestampMs: 1 });
    const b = buildRouterSample({ decisionId: 'd1', sessionId: 's', inputContext: '', outcomeScore: 1, timestampMs: 999 });
    expect(a.sample_id).toBe(b.sample_id); // timestamp irrelevant to id (idempotent re-score)
  });

  it('Reasoner sample carries a valid turn_sequence_json array', () => {
    const r = buildReasonerSample({
      decisionId: 'cortex-sess9-1-ff00',
      sessionId: 'sess9',
      turns: [
        { role: 'user', content: 'do X' },
        { role: 'assistant', content: 'done', thinking: 'reasoned', tool_calls: [], tool_results: [] },
      ],
      finalOutcomeScore: 0.9,
      timestampMs: 42,
    });
    expect(r.sample_id).toMatch(/^reasoner-cortex-sess9-1-ff00-[0-9a-f]{16}$/);
    expect(r.conversation_id).toBe('sess9');
    expect(r.channel_source).toBe('cortex');
    expect(r.final_outcome_score).toBe(0.9);
    const parsed = JSON.parse(r.turn_sequence_json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toEqual({ role: 'user', content: 'do X' });
    expect(parsed[1].role).toBe('assistant');
  });

  it('router vs reasoner sample_id prefixes differ for same decision', () => {
    const rt = buildRouterSample({ decisionId: 'd', sessionId: 's', inputContext: '', outcomeScore: 1, timestampMs: 1 });
    const rs = buildReasonerSample({ decisionId: 'd', sessionId: 's', turns: [], finalOutcomeScore: 1, timestampMs: 1 });
    expect(rt.sample_id.startsWith('router-')).toBe(true);
    expect(rs.sample_id.startsWith('reasoner-')).toBe(true);
    expect(rt.sample_id).not.toBe(rs.sample_id);
  });
});
