import { describe, it, expect } from 'vitest';
import { decodedObservationTexts } from '../endTurnGates.js';
import { verifyCitationsGrounded } from '../citationVerification.js';

// A browser get_content result as the MCP client hands it back: content blocks, the text block carrying JSON.
const pageText = 'Used Honda and Nissan for sale\n14,291 matches';
const mcpResult = [
  { type: 'text', text: JSON.stringify({ url: 'https://www.carmax.com/cars/nissan/honda', text: pageText }) },
  { type: 'image', data: 'iVBORw0KGgo', mimeType: 'image/png' },
];

describe('EndTurn grounding over MCP results', () => {
  it('the stringified form alone cannot ground a multi-line page quote (the 11-03 defect)', () => {
    const v = verifyCitationsGrounded([{ reference: 'count', verbatim_source: pageText }], JSON.stringify(mcpResult), { linewise: false });
    expect(v.grounded).toBe(false);
  });
  it('decoded text grounds it', () => {
    const corpus = [JSON.stringify(mcpResult), ...decodedObservationTexts(mcpResult)].join('\n');
    const v = verifyCitationsGrounded([{ reference: 'count', verbatim_source: pageText }], corpus, { linewise: false });
    expect(v.grounded).toBe(true);
  });
  it('image blocks contribute nothing; plain strings pass through', () => {
    expect(decodedObservationTexts([{ type: 'image', data: 'x' }])).toEqual([]);
    expect(decodedObservationTexts('plain')).toEqual(['plain']);
  });
});
