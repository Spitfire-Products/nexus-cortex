/**
 * PermissionProfileStore
 *
 * File-backed read/modify/write for permission profile JSON
 * (`.cortex/permissions.<profile>.json`). This is the only mechanism that
 * persists permission changes for the headless CLI — the orchestrator loads
 * these files at startup via PermissionConfigLoader, so editing them durably
 * grants/revokes tools across invocations.
 *
 * Serialization matches exactly what PermissionConfigLoader.createPolicy()
 * expects:
 *   - whitelist: { type:'whitelist', config:{ allowedTools: string[] }, priority }
 *   - blacklist: { type:'blacklist', config:{ blockedTools: string[] }, priority }
 *
 * Priorities mirror the in-memory policies OrchestratorClient previously
 * registered (WhitelistPolicy priority 40, BlacklistPolicy priority 100) so
 * file-backed and runtime behavior agree.
 */
import * as fs from 'fs';
import * as path from 'path';
import { type PermissionProfileName } from './profilePath.js';

/** Priority for a grant (whitelist) — matches the prior in-memory registration. */
export const GRANT_PRIORITY = 40;
/** Priority for a revoke (blacklist) — matches the prior in-memory registration. */
export const REVOKE_PRIORITY = 100;

export interface ProfilePolicyEntry {
  type: 'whitelist' | 'blacklist' | 'file-operation' | 'bash-command' | 'custom';
  config: Record<string, unknown>;
  priority?: number;
  enabled?: boolean;
}

export interface PermissionProfile {
  $comment?: string;
  enabled: boolean;
  defaultPolicy: 'allow' | 'deny';
  policies: ProfilePolicyEntry[];
  approvalHandler?: string;
  auditLog?: { enabled: boolean; path: string };
}

/** A flattened policy summary for display (matches the CLI's render shape). */
export interface ProfilePolicySummary {
  name: string;
  priority: number | null;
  enabled: boolean;
  tools: string[];
}

function skeleton(): PermissionProfile {
  return {
    enabled: true,
    defaultPolicy: 'allow',
    policies: [],
    approvalHandler: 'auto-approve',
  };
}

/**
 * Path the store reads/writes: the PROJECT-level profile file only. We
 * deliberately do NOT consult the global `~/.cortex` fallback that
 * resolvePermissionProfilePath() uses for startup READS — a `cortex permissions
 * grant` in one project must never silently mutate the user's global profile.
 * Prefers an existing project file (dotted or subdir form); defaults to the
 * dotted form when none exists yet.
 */
export function resolveWriteTarget(
  projectRoot: string,
  profile: PermissionProfileName,
): string {
  const dotted = path.join(projectRoot, '.cortex', `permissions.${profile}.json`);
  if (fs.existsSync(dotted)) return dotted;
  const sub = path.join(projectRoot, '.cortex', 'permissions', `${profile}.json`);
  if (fs.existsSync(sub)) return sub;
  return dotted;
}

/** Read the project-level profile, returning a skeleton if no file exists yet. */
export function readProfile(
  projectRoot: string,
  profile: PermissionProfileName,
): PermissionProfile {
  const target = resolveWriteTarget(projectRoot, profile);
  if (!fs.existsSync(target)) return skeleton();
  try {
    const parsed = JSON.parse(fs.readFileSync(target, 'utf-8')) as Partial<PermissionProfile>;
    return {
      ...skeleton(),
      ...parsed,
      policies: Array.isArray(parsed.policies) ? parsed.policies : [],
    };
  } catch {
    // Corrupt/unreadable profile — fall back to a skeleton rather than throw.
    return skeleton();
  }
}

function writeProfile(targetPath: string, profile: PermissionProfile): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(profile, null, 2) + '\n', 'utf-8');
}

function ensureArray(entry: ProfilePolicyEntry, key: string): string[] {
  const cur = entry.config[key];
  const arr = Array.isArray(cur) ? (cur as string[]) : [];
  entry.config[key] = arr;
  return arr;
}

function removeTool(
  profile: PermissionProfile,
  type: 'whitelist' | 'blacklist',
  key: string,
  toolName: string,
): void {
  for (const entry of profile.policies) {
    if (entry.type === type && Array.isArray(entry.config[key])) {
      entry.config[key] = (entry.config[key] as string[]).filter((t) => t !== toolName);
    }
  }
}

/**
 * Grant a tool: add it to the profile's whitelist (creating the policy if
 * absent) and remove it from any blacklist so the grant takes effect.
 * Returns the path written and whether the file actually changed.
 */
export function grantToolInProfile(
  projectRoot: string,
  profile: PermissionProfileName,
  toolName: string,
): { path: string; profile: PermissionProfileName; changed: boolean } {
  const target = resolveWriteTarget(projectRoot, profile);
  const data = readProfile(projectRoot, profile);
  const before = JSON.stringify(data);

  // Remove from blacklist first — a grant overrides a prior revoke.
  removeTool(data, 'blacklist', 'blockedTools', toolName);

  let wl = data.policies.find((p) => p.type === 'whitelist');
  if (!wl) {
    wl = { type: 'whitelist', config: { allowedTools: [] }, priority: GRANT_PRIORITY };
    data.policies.push(wl);
  }
  const allowed = ensureArray(wl, 'allowedTools');
  if (!allowed.includes(toolName)) allowed.push(toolName);

  const changed = JSON.stringify(data) !== before;
  if (changed) writeProfile(target, data);
  return { path: target, profile, changed };
}

/**
 * Revoke a tool: add it to the profile's blacklist (creating the policy if
 * absent) and remove it from any whitelist.
 */
export function revokeToolInProfile(
  projectRoot: string,
  profile: PermissionProfileName,
  toolName: string,
): { path: string; profile: PermissionProfileName; changed: boolean } {
  const target = resolveWriteTarget(projectRoot, profile);
  const data = readProfile(projectRoot, profile);
  const before = JSON.stringify(data);

  removeTool(data, 'whitelist', 'allowedTools', toolName);

  let bl = data.policies.find((p) => p.type === 'blacklist');
  if (!bl) {
    bl = { type: 'blacklist', config: { blockedTools: [] }, priority: REVOKE_PRIORITY };
    data.policies.push(bl);
  }
  const blocked = ensureArray(bl, 'blockedTools');
  if (!blocked.includes(toolName)) blocked.push(toolName);

  const changed = JSON.stringify(data) !== before;
  if (changed) writeProfile(target, data);
  return { path: target, profile, changed };
}

/**
 * Read the profile's approval handler ('cli' | 'auto-approve' | 'deny-all').
 * Defaults to 'auto-approve' when no profile/handler is set.
 */
export function getApprovalHandlerFromProfile(
  projectRoot: string,
  profile: PermissionProfileName,
): string {
  return readProfile(projectRoot, profile).approvalHandler ?? 'auto-approve';
}

/**
 * Persist the profile's approval handler. Returns the path written, the
 * resulting handler, and whether the file actually changed.
 */
export function setApprovalHandlerInProfile(
  projectRoot: string,
  profile: PermissionProfileName,
  handler: 'cli' | 'auto-approve' | 'deny-all',
): { path: string; profile: PermissionProfileName; handler: string; changed: boolean } {
  const target = resolveWriteTarget(projectRoot, profile);
  const data = readProfile(projectRoot, profile);
  const changed = data.approvalHandler !== handler;
  if (changed) {
    data.approvalHandler = handler;
    writeProfile(target, data);
  }
  return { path: target, profile, handler, changed };
}

/** Summarize the profile's policies for display (used by list/tools commands). */
export function listProfilePolicies(
  projectRoot: string,
  profile: PermissionProfileName,
): ProfilePolicySummary[] {
  const data = readProfile(projectRoot, profile);
  return data.policies.map((entry) => {
    const tools =
      (entry.config.allowedTools as string[] | undefined) ??
      (entry.config.blockedTools as string[] | undefined) ??
      [];
    return {
      name: entry.type,
      priority: entry.priority ?? null,
      enabled: entry.enabled ?? true,
      tools: Array.isArray(tools) ? tools : [],
    };
  });
}
