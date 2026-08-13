/**
 * CanonPullSession Tool Executor
 *
 * Materializes one canon-store session into the local session directory so it
 * can be read or resumed. Thin wrapper over the graduated nexus-canon
 * `canonPull` (re-exported by @nexus-cortex/core); no new logic here.
 */

import { BaseTool, type ToolResult } from '../../base/index.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';
import { canonPull } from '@nexus-cortex/core';
import { mutedConsole } from './mutedConsole.js';

export interface CanonPullSessionToolParams {
  /** Canon session uuid, or a unique prefix of one */
  session: string;
  /** Destination directory (defaults to this harness's session storage) */
  to?: string;
  /** Overwrite an existing local copy (resuming elsewhere is a branch) */
  force?: boolean;
  /**
   * Convert thinking blocks to plain <prior_reasoning> text in the local COPY.
   * Needed when the session originated under a different provider account —
   * thinking signatures only validate against the originating account.
   */
  stripSignatures?: boolean;
}

export class CanonPullSessionToolExecutor extends BaseTool<
  CanonPullSessionToolParams,
  ToolResult
> {
  constructor(private config: ExecutorConfig) {
    super(
      'CanonPullSession',
      'CanonPullSession',
      `Materialize a prior agent session from the canon store into the local session directory — the cross-harness "pull my history here" move.

Use this tool to:
- Rehydrate a prior session's full transcript for context (any harness's session: this one, Claude Code, browser agent, grok, gemini)
- Continue work started on another machine or surface
- Recover after a compaction by pulling the pre-compaction record

Find uuids with CanonListSessions first. The pulled file lands in the session directory (resumable when it originated in this harness; readable context otherwise). Set stripSignatures when pulling a session recorded under a DIFFERENT provider account.`,
      {
        type: 'object',
        properties: {
          session: {
            type: 'string',
            description: 'Canon session uuid or unique prefix',
          },
          to: {
            type: 'string',
            description: 'Destination directory (default: the local session storage dir)',
          },
          force: {
            type: 'boolean',
            description: 'Overwrite an existing local copy',
            default: false,
          },
          stripSignatures: {
            type: 'boolean',
            description: 'Convert thinking blocks to plain text in the copy (foreign-account replay safety)',
            default: false,
          },
        },
        required: ['session'],
      }
    );
  }

  validateToolParams(params: CanonPullSessionToolParams): string | null {
    if (!params.session || typeof params.session !== 'string') {
      return 'session (uuid or unique prefix) is required';
    }
    return null;
  }

  async execute(
    params: CanonPullSessionToolParams,
    signal: AbortSignal
  ): Promise<ToolResult> {
    const startTime = Date.now();
    try {
      const store = process.env.CANON_STORE || undefined;
      const repoUrl = process.env.CANON_REPO || undefined;
      // Default destination = this harness's real session storage, NOT
      // canonPull's built-in default (a dev-repl-specific path).
      const to = params.to || this.config.storageDir || '.cortex/sessions';

      // canonPull reports through console (incl. not-found/ambiguous via
      // console.error) — capture it so the result carries the detail.
      const { result, output } = await mutedConsole(
        () => canonPull({
          session: params.session,
          to,
          force: params.force,
          stripSignatures: params.stripSignatures,
          store,
          repoUrl,
          target: 'nexus-cortex',
        }),
        { captureOutput: true }
      );

      if (signal.aborted) {
        return {
          ...this.createErrorResult('Canon pull was cancelled'),
          metadata: { executionTime: Date.now() - startTime },
        };
      }

      if (result.code !== 0) {
        return {
          ...this.createErrorResult(
            `Canon pull failed: ${output.trim() || 'not found / ambiguous / exists (use force to overwrite)'}`
          ),
          metadata: { executionTime: Date.now() - startTime, dest: result.dest },
        };
      }

      const s = result.session;
      const summary = [
        `Materialized canon session ${s?.uuid ?? params.session}`,
        s ? `  origin: ${s.harness}${s.title ? ` — "${s.title}"` : ''}  (${(s.bytes / 1024).toFixed(0)}KB)` : '',
        `  file: ${result.dest}`,
        s?.harness === 'nexus-cortex'
          ? `  resumable here: cortex --resume ${s.uuid} "..."`
          : '  foreign-harness session: read the file for context (not directly resumable here)',
        output.includes('tool capsule') ? '  a .tools.md compatibility capsule was written next to it' : '',
      ].filter(Boolean).join('\n');

      return {
        ...this.createSuccessResult(summary),
        metadata: {
          executionTime: Date.now() - startTime,
          dest: result.dest,
          harness: s?.harness,
          bytes: s?.bytes,
        },
      };
    } catch (error: any) {
      return {
        ...this.createErrorResult(
          `Failed to pull canon session: ${error.message}. ` +
          'A canon store must be configured (CANON_REPO env or an existing CANON_STORE clone).'
        ),
        metadata: { executionTime: Date.now() - startTime, error: error.message },
      };
    }
  }
}
