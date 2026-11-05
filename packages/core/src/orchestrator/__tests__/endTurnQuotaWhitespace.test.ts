import { describe, it, expect } from 'vitest';
import { TurnEvidence } from '../endTurnGates.js';
import { verifyCitationsGrounded } from '../citationVerification.js';

// Shapes from the 2026-11-03 DeepSeek CarMax run: browser MCP results are compact JSON with a trailing `_quota` meter.
const evalResult = JSON.stringify({ success: true, result: JSON.stringify({ url: 'https://www.carmax.com/cars/nissan/honda', distVal: '50', count: '20 matches', store: 'Your store for 49512 Grand Rapids (Kentwood)' }), _quota: { sessionSeconds: 125, dailyUsed: 229, dailyLimit: 1000, remaining: 771 } });
const clickResult = JSON.stringify({ success: true, element: { tagName: 'button', id: 'header-my-store-button', text: 'Your store for 49512' }, waitFor: { met: 'mutation', waitedMs: 1290 }, _quota: { sessionSeconds: 15, dailyUsed: 53, dailyLimit: 1000, remaining: 947 }, _changes: { events: [{ type: 'appeared', kind: 'modal' }] } });
const cardsText = 'View more Compare 2016 Honda HR-V LX · 74K mi Test drive today·Grand Rapids (Kentwood) Est. $307/mo · $17,998';

function corpusOf(...contents: string[]): string {
  const ev = new TurnEvidence();
  ev.noteToolResults(contents.map((content) => ({ tool_name: 'nexus-browser__evaluate', content, is_error: false })) as any);
  return ev.citationCorpus();
}

describe('EndTurn grounding — browser `_quota` meter and spacing', () => {
  it('a JSON result quoted without its _quota meter is grounded', () => {
    const { _quota, ...rest } = JSON.parse(evalResult);
    const v = verifyCitationsGrounded([{ reference: 'final state', verbatim_source: JSON.stringify(rest) }], corpusOf(evalResult), { linewise: true });
    expect(v.grounded).toBe(true);
  });
  it('fields spliced from different places are still rejected', () => {
    const spliced = '{"success":true,"element":{"tagName":"button","id":"header-my-store-button","text":"Your store for 49512"},"_changes":{"events":[]}}';
    expect(verifyCitationsGrounded([{ reference: 'store', verbatim_source: spliced }], corpusOf(clickResult), { linewise: true }).grounded).toBe(false);
  });
  it('a quote that differs only in spacing is grounded; changed words are not', () => {
    const corpus = corpusOf(cardsText);
    expect(verifyCitationsGrounded([{ reference: 'card', verbatim_source: 'Test drive today· Grand Rapids (Kentwood) Est. $307/mo' }], corpus, { linewise: true }).grounded).toBe(true);
    expect(verifyCitationsGrounded([{ reference: 'card', verbatim_source: 'Test drive today· Grand Rapids (Kentwood) Est. $297/mo' }], corpus, { linewise: true }).grounded).toBe(false);
  });
});

describe('EndTurn grounding — label: "value" wrappers', () => {
  const out = JSON.stringify({ success: true, result: { url: 'https://www.carmax.com/cars/honda/6041/nissan', h1: 'Used Honda and Nissan at CarMax Grand Rapids (Kentwood) for sale' } });
  it('a JSON field quoted as `key: "value"` is grounded', () => {
    expect(verifyCitationsGrounded([{ reference: 'h1', verbatim_source: 'h1: "Used Honda and Nissan at CarMax Grand Rapids (Kentwood) for sale"' }], out, { linewise: true }).grounded).toBe(true);
  });
  it('a label with a changed value still fails', () => {
    expect(verifyCitationsGrounded([{ reference: 'h1', verbatim_source: 'h1: "Used Honda and Nissan at CarMax Charleston for sale"' }], out, { linewise: true }).grounded).toBe(false);
  });
});
