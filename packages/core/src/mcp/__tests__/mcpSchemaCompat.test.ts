import { describe, it, expect } from 'vitest';
import { normalizeMcpSchema } from '../mcpSchemaCompat.js';

describe('normalizeMcpSchema', () => {
  it('turns a homogeneous tuple into items + min/maxItems (nexus-browser computer_use coordinate)', () => {
    const s = { type: 'object', properties: { coordinate: { type: 'array', items: [{ type: 'number' }, { type: 'number' }] } } };
    expect((normalizeMcpSchema(s) as any).properties.coordinate).toEqual({ type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 });
  });
  it('a mixed tuple becomes unconstrained items with the length kept', () => {
    expect(normalizeMcpSchema({ type: 'array', items: [{ type: 'string' }, { type: 'number' }] })).toEqual({ type: 'array', items: {}, minItems: 2, maxItems: 2 });
  });
  it('nested tuples are normalized; ordinary schemas pass through unchanged', () => {
    const plain = { type: 'object', properties: { url: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['url'] };
    expect(normalizeMcpSchema(plain)).toEqual(plain);
    const nested = { type: 'object', properties: { r: { type: 'array', items: { type: 'array', items: [{ type: 'number' }, { type: 'number' }] } } } };
    expect((normalizeMcpSchema(nested) as any).properties.r.items).toEqual({ type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 });
  });
});
