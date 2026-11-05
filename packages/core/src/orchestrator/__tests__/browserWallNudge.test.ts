import { describe, it, expect } from 'vitest';
import { sawBotWall, BROWSER_WALL_LINE } from '../browserWallNudge.js';

const CF = '403 https://app.godelterminal.com/ 5358\n<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta http-equiv="content-security-policy" content="default-src \'self\' https://challenges.cloudflare.com">';

describe('browser-wall nudge', () => {
  it('detects a Cloudflare challenge in a Bash curl result', () => {
    expect(sawBotWall([{ tool_name: 'Bash', content: CF }])).toBe(true);
  });
  it('ignores ordinary pages and non-fetch tools', () => {
    expect(sawBotWall([{ tool_name: 'Bash', content: '<html><head><title>Example Domain</title></head><body>hello</body></html>' }])).toBe(false);
    expect(sawBotWall([{ tool_name: 'Read', content: CF }])).toBe(false);
  });
  it('points the model at Browse', () => {
    expect(BROWSER_WALL_LINE).toContain('Browse');
  });
});

import { sawScriptedBrowser } from '../browserWallNudge.js';
describe('scripted-browser trigger', () => {
  it('fires on a Bash call that drives its own browser', () => {
    expect(sawScriptedBrowser([{ name: 'Bash', input: { command: 'node -e "require(\'playwright-core\')..."' } }])).toBe(true);
    expect(sawScriptedBrowser([{ name: 'Bash', input: { command: 'chromium --headless --dump-dom https://cars.com' } }])).toBe(true);
  });
  it('ignores ordinary commands', () => {
    expect(sawScriptedBrowser([{ name: 'Bash', input: { command: 'ls -la && cat package.json' } }])).toBe(false);
    expect(sawScriptedBrowser([{ name: 'Read', input: { file_path: 'playwright.config.ts' } }])).toBe(false);
  });
});
