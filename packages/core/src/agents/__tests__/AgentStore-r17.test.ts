/**
 * Round 17 (Opus parallel-bench finding): AgentStore mtime cache.
 * Without this, loadAllAgents() re-parsed every profile from disk on
 * every call (and the watcher fires loadAllAgents on every single-file
 * change). Same pattern as R1's SystemMessageLoader cache.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AgentStore } from '../AgentStore.js';

const SAMPLE_AGENT = `---
name: test-agent
description: An agent for testing
tools: Read, Write, Edit
model: inherit
---

# Test Agent

You are a test agent.
`;

const UPDATED_AGENT = `---
name: test-agent
description: An updated description
tools: Read, Grep
model: inherit
---

# Test Agent v2

You are a test agent (updated).
`;

describe('AgentStore — mtime cache (Round 17)', () => {
  let tmpDir: string;
  let store: AgentStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'r17-agentstore-'));
    store = new AgentStore({
      projectDir: tmpDir,
      personalDir: join(tmpdir(), 'r17-nonexistent-' + Date.now()),
      enableWatching: false,
      debug: false,
    });
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('cache populated after first load', async () => {
    writeFileSync(join(tmpDir, 'test-agent.md'), SAMPLE_AGENT);
    await store.loadAllAgents();
    const cache = (store as any).agentFileCache as Map<string, any>;
    expect(cache.size).toBe(1);
    const filePath = join(tmpDir, 'test-agent.md');
    expect(cache.has(filePath)).toBe(true);
    expect(cache.get(filePath).agent.name).toBe('test-agent');
  });

  it('cache hit on second loadAllAgents for unchanged file (description preserved from first parse)', async () => {
    const filePath = join(tmpDir, 'test-agent.md');
    writeFileSync(filePath, SAMPLE_AGENT);
    await store.loadAllAgents();
    const firstAgent = store.getAgent('test-agent');
    expect(firstAgent?.description).toBe('An agent for testing');

    // Replace `getAgent` reference; cache hit should produce the same definition
    await store.loadAllAgents();
    const secondAgent = store.getAgent('test-agent');
    // Same content — cache entry returned, definition equivalent
    expect(secondAgent?.description).toBe('An agent for testing');
    expect(secondAgent?.tools).toEqual(firstAgent?.tools);
  });

  it('file mutation invalidates cache (mtime changes → fresh parse)', async () => {
    const filePath = join(tmpDir, 'test-agent.md');
    writeFileSync(filePath, SAMPLE_AGENT);
    await store.loadAllAgents();
    expect(store.getAgent('test-agent')?.description).toBe('An agent for testing');

    // Wait for OS mtime resolution, then update content
    await new Promise((r) => setTimeout(r, 20));
    writeFileSync(filePath, UPDATED_AGENT);

    await store.loadAllAgents();
    // New content reflected — cache invalidated by mtime change.
    // (Asserting on description, which is a simple frontmatter string,
    // avoids being coupled to tools-array YAML parsing quirks.)
    expect(store.getAgent('test-agent')?.description).toBe('An updated description');
  });

  it('cache survives multiple unchanged loadAllAgents calls without growing', async () => {
    writeFileSync(join(tmpDir, 'a.md'), SAMPLE_AGENT.replace('test-agent', 'agent-a'));
    writeFileSync(join(tmpDir, 'b.md'), SAMPLE_AGENT.replace('test-agent', 'agent-b'));
    await store.loadAllAgents();
    await store.loadAllAgents();
    await store.loadAllAgents();
    const cache = (store as any).agentFileCache as Map<string, any>;
    // Exactly 2 entries, even after 3 loads
    expect(cache.size).toBe(2);
  });
});
