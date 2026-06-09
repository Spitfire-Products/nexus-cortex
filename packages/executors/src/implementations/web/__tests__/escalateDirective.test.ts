/**
 * WebFetch failure must TELL the model to escalate to `browse` immediately
 * (in-band, in the failure result content — not a system-message hope).
 * Observed: deepseek-v4-flash on a long agentic task got web_fetch to work
 * ~1/20; it kept retrying WebFetch on blocked/dynamic county pages instead
 * of switching to the browser. The directive must be firm, name `browse`,
 * forbid retrying WebFetch, and carry the exact URL when known.
 */
import { describe, it, expect } from 'vitest';
import { browseEscalationDirective } from '../escalateDirective.js';

describe('browseEscalationDirective', () => {
  it('names browse, forbids WebFetch retry, is imperative', () => {
    const d = browseEscalationDirective('https://records.deltacounty.example/ditch');
    expect(d).toMatch(/browse/);
    expect(d).toMatch(/do not retry|don't retry|stop using WebFetch|no more WebFetch/i);
  });

  it('embeds the exact URL when provided', () => {
    const url = 'https://example.com/a?b=c';
    expect(browseEscalationDirective(url)).toContain(url);
  });

  it('still produces a usable directive with no URL', () => {
    const d = browseEscalationDirective();
    expect(d).toMatch(/browse/);
    expect(d).toMatch(/do not retry|don't retry|stop using WebFetch|no more WebFetch/i);
    expect(d.length).toBeGreaterThan(40);
  });

  it('mentions the browse-agent / task-agent as the next fallback', () => {
    expect(browseEscalationDirective('https://x.com')).toMatch(/browse subagent|browse tool/i);
  });
});
