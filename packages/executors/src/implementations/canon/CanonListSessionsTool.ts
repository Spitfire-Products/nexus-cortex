/**
 * CanonListSessions Tool Executor
 *
 * Lists sessions in the CANON STORE — the cross-harness, git-backed agent
 * memory rail. Thin wrapper over the graduated nexus-canon `canonList`
 * (re-exported by @nexus-cortex/core); no new logic here.
 */

import { BaseTool, type ToolResult } from '../../base/index.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';
import {
  canonList,
  discoverCanonSessions,
  deriveProjectSessionMap,
  sessionProject,
  type CanonSession,
} from '@nexus-cortex/core';
import { mutedConsole } from './mutedConsole.js';

export interface CanonListSessionsToolParams {
  /** Include small sessions (<4KB) normally filtered as noise */
  all?: boolean;
  /** Restrict to one project id (as derived by the canon project map) */
  project?: string;
  /** Maximum number of sessions to return (newest last; default 50) */
  limit?: number;
}

export class CanonListSessionsToolExecutor extends BaseTool<
  CanonListSessionsToolParams,
  ToolResult
> {
  constructor(private config: ExecutorConfig) {
    super(
      'CanonListSessions',
      'CanonListSessions',
      `List prior agent sessions in the canon store — the portable cross-harness memory rail that captures sessions from EVERY harness (this one, Claude Code, the browser agent, grok, gemini) in a git repo.

Use this tool to:
- Discover prior sessions relevant to the current work (any harness, any machine)
- Recover context after a compaction or on a fresh environment
- Find the session uuid to materialize with CanonPullSession

Each row: uuid, size, origin harness, recovered title. Requires a configured canon store (CANON_REPO/CANON_STORE environment; hosted sessions have this set automatically when the user saved a canon connection).`,
      {
        type: 'object',
        properties: {
          all: {
            type: 'boolean',
            description: 'Include small sessions (<4KB) normally filtered out',
            default: false,
          },
          project: {
            type: 'string',
            description: 'Restrict to one project id from the canon project map',
          },
          limit: {
            type: 'number',
            description: 'Maximum sessions to return',
            default: 50,
          },
        },
      }
    );
  }

  validateToolParams(_params: CanonListSessionsToolParams): string | null {
    return null;
  }

  async execute(
    params: CanonListSessionsToolParams,
    signal: AbortSignal
  ): Promise<ToolResult> {
    const startTime = Date.now();
    try {
      const store = process.env.CANON_STORE || undefined;
      const repoUrl = process.env.CANON_REPO || undefined;

      let sessions: CanonSession[];
      if (params.project) {
        // Project-scoped listing mirrors the CLI: derived map + local discovery
        // (assumes the store exists; the unscoped branch clones/pulls it).
        const resolvedStore = store ?? '/tmp/canon-store';
        const projects = deriveProjectSessionMap(resolvedStore);
        if (!projects[params.project]) {
          return {
            ...this.createErrorResult(
              `Unknown project '${params.project}' — known: ${Object.keys(projects).sort().join(', ') || '(none)'}`
            ),
            metadata: { executionTime: Date.now() - startTime },
          };
        }
        sessions = discoverCanonSessions(resolvedStore)
          .filter((s) => sessionProject(projects, s) === params.project)
          .filter((s) => params.all || s.bytes > 4096);
      } else {
        // canonList clones/pulls the store and prints a table — mute the
        // console so the listing reaches the model only via the tool result.
        sessions = await mutedConsole(() => canonList({ store, repoUrl, all: params.all }));
      }

      if (signal.aborted) {
        return {
          ...this.createErrorResult('Canon listing was cancelled'),
          metadata: { executionTime: Date.now() - startTime },
        };
      }

      const limit = params.limit && params.limit > 0 ? params.limit : 50;
      const shown = sessions.slice(-limit);
      return {
        ...this.createSuccessResult(this.formatSessions(shown, sessions.length)),
        metadata: {
          executionTime: Date.now() - startTime,
          sessionCount: sessions.length,
          shown: shown.length,
        },
      };
    } catch (error: any) {
      return {
        ...this.createErrorResult(
          `Failed to list canon sessions: ${error.message}. ` +
          'A canon store must be configured (CANON_REPO env or an existing CANON_STORE clone).'
        ),
        metadata: { executionTime: Date.now() - startTime, error: error.message },
      };
    }
  }

  private formatSessions(shown: CanonSession[], total: number): string {
    if (total === 0) return 'No canon sessions found in the store.';
    const lines: string[] = [];
    lines.push(`=== Canon store sessions (${shown.length} of ${total}) ===\n`);
    for (const s of shown) {
      const kb = (s.bytes / 1024).toFixed(0).padStart(7);
      lines.push(`${s.uuid}  ${kb}KB  ${s.harness.padEnd(14)} ${s.title ?? ''}`.trimEnd());
    }
    lines.push('');
    lines.push('Use CanonPullSession with a uuid (or unique prefix) to materialize one locally.');
    return lines.join('\n');
  }
}
