# Nexus Cortex CLI - Development Mode

## Overview

The CLI supports hot reload development mode using `tsx watch`, allowing you to make changes to the code and see them immediately reflected without manual rebuilds.

## Available Dev Scripts

### 1. Full Dev Mode (Server + CLI)

**Recommended for full-stack development**

```bash
# From CLI package directory
npm run dev:full

# Or using the global command (after npm link)
cortex-dev
```

This will:
- ✅ Start the server in watch mode with hot reload
- ✅ Start the CLI in watch mode with hot reload
- ✅ Automatically restart both on file changes
- ✅ Enable debug logging
- ✅ Show prefixed output: `[SERVER]` for server logs
- ✅ Handle graceful shutdown on Ctrl+C

**When to use:** When developing CLI features that interact with the server, or when you need both components running with hot reload.

### 2. CLI Only Dev Mode

```bash
# Run CLI directly with tsx watch
npm run dev

# Or run chat with tsx (no watch)
npm run dev:chat
```

**When to use:** When you're only working on CLI code and the server is already running separately.

### 3. Build Watch Mode

```bash
# Continuous TypeScript compilation (no execution)
npm run dev:build
```

**When to use:** When you want to see TypeScript compilation errors without running the code, or when using a different execution method.

## How Hot Reload Works

### Server Hot Reload
- Uses `tsx watch src/index.ts` in the server package
- Monitors `packages/server/src/**/*.ts` files
- Restarts Express server on any change
- Maintains port 4000 (or configured PORT)

### CLI Hot Reload
- Uses `tsx watch src/index.ts` in the CLI package
- Monitors `packages/cli/src/**/*.ts` files
- Restarts CLI process on any change
- Automatically reconnects to server

### What Gets Reloaded

**Server changes that trigger reload:**
- Route handlers (`/packages/server/src/routes/*.ts`)
- Middleware
- Server configuration
- Any TypeScript file in server/src/

**CLI changes that trigger reload:**
- Command implementations (`/packages/cli/src/commands/**/*.ts`)
- Client code (`/packages/cli/src/client/*.ts`)
- Themes and UI components
- Any TypeScript file in cli/src/

**Core library changes:** If you modify core library code, you need to rebuild it separately:
```bash
cd packages/core
npm run build
```

## Development Workflow

### Typical Workflow

1. **Start dev mode:**
   ```bash
   cd packages/cli
   npm run dev:full
   ```

2. **Make changes** to CLI or server code in your editor

3. **See changes immediately** - both processes restart automatically

4. **Test your changes** in the running CLI session

5. **Press Ctrl+C** to stop both server and CLI

### Working on Specific Components

**CLI Commands Only:**
```bash
# Terminal 1: Start server normally
cd packages/server
npm start

# Terminal 2: Run CLI in watch mode
cd packages/cli
npm run dev
```

**Server Routes Only:**
```bash
# Terminal 1: Start server in dev mode
cd packages/server
npm run dev

# Terminal 2: Use CLI normally or test with curl
cd packages/cli
npm start
```

**Full Stack Features:**
```bash
# Single terminal - both with hot reload
cd packages/cli
npm run dev:full
```

## Debugging in Dev Mode

### Debug Flags

Dev mode automatically enables `--debug` flag for the CLI, which shows:
- Request/response details
- Tool execution logs
- Session information
- Error stack traces

### Additional Debugging

```bash
# Server debug logs
cd packages/server
DEBUG=* npm run dev

# CLI with extra verbosity
cd packages/cli
npm run dev:chat -- --debug --server http://localhost:4000
```

### Inspecting Process

```bash
# Server with Node inspector
cd packages/server
node --inspect $(which tsx) watch src/index.ts

# CLI with Node inspector
cd packages/cli
node --inspect $(which tsx) watch src/index.ts chat
```

Then connect Chrome DevTools to `chrome://inspect`

## Troubleshooting

### Port Already in Use

If you get `EADDRINUSE` error:

```bash
# Find and kill process on port 4000
lsof -ti:4000 | xargs kill -9

# Or use a different port
PORT=4001 npm run dev:full
```

### Changes Not Reflecting

1. **Check file is being watched:**
   - tsx watch shows "Restarting..." when files change
   - Make sure you're editing files in `src/`, not `dist/`

2. **Core library changes not reflecting:**
   - Rebuild core library: `cd packages/core && npm run build`
   - Core library is not watched by CLI/server dev mode

3. **Server still using old code:**
   - Kill all node processes: `pkill -f "node.*cortex"`
   - Restart dev mode

### tsx Not Found

```bash
# Install tsx as dev dependency
npm install --save-dev tsx

# Or use npx
npx tsx watch src/index.ts
```

## Performance Tips

### Faster Restarts

tsx is much faster than `nodemon` with `ts-node` because it uses esbuild internally.

Typical restart times:
- **tsx watch:** ~100-500ms
- **nodemon + ts-node:** ~2-5s
- **tsc --watch + nodemon:** ~3-8s

### Exclude Unnecessary Files

tsx automatically ignores:
- `node_modules/`
- `dist/`
- `.git/`
- Test files

### Reduce File Watching

If you only need to watch specific files:

```bash
# Watch only commands directory
npx tsx watch --ignore 'src/!(commands)/**' src/index.ts
```

## Global Command Setup

After making changes, update the global command:

```bash
# Link the CLI package
cd packages/cli
npm link

# Now you can use from anywhere
cortex-dev
```

This creates symlinks:
- `cortex` → production launcher (requires build)
- `cortex-dev` → dev launcher (uses tsx watch)
- `cortex-cli` → direct CLI entry (requires build)

## Production vs Development

### Production Build

```bash
# Build both packages
cd packages/server && npm run build
cd packages/cli && npm run build

# Use compiled JavaScript
cortex
```

**Characteristics:**
- Uses compiled `dist/` files
- Faster startup (no TypeScript compilation)
- No hot reload
- Optimized for production use

### Development Mode

```bash
# No build required
npm run dev:full
```

**Characteristics:**
- Uses TypeScript source directly via tsx
- Hot reload on file changes
- Slower initial startup (esbuild compilation)
- Debug mode enabled
- Optimized for development iteration

## Best Practices

1. **Use dev:full for integrated work** - Keeps server and CLI in sync
2. **Use separate terminals for independent work** - Better control and logging visibility
3. **Keep core library built** - Core changes require manual rebuild
4. **Watch the console** - tsx shows restart events, useful for debugging reload issues
5. **Use Ctrl+C to stop** - Ensures clean shutdown of both processes
6. **Test in production mode before committing** - `npm run build && npm start`

## See Also

- [CLI Development Guide](./CLI_DEVELOPMENT_GUIDE.md) - How to build CLI features
- [Core Integration Guide](../core/INTEGRATION_GUIDE.md) - Using the orchestrator
- [Server README](../server/README.md) - Server architecture and endpoints
