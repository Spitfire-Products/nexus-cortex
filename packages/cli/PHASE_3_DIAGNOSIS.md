# Phase 3 - Server Startup Diagnosis

**Issue**: Server fails to start with `ERR_MODULE_NOT_FOUND`
**Date**: 2025-11-16

---

## Error Details

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@cortex/executors'
imported from /home/runner/workspace/nexus-cortex/packages/core/dist/orchestrator/OrchestratorFactory.js
```

## Root Cause

The monorepo packages are not properly linked. The server depends on:
- `@cortex/core`
- `@cortex/executors`

These are defined in `packages/server/package.json` with version `"*"` but npm hasn't linked them.

## Solution Required

The next agent needs to set up proper monorepo linking:

### Option 1: NPM Workspaces (Recommended)
Create root `package.json` with workspaces:

```json
{
  "name": "nexus-cortex-monorepo",
  "version": "4.0.0",
  "private": true,
  "workspaces": [
    "packages/*"
  ]
}
```

Then run from root:
```bash
cd /home/runner/workspace/nexus-cortex
npm install
```

### Option 2: Manual Linking
Link each package manually:

```bash
# Link types
cd packages/types
npm link

# Link executors
cd ../executors
npm link @cortex/types
npm link

# Link core
cd ../core
npm link @cortex/types
npm link @cortex/executors
npm link

# Link to server
cd ../server
npm link @cortex/types
npm link @cortex/executors
npm link @cortex/core

# Link to CLI
cd ../cli
npm link @cortex/types
npm link @cortex/core
```

### Option 3: Use Build Script
The existing `scripts/build.sh` may handle this. Check if it includes npm install steps.

## Quick Fix Test

Test if manual linking works:

```bash
cd /home/runner/workspace/nexus-cortex/packages/server
npm link ../core
npm link ../executors
npm link ../types

# Then test
PORT=4000 node dist/index.js
```

## Current Status

- ✅ All packages built successfully
- ✅ Server dist exists
- ❌ Server can't resolve local dependencies
- ⏳ Monorepo linking not configured

## Next Steps

1. **Set up workspaces** (recommended) OR **manually link packages**
2. **Test server startup**: `cd packages/server && PORT=4000 node dist/index.js`
3. **Test health endpoint**: `curl http://localhost:4000/health`
4. **Test launcher**: `cortex`

---

**Priority**: HIGH - Blocks all testing
**Estimated Fix Time**: 10-15 minutes
