import { describe, it, expect, afterEach } from 'vitest';
import { isStreamUsageEnabled, STREAM_USAGE_DEFAULT_PROVIDERS } from '../transportCacheFixes';

describe('R236 stream usage default (2026-10-06)', () => {
  afterEach(() => { delete process.env.CORTEX_STREAM_USAGE; });
  it('unset: on for openai / deepseek / groq, off for other providers and when the provider is unknown', () => {
    delete process.env.CORTEX_STREAM_USAGE;
    for (const p of STREAM_USAGE_DEFAULT_PROVIDERS) expect(isStreamUsageEnabled(p)).toBe(true);
    expect(isStreamUsageEnabled('DeepSeek')).toBe(true);
    expect(isStreamUsageEnabled('xai')).toBe(false);
    expect(isStreamUsageEnabled('google')).toBe(false);
    expect(isStreamUsageEnabled(undefined)).toBe(false);
  });
  it('explicit on forces any provider; explicit off disables everywhere', () => {
    process.env.CORTEX_STREAM_USAGE = 'on'; expect(isStreamUsageEnabled('xai')).toBe(true);
    process.env.CORTEX_STREAM_USAGE = 'off'; expect(isStreamUsageEnabled('deepseek')).toBe(false);
    process.env.CORTEX_STREAM_USAGE = '0'; expect(isStreamUsageEnabled('openai')).toBe(false);
  });
});
