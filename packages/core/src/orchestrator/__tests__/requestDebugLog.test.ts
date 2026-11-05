import { describe, it, expect, afterEach } from 'vitest';
import { describeChatRequest } from '../requestDebugLog.js';

afterEach(() => { delete process.env.CORTEX_DEBUG_FULL_REQUESTS; });
const base = [{ role: 'system', content: 'sys' + Math.random() }, { role: 'user', content: 'go to a site' }];

describe('debug request log', () => {
  it('logs a summary and only the messages new since the previous request of the same conversation', () => {
    const r1 = describeChatRequest({ model: 'm', messages: [...base], tools: [{}, {}], stream: true });
    expect(r1).toContain('messages=2 (+2 new) tools=2');
    const m2 = [...base, { role: 'assistant', content: '', tool_calls: [{ function: { name: 'Browse' } }] }, { role: 'tool', tool_call_id: 'call_1', content: 'x'.repeat(5000) }];
    const r2 = describeChatRequest({ model: 'm', messages: m2 });
    expect(r2).toContain('messages=4 (+2 new)');
    expect(r2).toContain('#2 assistant');
    expect(r2).toContain('calls=Browse');
    expect(r2).toContain('#3 tool text 5000ch');
    expect(r2).not.toContain('xxxxx');          // content is NOT dumped
    expect(r2).not.toContain('#1 user');        // earlier messages are not repeated
  });
  it('CORTEX_DEBUG_FULL_REQUESTS=true restores the full dump', () => {
    process.env.CORTEX_DEBUG_FULL_REQUESTS = 'true';
    expect(describeChatRequest({ model: 'm', messages: [{ role: 'user', content: 'hello world' }] })).toContain('"content": "hello world"');
  });
});
