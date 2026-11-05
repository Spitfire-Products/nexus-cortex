import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { normalizeEndTurnInput } from '../endTurnGates.js';
import { verifyIntegrity } from '../integrityVerification.js';

describe('EndTurn input normalization (2026-11-02)', () => {
  it('parses stringified array fields; leaves the rest', () => {
    const n = normalizeEndTurnInput({ sources: '[{"accessed":"https://x","purpose":"p","used_for":"u"}]', verification: '[]', summary: 'not json [', open_items: 'x' });
    expect(Array.isArray(n.sources)).toBe(true);
    expect(n.verification).toEqual([]);
    expect(n.summary).toBe('not json [');
    expect(n.open_items).toBe('x');
  });
  it('a stringified but valid sources attestation passes the integrity check once normalized', () => {
    const raw = { sources: JSON.stringify([{ accessed: 'https://app.example.com (via Browse)', purpose: 'the user asked to open it', used_for: 'the reported messages' }]) };
    const before = verifyIntegrity({ webQueries: ['open app.example.com and read the chat'], webContent: ['page'], writeInputs: [], userTaskText: 't', sourcesAttestation: (raw as any).sources });
    const after = verifyIntegrity({ webQueries: ['open app.example.com and read the chat'], webContent: ['page'], writeInputs: [], userTaskText: 't', sourcesAttestation: normalizeEndTurnInput(raw).sources as any });
    expect(before.ok).toBe(false);
    expect(after.ok).toBe(true);
  });
  it('the EndTurn schema declares sources as an array', async () => {
    const src = fs.readFileSync(new URL('../../tools/registries/BaseToolRegistry.ts', import.meta.url), 'utf8');
    const et = src.slice(src.indexOf("name: 'EndTurn',"), src.indexOf("name: 'EndTurn',") + 9000);
    expect(et).toMatch(/\n\s+sources: \{\n\s+type: 'array'/);
  });
});
