/**
 * EndTurn — generative end-of-turn attestation. The params force
 * RECONSTRUCTION (re-derive each reference's verbatim source, paste real
 * command output, write a skeptical self-review) rather than rubber-stampable
 * multiple-choice. Producing the evidence is the verification (Edit
 * old_string effect applied cognitively). Stage 1: no server-side check —
 * the executor echoes the model's own self_review back so it acts on it
 * before finalizing.
 */
import { describe, it, expect } from 'vitest';
import { EndTurnToolExecutor } from '../EndTurnTool.js';

const sig = new AbortController().signal;

describe('EndTurnToolExecutor', () => {
  const tool = new EndTurnToolExecutor();

  it('is named EndTurn with the 5 required generative params', () => {
    expect(tool.name).toBe('EndTurn');
    const req = (tool.parameterSchema as any).required as string[];
    expect(new Set(req)).toEqual(
      new Set(['citations', 'verification', 'summary', 'open_items', 'self_review']),
    );
    // citations must be an array of {reference, verbatim_source}, not an enum
    const cit = (tool.parameterSchema as any).properties.citations;
    expect(cit.type).toBe('array');
    expect(cit.items.properties.verbatim_source).toBeDefined();
    // verification must be an array of {command, observed_result}
    const ver = (tool.parameterSchema as any).properties.verification;
    expect(ver.type).toBe('array');
    expect(ver.items.properties.observed_result).toBeDefined();
  });

  it('rejects non-array citations', () => {
    expect(
      tool.validateToolParams({
        citations: 'all_good' as any,
        verification: [],
        summary: 'x',
        open_items: [],
        self_review: 'nothing missed',
      }),
    ).toMatch(/citations/);
  });

  it('rejects a citation missing verbatim_source', () => {
    expect(
      tool.validateToolParams({
        citations: [{ reference: 'the ENOENT guard' } as any],
        verification: [],
        summary: 'x',
        open_items: [],
        self_review: 'ok',
      }),
    ).toMatch(/verbatim_source/);
  });

  it('rejects empty self_review (the reflection pass is mandatory)', () => {
    expect(
      tool.validateToolParams({
        citations: [],
        verification: [],
        summary: 'x',
        open_items: [],
        self_review: '   ',
      }),
    ).toMatch(/self_review/);
  });

  it('rejects missing summary', () => {
    expect(
      tool.validateToolParams({
        citations: [],
        verification: [],
        summary: '',
        open_items: [],
        self_review: 'ok',
      }),
    ).toMatch(/summary/);
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
