import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { materializeAgentSystemPrompt } from './agentSystemPrompt.js';

describe('R266 materializeAgentSystemPrompt', () => {
  it('writes the agent prompt to a 0600 file and returns its path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-prompt-'));
    const file = materializeAgentSystemPrompt({ name: 'browse-agent', systemPrompt: 'You are a browser automation subagent.' }, {}, dir);
    expect(file).toBeDefined();
    expect(fs.readFileSync(file!, 'utf-8')).toBe('You are a browser automation subagent.\n');
    expect(path.basename(file!)).toMatch(/^cortex-agent-prompt-browse-agent-\d+\.md$/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it('returns undefined without a prompt or when an override is already set', () => {
    expect(materializeAgentSystemPrompt({ name: 'x' }, {})).toBeUndefined();
    expect(materializeAgentSystemPrompt({ name: 'x', systemPrompt: '  ' }, {})).toBeUndefined();
    expect(materializeAgentSystemPrompt({ name: 'x', systemPrompt: 'p' }, { CORTEX_SYSTEM_PROMPT_FILE: '/x.md' })).toBeUndefined();
  });
});
