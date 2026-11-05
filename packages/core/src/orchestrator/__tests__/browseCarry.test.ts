import { describe, it, expect } from 'vitest';
import { browseCarryEnabled, browseCarryBlock, browseCarryApplies, lastUrlIn } from '../browserWallNudge.js';

const report = 'EVIDENCE: "Spire GTX $104.50" — https://www.backcountry.com/cat/mens-hiking?p=x|y and the PDP https://www.backcountry.com/la-sportiva-spire-gtx.';
describe('Browse carry-forward (CORTEX_BROWSE_CARRY)', () => {
  it('defaults on; off|false|0 disables', () => {
    expect(browseCarryEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    for (const v of ['off', 'false', '0']) expect(browseCarryEnabled({ CORTEX_BROWSE_CARRY: v } as NodeJS.ProcessEnv)).toBe(false);
  });
  it('takes the last URL, without trailing punctuation', () => {
    expect(lastUrlIn(report)).toBe('https://www.backcountry.com/la-sportiva-spire-gtx');
    expect(lastUrlIn('no links')).toBeUndefined();
  });
  it('starts the follow-up where the earlier pass ended unless it names its own start', () => {
    const b = browseCarryBlock({ task: 'find a GORE-TEX shoe', report }, false);
    expect(b).toContain('Start at: https://www.backcountry.com/la-sportiva-spire-gtx');
    expect(b).toContain('find a GORE-TEX shoe');
    expect(b.endsWith('TASK:\n')).toBe(true);
    expect(browseCarryBlock({ task: 't', report }, true)).not.toContain('Start at:');
  });
  it('does not apply when the new task names a different site', () => {
    expect(browseCarryApplies({ report }, 'On rei.com find the same shoe')).toBe(false);
    expect(browseCarryApplies({ report }, 'On backcountry.com check the size chart')).toBe(true);
    expect(browseCarryApplies({ report }, 'Check the size chart for that shoe')).toBe(true);
  });
});
