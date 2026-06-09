/**
 * ClientSideToolFilter — Progressive tool loading for non-PTC providers.
 *
 * Tracks recently used tools and returns essential + recently-used tools,
 * reducing token usage by not sending all tool schemas on every request.
 *
 * For PTC providers (Anthropic), use native `defer_loading` instead.
 */

import type { CanonicalTool } from '../adapters/FormatAdapter.interface.js';
import { ToolNamingHandler } from '../adapters/ToolNamingHandler.js';

const MAX_RECENT = 15;
const namingHandler = new ToolNamingHandler();

export class ClientSideToolFilter {
  private recentlyUsed: string[] = [];
  private discoveredTools = new Set<string>();

  /** Record that a tool was used (adds to recent list). */
  recordToolUse(name: string): void {
    this.recentlyUsed = this.recentlyUsed.filter((n) => n !== name);
    this.recentlyUsed.unshift(name);
    if (this.recentlyUsed.length > MAX_RECENT) {
      this.recentlyUsed.pop();
    }
  }

  /** Get filtered tools: essential + discovered + recently-used. */
  getFilteredTools(allTools: CanonicalTool[]): CanonicalTool[] {
    const recentSet = new Set(this.recentlyUsed);
    return allTools.filter(
      (t) =>
        t.discoveryTier === 'essential' ||
        recentSet.has(t.name) ||
        this.discoveredTools.has(t.name),
    );
  }

  /** Get deferred tool names (standard tier, not yet discovered/used). */
  getDeferredToolNames(allTools: CanonicalTool[]): string[] {
    const activeSet = new Set([...this.recentlyUsed, ...this.discoveredTools]);
    return allTools
      .filter((t) => t.discoveryTier !== 'essential' && !activeSet.has(t.name))
      .map((t) => t.name);
  }

  /** Get deferred tools with metadata for richer announcements. */
  getDeferredTools(allTools: CanonicalTool[]): { name: string; description: string }[] {
    const activeSet = new Set([...this.recentlyUsed, ...this.discoveredTools]);
    return allTools
      .filter((t) => t.discoveryTier !== 'essential' && !activeSet.has(t.name))
      .map((t) => ({ name: t.name, description: t.description }));
  }

  /** Get list of recently used tool names. */
  getRecentlyUsed(): readonly string[] {
    return this.recentlyUsed;
  }

  /**
   * Record tools discovered via SearchTools result.
   * Discovered tools are sticky — they stay available for the rest of the session
   * rather than competing with recent-use slots.
   */
  recordDiscoveredTools(searchResultJson: string): void {
    try {
      const parsed = JSON.parse(searchResultJson);
      if (parsed.tools && Array.isArray(parsed.tools)) {
        for (const tool of parsed.tools) {
          if (tool.name && typeof tool.name === 'string') {
            // SearchTools may return snake_case names (model-facing convention).
            // Convert to PascalCase for internal matching against allTools.
            this.discoveredTools.add(namingHandler.convertName(tool.name, 'PascalCase'));
          }
        }
      }
    } catch { /* skip malformed JSON */ }
  }

  /** Reset tracking. */
  reset(): void {
    this.recentlyUsed = [];
    this.discoveredTools.clear();
  }
}
