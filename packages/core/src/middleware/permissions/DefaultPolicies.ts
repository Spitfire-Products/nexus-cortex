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

      // Check if command matches any safe command (with or without args)
      const isSafeCommand = safeReadCommands.some((safe) => {
        // Exact match (e.g., "ls" === "ls")
        if (cmd === safe) return true;

        // Command with arguments (e.g., "ls -la" starts with "ls ")
        // Works for both single-word ("ls") and multi-word ("git status") commands
        if (cmd.startsWith(safe + ' ')) return true;

        return false;
      });

      // For compound commands (with &&, ||, |, ;), check if ALL parts are safe
      // Safe operators: && (and), || (or), | (pipe), ; (sequence)
      // Unsafe operators: >, >>, <, << (redirects)
      const hasUnsafeOperators = cmd.match(/[<>]/);

      if (hasUnsafeOperators) {
        // Has redirects - not safe even if commands are safe
        return { allowed: true }; // Pass-through to graylist
      }

      // Split by safe operators and check if all parts are safe commands
      const commandParts = cmd.split(/\s*(?:&&|\|\||[|;])\s*/).filter(Boolean);
      const allPartsAreSafe = commandParts.every((part: string) => {
        const trimmed = part.trim();
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

      const isDangerous = dangerousPatterns.some((pattern) => cmd.includes(pattern));

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
