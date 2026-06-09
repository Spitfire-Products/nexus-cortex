/**
 * ResearchBacklog tool — agent-facing interface to the recursive auto-research
 * deficiency lifecycle (core `ResearchBacklog`). During benchmarking, the harness
 * AUTO-ADDS every deficiency it finds, triages it (priority computed on add), and
 * walks it through open → triaged → in_progress → fixed → verified → closed.
 *
 * OVERFITTING GUARD: `fixed` (passes the discovery task) is NOT `verified`
 * (also holds on held-out tasks). Only call `verified` after held-out confirmation.
 */

import { BaseTool, type ToolResult } from '../../base/index.js';
import { ResearchBacklog, type Severity } from '@nexus-cortex/core';

export interface ResearchBacklogParams {
  action: 'add' | 'triage' | 'list' | 'next' | 'in_progress' | 'fixed' | 'verified' | 'close' | 'wont_fix' | 'regressed';
  // add / triage
  title?: string;
  description?: string;
  bugClass?: string;
  severity?: Severity;
  impact?: number;
  effort?: number;
  confidence?: number;
  discoveredRound?: string;
  affectedModels?: string[];
  // id-targeted ops
  id?: string;
  experimentTag?: string;   // in_progress
  ref?: string;             // fixed → commit; verified → held-out round; wont_fix → reason
  // list filter
  status?: string;
}

export class ResearchBacklogToolExecutor extends BaseTool<ResearchBacklogParams, ToolResult> {
  private backlog: ResearchBacklog;

  constructor(config: { workingDirectory: string }) {
    super('ResearchBacklog', 'ResearchBacklog', 'Track & triage harness deficiencies for recursive auto-research', {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['add', 'triage', 'list', 'next', 'in_progress', 'fixed', 'verified', 'close', 'wont_fix', 'regressed'],
          description: "add (auto-triages on add) | triage | list | next (highest-priority open item) | in_progress | fixed (passes discovery task) | verified (held-out confirmed — overfitting-cleared) | close | wont_fix | regressed",
        },
        title: { type: 'string', description: 'add: short deficiency title (also the dedupe key)' },
        description: { type: 'string', description: 'add: what is wrong + how it was found' },
        bugClass: { type: 'string', description: 'Adapter | Streaming | Caching | Loop control | Routing | Config | Model card | State | Infrastructure | TUI | Other' },
        severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        impact: { type: 'number', description: '1-5: how much it degrades the harness' },
        effort: { type: 'number', description: '1-5: estimated fix cost' },
        confidence: { type: 'number', description: '0-1: how sure it is a real deficiency (not model noise)' },
        discoveredRound: { type: 'string' },
        affectedModels: { type: 'array', items: { type: 'string' } },
        id: { type: 'string', description: 'target deficiency id (for triage/lifecycle ops)' },
        experimentTag: { type: 'string', description: 'in_progress: the worktree experiment tag' },
        ref: { type: 'string', description: 'fixed: commit SHA · verified: held-out round · wont_fix: reason' },
        status: { type: 'string', description: 'list: filter by status' },
      },
      required: ['action'],
    });
    this.backlog = new ResearchBacklog(config.workingDirectory || process.env.PROJECT_ROOT || process.cwd());
  }

  validateToolParams(p: ResearchBacklogParams): string | null {
    if (!p.action) return 'action is required';
    if (p.action === 'add' && (!p.title || !p.description)) return 'add requires title and description';
    if (['triage', 'in_progress', 'fixed', 'verified', 'close', 'wont_fix', 'regressed'].includes(p.action) && !p.id) {
      return `${p.action} requires an id (use action:list to find it)`;
    }
    return null;
  }

  async execute(params: ResearchBacklogParams): Promise<ToolResult> {
    const err = this.validateToolParams(params);
    if (err) return this.createErrorResult(err);
    try {
      const fmt = (r: unknown) => JSON.stringify(r, null, 2);
      switch (params.action) {
        case 'add':
          return this.createSuccessResult(fmt(this.backlog.add({
            title: params.title!, description: params.description!, bugClass: params.bugClass,
            severity: params.severity, impact: params.impact, effort: params.effort, confidence: params.confidence,
            discoveredRound: params.discoveredRound, affectedModels: params.affectedModels,
          })));
        case 'triage':
          return this.resultOr(this.backlog.triage(params.id!, {
            severity: params.severity, impact: params.impact, effort: params.effort, confidence: params.confidence,
          }), params.id!);
        case 'list': {
          const items = this.backlog.list({ status: params.status as any });
          return this.createSuccessResult(`${items.length} deficiencies (by priority):\n${fmt(items)}`);
        }
        case 'next': {
          const n = this.backlog.next();
          return this.createSuccessResult(n ? fmt(n) : 'No open/triaged deficiencies in the backlog.');
        }
        case 'in_progress':
          return this.resultOr(this.backlog.markInProgress(params.id!, params.experimentTag ?? 'untagged'), params.id!);
        case 'fixed':
          return this.resultOr(this.backlog.markFixed(params.id!, params.ref ?? ''), params.id!);
        case 'verified':
          return this.resultOr(this.backlog.markVerified(params.id!, params.ref ?? ''), params.id!);
        case 'close':
          return this.resultOr(this.backlog.close(params.id!), params.id!);
        case 'wont_fix':
          return this.resultOr(this.backlog.wontFix(params.id!, params.ref ?? 'no reason given'), params.id!);
        case 'regressed':
          return this.resultOr(this.backlog.reopenRegressed(params.id!), params.id!);
        default:
          return this.createErrorResult(`Unknown action: ${params.action}`);
      }
    } catch (e) {
      return this.createErrorResult(e instanceof Error ? e : String(e));
    }
  }

  private resultOr(rec: unknown, id: string): ToolResult {
    return rec
      ? this.createSuccessResult(JSON.stringify(rec, null, 2))
      : this.createErrorResult(`No deficiency with id "${id}" (use action:list).`);
  }
}
