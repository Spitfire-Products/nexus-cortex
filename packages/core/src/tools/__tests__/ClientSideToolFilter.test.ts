/**
 * ClientSideToolFilter — Progressive tool loading for non-PTC providers.
 *
 * Tests: essential/recent filtering, deduplication, capacity limits, reset.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ClientSideToolFilter } from '../ClientSideToolFilter.js';
import type { CanonicalTool } from '../../adapters/FormatAdapter.interface.js';

function makeTool(name: string, tier: 'essential' | 'standard' = 'standard'): CanonicalTool {
  return {
    name,
    description: `Tool: ${name}`,
    schema: { type: 'object', properties: {}, required: [] },
    discoveryTier: tier,
  };
}

describe('ClientSideToolFilter', () => {
  let filter: ClientSideToolFilter;
  let allTools: CanonicalTool[];

  beforeEach(() => {
    filter = new ClientSideToolFilter();
    allTools = [
      makeTool('ReadFile', 'essential'),
      makeTool('WriteFile', 'essential'),
      makeTool('Shell', 'essential'),
      makeTool('Glob', 'essential'),
      makeTool('Grep', 'essential'),
      makeTool('EditFile', 'essential'),
      makeTool('SearchConversationHistory', 'standard'),
      makeTool('RequestHistoricalContext', 'standard'),
      makeTool('GetConversationSegment', 'standard'),
      makeTool('ListCompactionBoundaries', 'standard'),
      makeTool('AddonTool1', 'standard'),
      makeTool('AddonTool2', 'standard'),
    ];
  });

  it('should return only essential tools when nothing has been used', () => {
    const filtered = filter.getFilteredTools(allTools);
    expect(filtered.length).toBe(6);
    const names = filtered.map(t => t.name);
    expect(names).toContain('ReadFile');
    expect(names).toContain('Shell');
    expect(names).not.toContain('SearchConversationHistory');
    expect(names).not.toContain('AddonTool1');
  });

  it('should include recently used standard tools', () => {
    filter.recordToolUse('SearchConversationHistory');
    const filtered = filter.getFilteredTools(allTools);
    const names = filtered.map(t => t.name);
    expect(names).toContain('SearchConversationHistory');
    expect(names).toContain('ReadFile'); // Essential still included
  });

  it('should track most recent 15 tools only', () => {
    for (let i = 0; i < 20; i++) {
      filter.recordToolUse(`Tool_${i}`);
    }
    const recent = filter.getRecentlyUsed();
    expect(recent.length).toBe(15);
    expect(recent[0]).toBe('Tool_19'); // Most recent first
    expect(recent).not.toContain('Tool_0'); // Dropped
    expect(recent).not.toContain('Tool_4'); // Dropped
  });

  it('should deduplicate re-used tools and move to front', () => {
    filter.recordToolUse('A');
    filter.recordToolUse('B');
    filter.recordToolUse('C');
    filter.recordToolUse('A'); // Re-use
    const recent = filter.getRecentlyUsed();
    expect(recent).toEqual(['A', 'C', 'B']);
  });

  it('should reset tracking', () => {
    filter.recordToolUse('Foo');
    filter.recordToolUse('Bar');
    filter.reset();
    expect(filter.getRecentlyUsed().length).toBe(0);
    const filtered = filter.getFilteredTools(allTools);
    expect(filtered.length).toBe(6); // Only essentials
  });

  it('should handle tools not in registry gracefully', () => {
    filter.recordToolUse('NonExistentTool');
    const filtered = filter.getFilteredTools(allTools);
    // NonExistentTool isn't in allTools, so it won't appear
    const names = filtered.map(t => t.name);
    expect(names).not.toContain('NonExistentTool');
    // But essentials should still be there
    expect(filtered.length).toBe(6);
  });

  it('should return all tools when all are essential', () => {
    const allEssential = allTools.map(t => ({ ...t, discoveryTier: 'essential' as const }));
    const filtered = filter.getFilteredTools(allEssential);
    expect(filtered.length).toBe(allEssential.length);
  });

  describe('recordDiscoveredTools', () => {
    it('should add discovered tools to recent list', () => {
      const json = JSON.stringify({
        matches: 2,
        tools: [
          { name: 'AddonTool1', description: 'test', schema: {} },
          { name: 'AddonTool2', description: 'test', schema: {} },
        ],
      });

      filter.recordDiscoveredTools(json);

      const filtered = filter.getFilteredTools(allTools);
      const names = filtered.map(t => t.name);
      expect(names).toContain('AddonTool1');
      expect(names).toContain('AddonTool2');
    });

    it('should handle empty tools array', () => {
      const json = JSON.stringify({ matches: 0, tools: [] });
      filter.recordDiscoveredTools(json);
      expect(filter.getRecentlyUsed().length).toBe(0);
    });

    it('should skip invalid JSON gracefully', () => {
      filter.recordDiscoveredTools('not json');
      expect(filter.getRecentlyUsed().length).toBe(0);
    });

    it('should skip tools without valid name', () => {
      const json = JSON.stringify({
        tools: [
          { name: 123, description: 'bad' },
          { description: 'missing name' },
          { name: 'ValidTool', description: 'ok' },
        ],
      });

      filter.recordDiscoveredTools(json);
      // discoveredTools are stored separately (not in recentlyUsed)
      const recent = filter.getRecentlyUsed();
      expect(recent.length).toBe(0);
      // But ValidTool should be discoverable via getFilteredTools
      const testTools = [makeTool('ValidTool'), makeTool('OtherTool')];
      const filtered = filter.getFilteredTools(testTools);
      expect(filtered.map(t => t.name)).toContain('ValidTool');
    });

    it('should handle missing tools key', () => {
      const json = JSON.stringify({ matches: 0 });
      filter.recordDiscoveredTools(json);
      expect(filter.getRecentlyUsed().length).toBe(0);
    });
  });
});
