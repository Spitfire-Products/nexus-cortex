/**
 * Canon — the canonical agent history & memory store's local-first pipeline
 * (sync → translate → pull), graduated from scripts/canon/ at Phase C part 2.
 * One implementation serves the cron wrappers and the `cortex canon` CLI.
 * Spec: docs/CANON.md. Plan: CANON_CROSS_HARNESS_PLAN.md.
 *
 * @module canon
 */
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
