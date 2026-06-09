/**
 * Node.js Runtime Adapters
 *
 * Thin wrappers around existing Node.js services (JSONLHistoryStore,
 * SettingsLoader, ExecutorRegistry, PermissionsMiddleware) that implement
 * the runtime-agnostic interfaces from packages/core/src/interfaces/.
 *
 * These adapters enable the browser runtime to swap in different
 * implementations (IndexedDB, fetch, DOM APIs) while the Node.js
 * path continues using the existing concrete services.
 *
 * @module adapters/node
 */

export { NodeConfigProvider } from './NodeConfigProvider.js';
export { NodeHistoryStoreAdapter } from './NodeHistoryStoreAdapter.js';
export { NodeToolExecutorAdapter } from './NodeToolExecutorAdapter.js';
export { NodePermissionAdapter } from './NodePermissionAdapter.js';
