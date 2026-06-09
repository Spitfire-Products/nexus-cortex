/**
 * The bare `fetch(url, { signal })` in WebFetch's fallback got Node's
 * default UA blocked (403) by most real sites — root cause of ~1/20
 * success. The hardened init must carry a real browser UA + Accept
 * headers + follow redirects, and still thread the abort signal.
 */
import { describe, it, expect } from 'vitest';
import { buildBrowserFetchInit } from '../webFetchRequestInit.js';

describe('buildBrowserFetchInit', () => {
  const ac = new AbortController();
  const init = buildBrowserFetchInit(ac.signal);
  const h = init.headers as Record<string, string>;

  it('sends a modern desktop-browser User-Agent (not node/empty)', () => {
    expect(h['User-Agent']).toMatch(/Mozilla\/5\.0/);
    expect(h['User-Agent']).toMatch(/Chrome\/\d+/);
    expect(h['User-Agent']).not.toMatch(/node|undici/i);
  });

  it('sends Accept and Accept-Language so WAFs do not 406/403', () => {
    expect(h['Accept']).toMatch(/text\/html/);
    expect(h['Accept-Language']).toMatch(/en/);
  });

  it('follows redirects and threads the abort signal', () => {
    expect(init.redirect).toBe('follow');
    expect(init.signal).toBe(ac.signal);
  });
});
