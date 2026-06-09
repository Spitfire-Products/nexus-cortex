/**
 * Tools Module - Public API
 *
 * Unified exports for the new canonical tool system.
 * Use ToolFactory as the primary interface for accessing tools.
 */

// Types
export type {
  PropertySchema,
  ToolSchema,
  ToolCategory,
  ExecutionEnvironment,
  CanonicalToolDefinition,
  ToolImplementation,
  ToolValidation,
  AddonToolDefinition,
  ToolRegistry,
  MutableToolRegistry,
  ToolFactoryInterface
} from './types/index.js';

// Registries (for advanced use cases)
export { BaseToolRegistry, baseToolRegistry } from './registries/BaseToolRegistry.js';
export { AddonToolRegistry, addonToolRegistry } from './registries/AddonToolRegistry.js';

// Factory (primary interface)
export { ToolFactory, toolFactory } from './ToolFactory.js';

// Note: ExecutorRegistry moved to @nexus-cortex/executors package (Phase 2.5)
// Import from '@nexus-cortex/executors' instead

export * from './historical/index.js';

// MCP Management Tools (Phase 2.6)
export * from './mcp-management/index.js';

// Context Management Tools (CORTEX.md generation)
export * from './context-management/index.js';

// PTC / Progressive Tool Loading
export { ClientSideToolFilter } from './ClientSideToolFilter.js';
