/** 2026-11-13: a hosted MCP quota refusal is recognised (one quiet line, no second connect attempt); transport faults are not. */
import { describe, it, expect } from 'vitest';
import { mcpQuotaRefusal } from '../McpClient.js';

const BODY = 'Streamable HTTP error: Error POSTing to endpoint: {"error":"Daily usage limit exceeded.","action":"upgrade","signupUrl":"https://spitfire-products.com","usage":{"dailyUsed":125,"dailyLimit":120,"remaining":0,"resetsAt":"midnight UTC"}}';

describe('mcpQuotaRefusal', () => {
  it('recognises the nexus-browser daily-limit refusal and names the reset', () => {
    expect(mcpQuotaRefusal(BODY)).toBe('daily free usage limit reached (resets midnight UTC)');
    expect(mcpQuotaRefusal(`Failed to connect to MCP server 'nexus-browser': ${BODY}`)).toBeDefined();
  });
  it('ignores ordinary transport / auth faults', () => {
    expect(mcpQuotaRefusal('fetch failed (cause: ECONNRESET [ECONNRESET])')).toBeUndefined();
    expect(mcpQuotaRefusal('Streamable HTTP error: Error POSTing to endpoint: {"error":"API key has expired.","action":"renew"}')).toBeUndefined();
    expect(mcpQuotaRefusal('SSE stream disconnected')).toBeUndefined();
  });
});
