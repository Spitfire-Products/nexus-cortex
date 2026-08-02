/**
 * StructuredOutput pure-module tests (grok-build port).
 *
 * Covers ONLY the pure module (no orchestrator instantiation):
 *   - tool build shape (canonical name, steering description, schema, tier)
 *   - Ajv validation success / failure / error rendering
 *   - corrective text
 *   - co-emission handling
 *   - retry-cap semantics via evaluateStructuredOutputCall
 *   - clone-on-write tool injection
 *   - finalization surface
 */

import { describe, it, expect } from 'vitest';
import {
  STRUCTURED_OUTPUT_TOOL_NAME,
  MAX_STRUCTURED_OUTPUT_RETRIES,
  COEMISSION_CORRECTIVE,
  ACCEPTED_RESULT_TEXT,
  ACCEPTED_WITH_ERRORS_RESULT_TEXT,
  buildStructuredOutputTool,
  createStructuredOutputTurnState,
  isStructuredOutputToolName,
  ensureStructuredOutputTool,
  validateStructuredOutput,
  buildCorrectiveResult,
  evaluateStructuredOutputCall,
  finalizeStructuredOutput,
} from '../structuredOutput.js';

const SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    confidence: { type: 'number' },
  },
  required: ['answer', 'confidence'],
  additionalProperties: false,
} as object;

describe('structuredOutput pure module', () => {
  describe('buildStructuredOutputTool', () => {
    it('builds a canonical tool with the PascalCase name', () => {
      const tool = buildStructuredOutputTool(SCHEMA);
      expect(tool.name).toBe('StructuredOutput');
      expect(tool.name).toBe(STRUCTURED_OUTPUT_TOOL_NAME);
    });

    it('carries the caller schema verbatim as the tool schema', () => {
      const tool = buildStructuredOutputTool(SCHEMA);
      expect(tool.schema).toBe(SCHEMA);
    });

    it('is essential-tier so it survives the deferred-loading filter', () => {
      const tool = buildStructuredOutputTool(SCHEMA);
      expect(tool.discoveryTier).toBe('essential');
    });

    it('description carries the steering: final action, exactly once, alone, schema-exact', () => {
      const desc = buildStructuredOutputTool(SCHEMA).description;
      expect(desc).toContain('FINAL');
      expect(desc).toContain('exactly once');
      expect(desc).toContain('Do not call it together with other tools');
      expect(desc).toContain('satisfy the provided JSON schema exactly');
    });
  });

  describe('isStructuredOutputToolName', () => {
    it('matches the canonical PascalCase name', () => {
      expect(isStructuredOutputToolName('StructuredOutput')).toBe(true);
    });

    it('matches the snake_case wire form defensively', () => {
      expect(isStructuredOutputToolName('structured_output')).toBe(true);
    });

    it('does not match other tools', () => {
      expect(isStructuredOutputToolName('Read')).toBe(false);
      expect(isStructuredOutputToolName('EndTurn')).toBe(false);
      expect(isStructuredOutputToolName('structuredoutput')).toBe(false);
    });
  });

  describe('ensureStructuredOutputTool (clone-on-write)', () => {
    it('appends the tool without mutating the input array', () => {
      const state = createStructuredOutputTurnState(SCHEMA);
      const original = [{ name: 'Read', description: 'read', schema: { type: 'object' as const, properties: {} } }];
      const originalLength = original.length;
      const result = ensureStructuredOutputTool(original as any, state);
      expect(original.length).toBe(originalLength); // input untouched
      expect(result).not.toBe(original); // new array
      expect(result.map((t) => t.name)).toEqual(['Read', 'StructuredOutput']);
    });

    it('is idempotent — returns the same array when the tool is already present', () => {
      const state = createStructuredOutputTurnState(SCHEMA);
      const once = ensureStructuredOutputTool([], state);
      const twice = ensureStructuredOutputTool(once, state);
      expect(twice).toBe(once);
      expect(twice.filter((t) => t.name === STRUCTURED_OUTPUT_TOOL_NAME).length).toBe(1);
    });

    it('handles undefined input', () => {
      const state = createStructuredOutputTurnState(SCHEMA);
      const result = ensureStructuredOutputTool(undefined, state);
      expect(result.map((t) => t.name)).toEqual(['StructuredOutput']);
    });
  });

  describe('validateStructuredOutput (Ajv)', () => {
    it('accepts args satisfying the schema', () => {
      const { valid, errors } = validateStructuredOutput(SCHEMA, { answer: 'yes', confidence: 0.9 });
      expect(valid).toBe(true);
      expect(errors).toEqual([]);
    });

    it('rejects missing required fields with rendered errors', () => {
      const { valid, errors } = validateStructuredOutput(SCHEMA, { answer: 'yes' });
      expect(valid).toBe(false);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.join('\n')).toContain('confidence');
    });

    it('rejects wrong types with instancePath in the rendered error', () => {
      const { valid, errors } = validateStructuredOutput(SCHEMA, { answer: 42, confidence: 'high' });
      expect(valid).toBe(false);
      expect(errors.join('\n')).toContain('/answer');
      expect(errors.join('\n')).toContain('/confidence');
    });

    it('rejects additional properties when the schema forbids them', () => {
      const { valid } = validateStructuredOutput(SCHEMA, { answer: 'a', confidence: 1, extra: true });
      expect(valid).toBe(false);
    });

    it('renders root-level failures as (root)', () => {
      const { valid, errors } = validateStructuredOutput(SCHEMA, 'not-an-object');
      expect(valid).toBe(false);
      expect(errors[0]).toContain('(root)');
    });

    it('collects ALL errors (allErrors: true)', () => {
      const { errors } = validateStructuredOutput(SCHEMA, { answer: 42, confidence: 'high' });
      expect(errors.length).toBeGreaterThanOrEqual(2);
    });

    it('fails open on an uncompilable schema instead of throwing', () => {
      const badSchema = { type: 'object', properties: { x: { type: 'not-a-type' } } } as object;
      const { valid, errors } = validateStructuredOutput(badSchema, { x: 1 });
      expect(valid).toBe(true);
      expect(errors.join('\n')).toContain('schema compilation failed');
    });
  });

  describe('buildCorrectiveResult', () => {
    it('lists every error and the attempt counter', () => {
      const text = buildCorrectiveResult(['/a: must be number', '(root): must have required property b'], 1, 3);
      expect(text).toContain('attempt 1/3');
      expect(text).toContain('/a: must be number');
      expect(text).toContain('(root): must have required property b');
    });

    it('instructs the model to call StructuredOutput again with corrected arguments', () => {
      const text = buildCorrectiveResult(['/x: must be string'], 2, 3);
      expect(text).toContain('Call StructuredOutput again');
      expect(text).toContain('corrected arguments');
    });
  });

  describe('evaluateStructuredOutputCall', () => {
    it('co-emission: corrective non-error result, attempt NOT counted, not accepted', () => {
      const d = evaluateStructuredOutputCall(SCHEMA, { answer: 'a', confidence: 1 }, 0, true);
      expect(d.toolResultText).toBe(COEMISSION_CORRECTIVE);
      expect(d.isError).toBe(false);
      expect(d.attemptsAfter).toBe(0);
      expect(d.accepted).toBe(false);
      expect(d.result).toBeUndefined();
    });

    it('valid args alone: accepted, attempt counted, result captured', () => {
      const args = { answer: 'a', confidence: 1 };
      const d = evaluateStructuredOutputCall(SCHEMA, args, 0, false);
      expect(d.accepted).toBe(true);
      expect(d.isError).toBe(false);
      expect(d.attemptsAfter).toBe(1);
      expect(d.toolResultText).toBe(ACCEPTED_RESULT_TEXT);
      expect(d.result).toEqual({ value: args, valid: true, attempts: 1 });
    });

    it('invalid args below the cap: corrective error, no result yet', () => {
      const d = evaluateStructuredOutputCall(SCHEMA, { answer: 'a' }, 0, false);
      expect(d.accepted).toBe(false);
      expect(d.isError).toBe(true);
      expect(d.attemptsAfter).toBe(1);
      expect(d.toolResultText).toContain('validation failed');
      expect(d.toolResultText).toContain(`attempt 1/${MAX_STRUCTURED_OUTPUT_RETRIES}`);
      expect(d.result).toBeUndefined();
    });

    it('invalid args at the cap: fail-open acceptance with errors (never wedge the loop)', () => {
      const args = { answer: 'a' }; // missing confidence
      const d = evaluateStructuredOutputCall(SCHEMA, args, MAX_STRUCTURED_OUTPUT_RETRIES - 1, false);
      expect(d.attemptsAfter).toBe(MAX_STRUCTURED_OUTPUT_RETRIES);
      expect(d.accepted).toBe(true);
      expect(d.isError).toBe(false);
      expect(d.toolResultText).toBe(ACCEPTED_WITH_ERRORS_RESULT_TEXT);
      expect(d.result?.valid).toBe(false);
      expect(d.result?.value).toBe(args);
      expect(d.result?.attempts).toBe(MAX_STRUCTURED_OUTPUT_RETRIES);
      expect(d.result?.errors?.length).toBeGreaterThan(0);
    });

    it('full retry-cap walk: fail, fail, fail-open at 3', () => {
      let attempts = 0;
      const bad = { answer: 42 };

      const d1 = evaluateStructuredOutputCall(SCHEMA, bad, attempts, false);
      attempts = d1.attemptsAfter;
      expect(d1.isError).toBe(true);
      expect(attempts).toBe(1);

      const d2 = evaluateStructuredOutputCall(SCHEMA, bad, attempts, false);
      attempts = d2.attemptsAfter;
      expect(d2.isError).toBe(true);
      expect(attempts).toBe(2);

      const d3 = evaluateStructuredOutputCall(SCHEMA, bad, attempts, false);
      attempts = d3.attemptsAfter;
      expect(d3.isError).toBe(false);
      expect(d3.accepted).toBe(true);
      expect(d3.result?.valid).toBe(false);
      expect(attempts).toBe(3);
    });

    it('co-emission rounds do not burn the retry budget', () => {
      // Two co-emission rounds, then three validation failures still allowed.
      let attempts = 0;
      for (let i = 0; i < 2; i++) {
        const d = evaluateStructuredOutputCall(SCHEMA, {}, attempts, true);
        attempts = d.attemptsAfter;
      }
      expect(attempts).toBe(0);
      const d = evaluateStructuredOutputCall(SCHEMA, {}, attempts, false);
      expect(d.attemptsAfter).toBe(1);
      expect(d.isError).toBe(true); // still a corrective, not fail-open
    });

    it('recovery after a failure: valid retry is accepted with attempts=2', () => {
      const d1 = evaluateStructuredOutputCall(SCHEMA, { answer: 'a' }, 0, false);
      expect(d1.isError).toBe(true);
      const d2 = evaluateStructuredOutputCall(SCHEMA, { answer: 'a', confidence: 0.5 }, d1.attemptsAfter, false);
      expect(d2.accepted).toBe(true);
      expect(d2.result).toEqual({ value: { answer: 'a', confidence: 0.5 }, valid: true, attempts: 2 });
    });
  });

  describe('finalizeStructuredOutput', () => {
    it('returns the captured result when one exists', () => {
      const state = createStructuredOutputTurnState(SCHEMA);
      const d = evaluateStructuredOutputCall(SCHEMA, { answer: 'a', confidence: 1 }, 0, false);
      state.attempts = d.attemptsAfter;
      state.result = d.result;
      expect(finalizeStructuredOutput(state)).toEqual({
        value: { answer: 'a', confidence: 1 },
        valid: true,
        attempts: 1,
      });
    });

    it('returns a deterministic invalid result when the tool was never called', () => {
      const state = createStructuredOutputTurnState(SCHEMA);
      const final = finalizeStructuredOutput(state);
      expect(final.valid).toBe(false);
      expect(final.value).toBeUndefined();
      expect(final.attempts).toBe(0);
      expect(final.errors?.[0]).toContain('was not called');
    });
  });

  describe('constants', () => {
    it('retry cap is 3', () => {
      expect(MAX_STRUCTURED_OUTPUT_RETRIES).toBe(3);
    });

    it('co-emission corrective steers to finish other work first, then call alone', () => {
      expect(COEMISSION_CORRECTIVE).toContain('Finish your other tool work first');
      expect(COEMISSION_CORRECTIVE).toContain('call StructuredOutput alone as your final action');
    });
  });
});
