/**
 * Accessibility capture on the pinned Playwright (2026-11-06): page.accessibility was removed upstream; the 1.64.1 pin broke the build on it
 * and installs on a newer Playwright already failed at runtime. The bridge now reads Chrome's AX tree over CDP (ariaSnapshot fallback).
 */
import { describe, it, expect } from 'vitest';
import { VisualFeedbackBridge } from '../VisualFeedbackBridge.js';
import { getChromiumBinary } from '../../../utils/ChromiumBrowserManager.js';

const HAS_CHROMIUM = !!getChromiumBinary();

describe.skipIf(!HAS_CHROMIUM)('VisualFeedbackBridge accessibility capture', () => {
  it('returns roles and labels from a real page', async () => {
    const b = new VisualFeedbackBridge();
    await b.initialize();
    try {
      const url = 'data:text/html,' + encodeURIComponent('<main><h1>Hello world</h1><button>Press me</button><a href="#x">Go link</a></main>');
      const s = await b.captureSnapshot(url);
      expect(s.accessibility.roles).toEqual(expect.arrayContaining(['heading', 'button', 'link']));
      expect(s.accessibility.labels).toEqual(expect.arrayContaining(['Hello world', 'Press me', 'Go link']));
    } finally {
      await b.close();
    }
  }, 180000);
});
