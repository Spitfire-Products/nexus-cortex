/**
 * ArtifactManifest — canon's SECOND canonical record kind (beside Message).
 *
 * Capability artifacts (skills, agents, MCP configs, plugins) and the intent
 * layer (projects, plans) are versioned document/config BUNDLES, not temporal
 * event streams — they deliberately do NOT use the Message schema
 * (CANON_CROSS_HARNESS_PLAN.md §27p). A manifest records identity, version,
 * blob-addressed content, provenance, and per-harness compatibility; the
 * artifact bytes live in the store's top-level taxonomy dirs and are
 * translated between harnesses by per-kind LAYOUT adapters (skill-dir ↔
 * skill-dir, agent-frontmatter ↔ agent-frontmatter) — never by the gateway
 * Message conversion.
 *
 * plans/projects carry a thin `state` field (doc-snapshot + state — fork 1;
 * NOT a full event log).
 */

export type ArtifactKind = 'skill' | 'agent' | 'mcp' | 'plugin' | 'project' | 'plan';

export interface ArtifactProvenance {
  /** Originating harness or source label (claude-code, nexus-cortex, agents-dir, workspace). */
  harness: string;
  /** Absolute or store-relative path of the native artifact root captured from. */
  native: string;
  /** git blob SHA (12 hex) of the primary content file — content-stable version anchor. */
  ref: string;
}

export interface ArtifactContentEntry {
  /** Artifact-relative file path. */
  path: string;
  /** git blob SHA (12 hex) of the file content (sha1 of "blob <len>\0" + bytes). */
  ref: string;
  bytes: number;
}

export interface ArtifactManifest {
  /** Record-kind discriminator vs canon Message records. */
  recordKind: 'artifact-manifest';
  kind: ArtifactKind;
  /** Stable slug (skill/agent name, config id, project label). */
  id: string;
  /** Content-derived version = the primary file's blob ref (changes iff content changes). */
  version: string;
  name?: string;
  description?: string;
  /** ISO capture time (when this manifest snapshot was taken). */
  timestamp: string;
  /** Artifact-relative path of the defining file (SKILL.md, <agent>.md, config json). */
  primary: string;
  /** Blob-addressed content listing (bytes live under the store taxonomy dir). */
  content: ArtifactContentEntry[];
  provenance: ArtifactProvenance;
  /** Per-harness compatibility, when known. */
  harnessCompat?: Record<string, 'supported' | 'degraded' | 'absent'>;
  /** Per-kind layout-adapter hints (target paths per harness, transform notes). */
  projectionRules?: Record<string, unknown>;
  /** plans/projects only: thin task/status state — doc-snapshot + state, never an event log. */
  state?: Record<string, unknown>;
}
