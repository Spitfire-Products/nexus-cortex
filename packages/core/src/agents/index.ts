/**
 * Agent Management Module
 *
 * Exports for managing Task Agent profiles
 */

export {
  AgentStore,
  createAgentStore,
  type AgentStoreConfig,
  type CreateAgentOptions,
} from './AgentStore.js';

export { resolveProjectAgentsDir } from './projectRoot.js';

// Re-export AgentDefinition from orchestrator for convenience
export type { AgentDefinition } from '../orchestrator/SubAgentTypes.js';
