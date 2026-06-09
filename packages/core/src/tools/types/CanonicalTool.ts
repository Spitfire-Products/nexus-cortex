/**
 * Canonical Tool Type Definitions
 *
 * Pure provider-agnostic tool definitions following the principle:
 * "Canonical in storage, provider-specific on the wire, transparent to user"
 *
 * Phase 1: Tool Architecture Refactor
 */

// Import canonical types from @nexus-cortex/types
import type { CanonicalTool as BaseCanonicalTool, ToolSchema, PropertySchema } from '@nexus-cortex/types';

// Re-export for external use
export type { ToolSchema, PropertySchema };
export type CanonicalTool = BaseCanonicalTool;

/**
 * Tool categories for classification
 */
export type ToolCategory =
  | 'base' // Hardcoded core tools (25 tools)
  | 'historical' // Historical context retrieval tools
  | 'addon-temporary' // Runtime-created tools (session only)
  | 'addon-persistent';     // User-saved custom tools

/**
 * Execution environment for tools
 */
export type ExecutionEnvironment =
  | 'client' // Executed by client (trusted code)
  | 'sandbox';              // Executed in sandbox (untrusted code)

/**
 * Extended canonical tool definition with category and execution metadata
 * Extends the existing CanonicalTool with additional fields for registry management
 */
export interface CanonicalToolDefinition extends BaseCanonicalTool {
  /** Tool category for classification */
  category: ToolCategory;

  /** Discovery tier for progressive tool loading (PTC/deferred loading) */
  discoveryTier?: import('@nexus-cortex/types').ToolDiscoveryTier;

  /** Extended metadata (inherits from CanonicalTool.metadata) */
  metadata?: BaseCanonicalTool['metadata'] & {
    /** Whether this tool can be modified/removed */
    immutable?: boolean;

    /** Where this tool executes */
    executionEnvironment?: ExecutionEnvironment;

    /** Tool version */
    version?: string;

    /** Who created this tool (for addon tools) */
    createdBy?: string;

    /** When tool was created (for addon tools) */
    createdAt?: Date;
  };
}

/**
 * Implementation specification for addon tools
 */
export interface ToolImplementation {
  /** Programming language */
  language: 'javascript' | 'python';

  /** Source code for the tool */
  code: string;

  /** Required dependencies (package names) */
  dependencies?: string[];
}

/**
 * Validation results for addon tools
 */
export interface ToolValidation {
  /** Whether the tool has been tested */
  tested: boolean;

  /** Test results if tested */
  testResults?: {
    /** Whether all tests passed */
    passed: boolean;

    /** Error messages if tests failed */
    errors?: string[];

    /** Test execution timestamp */
    executedAt?: Date;
  };
}

/**
 * Extended definition for addon tools
 * Includes implementation and validation
 */
export interface AddonToolDefinition extends CanonicalToolDefinition {
  /** Must be addon category */
  category: 'addon-temporary' | 'addon-persistent';

  /** Tool implementation code */
  implementation: ToolImplementation;

  /** Validation status */
  validation?: ToolValidation;
}

/**
 * Tool registry interface
 * Implemented by BaseToolRegistry and AddonToolRegistry
 */
export interface ToolRegistry {
  /** Get all tools in this registry */
  getAllTools(): CanonicalToolDefinition[];

  /** Get a specific tool by name */
  getTool(name: string): CanonicalToolDefinition | undefined;

  /** Check if a tool exists */
  hasTool(name: string): boolean;

  /** Get tools by category */
  getToolsByCategory(category: ToolCategory): CanonicalToolDefinition[];
}

/**
 * Mutable registry interface for addon tools
 */
export interface MutableToolRegistry extends ToolRegistry {
  /** Register a new tool */
  registerTool(tool: AddonToolDefinition): void;

  /** Remove a tool */
  removeTool(name: string): boolean;

  /** Update an existing tool */
  updateTool(name: string, tool: AddonToolDefinition): boolean;

  /** Clear all tools (temporary tools only) */
  clearTools(persistent?: boolean): void;
}

/**
 * Unified tool factory interface
 */
export interface ToolFactoryInterface {
  /** Get all available tools (base + addon) */
  getAllTools(): CanonicalToolDefinition[];

  /** Get a specific tool by name */
  getTool(name: string): CanonicalToolDefinition | undefined;

  /** Get base tools only */
  getBaseTools(): CanonicalToolDefinition[];

  /** Get addon tools only */
  getAddonTools(): AddonToolDefinition[];

  /** Get historical tools only */
  getHistoricalTools(): CanonicalToolDefinition[];

  /** Register addon tool */
  registerAddonTool(tool: AddonToolDefinition): void;

  /** Remove addon tool */
  removeAddonTool(name: string): boolean;

  /** Check if tool exists */
  hasTool(name: string): boolean;
}
