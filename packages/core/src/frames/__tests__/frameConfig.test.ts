import { describe, it, expect } from 'vitest';
import { resolveFrameConfig, FRAME_CONTRACT, FRAME_TOOL_NAME } from '../frameConfig.js';

describe('R179 frameConfig', () => {
  it('defaults to the tools frame with the chooser off; parses and clamps the levers', () => {
    expect(resolveFrameConfig({})).toEqual({ frame: 'tools', chooser: 'off', candidates: 1, waitCapS: 60, screenLines: 45, keyGuard: true, minCandidates: 1 });
    expect(resolveFrameConfig({ CORTEX_FRAME: 'terminus', CORTEX_FRAME_CHOOSER: 'jev', CORTEX_FRAME_CANDIDATES: '3', CORTEX_FRAME_WAIT_CAP_S: '120', CORTEX_FRAME_SCREEN_LINES: '80', CORTEX_FRAME_KEY_GUARD: 'off' })).toEqual({ frame: 'terminus', chooser: 'jev', candidates: 3, waitCapS: 120, screenLines: 80, keyGuard: false, minCandidates: 2 });
    expect(resolveFrameConfig({ CORTEX_FRAME: 'TERMINUS', CORTEX_FRAME_CANDIDATES: '9', CORTEX_FRAME_WAIT_CAP_S: '1', CORTEX_FRAME_CHOOSER: 'bogus' })).toEqual({ frame: 'terminus', chooser: 'off', candidates: 3, waitCapS: 60, screenLines: 45, keyGuard: true, minCandidates: 1 });
    expect(FRAME_TOOL_NAME).toBe('FrameAction'); expect(FRAME_CONTRACT).toContain('FrameAction'); expect(FRAME_CONTRACT).toContain('EndTurn'); expect(FRAME_CONTRACT).toContain('LAST 45 lines'); expect(FRAME_CONTRACT).toContain('several small, precise commands');
    expect(resolveFrameConfig({ CORTEX_FRAME: 'terminus', CORTEX_FRAME_CHOOSER: 'jev', CORTEX_FRAME_CANDIDATES: '1' }).minCandidates).toBe(1); // never above the cap
    expect(resolveFrameConfig({ CORTEX_FRAME: 'terminus', CORTEX_FRAME_CHOOSER: 'jev', CORTEX_FRAME_CANDIDATES: '3', CORTEX_FRAME_MIN_CANDIDATES: '3' }).minCandidates).toBe(3);
    expect(resolveFrameConfig({ CORTEX_FRAME: 'terminus', CORTEX_FRAME_CHOOSER: 'jev', CORTEX_FRAME_CANDIDATES: '3', CORTEX_FRAME_MIN_CANDIDATES: '1' }).minCandidates).toBe(1); // explicit off
  });
});
