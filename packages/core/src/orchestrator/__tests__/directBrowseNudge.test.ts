import { describe, it, expect } from 'vitest';
import { countDirectBrowserCalls, directBrowseLine, directBrowseNudgeThreshold } from '../browserWallNudge.js';

describe('long direct browsing → delegate nudge', () => {
  it('threshold: default 15, 0 = off, junk falls back', () => {
    expect(directBrowseNudgeThreshold({} as any)).toBe(15);
    expect(directBrowseNudgeThreshold({ CORTEX_BROWSE_DIRECT_NUDGE_CALLS: '0' } as any)).toBe(0);
    expect(directBrowseNudgeThreshold({ CORTEX_BROWSE_DIRECT_NUDGE_CALLS: '30' } as any)).toBe(30);
    expect(directBrowseNudgeThreshold({ CORTEX_BROWSE_DIRECT_NUDGE_CALLS: 'x' } as any)).toBe(15);
  });
  it('counts only nexus-browser tool calls', () => {
    expect(countDirectBrowserCalls([{ name: 'nexus-browser__click' }, { name: 'Bash' }, { name: 'nexus-browser__scan' }, { name: 'Browse' }])).toBe(2);
  });
  it('the line names the delegate hand-off and close_session', () => {
    const l = directBrowseLine(15);
    expect(l).toContain('15 browser calls');
    expect(l).toContain('Browse({ task }) with no mode');
    expect(l).toContain('close_session');
  });
});

import { looksMultiStepBrowseTask, directConfirmEnabled, DIRECT_CONFIRM_TEXT } from '../browserWallNudge.js';

describe('direct-mode confirm gate', () => {
  it('the CarMax task reads as multi-step; a short look does not', () => {
    expect(looksMultiStepBrowseTask("Go to https://www.carmax.com/ . Set the location/ZIP to 49512 (Kentwood, MI 49512) using the site's location control. Then start a car search and, in the results filters, select Make = Nissan AND Make = Honda (both), apply, and wait for results")).toBe(true);
    expect(looksMultiStepBrowseTask('Open https://example.com and read the headline')).toBe(false);
    expect(looksMultiStepBrowseTask(undefined)).toBe(false);
  });
  it('on by default; off disables', () => {
    expect(directConfirmEnabled({} as any)).toBe(true);
    expect(directConfirmEnabled({ CORTEX_BROWSE_DIRECT_CONFIRM: 'off' } as any)).toBe(false);
  });
  it('the confirm text names the delegate call and how to insist', () => {
    expect(DIRECT_CONFIRM_TEXT).toContain('Browse({ task }) with NO mode');
    expect(DIRECT_CONFIRM_TEXT).toContain('call Browse with mode "direct" again');
  });
});

import { browseDirectAvailable, withoutBrowseDirect } from '../browserWallNudge.js';

describe('direct mode is withheld headless', () => {
  it('auto: interactive only; always / never override', () => {
    expect(browseDirectAvailable(true, {} as any)).toBe(false);
    expect(browseDirectAvailable(false, {} as any)).toBe(true);
    expect(browseDirectAvailable(true, { CORTEX_BROWSE_DIRECT: 'always' } as any)).toBe(true);
    expect(browseDirectAvailable(false, { CORTEX_BROWSE_DIRECT: 'never' } as any)).toBe(false);
  });
  it('withoutBrowseDirect drops the mode parameter and the direct sentence, leaving the registry copy untouched', () => {
    const def = { name: 'Browse', description: 'Default mode delegates the task — use it for multi-page work; mode "direct" connects the tools for short work. Last.', schema: { type: 'object', properties: { task: { type: 'string' }, mode: { type: 'string' } } } };
    const out = withoutBrowseDirect(def);
    expect(Object.keys(out.schema.properties)).toEqual(['task']);
    expect(out.description).not.toContain('direct');
    expect(def.schema.properties).toHaveProperty('mode');
  });
});

import { looksLikeReverification, reverifyGuardEnabled, REVERIFY_TEXT } from '../browserWallNudge.js';

describe('re-verification of a completed browse report', () => {
  it('the baseline follow-up calls read as re-verification', () => {
    expect(looksLikeReverification('INDEPENDENT VERIFICATION. Navigate to https://www.fedex.com/fedextrack/?trknbr=3023858502 and wait for the page')).toBe(true);
    expect(looksLikeReverification('Raw data capture only — no interpretation, no summarizing. Navigate to https://www.fedex.com/fedextrack/')).toBe(true);
    expect(looksLikeReverification('This is a final verification pass. Do exactly these three things and print verbatim strings')).toBe(true);
    expect(looksLikeReverification('Open this exact URL and VERIFY a listing. Do not search anywhere else')).toBe(true);
    expect(looksLikeReverification('Go to https://newportbeach.porsche.com/en/inventory/porsche/search?condition=used&modelSeries=cayenne — I need to resolve a discrepancy in the count')).toBe(true);
  });
  it('follow-ups for other work are not', () => {
    expect(looksLikeReverification('Now open the cheapest listing and report its VIN and dealer phone number.')).toBe(false);
    expect(looksLikeReverification('Go to the second page of results and list the next 10 hatchbacks.')).toBe(false);
  });
  it('on by default; allow disables; the text says how to insist', () => {
    expect(reverifyGuardEnabled({} as any)).toBe(true);
    expect(reverifyGuardEnabled({ CORTEX_BROWSE_REVERIFY: 'allow' } as any)).toBe(false);
    expect(REVERIFY_TEXT).toContain('call Browse again with the SAME task text and it will run'); expect(REVERIFY_TEXT).toContain('do not mention it');
  });
});

import { subAgentEndTurnEnv } from '../browserWallNudge.js';

describe('EndTurn policy inside sub-agents', () => {
  it('default: resolver off, mechanical gates inherited', () => {
    expect(subAgentEndTurnEnv({} as any)).toEqual({ CORTEX_ENDTURN_RESOLVER: 'false' });
  });
  it('off: every EndTurn gate off; full: inherit everything', () => {
    expect(subAgentEndTurnEnv({ CORTEX_SUBAGENT_ENDTURN: 'off' } as any)).toMatchObject({ CORTEX_ENDTURN_RESOLVER: 'false', CORTEX_ENDTURN_GATE: 'false', CORTEX_ENDTURN_REQUIREMENTS: 'false' });
    expect(subAgentEndTurnEnv({ CORTEX_SUBAGENT_ENDTURN: 'full' } as any)).toEqual({});
  });
});

import { reverifyKey, REVERIFY_MAX } from '../browserWallNudge.js';
describe('re-verify guard: each new task once, the same task runs', () => {
  it('keys ignore case and spacing; cap is small', () => {
    expect(reverifyKey('FINAL  verification pass on bbb.org')).toBe(reverifyKey('final verification pass on bbb.org'));
    expect(REVERIFY_MAX).toBeLessThanOrEqual(3);
  });
  it('the reworded BBB passes read as re-verification', () => {
    expect(looksLikeReverification('FINAL verification pass on https://www.bbb.org/ . Start fresh; the browser was closed')).toBe(true);
    expect(looksLikeReverification('Reconcile one inconsistency on https://www.bbb.org/ and then leave the browser OPEN')).toBe(true);
    expect(looksLikeReverification('Final pass on https://www.bbb.org/ . Do NOT close the session at the end')).toBe(true);
  });
});

import { looksLikeProbe, probeGuardEnabled, PROBE_TEXT } from '../browserWallNudge.js';
describe('probe-first Browse guard', () => {
  it('the observed probe calls match; whole tasks do not', () => {
    expect(looksLikeProbe('Go to https://www.bbb.org/ and report: (1) the exact URL of the page you land on, (2) whether the page renders (or shows a block)')).toBe(true);
    expect(looksLikeProbe('Open https://www.carmax.com/ and tell me exactly what renders: the page title, whether it is the real CarMax homepage or an Access Denied page')).toBe(true);
    expect(looksLikeProbe('Go to https://www.cars.com/ and report exactly what the homepage shows: the main navigation items')).toBe(true);
    expect(looksLikeProbe('GOAL: On bbb.org, find the BEST-RATED BBB-ACCREDITED CHARITY near ZIP 12023 and report its name, rating and address.')).toBe(false);
    expect(looksLikeProbe('Go to https://www.jcpenney.com/ and filter Handbags to evening bags that are gold, satin, under $100; report the count and URL.')).toBe(false);
  });
  it('on by default; text explains how to insist', () => {
    expect(probeGuardEnabled({} as any)).toBe(true);
    expect(probeGuardEnabled({ CORTEX_BROWSE_PROBE_GUARD: 'off' } as any)).toBe(false);
    expect(PROBE_TEXT).toContain('SAME task text');
  });
});

describe('gap follow-ups are not re-verification', () => {
  it('a task naming a gap the report flagged runs', () => {
    expect(looksLikeReverification('Gap to close (named by the previous pass): its top pick "Charity Fundraising" is categorized as a for-profit Professional Fundraiser — verify whether any accredited charity qualifies')).toBe(false);
    expect(looksLikeReverification('The report could not confirm the Satin filter; confirm it on the page')).toBe(false);
    expect(looksLikeReverification('FINAL verification pass on https://www.bbb.org/ . Start fresh')).toBe(true);
  });
});
