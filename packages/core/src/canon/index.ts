/**
 * Canon — the canonical agent history & memory store pipeline.
 *
 * The implementation lives in the standalone `nexus-canon` package (Phase C
 * part 3 extraction); core re-exports it so the harness surface is unchanged
 * and the one-implementation rule holds: the cortex CLI, cron wrappers, and
 * standalone `nexus-canon` users all run the same code.
 * Spec: docs/CANON.md. Plan: CANON_CROSS_HARNESS_PLAN.md.
 *
 * @module canon
 */
export * from 'nexus-canon';
