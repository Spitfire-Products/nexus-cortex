# Permissions System

Comprehensive authorization layer for tool execution in Nexus Cortex.

## Overview

The permissions system provides:
- **Policy-based authorization** - Configure rules for tool execution
- **Three-tier security model** - Whitelist, graylist, and blacklist tiers
- **Auto-approve actions toggle** - Runtime control over graylist approval
- **Priority-ordered evaluation** - Policies evaluated by priority
- **Approval flow** - Request user approval for dangerous operations
- **Audit logging** - Track all permission decisions in JSONL format
- **Flexible configuration** - JSON-based configuration files

## Quick Start

```typescript
import { PermissionsMiddleware } from './PermissionsMiddleware.js';
import { FileOperationPolicy } from './permissions/FileOperationPolicy.js';
import { BashCommandPolicy } from './permissions/BashCommandPolicy.js';
import { WhitelistPolicy } from './permissions/WhitelistPolicy.js';
import { CLIApprovalHandler } from './permissions/CLIApprovalHandler.js';
import { PermissionAuditLogger } from './permissions/PermissionAuditLogger.js';

// Create middleware with policies
const middleware = new PermissionsMiddleware({
  policies: [
    new WhitelistPolicy(['read_file', 'write_file', 'execute_bash']),
    new FileOperationPolicy({
      allowedPaths: ['/workspace'],
      blockedPaths: ['/etc', '/root'],
      requireApprovalForDelete: true
    }),
    new BashCommandPolicy({
      allowedCommands: [],
      blockedCommands: ['sudo', 'rm -rf /'],
      requireApprovalForDangerous: true
    })
  ],
  approvalHandler: new CLIApprovalHandler(),
  auditLogger: new PermissionAuditLogger('.nexus-cortex/audit/permissions.log'),
  defaultPolicy: 'deny'
});

// Check permission
const decision = await middleware.checkPermission(
  'read_file',
  { file_path: '/workspace/file.txt' },
  context
);

if (decision.allowed) {
  // Execute tool
} else {
  // Handle denial
  console.log(decision.reason);
}
```

## Three-Tier Security Model

The permissions system uses three security tiers for tool authorization:

### Tier 1: Whitelist (Always Allowed)

Tools that are always allowed without approval:
- **Read** - Reading files
- **Grep** - Searching file contents
- **Glob** - File pattern matching
- **BashOutput** - Reading bash output
- **MCP operations** - MCP configuration and discovery

**Behavior**: Execute immediately, no approval required
**Priority**: 100 (evaluated after blacklist)

### Tier 2: Graylist (Conditional Approval)

Tools that require approval based on **auto-approve actions** setting:
- **Write** - Creating/modifying files
- **Edit** - Editing files
- **NotebookEdit** - Editing Jupyter notebooks
- **Bash** (safe commands) - Non-dangerous bash commands

**Behavior**:
- **Auto-approve ON**: Execute without approval
- **Auto-approve OFF**: Prompt for approval
- **YOLO mode**: Execute without approval (bypasses all)

**Priority**: 50 (evaluated last)
**Default**: Auto-approve OFF for interactive sessions, ON for piped/non-interactive

### Tier 3: Blacklist (Always Requires Approval)

Dangerous operations that ALWAYS require explicit approval:
- **Bash** (dangerous) - Commands like `rm -rf`, `sudo`, `chmod 777`
- **System file access** - `/etc`, `/sys`, `/proc`, `/bin`
- **Destructive operations** - File deletion, disk formatting

**Behavior**:
- **ALWAYS prompts for approval** (even with auto-approve ON)
- **ONLY exception**: YOLO mode bypasses all checks

**Priority**: 1000 (evaluated first, highest priority)

### Auto-Approve Actions Feature

Runtime toggle for graylist tool approval:

```typescript
// Enable auto-approve for graylist tools
orchestrator.setApprovalMode({ autoApproveActions: true });

// Disable auto-approve (prompts required)
orchestrator.setApprovalMode({ autoApproveActions: false });

// Check current mode
const mode = orchestrator.getApprovalMode();
console.log(mode.autoApproveActions); // true or false
```

**API Endpoints** (see `AUTO_APPROVE_API.md`):
- `GET /v1/approval-mode` - Get current approval mode
- `POST /v1/approval-mode` - Toggle auto-approve actions

**Behavior Matrix**:

| Tool Tier | Auto-Approve OFF | Auto-Approve ON | YOLO Mode |
|-----------|------------------|-----------------|-----------|
| Whitelist | ✅ Execute | ✅ Execute | ✅ Execute |
| Graylist | ⚠️ Prompt | ✅ Execute | ✅ Execute |
| Blacklist | ⚠️ Prompt | ⚠️ Prompt | ✅ Execute |

## Policy Types

### WhitelistPolicy

Only allows specific tools to execute.

```typescript
const policy = new WhitelistPolicy(['read_file', 'write_file']);
```

**Priority**: LOW (40)
**Can Approve**: No (hard block)

### BlacklistPolicy

Blocks specific tools from executing.

```typescript
const policy = new BlacklistPolicy(['delete_file', 'format_disk']);
```

**Priority**: CRITICAL (100)
**Can Approve**: No (hard block)

### FileOperationPolicy

Validates file paths and operations.

```typescript
const policy = new FileOperationPolicy({
  allowedPaths: ['/workspace', '/tmp'],
  blockedPaths: ['/etc', '/root', '/.git'],
  requireApprovalForDelete: true,
  requireApprovalForWrite: false,
  maxPathLength: 4096
});
```

**Priority**: HIGH (80)
**Features**:
- Path prefix validation
- Blocked path detection
- Path traversal detection
- Sensitive directory protection
- Delete/write approval requirements

**Can Approve**: Yes (for path outside allowed) / No (for blocked paths)

### BashCommandPolicy

Validates bash commands for dangerous patterns.

```typescript
const policy = new BashCommandPolicy({
  allowedCommands: ['ls', 'git', 'npm'], // Optional whitelist
  blockedCommands: ['sudo', 'rm -rf /'],
  requireApprovalForDangerous: true,
  customDangerousPatterns: ['custom-pattern']
});
```

**Priority**: HIGH (80)
**Features**:
- Dangerous pattern detection (rm -rf, sudo, chmod 777, etc.)
- Command prefix whitelist/blacklist
- Custom dangerous patterns

**Can Approve**: Yes (for dangerous commands) / No (for blacklisted)

## Approval Handlers

### CLIApprovalHandler

Interactive command-line prompts.

```typescript
const handler = new CLIApprovalHandler({
  timeoutMs: 60000,
  showToolInput: true,
  maxInputDisplay: 500
});
```

**Use Case**: Development and interactive environments

### AutoApproveHandler

Automatically approves all requests.

```typescript
const handler = new AutoApproveHandler({
  enableLogging: true,
  maxApprovals: Infinity
});
```

**Use Case**: Testing, automation, trusted environments
**Warning**: Bypasses all security checks

### DenyAllHandler

Automatically denies all requests.

```typescript
const handler = new DenyAllHandler({
  enableLogging: true,
  customMessage: 'All approvals denied by policy'
});
```

**Use Case**: Production, strict security environments

## Configuration Files

Load configuration from JSON:

```typescript
import { PermissionConfigLoader } from './permissions/PermissionConfigLoader.js';

const loader = new PermissionConfigLoader();
const middleware = await loader.loadFromFile('.nexus-cortex/permissions.json');
```

### Example Configuration

```json
{
  "enabled": true,
  "defaultPolicy": "deny",
  "policies": [
    {
      "type": "whitelist",
      "priority": 40,
      "config": {
        "allowedTools": ["read_file", "write_file"]
      }
    },
    {
      "type": "file-operation",
      "priority": 80,
      "config": {
        "allowedPaths": ["/workspace"],
        "blockedPaths": ["/etc", "/root"],
        "requireApprovalForDelete": true
      }
    },
    {
      "type": "bash-command",
      "priority": 80,
      "config": {
        "blockedCommands": ["sudo", "rm -rf /"],
        "requireApprovalForDangerous": true
      }
    }
  ],
  "approvalHandler": "cli",
  "auditLog": {
    "enabled": true,
    "path": ".nexus-cortex/audit/permissions.log"
  }
}
```

### Configuration Presets

```typescript
import { PermissionPresets } from './permissions/PermissionConfig.js';

// Development (permissive)
const devConfig = PermissionPresets.development();

// Production (strict)
const prodConfig = PermissionPresets.production();

// Testing (auto-approve)
const testConfig = PermissionPresets.testing();

// Disabled
const disabledConfig = PermissionPresets.disabled();
```

## Policy Priority System

Policies are evaluated in priority order (higher number = higher priority):

| Priority | Policy Type       | Use Case                    |
|----------|-------------------|-----------------------------|
| 100      | Blacklist         | Critical security blocks    |
| 80       | File Operation    | Path validation             |
| 80       | Bash Command      | Command validation          |
| 60       | Custom            | User-defined rules          |
| 40       | Whitelist         | Tool allowlist              |
| 20       | Default           | Fallback behavior           |

### Evaluation Rules

1. Policies evaluated in descending priority order
2. First `{ allowed: false, canApprove: false }` immediately blocks
3. First `{ allowed: false, canApprove: true }` triggers approval flow
4. If all policies return `{ allowed: true }`, execution proceeds

### Example

```typescript
// High priority blacklist blocks immediately
const blacklist = new BlacklistPolicy(['delete_file'], 100);

// Low priority whitelist evaluated later
const whitelist = new WhitelistPolicy(['delete_file'], 40);

// Blacklist wins (higher priority)
const result = await evaluator.evaluate({ toolName: 'delete_file', ... });
// result.decision.allowed === false
// result.decidingPolicy === 'blacklist'
```

## Audit Logging

JSONL-based audit log tracks all permission decisions.

```typescript
const logger = new PermissionAuditLogger('.nexus-cortex/audit/permissions.log', {
  maxFileSizeBytes: 10 * 1024 * 1024, // 10MB
  enableRotation: true,
  maxRotatedFiles: 5
});

// Query entries
const entries = await logger.query({
  sessionId: '123',
  deniedOnly: true,
  startDate: new Date('2025-01-01'),
  limit: 100
});

// Get statistics
const stats = await logger.getStatistics();
console.log(stats.totalEntries);
console.log(stats.deniedCount);
console.log(stats.approvalRequestCount);
```

### Audit Entry Format

```json
{
  "timestamp": "2025-11-12T10:30:00.000Z",
  "sessionId": "abc-123",
  "toolName": "read_file",
  "toolInput": { "file_path": "/etc/passwd" },
  "decision": {
    "allowed": false,
    "reason": "Path /etc/passwd is restricted",
    "canApprove": false
  },
  "approvalRequested": false
}
```

## Security Best Practices

1. **Default Deny**: Set `defaultPolicy: 'deny'` in production
2. **High Priority Blacklists**: Use priority 100 for critical blocks
3. **Audit Everything**: Enable audit logging in production
4. **Review Logs**: Regularly check denied operations
5. **Principle of Least Privilege**: Only whitelist necessary tools
6. **Path Validation**: Always validate file paths
7. **Command Validation**: Block dangerous bash patterns
8. **Fail Closed**: Errors in policy evaluation → deny operation

## Testing

```typescript
import { describe, it, expect } from 'vitest';
import { FileOperationPolicy } from './FileOperationPolicy.js';

describe('FileOperationPolicy', () => {
  it('should block /etc access', async () => {
    const policy = new FileOperationPolicy({
      allowedPaths: ['/workspace'],
      blockedPaths: ['/etc']
    });

    const decision = await policy.evaluate({
      toolName: 'read_file',
      toolInput: { file_path: '/etc/passwd' },
      sessionId: 'test',
      timestamp: new Date()
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('restricted');
  });
});
```

## Architecture

```
Tool Execution Request
    ↓
PermissionsMiddleware
    ↓
PermissionEvaluator
    ↓
┌─────────────────────────────────────┐
│  Policy Evaluation Pipeline         │
│                                     │
│  1. Load policies                   │
│  2. Sort by priority (high → low)   │
│  3. Evaluate each policy            │
│  4. First DENY wins                 │
│  5. All ALLOW required              │
└─────────────────────────────────────┘
    ↓
Permission Decision
    ├─→ ALLOWED: Execute tool
    └─→ DENIED:
        ├─→ canApprove = true
        │   ├─→ Request approval
        │   │   ├─→ Approved: Execute
        │   │   └─→ Denied: Block
        │   └─→ No handler: Block
        └─→ canApprove = false: Block
```

## API Reference

See JSDoc comments in source files for detailed API documentation:
- `PermissionsMiddleware.ts` - Main middleware class
- `PermissionEvaluator.ts` - Policy evaluation engine
- `PermissionPolicy.ts` - Base policy types
- `FileOperationPolicy.ts` - File path validation
- `BashCommandPolicy.ts` - Bash command validation
- `WhitelistPolicy.ts` - Tool whitelist
- `BlacklistPolicy.ts` - Tool blacklist
- `PermissionAuditLogger.ts` - Audit logging
- `PermissionConfigLoader.ts` - Configuration loading

## Troubleshooting

### Operation denied unexpectedly

1. Check audit log for denial reason
2. Verify policy priority order
3. Check if tool is in whitelist (if using whitelist)
4. Check if path/command is blocked
5. Enable debug logging: `enableLogging: true`

### Approval not working

1. Verify approval handler is configured
2. Check if `canApprove` is true in decision
3. Check approval handler implementation
4. Verify no timeout issues

### Audit log not recording

1. Verify audit logger is configured
2. Check file permissions for log directory
3. Check disk space
4. Verify log path is writable

## Examples

See example configurations:
- `.nexus-cortex/permissions.example.json` - Complete example
- `.nexus-cortex/permissions.dev.json` - Development
- `.nexus-cortex/permissions.prod.json` - Production
- `.nexus-cortex/permissions.test.json` - Testing/CI

## Support

For issues or questions:
1. Check this documentation
2. Review example configurations
3. Check test files for usage patterns
4. Review audit logs for decision details
