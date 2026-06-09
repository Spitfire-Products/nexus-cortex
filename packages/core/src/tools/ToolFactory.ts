/**
 * Tool Factory
 *
 * Unified interface for accessing all tools (base + addon).
 * Provides single point of access for orchestrator and adapters.
 *
 * Phase 1: Tool Architecture Refactor
 */

import type {
  AddonToolDefinition,
  CanonicalToolDefinition,
  ToolFactoryInterface
} from './types/CanonicalTool.js';
import { baseToolRegistry } from './registries/BaseToolRegistry.js';
import { addonToolRegistry } from './registries/AddonToolRegistry.js';

/**
 * Unified tool factory
 *
 * Provides access to all tools (base + addon) through a single interface.
 * Base tools are immutable, addon tools can be registered/removed dynamically.
 */
export class ToolFactory implements ToolFactoryInterface {
  /**
   * Get all available tools (base + addon)
   *
   * Base tools are always included. Addon tools are added if registered.
   * Deduplicates by tool name, with base tools taking precedence.
   */
  getAllTools(): CanonicalToolDefinition[] {
    const baseTools = baseToolRegistry.getAllTools();
    const addonTools = addonToolRegistry.getAllTools();

    // Use Map to deduplicate by tool name
    // Base tools added first, so they take precedence over addon tools
    const toolMap = new Map<string, CanonicalToolDefinition>();

    // Add base tools first (these are immutable and take precedence)
    baseTools.forEach(tool => {
      toolMap.set(tool.name, tool);
    });

    // Add addon tools only if name doesn't already exist
    addonTools.forEach(tool => {
      if (!toolMap.has(tool.name)) {
        toolMap.set(tool.name, tool);
      }
    });

    return Array.from(toolMap.values());
  }

  /**
   * Get a specific tool by name
   *
   * Searches base tools first, then addon tools.
   */
  getTool(name: string): CanonicalToolDefinition | undefined {
    // Check base tools first (immutable)
    const baseTool = baseToolRegistry.getTool(name);
    if (baseTool) {
      return baseTool;
    }

    // Check addon tools
    return addonToolRegistry.getTool(name);
  }

  /**
   * Get base tools only
   */
  getBaseTools(): CanonicalToolDefinition[] {
    return baseToolRegistry.getAllTools();
  }

  /**
   * Get addon tools only
   */
  getAddonTools(): AddonToolDefinition[] {
    return addonToolRegistry.getAllTools() as AddonToolDefinition[];
  }

  /**
   * Get historical tools only
   */
  getHistoricalTools(): CanonicalToolDefinition[] {
    return baseToolRegistry.getToolsByCategory('historical');
  }

  /**
   * Register an addon tool
   *
   * @throws Error if tool name conflicts with base tool
   * @throws Error if addon tool already exists
   */
  registerAddonTool(tool: AddonToolDefinition): void {
    // Prevent overriding base tools
    if (baseToolRegistry.hasTool(tool.name)) {
      throw new Error(
        `Cannot register addon tool '${tool.name}': name conflicts with base tool. ` +
        `Base tools are immutable.`
      );
    }

    // Register the addon tool
    addonToolRegistry.registerTool(tool);
  }

  /**
   * Remove an addon tool
   *
   * @returns true if tool was removed, false if not found
   */
  removeAddonTool(name: string): boolean {
    // Cannot remove base tools
    if (baseToolRegistry.hasTool(name)) {
      throw new Error(
        `Cannot remove '${name}': it is a base tool. Base tools are immutable.`
      );
    }

    return addonToolRegistry.removeTool(name);
  }

  /**
   * Check if a tool exists (base or addon)
   */
  hasTool(name: string): boolean {
    return baseToolRegistry.hasTool(name) || addonToolRegistry.hasTool(name);
  }

  /**
   * Get tool count (base + addon)
   */
  getToolCount(): number {
    return this.getAllTools().length;
  }

  /**
   * Clear addon tools (temporary or all)
   */
  clearAddonTools(persistent: boolean = false): void {
    addonToolRegistry.clearTools(persistent);
  }

  /**
   * Export persistent addon tools for storage
   */
  exportAddonTools(): AddonToolDefinition[] {
    return addonToolRegistry.exportTools();
  }

  /**
   * Import persistent addon tools from storage
   */
  importAddonTools(tools: AddonToolDefinition[]): void {
    addonToolRegistry.importTools(tools);
  }

  /**
   * Get essential tools only (discoveryTier === 'essential').
   * Used for PTC deferred tool loading — essential tools are always loaded,
   * standard tools get defer_loading: true and are discovered via Tool Search.
   */
  getEssentialTools(): CanonicalToolDefinition[] {
    const ESSENTIAL_TOOL_NAMES = new Set([
      'ReadFile', 'WriteFile', 'EditFile', 'Shell', 'Glob', 'Grep',
    ]);
    return this.getAllTools().filter(
      (t) => t.discoveryTier === 'essential' || ESSENTIAL_TOOL_NAMES.has(t.name),
    );
  }

  /**
   * Get standard tools only (discoveryTier === 'standard' or unset, excluding essential).
   * These are candidates for defer_loading when PTC is enabled.
   */
  getStandardTools(): CanonicalToolDefinition[] {
    const essential = new Set(this.getEssentialTools().map((t) => t.name));
    return this.getAllTools().filter((t) => !essential.has(t.name));
  }
}

// Export singleton instance
export const toolFactory = new ToolFactory();
