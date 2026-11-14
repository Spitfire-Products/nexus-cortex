import { describe, it, expect } from 'vitest';
import { isModelFacingTool, modelFacingToolLine } from './toolDisplay.js';

describe('toolDisplay — model-facing tools are not printed in full (operator 2026-11-14)', () => {
  it('EndTurn in every naming form a provider naming handler produces', () => {
    for (const n of ['EndTurn', 'end_turn', 'end-turn', 'endTurn', 'ENDTURN', 'cortex__end_turn']) expect(isModelFacingTool(n), n).toBe(true);
  });
  it('ordinary tools and empty names are printed normally', () => {
    for (const n of ['Bash', 'bash', 'Read', 'nexus-browser__browse', 'end_turn_report', 'turn', '', undefined, null]) expect(isModelFacingTool(n as any), String(n)).toBe(false);
    expect(modelFacingToolLine('Bash')).toBeUndefined();
  });
  it('one short line instead of the attestation', () => {
    expect(modelFacingToolLine('end_turn')).toBe('answer checked');
    expect(modelFacingToolLine('EndTurn', true)).toBe('answer check returned an error');
  });
});
