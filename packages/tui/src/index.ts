#!/usr/bin/env node
/**
 * @nexus-cortex/tui — the full interactive Commander CLI (what `fuzzycortex-cli`
 * launches, via bin/cli-full.js → this dist/index.js, exactly as the pre-split
 * cli index.ts did).
 *
 * - default `chat` command  → the CHALK interactiveChat REPL (CHIP_ART /about splash)
 * - `ui …` → the interactive terminal browsers (Ink/chalk)
 * - any other subcommand    → delegated to the headless @nexus-cortex/cli Commander
 *   (autoresearch, models, sessions, message, mcp, config, …)
 */
import { Command } from 'commander';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { interactiveChat } from './commands/chat/interactive.js';
import { uiSessions } from './commands/ui/sessions.js';
import { uiModels } from './commands/ui/models.js';
import { uiThemes } from './commands/ui/themes.js';
import { uiConfig } from './commands/ui/config.js';
import { uiPermissions } from './commands/ui/permissions.js';
import { uiArtifacts } from './commands/ui/artifacts.js';
import { uiMiddleware } from './commands/ui/middleware.js';
import { uiContext } from './commands/ui/context.js';
import { tmuxBrowser } from './commands/ui/tmux.js';
import { systemMessageBrowser } from './commands/ui/system-messages.js';

// Headless subcommands live in @nexus-cortex/cli — delegate them there verbatim.
const HEADLESS = new Set([
  'message', 'models', 'session', 'sessions', 'mcp', 'config', 'permissions',
  'context', 'tools', 'middleware', 'artifact', 'cache', 'system-messages', 'tmux',
  'server', 'autoresearch', 'history', 'stats', 'limits', 'debug', 'helper',
  'mentorship', 'retry', 'dashboard', 'templates', 'sandbox',
]);
const argv = process.argv.slice(2);
const firstPositional = argv.find((a) => !a.startsWith('-'));
if (firstPositional && HEADLESS.has(firstPositional)) {
  const require = createRequire(import.meta.url);
  const cliEntry = require.resolve('@nexus-cortex/cli/dist/index.js');
  const r = spawnSync(process.execPath, [cliEntry, ...argv], { stdio: 'inherit' });
  process.exit(r.status ?? 0);
}

const program = new Command();
program
  .name('cortex')
  .description('Nexus Cortex - Multi-provider LLM CLI (interactive)')
  .version('4.0.0');
program
  .option('--server <url>', 'Server URL', 'http://localhost:4000')
  .option('--debug', 'Enable debug logging')
  .option('--json', 'Output JSON format')
  .option('--no-color', 'Disable colored output');

// Chat command (default) — the CHALK interactive REPL
program
  .command('chat', { isDefault: true })
  .description('Start interactive chat (default command)')
  .option('-m, --model <id>', 'Model ID to use')
  .option('--system <message>', 'System message')
  .option('--max-tokens <number>', 'Maximum tokens', parseInt)
  .option('--temperature <number>', 'Temperature (0-2)', parseFloat)
  .action(async (options) => {
    const g = program.opts();
    await interactiveChat({
      serverUrl: g.server,
      model: options.model,
      system: options.system,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
    });
  });

// UI commands (interactive terminal browsers)
const ui = program.command('ui').description('Interactive terminal UIs');
ui.command('sessions').description('Browse sessions interactively').action(async () => {
  const g = program.opts(); await uiSessions({ serverUrl: g.server, json: g.json });
});
ui.command('models').description('Browse and select models interactively').option('--current <model>', 'Current model ID').action(async (o) => {
  const g = program.opts(); await uiModels({ serverUrl: g.server, json: g.json, current: o.current });
});
ui.command('themes').description('Browse and select themes interactively').action(async () => {
  const g = program.opts(); await uiThemes({ json: g.json });
});
ui.command('config').description('Interactive configuration wizard').action(async () => {
  const g = program.opts(); await uiConfig({ json: g.json });
});
ui.command('permissions').description('Browse permissions, policies, and tool access').action(async () => {
  const g = program.opts(); await uiPermissions({ serverUrl: g.server, json: g.json });
});
ui.command('artifacts').description('View and manage running artifacts').action(async () => {
  const g = program.opts(); await uiArtifacts({ serverUrl: g.server, json: g.json });
});
ui.command('middleware').description('View and configure middleware systems').action(async () => {
  const g = program.opts(); await uiMiddleware({ serverUrl: g.server, json: g.json });
});
ui.command('context').description('View context budget and compaction history').option('--session-id <id>', 'Session ID to view context for').action(async (o) => {
  const g = program.opts(); await uiContext({ sessionId: o.sessionId, serverUrl: g.server, json: g.json });
});
ui.command('tmux').description('Browse and manage tmux sessions').action(async () => {
  const g = program.opts(); await tmuxBrowser({ serverUrl: g.server });
});
ui.command('system-messages').description('Browse available system messages').action(async () => {
  const g = program.opts(); await systemMessageBrowser({ serverUrl: g.server });
});

program.parse();
