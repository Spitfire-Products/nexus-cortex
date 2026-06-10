/**
 * EndTurn — generative end-of-turn attestation. The params force
 * RECONSTRUCTION (re-derive each reference's verbatim source, paste real
 * command output, write a skeptical self-review) rather than rubber-stampable
 * multiple-choice. Producing the evidence is the verification (Edit
 * old_string effect applied cognitively). Stage 1: no server-side check —
 * the executor echoes the model's own self_review back so it acts on it
 * before finalizing.
 *
 * Validation is intentionally NON-BLOCKING at the executor level: absent
 * arrays normalize to [] ("empty = none"), malformed items are dropped, and
 * the only hard reject is a non-object payload. The meaningful rejection (a
 * verbatim_source not grounded in this turn's tool output) lives in the
 * orchestrator's Stage-2 grounding check when CORTEX_ENDTURN_GATE is on —
 * see citationVerification.ts. A blunt validate-and-reject here only produced
 * retry loops that ended with the model giving up and emitting NO attestation.
 */
import { describe, it, expect } from 'vitest';
import { EndTurnToolExecutor } from '../EndTurnTool.js';

const sig = new AbortController().signal;

describe('EndTurnToolExecutor', () => {
  const tool = new EndTurnToolExecutor();

  it('is named EndTurn; only the two generative fields are required', () => {
    expect(tool.name).toBe('EndTurn');
    const req = (tool.parameterSchema as any).required as string[];
    // Evidence arrays are legitimately empty on many turns, so they are NOT
    // required — only the always-producible summary + self_review are.
    expect(new Set(req)).toEqual(new Set(['summary', 'self_review']));
    // citations must be an array of {reference, verbatim_source}, not an enum
    const cit = (tool.parameterSchema as any).properties.citations;
    expect(cit.type).toBe('array');
    expect(cit.items.properties.verbatim_source).toBeDefined();
    // verification must be an array of {command, observed_result}
    const ver = (tool.parameterSchema as any).properties.verification;
    expect(ver.type).toBe('array');
    expect(ver.items.properties.observed_result).toBeDefined();
  });

  it('only hard-rejects a non-object payload', () => {
    expect(tool.validateToolParams(null as any)).toMatch(/object/);
    expect(tool.validateToolParams('nope' as any)).toMatch(/object/);
    expect(tool.validateToolParams({ summary: 's', self_review: 'r' } as any)).toBeNull();
  });

  it('accepts an attestation with OMITTED arrays (the loop-bug regression)', async () => {
    // A PR reviewer cites code but runs no commands; it naturally omits the
    // empty verification/open_items. This must NOT reject.
    const params = {
      citations: [
        { reference: 'calc.js line 4', verbatim_source: 'for (let i = 0; i <= b; i++)' },
      ],
      summary: 'Found an off-by-one in multiply().',
      self_review: 'Assumed the diff was complete; did not execute the code.',
    } as any;
    expect(tool.validateToolParams(params)).toBeNull();
    const r = await tool.execute(params, sig);
    expect(r.success).toBe(true);
    const text = typeof r.llmContent === 'string' ? r.llmContent : JSON.stringify(r.llmContent);
    expect(text).toMatch(/off-by-one/);
    expect(text).toMatch(/calc\.js line 4/);
  });

  it('normalizes non-array citations to empty rather than rejecting', async () => {
    const r = await tool.execute(
      { citations: 'all_good' as any, summary: 'x', self_review: 'nothing missed' } as any,
      sig,
    );
    expect(r.success).toBe(true);
    const text = typeof r.llmContent === 'string' ? r.llmContent : JSON.stringify(r.llmContent);
    expect(text).toMatch(/none cited/);
  });

  it('drops a malformed citation (missing verbatim_source) instead of looping', async () => {
    const r = await tool.execute(
      {
        citations: [
          { reference: 'the ENOENT guard' } as any, // no verbatim_source → dropped
          { reference: 'real one', verbatim_source: "if (err?.code === 'ENOENT')" },
        ],
        summary: 'x',
        self_review: 'ok',
      } as any,
      sig,
    );
    expect(r.success).toBe(true);
    expect(r.returnDisplay).toMatch(/1 cited/); // only the grounded one survives
  });

  it('accepts a well-formed generative attestation and echoes self_review back', async () => {
    const params = {
      citations: [
        { reference: 'ENOENT guard', verbatim_source: "if (err?.code === 'ENOENT') {" },
      ],
      verification: [{ command: 'npm run build', observed_result: 'BUILD COMPLETE' }],
      summary: 'Explained the mkdir memo.',
      open_items: [],
      self_review: 'I did not check whether appendMessages shares the memo — verified it does.',
    };
    expect(tool.validateToolParams(params)).toBeNull();
    const r = await tool.execute(params, sig);
    expect(r.success).toBe(true);
    const text = typeof r.llmContent === 'string' ? r.llmContent : JSON.stringify(r.llmContent);
    // Echoes the model's OWN self_review + sources back so it must act on them.
    expect(text).toMatch(/did not check whether appendMessages/);
    expect(text).toMatch(/ENOENT guard/);
    expect(text.toLowerCase()).toMatch(/final answer|finaliz/);
  });

  it('empty citations + empty verification is valid (no-reference tool turn)', async () => {
    const r = await tool.execute(
      {
        citations: [],
        verification: [],
        summary: 'Summarized the module behavior; no specific coordinates cited.',
        open_items: ['did not run the build'],
        self_review: 'No line numbers asserted; behavior described from the read content.',
      },
      sig,
    );
    expect(r.success).toBe(true);
    const text = typeof r.llmContent === 'string' ? r.llmContent : JSON.stringify(r.llmContent);
    expect(text).toMatch(/did not run the build/);
  });
});
