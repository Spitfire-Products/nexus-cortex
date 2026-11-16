/**
 * Default Permission Policies for Nexus Cortex
 *
 * 3-Tier Permission System:
 * - Whitelist (Green): Always approved, no prompt needed
 * - Graylist (Yellow): Conditional approval based on "auto approve actions" setting
 * - Blacklist (Red): ALWAYS requires explicit approval (except YOLO mode)
 *
 * @version 1.0.0
 * @created 2025-11-13
 */

import type { PermissionPolicy } from '../contracts/MiddlewareContracts.js';
import { analyzeBashCommand } from './bashCommandView.js';
import * as path from 'node:path';
import { resolveDesktop } from '../../config/localDesktop.js';
import { listSites, sessionVaultPath } from '../../config/sessionVault.js';
import { grantsPath, readGrantForSite, notePreApproval, hasSessionGrant } from '../../config/sessionRelease.js';

/**
 * 2026-11-13 (operator's M2 session 28a43865): with no desktop package installed, deepseek-flash answered "do you have desktop tools?"
 * by screenshotting the real screen, posting a CoreGraphics input event and scripting Safari/Chrome — all through plain Bash, around every
 * guard the desktop tool has (off by default, failsafe, stop latch, audit). Screen capture, synthetic input and app scripting through Bash
 * therefore ALWAYS ask (blacklist tier: auto-approve does not cover it) — since 11-14 also with the desktop surface on, where the prompt
 * points at the desktop tool (its stop latch + audit must not be bypassable through Bash). Returns the category for the prompt, else undefined.
 */
export function nativeAutomationCategory(cmd: string): string | undefined {
  const c = String(cmd ?? '');
  if (/\bscreencapture\b|\bimport\s+-window\b|\bxwd\b/.test(c)) return 'screen capture';
  if (/\bCGEvent(Post|PostToPid|CreateMouseEvent|CreateKeyboardEvent|CreateScrollWheelEvent)\b|\bcliclick\b|\bx?dotool\b|\bydotool\b/.test(c)) return 'synthetic mouse/keyboard input';
  // ANY osascript / osacompile is app or UI scripting (11-14, macbook C9): saved .scpt files, a direct `tell application "Finder"` and
  // keyword-free JXA all slipped the old System-Events/keystroke pattern list — the desktop tool's audited `osa` is the sanctioned path.
  if (/\b(osascript|osacompile)\b/.test(c)) return 'app or UI scripting (AppleScript/JXA)';
  if (/\bsafaridriver\b|\bshortcuts\s+run\b/.test(c)) return 'browser or Shortcuts automation';
  return undefined;
}

/** The orient scripts the harness itself ships (CORTEX_ROOT/.cortex/orient, CORTEX_ROOT/docs/prompts/orient-scaffold.sh). */
export function isShippedOrientCommand(cmd: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const root = (env.CORTEX_ROOT ?? '').trim();
  if (!root) return false;
  const shipped = new Set([path.join(root, '.cortex', 'orient'), path.join(root, 'docs', 'prompts', 'orient-scaffold.sh')]);
  const m = /^sh\s+(['"]?)([^'"\s;&|<>$`]+)\1(?:\s+2>&1)?(?:\s*\|\s*head(?:\s+-n)?(?:\s+-?\d+)?)?$/.exec(cmd.trim());
  return !!m && shipped.has(path.normalize(m[2]!));
}

/**
 * Whitelist Policy: Safe research/read operations that never need approval
 *
 * Priority: 100 (medium)
 * Tier: N/A (always allowed, no tier needed)
 *
 * Philosophy: Allow all non-destructive research operations without prompts
 */
export const whitelistPolicy: PermissionPolicy = {
  name: 'whitelist-safe-research-operations',
  priority: 100,
  enabled: true,

  evaluate: async (context) => {
    // Safe read-only tools - ALWAYS allowed without prompts
    const whitelistTools = [
      'Read',
      'Grep',
      'Glob',
      'BashOutput',
      'WebSearch',
      'WebFetch',
      'GetMcpConfig',
      // Restarts an ALREADY-configured MCP server in this session (no config write) — self-maintenance after an update (11-14).
      'ReconnectMcpServer',
      'ListAvailableMcpServers',
      'SearchMcpServers',
      'GetConversationSegment',
      'ListCompactionBoundaries',
      'ListSessions',
      'LoadSession',
      'RequestHistoricalContext',
      'SearchConversationHistory',
      'TodoList',
      'SearchTools',
      // Canon store: list is read-only; pull only writes a session COPY into
      // the local session directory (no arbitrary-path writes).
      'CanonListSessions',
      'CanonPullSession',
      // Secrets vault: names / providers / bindings only — never values.
      'SecretsList',
      // Stores a key ENCRYPTED in the user's own vault, refuses to replace one without overwrite:true, never prints it (11-14).
      'SecretsSet',
    ];

    if (whitelistTools.includes(context.toolName)) {
      return {
        allowed: true,
        tier: 'whitelist', // Explicit approval - stop evaluating further policies
      };
    }

    // Safe bash commands - ALWAYS allowed for research without prompts
    if (context.toolName === 'Bash') {
      const cmd = (context.toolInput?.command || '').trim();

      // Read-only commands that are always safe
      const safeReadCommands = [
        'ls', 'dir',           // List files
        'pwd',                 // Print working directory
        'whoami', 'id',        // User info
        'echo',                // Print text
        'cat', 'head', 'tail', 'less', 'more',  // Read files
        'grep', 'egrep', 'fgrep', 'rg',         // Search
        'find', 'locate',      // Find files
        'which', 'whereis', 'type',  // Locate commands
        'env', 'printenv',     // Environment
        'date', 'uptime', 'hostname',  // System info
        'uname', 'arch',       // System info
        'df', 'du',            // Disk usage
        'ps', 'top', 'htop',   // Process info
        'history',             // Command history
        'wc', 'sort', 'uniq',  // Text processing
        'diff', 'cmp',         // File comparison
        'stat', 'file',        // File info
        'tree',                // Directory tree

        // Git read-only operations (comprehensive list)
        'git status',          // Status (all variants: --porcelain, --short, etc.)
        'git log',             // Commit history (all variants)
        'git diff',            // Show changes (staged, unstaged, commits)
        'git show',            // Show commits, objects
        'git branch',          // List branches
        'git remote',          // List remotes
        'git tag',             // List tags
        'git reflog',          // Reference logs
        'git blame',           // Show who changed lines
        'git describe',        // Describe commits
        'git ls-files',        // List tracked files
        'git ls-tree',         // List tree objects
        'git grep',            // Search repository
        'git config --list',   // View config
        'git config --get',    // Get config value
        'git rev-parse',       // Parse revisions
        'git symbolic-ref',    // Read symbolic refs
        'git for-each-ref',    // Iterate refs
        'git cat-file',        // View objects
        'git shortlog',        // Summarize commits
        'git count-objects',   // Count objects
        'git verify-commit',   // Verify commits
        'git verify-tag',      // Verify tags
        'git check-ignore',    // Check gitignore
        'git check-attr',      // Check attributes
        'git ls-remote',       // List remote references
        'git fetch --dry-run', // Dry-run fetch
        'npm list', 'npm view', 'npm search',             // NPM read ops
        'npm run build', 'npm run test', 'npm test',      // Build/test (typically safe)
        'npm run lint', 'npm run typecheck',              // Code quality checks
        'node --version', 'npm --version', 'python --version',  // Version info
        'node -e', 'node --check',  // Safe node execution (read-only eval/syntax check)
        'tsc', 'tsc --noEmit',      // TypeScript check (no output)
        'eslint', 'prettier',       // Linting/formatting (check mode)
        'vitest', 'jest', 'mocha',  // Test runners
        'sqlite3',             // Database queries (read-only if no write commands)
        'jq', 'yq',            // JSON/YAML processing
        'awk', 'sed',          // Text processing (when reading, not editing)
        'curl -I', 'curl --head',  // HEAD requests only
        'ping', 'traceroute', 'dig', 'nslookup',  // Network diagnostics (read-only)
        'timeout',             // Command wrapper
        'time',                // Command timing
        'cd' // Change directory (safe)
      ];

      // Heredoc/redirect-aware structural analysis (2026-08-22). The old rule
      // here was `cmd.match(/[<>]/)` — ANY angle bracket (every heredoc, every
      // `2>/dev/null`, a `<` in a quoted string) ejected the command from the
      // whitelist. Built when models were unreliable with heredocs; the
      // narrow-door program showed they no longer are. Now: only a REAL file
      // write (`>`/`>>` to a non-sink target) leaves the whitelist — as a
      // graylist WRITE (parity with the Write tool), not a hard ejection.
      // Stdin feeds (`<`), heredocs (`<<`), and null sinks stay whitelistable;
      // matching runs on the heredoc-body-free view (bodies are data).
      const structure = analyzeBashCommand(cmd);
      if (structure.hasFileWriteRedirect) {
        return { allowed: true }; // A write — pass-through to graylist
      }
      const matchText = structure.view.trim();

      // 2026-11-13 (operator's fuzzycortex run): the harness's OWN shipped orient script (the prompt tells the model to run it first) asked
      // for Bash approval every session. Exactly `sh <shipped path>` (optionally `2>&1` and `| head [-n] N`) is whitelisted; a project's
      // own ./.cortex/orient stays behind approval — that one is arbitrary project code.
      if (isShippedOrientCommand(matchText)) {
        return { allowed: true, tier: 'whitelist' };
      }

      // Check if command matches any safe command (with or without args)
      const isSafeCommand = safeReadCommands.some((safe) => {
        // Exact match (e.g., "ls" === "ls")
        if (matchText === safe) return true;

        // Command with arguments (e.g., "ls -la" starts with "ls ")
        // Works for both single-word ("ls") and multi-word ("git status") commands
        if (matchText.startsWith(safe + ' ')) return true;

        return false;
      });

      // Split by safe operators (&&, ||, |, ;) and check if all parts are safe.
      // Redirect operators inside parts were handled structurally above.
      const commandParts = matchText.split(/\s*(?:&&|\|\||[|;])\s*/).filter(Boolean);
      const allPartsAreSafe = commandParts.every((part: string) => {
        // Strip stdin/heredoc operator tails so `sort < file` / `cat <<'EOF'`
        // match on their command head.
        const trimmed = part.trim().replace(/\s*<<?-?\s*.*$/, '').trim();
        if (!trimmed) return true; // pure operator remnant
        return safeReadCommands.some((safe) => {
          // Check if this part matches a safe command
          return trimmed === safe || trimmed.startsWith(safe + ' ');
        });
      });

      if (isSafeCommand || allPartsAreSafe) {
        return {
          allowed: true,
          tier: 'whitelist', // Explicit approval - stop evaluating further policies
        };
      }
    }

    // Not a whitelist tool - pass to next policy
    return { allowed: true }; // Pass-through (not handled by this policy)
  },
};

/**
 * Graylist Policy: Write/edit operations and non-whitelisted bash
 *
 * Priority: 50 (low)
 * Tier: graylist
 * Behavior:
 * - Auto-approve ON: Executes without prompt
 * - Auto-approve OFF: Requires explicit approval
 *
 * Note: Safe bash commands moved to whitelist - this catches everything else
 */
export const graylistPolicy: PermissionPolicy = {
  name: 'graylist-write-operations',
  priority: 50,
  enabled: true,

  evaluate: async (context) => {
    const graylistTools = ['Write', 'Edit', 'NotebookEdit'];

    // File write/edit operations
    if (graylistTools.includes(context.toolName)) {
      return {
        allowed: false,
        reason: `${context.toolName} operation requires approval`,
        canApprove: true,
        tier: 'graylist', // Can be auto-approved
      };
    }

    // Bash commands that weren't whitelisted (anything not read-only)
    // Note: Safe commands are now in whitelist, so this catches:
    // - npm install, git add/commit/push, etc.
    if (context.toolName === 'Bash') {
      return {
        allowed: false,
        reason: 'Bash command requires approval (not in safe whitelist)',
        canApprove: true,
        tier: 'graylist',
      };
    }

    // Not a graylist tool - pass to next policy
    return { allowed: true }; // Pass-through
  },
};

/**
 * Blacklist Policy: Dangerous operations that ALWAYS require approval
 *
 * Priority: 1000 (highest - evaluated first)
 * Tier: blacklist
 * Behavior:
 * - ALWAYS requires explicit approval (even if auto-approve ON)
 * - ONLY exception: YOLO=true bypasses all
 */
/**
 * FLOOR policy (2026-11-14, macbook battery C5): the native-automation guard used to live only inside blacklistPolicy, which the factory uses
 * just when NO permission-profile file exists — real installs ship ~/.cortex/permissions.*.json, so the guard never ran there. This policy is
 * prepended to EVERY resolved policy set (profile or default) by OrchestratorFactory.createDefaultPolicies, above any profile priority.
 */
export const nativeAutomationFloorPolicy: PermissionPolicy = {
  name: 'floor-native-automation',
  priority: 10_000,
  enabled: true,
  evaluate: async (context) => {
    if (context.toolName !== 'Bash') return { allowed: true };
    const native = nativeAutomationCategory(context.toolInput?.command || '');
    // 11-14 operator ("the entire point … was to create a way for the agent or you to drive a computer — you are handicapping it"): once
    // the user ENABLED the desktop surface (cortex desktop enable = consent), native automation through Bash is allowed, headless or not.
    // The floor only guards installs where the user has NOT opted in.
    if (!native || resolveDesktop().using) return { allowed: true };
    const desk = resolveDesktop();
    return {
      allowed: false,
      reason: desk.using
        ? `NATIVE AUTOMATION (${native}) through Bash bypasses the desktop tool's stop switch, failsafe and audit log — use the desktop tool (nexus-desktop__desktop) instead; through Bash it always asks`
        : `NATIVE AUTOMATION (${native}) acts on your real screen/apps outside the desktop tool's safety rails — always asks (enable the desktop surface with cortex desktop enable to use the desktop tool)`,
      canApprove: true,
      tier: 'blacklist',
    };
  },
};

/** Provider-key shapes (prefix + length) — conservative on purpose, so ordinary words ("risk-assessment", "task-list") never match. */
const KEY_SHAPES: RegExp[] = [
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/, /\bxai-[A-Za-z0-9]{20,}/, /\bghp_[A-Za-z0-9]{30,}/, /\bgithub_pat_[A-Za-z0-9_]{22,}/, /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}/, /\bhf_[A-Za-z0-9]{30,}/, /\b(?:nb|ncsb|nrl|nar|ncx)_[A-Za-z0-9]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];
export function keyShapeIn(text: string): string | undefined {
  const t = String(text ?? '');
  for (const r of KEY_SHAPES) { const m = r.exec(t); if (m) return m[0].slice(0, 6) + '…'; }
  return undefined;
}

/**
 * FLOOR policy (2026-11-14, macbook battery C7): an agent wrote a key-shaped value from its task into a file although USER.md forbids it —
 * a prompt rule is not a guard. ASK (blacklist tier → headless fails fast, interactive confirms) before Write / Edit / Bash put a key-shaped
 * value on disk. Prepended to every policy set with nativeAutomationFloorPolicy (OrchestratorFactory.createDefaultPolicies).
 */
export const secretsInFilesFloorPolicy: PermissionPolicy = {
  name: 'floor-secrets-in-files',
  priority: 9_999,
  enabled: true,
  evaluate: async (context) => {
    const i = context.toolInput || {};
    const text = context.toolName === 'Write' ? i.content : context.toolName === 'Edit' ? i.new_string : context.toolName === 'Bash' ? i.command : undefined;
    const hit = text ? keyShapeIn(text) : undefined;
    if (!hit) return { allowed: true };
    return {
      allowed: false,
      reason: `writes a key/token (${hit}) ${context.toolName === 'Bash' ? 'through Bash' : 'into ' + (i.file_path || 'a file')} — keys never go in files or command lines: store it with the SecretsSet tool (encrypted vault, bound as $NAME) and use "$NAME" instead. Always asks.`,
      canApprove: true,
      tier: 'blacklist',
    };
  },
};

export const blacklistPolicy: PermissionPolicy = {
  name: 'blacklist-dangerous-operations',
  priority: 1000, // Highest priority - checked first
  enabled: true,

  evaluate: async (context) => {
    // Dangerous bash commands
    if (context.toolName === 'Bash') {
      const cmd = context.toolInput?.command || '';
      const dangerousPatterns = [
        'rm -rf',
        'rm -fr',
        'dd if=',
        'mkfs',
        ':(){:|:&};:', // Fork bomb
        '> /dev/sd',
        'chmod -R 777',
        'chown -R',
        'wget',
        'curl',
        'nc -l',
        'python -m http.server',
        'npm install -g',
        'apt install',
        'yum install',
        'dnf install',
        'pacman -S',
        'systemctl',
        'service ',
        'reboot',
        'shutdown',
        'init ',
        'kill -9',
        'pkill -9',
        'killall',
      ];

      // Heredoc bodies are DATA unless fed to an interpreter that executes
      // stdin (2026-08-22): `cat > deploy.sh <<EOF` containing `rm -rf ./dist`
      // is a WRITE of text, not an execution — scan the body-free view.
      // `bash <<EOF` DOES execute its body — scan the full command.
      const bl = analyzeBashCommand(cmd);
      const scanText = bl.interpreterFed ? cmd : bl.view;
      const isDangerous = dangerousPatterns.some((pattern) => scanText.includes(pattern));

      // Native automation (see nativeAutomationCategory): scan the FULL command — a heredoc that writes a script and runs it in the same
      // call is how the M2 session posted its CGEvent.
      const native = nativeAutomationCategory(cmd);
      // 11-14 (macbook step 5b): it used to pass once the desktop surface was ON — then Bash screencapture/osascript reached the screen
      // around the desktop tool's stop latch, failsafe and audit. It ALWAYS asks now; with the surface on the prompt names the tool to use.
      if (native && !resolveDesktop().using) {   // desktop surface enabled = the user's consent (operator 11-14)
        const desk = resolveDesktop();
        return {
          allowed: false,
          reason: desk.using
            ? `NATIVE AUTOMATION (${native}) through Bash bypasses the desktop tool's stop switch, failsafe and audit log — use the desktop tool (nexus-desktop__desktop) instead; through Bash it always asks`
            : `NATIVE AUTOMATION (${native}) acts on your real screen/apps outside the desktop tool's safety rails — always asks (enable the desktop surface with cortex desktop enable to use the desktop tool)`,
          canApprove: true,
          tier: 'blacklist',
        };
      }

      if (isDangerous) {
        const previewCmd = cmd.substring(0, 50) + (cmd.length > 50 ? '...' : '');
        return {
          allowed: false,
          reason: `DANGEROUS: ${previewCmd} - always requires approval`,
          canApprove: true,
          tier: 'blacklist', // ALWAYS requires approval
        };
      }
    }

    // System file access
    if (['Write', 'Edit'].includes(context.toolName)) {
      const filePath = context.toolInput?.file_path || '';
      const systemPaths = ['/etc/', '/sys/', '/proc/', '/dev/', '/bin/', '/sbin/', '/usr/bin/', '/usr/sbin/'];

      const isSystemFile = systemPaths.some((path) => filePath.startsWith(path));

      if (isSystemFile) {
        return {
          allowed: false,
          reason: `System file access forbidden: ${filePath}`,
          canApprove: true,
          tier: 'blacklist',
        };
      }
    }

    // Bash commands that modify system files.
    // Only flag WRITE redirects (> or >>) to sensitive system paths.
    // NOT flagged:
    //   - Reads (cat /etc/os-release) — substring matching previously caused false positives
    //   - Suppressing output to /dev/null (2>/dev/null, >/dev/null, &>/dev/null) — a
    //     standard null sink, not a real file modification
    if (context.toolName === 'Bash') {
      const cmd = context.toolInput?.command || '';

      // Match any redirect (`>` or `>>`, with or without a preceding `2`/`&` and optional space)
      // that targets a sensitive system path. Explicitly exclude /dev/null.
      // Examples matched:   `> /etc/passwd`, `>>/dev/sda`, `2>>/sys/...`, `&>/proc/x`
      // Examples NOT matched: `cat /etc/os-release`, `2>/dev/null`, `>/dev/null`, `&>/dev/null`
      const sensitiveWriteRegex = /(?:^|\s)[0-9&]?\s*>>?\s*(\/etc\/|\/sys\/|\/proc\/|\/bin\/|\/sbin\/|\/usr\/bin\/|\/usr\/sbin\/|\/dev\/(?!null\b))/;

      if (sensitiveWriteRegex.test(cmd)) {
        return {
          allowed: false,
          reason: 'System modification via Bash requires approval',
          canApprove: true,
          tier: 'blacklist',
        };
      }
    }

    // Not a blacklist operation - pass to next policy
    return { allowed: true }; // Pass-through
  },
};

/**
 * Default policy set for Nexus Cortex
 *
 * Order matters: Policies are evaluated in priority order (highest first)
 * 1. Blacklist (priority 1000) - catches dangerous operations
 * 2. Whitelist (priority 100) - allows safe read operations
 * 3. Graylist (priority 50) - requires conditional approval for writes
 */
export const defaultPolicies: PermissionPolicy[] = [
  blacklistPolicy, // Priority 1000 (checked first)
  whitelistPolicy, // Priority 100
  graylistPolicy, // Priority 50 (checked last)
];

/**
 * FLOOR policy (2026-11-15, vault task T3): `load_session` releases a saved browser session for a site — the highest-value thing
 * an agent can do with the vault, so it never rides on a generic classification.
 *
 * The rule, exactly:
 *   - the site has a valid standing 'always' grant (grant.importedAt === the CURRENT vault entry's importedAt) → allowed, no prompt;
 *   - the site is not in the vault → allowed (release itself returns loaded 0 and asks nothing — there is nothing to protect);
 *   - otherwise → refused with canApprove + blacklist tier: the middleware then turns it into a dialog when a person is there
 *     (auto-approve OFF), and REFUSES AT ONCE when auto-approve is on or the run is headless (nothing waits).
 *
 * Paths are injectable so tests never touch ~/.cortex.
 */
export interface LoadSessionFloorOptions { vaultFile?: string; grantsFile?: string }

/**
 * The four choices the load_session dialog offers (T3 D1). Shared with the CLI and the TUI so the two surfaces ask the same
 * question; the value is what the handler returns and what releaseSite understands.
 */
export function loadSessionChoices(site: string): ReadonlyArray<{ value: 'once' | 'session' | 'always' | 'no'; label: string }> {
  return [
    { value: 'once', label: 'Yes, just this once' },
    { value: 'session', label: 'Yes, for this session' },
    { value: 'always', label: `Yes, always for ${site}` },
    { value: 'no', label: 'No, do not load it (esc)' },
  ];
}

export function loadSessionFloorPolicy(opts: LoadSessionFloorOptions = {}): PermissionPolicy {
  return {
    name: 'floor-load-session',
    priority: 9_998,
    enabled: true,
    evaluate: async (context) => {
      const tool = String(context.toolName || '');
      if (tool !== 'nexus-browser__load_session' && tool !== 'load_session') return { allowed: true };
      const raw = (context.toolInput as { site?: unknown } | undefined)?.site;
      if (typeof raw !== 'string' || !raw.trim()) {
        return { allowed: false, reason: 'load_session needs a site (the registrable domain, e.g. github.com)', canApprove: true, tier: 'blacklist' };
      }
      const site = raw.trim().toLowerCase();
      const entry = listSites(opts.vaultFile ?? sessionVaultPath()).find((x) => x.site === site);
      if (!entry) return { allowed: true };
      const grant = readGrantForSite(site, opts.grantsFile ?? grantsPath());
      if (grant?.mode === 'always' && grant.importedAt === entry.importedAt) return { allowed: true };
      if (hasSessionGrant(site, entry.importedAt, typeof context.sessionId === 'string' ? context.sessionId : undefined)) return { allowed: true };   // the user said "this session" in the dialog (in-process only)
      return {
        allowed: false,
        reason: `no standing grant for ${site} - the user grants it once in the TUI`,
        canApprove: true,
        tier: 'blacklist',
        // T3 D1/D2: this refusal carries its own four-way question, so the ONE dialog the user sees is the one that decides
        // the release. The answer is handed to releaseSite through the in-memory pre-approval (never the disk).
        approval: { kind: 'load_session', site, choices: loadSessionChoices(site) },
        onApproved: (answer) => {
          if (!answer.approved) return;
          // Bound to the entry the user actually saw (importedAt) and to the session that answered: a re-imported site or
          // another session can never consume this answer. No sessionId → nothing is recorded (fail closed).
          notePreApproval({
            site,
            importedAt: entry.importedAt,
            sessionId: context.sessionId,
            scope: answer.scope ?? 'once',
          });
        },
      };
    },
  };
}

/**
 * Classification for the session-vault tool (vault task T3). No policy file classifies `nexus-browser__*` tools, and the honest
 * reason this entry exists is EXPLICIT CLASSIFICATION — not a rescue from the default policy.
 *
 * What PermissionEvaluator actually does (see evaluate() there): a policy that returns `{ allowed: true }` WITHOUT a tier is a
 * pass-through and evaluation continues; if every policy passes through, the evaluator returns ALLOWED. The configured default
 * policy is consulted only when NO policy evaluated at all (none registered, or every one disabled) — never because a tool was
 * unclassified. So an unclassified `nexus-browser__load_session` would NOT be denied by the default policy; it would be allowed
 * by pass-through, with no policy named as the deciding one.
 *
 * This entry therefore makes the tool's decision explicit and attributable (`tier: 'whitelist'`, deciding policy
 * `load-session-tool`) instead of an accidental pass-through. It is harmless because it is deliberately LOWER priority than the
 * `floor-load-session` floor (9_998), which runs first and refuses when there is no standing grant — this entry can never
 * release anything the floor refused, and it never even gets evaluated after a refusal (the evaluator stops at the first
 * non-allowed decision). Interactive use with no grant stops at the floor and reaches the dialog.
 */
export const loadSessionToolPolicy: PermissionPolicy = {
  name: 'load-session-tool',
  priority: 500,
  enabled: true,
  evaluate: async (context) => {
    const tool = String(context.toolName || '');
    return tool === 'nexus-browser__load_session' || tool === 'load_session' ? { allowed: true, tier: 'whitelist' } : { allowed: true };
  },
};
