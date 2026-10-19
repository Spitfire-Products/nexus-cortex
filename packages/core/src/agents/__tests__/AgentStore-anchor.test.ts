import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AgentStore } from '../AgentStore.js';

describe('R267: agent definition `anchor` + empty body', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
  it('parses anchor and keeps an empty body as an empty system prompt (card prompt applies)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentstore-anchor-')); dirs.push(dir);
    writeFileSync(join(dir, 'action-agent.md'), `---\nname: action-agent\ndescription: Narrow-frame action delegate\ntools: all\nmodel: inherit\nanchor: Bash-Edit\n---\n`);
    writeFileSync(join(dir, 'role.md'), `---\nname: role\ndescription: A role agent\ntools: Read, Grep\nmodel: inherit\nmcp: nexus-browser, other-server\n---\n# Role\nYou are a role agent.\n`);
    const store = new AgentStore({ projectDir: dir, personalDir: join(tmpdir(), 'none-' + Date.now()), enableWatching: false, debug: false });
    await store.loadAllAgents();
    const action = store.getAgent('action-agent'); const role = store.getAgent('role');
    expect(action?.anchor).toBe('bash-edit');
    expect(action?.tools).toBe('all');
    expect(action?.systemPrompt).toBe('');
    expect(role?.anchor).toBeUndefined();
    expect(role?.systemPrompt).toContain('You are a role agent.');
    expect(role?.mcp).toEqual(['nexus-browser', 'other-server']);
    expect(action?.mcp).toBeUndefined();
  });
});
