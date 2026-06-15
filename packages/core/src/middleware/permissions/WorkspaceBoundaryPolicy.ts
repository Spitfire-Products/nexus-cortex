/**
 * Workspace Boundary Policy
 *
 * Enforces the project-root boundary as an APPROVAL-GATED permission (not a hard
 * wall). When a file/shell tool targets a path OUTSIDE the project root and any
 * user-granted --add-dir directories, this returns `deny(..., canApprove: true)`.
 * The PermissionsMiddleware then routes it through the approval system:
 *   - interactive (CLIApprovalHandler): the user is prompted to allow/deny;
 *   - --yolo (AutoApproveHandler): auto-approved (bypassAll short-circuits earlier);
 *   - headless / deny-all: denied, and the model receives the explain-why reason.
 *
 * The deny reason explicitly instructs the model to explain to the user WHY it
 * needs to cross the project boundary — so the human has context to decide.
 *
 * This replaces the old in-tool hard rejects (which could not trigger a prompt).
 * Lives in core (no import from executors) so it self-contains the within-roots check.
 */

import * as path from 'node:path';
import type {
  PermissionDecision,
  PermissionContext,
} from '../contracts/MiddlewareContracts.js';
import { BasePermissionPolicy } from './PermissionPolicy.js';

/**
 * Priority must sit ABOVE the whitelist (CRITICAL=100) so the boundary is
 * evaluated BEFORE a tool like Read is whitelisted as a "safe research op" —
 * otherwise the whitelist's tier-allow returns first and the boundary never
 * runs. Kept BELOW the blacklist (1000) so genuinely-dangerous ops still
 * hard-deny first. The policy abstains (allow without tier) on in-bounds paths,
 * so lower-priority policies (whitelist/graylist write-approval) still apply.
 */
const BOUNDARY_PRIORITY = 500;

/** Tools whose path arguments are subject to the workspace boundary. */
const PATH_FIELD_BY_TOOL: Record<string, string[]> = {
  Read: ['file_path', 'path'],
  Write: ['file_path', 'path'],
  Edit: ['file_path', 'path'],
  MultiEdit: ['file_path', 'path'],
  WriteBinary: ['file_path', 'path'],
  Glob: ['path'],
  Grep: ['path'],
  // Shell/Bash: only the explicit working-directory param is gated here. The
  // command string itself is the BashCommandPolicy's concern, not this one.
  Bash: ['directory'],
  Shell: ['directory'],
};

export class WorkspaceBoundaryPolicy extends BasePermissionPolicy {
  private readonly roots: string[];

  /**
   * @param allowedRoots Absolute roots the tools may freely touch — the project
   *   working directory first, then any --add-dir grants. Empty = boundary off.
   */
  constructor(allowedRoots: string[], priority: number = BOUNDARY_PRIORITY, enabled: boolean = true) {
    super('workspace-boundary', priority, enabled);
    this.roots = (allowedRoots || []).filter(Boolean).map((r) => path.resolve(r));
  }

  async evaluate(context: PermissionContext): Promise<PermissionDecision> {
    if (this.roots.length === 0) return this.allow();

    const fields = PATH_FIELD_BY_TOOL[context.toolName];
    if (!fields) return this.allow();

    const input: any = context.toolInput || {};
    const workingDir = this.roots[0] ?? process.cwd();

    for (const field of fields) {
      const raw = input[field];
      if (typeof raw !== 'string' || raw.length === 0) continue;

      const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(workingDir, raw);
      if (!this.isWithinRoots(resolved)) {
        return this.deny(this.boundaryReason(context.toolName, raw, resolved), true /* canApprove */);
      }
    }

    return this.allow();
  }

  private isWithinRoots(resolved: string): boolean {
    for (const root of this.roots) {
      if (resolved === root || resolved.startsWith(root + path.sep)) return true;
    }
    return false;
  }

  private boundaryReason(toolName: string, requested: string, resolved: string): string {
    return (
      `PERMISSION REQUIRED: "${requested}" (resolved: ${resolved}) is OUTSIDE the project ` +
      `directory (${this.roots[0]}). Crossing the project boundary needs the user's approval.\n` +
      `Before retrying: tell the user the exact path you need and EXPLAIN WHY you need to leave ` +
      `the project directory, so they can decide. They will be asked to approve; if they approve, ` +
      `the ${toolName} proceeds. The user can also pre-grant access with \`--add-dir <dir>\`, or ` +
      `run with --yolo to auto-approve. Do NOT keep retrying the same path without first explaining why.`
    );
  }
}
