import { describe, it, expect, vi } from 'vitest';
import { BrowseTool, buildBrowseSubagentDispatch } from '../BrowseTool.js';

describe('BrowseTool', () => {
  const tool = new BrowseTool();

  describe('validateToolParams', () => {
    it('accepts a non-empty task', () => {
      expect(tool.validateToolParams({ task: 'extract HN top 5' })).toBeNull();
    });

    it('rejects empty/whitespace task', () => {
      expect(tool.validateToolParams({ task: '' })).toContain('task');
      expect(tool.validateToolParams({ task: '   ' })).toContain('task');
    });

    it('rejects oversized task', () => {
      expect(tool.validateToolParams({ task: 'x'.repeat(4001) })).toContain('4000');
    });

    it('accepts optional url and model', () => {
      expect(
        tool.validateToolParams({ task: 'login', url: 'https://example.com', model: 'sonnet' })
      ).toBeNull();
    });

    it('rejects invalid model alias', () => {
      expect(
        tool.validateToolParams({ task: 't', model: 'gpt-4' as any })
      ).toContain('model must be one of');
    });

    it('rejects oversized url', () => {
      expect(tool.validateToolParams({ task: 't', url: 'x'.repeat(2049) })).toContain('2048');
    });
  });

  describe('execute → subagent dispatch contract', () => {
    it('emits shouldSpawnSubAgent + agentDefinition + taskPrompt + envOverrides', async () => {
      const r = await tool.execute({ task: 'extract titles from front page', url: 'https://example.com' });
      expect(r.success).toBe(true);
      expect(r.metadata?.shouldSpawnSubAgent).toBe(true);
      expect(r.metadata?.agentName).toBe('browse-agent');
      expect(r.metadata?.agentDefinition).toBeDefined();
      expect((r.metadata?.agentDefinition as any).name).toBe('browse-agent');
      expect((r.metadata?.agentDefinition as any).systemPrompt).toContain('nexus-browser');
      // Critical: env override must enable MCP for the subagent only
      expect(r.metadata?.envOverrides).toEqual({ MCP_AUTO_INJECT: 'true', CORTEX_MCP_AUTOCONNECT: 'nexus-browser' });
    });

    it('threads starting URL into taskPrompt when provided', async () => {
      const r = await tool.execute({ task: 'click login', url: 'https://example.com/login' });
      expect(r.metadata?.taskPrompt).toContain('Start at: https://example.com/login');
      expect(r.metadata?.taskPrompt).toContain('click login');
    });

    it('omits the "Start at:" prefix when no url provided', async () => {
      const r = await tool.execute({ task: 'find best deals on flights to Lisbon' });
      expect(r.metadata?.taskPrompt).not.toContain('Start at:');
      expect(r.metadata?.taskPrompt).toContain('find best deals');
    });

    it('returns error result on invalid params', async () => {
      const r = await tool.execute({ task: '' });
      expect(r.success).toBe(false);
      expect(r.metadata?.shouldSpawnSubAgent).toBeUndefined();
    });

    it('recursion guard: refuses to dispatch when invoked inside a subagent', async () => {
      const origCortex = process.env.CORTEX_AGENT_MODE;
      const origOmni = process.env.CORTEX_AGENT_MODE;
      process.env.CORTEX_AGENT_MODE = 'true';
      try {
        const r = await tool.execute({ task: 'recursive call attempt' });
        expect(r.success).toBe(false);
        expect(r.metadata?.shouldSpawnSubAgent).toBeUndefined();
        const msg = (r.error || (r.llmContent as string) || '').toLowerCase();
        expect(msg).toContain('subagent');
        expect(msg).toContain('nexus-browser');
      } finally {
        if (origCortex === undefined) delete process.env.CORTEX_AGENT_MODE;
        else process.env.CORTEX_AGENT_MODE = origCortex;
        if (origOmni === undefined) delete process.env.CORTEX_AGENT_MODE;
        else process.env.CORTEX_AGENT_MODE = origOmni;
      }
    });
  });

  describe('buildBrowseSubagentDispatch helper (shared with WebSearch/WebFetch interactive mode)', () => {
    it('produces the exact dispatch contract orchestrator expects', () => {
      const r = buildBrowseSubagentDispatch('test task', 'https://x.com', 'display label');
      expect(r.metadata?.shouldSpawnSubAgent).toBe(true);
      expect(r.metadata?.envOverrides).toEqual({ MCP_AUTO_INJECT: 'true', CORTEX_MCP_AUTOCONNECT: 'nexus-browser' });
      expect(r.metadata?.taskPrompt).toBe('Start at: https://x.com\n\ntest task');
      expect(r.metadata?.agentName).toBe('browse-agent');
    });

    it('passes through executionTime when startTime provided', () => {
      const now = Date.now();
      const r = buildBrowseSubagentDispatch('t', undefined, 'd', now);
      expect(typeof r.metadata?.executionTime).toBe('number');
      expect((r.metadata!.executionTime as number)).toBeGreaterThanOrEqual(0);
    });

    it('omits executionTime when no startTime given', () => {
      const r = buildBrowseSubagentDispatch('t', undefined, 'd');
      expect(r.metadata?.executionTime).toBeUndefined();
    });
  });
});
