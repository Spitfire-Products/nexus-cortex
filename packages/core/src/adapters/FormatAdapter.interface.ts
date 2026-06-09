/**
 * FormatAdapter Interface
 *
 * Defines the contract for bidirectional tool format conversion between
 * canonical internal format and provider-specific formats.
 *
 * Phase 1.5: Multi-Provider Architecture
 * Based on: CORTEX_V4_PHASE_1.5_ARCHITECTURE.md
 */

import type {
  CanonicalTool,
  ToolSchema,
  PropertySchema,
  CanonicalToolUse,
  CanonicalToolResult,
  CanonicalContentBlock,
  TokenUsage,
  CanonicalMessage,
  FormatAdapter,
  AdapterRegistry,
  ModelConfig
} from '@nexus-cortex/types';

// Re-export for backward compatibility
export type {
  CanonicalTool,
  ToolSchema,
  PropertySchema,
  CanonicalToolUse,
  CanonicalToolResult,
  CanonicalContentBlock,
  TokenUsage,
  CanonicalMessage,
  FormatAdapter,
  AdapterRegistry,
  ModelConfig
};

/**
 * Naming Convention Utilities
 *
 * Convert between snake_case and PascalCase.
 */
export class NamingConvention {
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
  static toSnakeCase(str: string): string {
    return str
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '');
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
  static toPascalCase(str: string): string {
    return str
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');
  }

  /**
   * Convert tool name based on convention
   *
   * @param name - Tool name
   * @param convention - Target convention
   * @returns Converted name
   */
  static convertToolName(
    name: string,
    convention: 'snake_case' | 'PascalCase'
  ): string {
    return convention === 'snake_case'
      ? this.toSnakeCase(name)
      : this.toPascalCase(name);
  }

  /**
   * Convert all tool names in schema
   *
   * @param tools - Canonical tools
   * @param convention - Target convention
   * @returns Tools with converted names
   */
  static convertToolNames(
    tools: CanonicalTool[],
    convention: 'snake_case' | 'PascalCase'
  ): CanonicalTool[] {
    return tools.map(tool => ({
      ...tool,
      name: this.convertToolName(tool.name, convention),
      metadata: {
        ...tool.metadata,
        originalNaming: this.detectConvention(tool.name)
      }
    }));
  }

  /**
   * Detect naming convention used
   *
   * @param str - String to analyze
   * @returns Detected convention
   */
  static detectConvention(str: string): 'snake_case' | 'PascalCase' {
    return str.includes('_') ? 'snake_case' : 'PascalCase';
  }
}

