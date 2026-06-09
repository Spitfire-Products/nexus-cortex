/**
 * Addon Tool Registry
 *
 * Mutable registry for dynamically created addon tools.
 * Supports both temporary (session-only) and persistent tools.
 *
 * Phase 1: Tool Architecture Refactor
 */

import type {
  AddonToolDefinition,
  CanonicalToolDefinition,
  MutableToolRegistry,
  ToolCategory
} from '../types/CanonicalTool.js';

/**
 * Mutable registry for addon tools
 */
export class AddonToolRegistry implements MutableToolRegistry {
  private readonly tools: Map<string, AddonToolDefinition>;

  constructor() {
    this.tools = new Map();
  }

  /**
   * Register a new addon tool
   */
  registerTool(tool: AddonToolDefinition): void {
    // Validate category
    if (tool.category !== 'addon-temporary' && tool.category !== 'addon-persistent') {
      throw new Error(
        `Invalid category for addon tool: ${tool.category}. Must be 'addon-temporary' or 'addon-persistent'`
      );
    }

    // Validate required fields
    if (!tool.name || !tool.description || !tool.schema || !tool.implementation) {
      throw new Error('Addon tool must have name, description, schema, and implementation');
    }

    // Validate implementation
    if (!tool.implementation.language || !tool.implementation.code) {
      throw new Error('Addon tool implementation must have language and code');
    }

    // Check if tool already exists
    if (this.tools.has(tool.name)) {
      throw new Error(`Addon tool '${tool.name}' already exists. Use updateTool to modify.`);
    }

    // Register the tool
    this.tools.set(tool.name, tool);
  }

  /**
   * Remove a tool
   */
  removeTool(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Update an existing tool
   */
  updateTool(name: string, tool: AddonToolDefinition): boolean {
    if (!this.tools.has(name)) {
      return false;
    }

    // Validate like in registerTool
    if (tool.category !== 'addon-temporary' && tool.category !== 'addon-persistent') {
      throw new Error(
        `Invalid category for addon tool: ${tool.category}. Must be 'addon-temporary' or 'addon-persistent'`
      );
    }

    this.tools.set(name, tool);
    return true;
  }

  /**
   * Clear all tools or only temporary ones
   */
  clearTools(persistent: boolean = false): void {
    if (persistent) {
      // Clear all tools including persistent
      this.tools.clear();
    } else {
      // Clear only temporary tools
      const tempTools = Array.from(this.tools.entries())
        .filter(([_, tool]) => tool.category === 'addon-temporary')
        .map(([name]) => name);

      tempTools.forEach(name => this.tools.delete(name));
    }
  }

  /**
   * Get all addon tools
   */
  getAllTools(): CanonicalToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get a specific tool by name
   */
  getTool(name: string): CanonicalToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool exists
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get tools by category
   */
  getToolsByCategory(category: ToolCategory): CanonicalToolDefinition[] {
    return Array.from(this.tools.values()).filter(tool => tool.category === category);
  }

  /**
   * Get temporary tools
   */
  getTemporaryTools(): AddonToolDefinition[] {
    return this.getToolsByCategory('addon-temporary') as AddonToolDefinition[];
  }

  /**
   * Get persistent tools
   */
  getPersistentTools(): AddonToolDefinition[] {
    return this.getToolsByCategory('addon-persistent') as AddonToolDefinition[];
  }

  /**
   * Get count of tools
   */
  getToolCount(): number {
    return this.tools.size;
  }

  /**
   * Export tools for persistence
   */
  exportTools(): AddonToolDefinition[] {
    return this.getPersistentTools();
  }

  /**
   * Import tools from persistence
   */
  importTools(tools: AddonToolDefinition[]): void {
    tools.forEach(tool => {
      // Only import persistent tools
      if (tool.category === 'addon-persistent') {
        this.tools.set(tool.name, tool);
      }
    });
  }
}

// Export singleton instance
export const addonToolRegistry = new AddonToolRegistry();
