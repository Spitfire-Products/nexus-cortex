/**
 * Adapters Module
 *
 * Pattern-based tool format adapters for multi-provider support.
 *
 * Phase 1.5: Multi-Provider Architecture
 */

// Interfaces (export specific types to avoid conflict)
export type {
  FormatAdapter,
  CanonicalTool,
  CanonicalToolUse,
  CanonicalToolResult,
  CanonicalMessage,
  CanonicalContentBlock,
  TokenUsage,
  ToolSchema,
  PropertySchema,
  AdapterRegistry as IAdapterRegistry
} from './FormatAdapter.interface.js';
export { NamingConvention } from './FormatAdapter.interface.js';

// Adapter Implementations
export * from './GenerateContentAPIAdapter.js';
export * from './GoogleGenAPIAdapter.js';
export * from './MessagesAPIAdapter.js';
export * from './ChatCompletionsAPIAdapter.js';
export * from './ResponsesAPIAdapter.js';

// Registry
export * from './AdapterRegistry.js';

// Gateway Translation Layer
export * from './GatewayTranslationLayer.js';

// Tool Naming Handler (Week 3 Implementation)
export * from './ToolNamingHandler.js';

// Server-Side Tool Detection (Phase 2.4)
export * from './ServerSideToolDetection.js';
