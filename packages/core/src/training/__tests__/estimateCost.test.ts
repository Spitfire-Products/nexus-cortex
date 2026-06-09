import { describe, it, expect } from 'vitest';
import { estimateModelCost as estimateCost } from '../../index.js';

describe('estimateCost — non-string modelId guard (regression: live experiment crash)', () => {
  it('handles a normal string modelId', () => {
    expect(estimateCost('deepseek-v4-flash', 1_000_000, 0)).toBeGreaterThan(0);
  });

  it('does NOT throw on a non-string modelId (e.g. a model object leaking through)', () => {
    // The server returns model as {id, provider}; a recorder that forwards it
    // verbatim once crashed estimateCost with "modelId.startsWith is not a function".
    const obj = { id: 'deepseek-v4-flash', provider: 'deepseek' } as unknown as string;
    expect(() => estimateCost(obj, 1000, 500)).not.toThrow();
    expect(estimateCost(obj, 1000, 500)).toBeGreaterThanOrEqual(0);
    expect(() => estimateCost(undefined as unknown as string, 1000, 500)).not.toThrow();
  });
});
