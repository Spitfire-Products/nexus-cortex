/**
 * Tool Naming Handler
 *
 * Handles naming convention conversion for tools at the gateway layer.
 * This separates naming concerns from API format conversion, allowing
 * adapters to focus solely on API-specific formats.
 *
 * Phase 1.5: Multi-Provider Architecture
 * Week 3: Tool Naming Handler Implementation
 *
 * Architecture Principle:
 * - Gateway handles naming conversion
 * - Adapters handle API format conversion
 * - Separation of concerns for maintainability
 */

import { CanonicalTool, CanonicalToolUse, CanonicalToolResult } from './FormatAdapter.interface.js';

/**
 * Tool Naming Handler
 *
 * Applies naming conventions to tools before they are passed to adapters.
 * This ensures adapters receive tools with the correct naming for their API pattern.
 */
export class ToolNamingHandler {
  // R16 (Opus parallel-bench): convertName recomputed snake/Pascal on every
  // call. Memoized by `${convention}:${name}` — shared across instances.
  static convertNameCache = new Map<string, string>();

  /**
   * Apply naming convention to tools
   *
   * Converts tool names from canonical format to the specified convention.
   * This should be called by the gateway BEFORE passing tools to adapters.
   *
   * @param tools - Canonical tools with any naming
   * @param convention - Target naming convention
   * @returns Tools with converted names
   */
  applyNamingConvention(
    tools: CanonicalTool[],
    convention: 'snake_case' | 'PascalCase'
  ): CanonicalTool[] {
    return tools.map(tool => ({
      ...tool,
      name: this.convertName(tool.name, convention)
    }));
  }

  /**
   * Apply naming convention to tool use
   *
   * Converts tool use names to match the specified convention.
   *
   * @param toolUse - Tool use with any naming
   * @param convention - Target naming convention
   * @returns Tool use with converted name
   */
  applyNamingToToolUse(
    toolUse: CanonicalToolUse,
    convention: 'snake_case' | 'PascalCase'
  ): CanonicalToolUse {
    return {
      ...toolUse,
      name: this.convertName(toolUse.name, convention)
    };
  }

  /**
   * Apply naming convention to tool result
   *
   * Note: Tool results reference tools by ID, not name, so no conversion needed.
   * This method is provided for API consistency but returns the result unchanged.
   *
   * @param toolResult - Tool result
   * @param convention - Target naming convention (unused)
   * @returns Tool result unchanged
   */
  applyNamingToToolResult(
    toolResult: CanonicalToolResult,
    _convention: 'snake_case' | 'PascalCase'
  ): CanonicalToolResult {
    // Tool results reference tools by ID, not name
    // No naming conversion needed
    return toolResult;
  }

  /**
   * Convert a single name to the specified convention
   *
   * @param name - Name to convert
   * @param convention - Target convention
   * @returns Converted name
   */
  convertName(
    name: string,
    convention: 'snake_case' | 'PascalCase'
  ): string {
    // MCP-namespaced names (`<server>__<tool>`) are already qualified by the
    // server; their case and shape come from the external server's protocol.
    // Do NOT case-convert them — the existing converters mangle the prefix
    // (e.g. PascalCase: `nexus-browser__browse` → `Nexus-browserBrowse`).
    const cacheKey = `${convention}:${name}`;
    const cached = ToolNamingHandler.convertNameCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const result = this.isMcpNamespacedName(name)
      ? name
      : convention === 'snake_case'
        ? this.toSnakeCase(name)
        : this.toPascalCase(name);
    ToolNamingHandler.convertNameCache.set(cacheKey, result);
    return result;
  }

  /**
   * Detect names of the form `<server>__<tool>` where both halves are
   * non-empty and the server-name half doesn't itself look like a
   * doubly-underscored native identifier (which would be `read__file` and
   * is handled by the regular conversion path).
   */
  private isMcpNamespacedName(name: string): boolean {
    const idx = name.indexOf('__');
    if (idx <= 0) return false;
    const left = name.slice(0, idx);
    const right = name.slice(idx + 2);
    if (!left || !right) return false;
    // The server half typically contains a hyphen or other non-snake char,
    // distinguishing it from an accidental `read__file` style identifier.
    // Accept any non-empty left/right pair where the LEFT half contains a
    // character that wouldn't appear in a native PascalCase / snake_case
    // identifier (hyphens, dots, etc.).
    return /[^a-zA-Z0-9_]/.test(left);
  }

  /**
   * Convert string to snake_case
   *
   * @param str - Input string
   * @returns snake_case version
   *
   * @example
   * toSnakeCase('ReadFile') → 'read_file'
   * toSnakeCase('readFile') → 'read_file'
   * toSnakeCase('read_file') → 'read_file'
   */
  private toSnakeCase(str: string): string {
    // Handle already snake_case
    if (this.isSnakeCase(str)) {
      return str;
    }

    // Convert from PascalCase or camelCase
    return str
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '') // Remove leading underscore if present
      .replace(/_+/g, '_'); // Collapse multiple underscores
  }

  /**
   * Convert string to PascalCase
   *
   * @param str - Input string
   * @returns PascalCase version
   *
   * @example
   * toPascalCase('read_file') → 'ReadFile'
   * toPascalCase('ReadFile') → 'ReadFile'
   * toPascalCase('readFile') → 'ReadFile'
   */
  private toPascalCase(str: string): string {
    // Handle already PascalCase
    if (this.isPascalCase(str)) {
      return str;
    }

    // Convert from snake_case
    if (str.includes('_')) {
      return str
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join('');
    }

    // Convert from camelCase
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Check if string is in snake_case format
   *
   * @param str - String to check
   * @returns true if snake_case
   */
  private isSnakeCase(str: string): boolean {
    return /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(str);
  }

  /**
   * Check if string is in PascalCase format
   *
   * @param str - String to check
   * @returns true if PascalCase
   */
  private isPascalCase(str: string): boolean {
    return /^[A-Z][a-zA-Z0-9]*$/.test(str) && !str.includes('_');
  }

  /**
   * Detect the current naming convention of a string
   *
   * @param str - String to analyze
   * @returns Detected convention or 'unknown'
   */
  detectConvention(str: string): 'snake_case' | 'PascalCase' | 'camelCase' | 'unknown' {
    if (this.isSnakeCase(str)) {
      return 'snake_case';
    }
    if (this.isPascalCase(str)) {
      return 'PascalCase';
    }
    if (/^[a-z][a-zA-Z0-9]*$/.test(str)) {
      return 'camelCase';
    }
    return 'unknown';
  }

  /**
   * Validate that tools have the correct naming convention
   *
   * @param tools - Tools to validate
   * @param expectedConvention - Expected naming convention
   * @returns Validation result with any errors
   */
  validateNaming(
    tools: CanonicalTool[],
    expectedConvention: 'snake_case' | 'PascalCase'
  ): {
    valid: boolean;
    errors?: string[];
  } {
    const errors: string[] = [];

    for (const tool of tools) {
      const currentConvention = this.detectConvention(tool.name);

      if (expectedConvention === 'snake_case' && currentConvention !== 'snake_case') {
        errors.push(
          `Tool "${tool.name}" is not in snake_case format (detected: ${currentConvention})`
        );
      } else if (expectedConvention === 'PascalCase' && currentConvention !== 'PascalCase') {
        errors.push(
          `Tool "${tool.name}" is not in PascalCase format (detected: ${currentConvention})`
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined
    };
  }
}