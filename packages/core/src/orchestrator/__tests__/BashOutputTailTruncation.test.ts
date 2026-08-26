/** Item 14a — BashOutput oversized results return the TAIL as success
 *  (background logs: the tail IS the answer; there are no navigation params). */
import { describe, it, expect } from 'vitest';
import { CortexOrchestrator } from '../CortexOrchestrator.js';

const fakeThis = {
  config: { debug: false },
  truncateToolOutput: (CortexOrchestrator.prototype as any).truncateToolOutput,
};
const proc = (tool: string, out: string) =>
  (CortexOrchestrator.prototype as any).processToolResult.call(fakeThis, tool, out);

describe('oversized tool results (item 14a)', () => {
  const big = 'line-A\n'.repeat(60000) + 'FINAL RESULT: acc=0.71\n'; // ~105K tokens

  it('BashOutput: tail returned as SUCCESS with truncation notice', () => {
    const r = proc('BashOutput', big);
    expect(r.isError).toBe(false);
    expect(r.content).toContain('output truncated: showing the LAST');
    expect(r.content).toContain('FINAL RESULT: acc=0.71'); // the tail survives
    expect(r.content.length).toBeLessThan(90000); // ~20K tokens
  });

  it('Read: still the guidance-error path (has navigation params)', () => {
    const r = proc('Read', big);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('Tool result too large');
  });

  it('small outputs pass through untouched', () => {
    const r = proc('BashOutput', 'short output');
    expect(r.isError).toBe(false);
    expect(r.content).toBe('short output');
  });
});
