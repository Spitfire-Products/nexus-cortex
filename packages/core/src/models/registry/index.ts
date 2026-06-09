/**
 * Model Registry Module
 * Exports modular registry components
 */

export { ModelCardLoader, type ModelCardLoaderOptions } from './ModelCardLoader.js';
export { ModularModelRegistry, type ModularModelRegistryOptions } from './ModularModelRegistry.js';

// Model Alias Resolver (Sub-Agent System)
export {
  ModelAliasResolver,
  MODEL_ALIASES,
  getDefaultResolver,
  resolveModelAlias,
  type ResolvedModel,
  type ResolveOptions,
} from './ModelAliasResolver.js';
