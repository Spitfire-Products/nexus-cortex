/**
 * nexus-canon — portable agent memory in a git repo you own.
 *
 * The canonical agent history & memory store pipeline, standalone:
 * init (scaffold) → sync (native harness sessions → store, secret-scrubbed) →
 * translate (native → canonical line + projections, deterministic/incremental)
 * → list/pull (rehydrate anywhere) + artifacts (capability manifests) + graph
 * (project-scoped knowledge graphs). Dependency-free (Node built-ins; the
 * canonical record types come from @nexus-cortex/types — one type authority,
 * the format never forks). The nexus-cortex harness re-exports this package —
 * the CLI, any cron, and standalone users run ONE implementation.
 *
 * Spec: https://github.com/Spitfire-Products/nexus-cortex/blob/main/docs/CANON.md
 */
export { canonInit } from './canonInit.js';
export type { CanonInitOptions, CanonInitResult } from './canonInit.js';
export { canonSync } from './canonSync.js';
export type { CanonSyncOptions, CanonSyncResult } from './canonSync.js';
export { canonTranslate } from './canonTranslate.js';
export type { CanonTranslateOptions, CanonTranslateResult } from './canonTranslate.js';
export { canonList, canonPull, discoverCanonSessions } from './canonPull.js';
export type { CanonStoreOptions, CanonSession, CanonPullOptions, CanonPullResult } from './canonPull.js';
export { canonArtifacts } from './canonArtifacts.js';
export type { CanonArtifactsOptions, CanonArtifactsResult } from './canonArtifacts.js';
export { canonGraph, deriveProjectSessionMap, sessionProject } from './canonGraph.js';
export type { CanonGraphOptions, CanonGraphResult, ProjectEntry } from './canonGraph.js';
export { CANON_VERIFY_MJS, GITATTRIBUTES, STORE_DIRS, STORE_README, VERIFY_YML } from './scaffoldAssets.js';
