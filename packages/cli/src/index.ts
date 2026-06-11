#!/usr/bin/env node
/**
 * Nexus Cortex CLI
 * Main entry point
 */
import { Command } from 'commander';
import { listModels } from './commands/models/list.js';
import { modelInfo } from './commands/models/info.js';
import { modelsSearch } from './commands/models/search.js';
import { modelsCompare } from './commands/models/compare.js';
import { modelsCost } from './commands/models/cost.js';
import { modelsProviders } from './commands/models/providers.js';
import { modelSwitch } from './commands/models/switch.js';
// interactiveChat moved to @nexus-cortex/tui
import { sendSingleMessage } from './commands/chat/single-message.js';
import { serverStart } from './commands/server/start.js';
import { listSessions } from './commands/session/list.js';
import { viewSession } from './commands/session/view.js';
import { exportSession } from './commands/session/export.js';
import { resumeSession } from './commands/session/resume.js';
import { listCheckpoints } from './commands/session/checkpoints.js';
import { sessionStats } from './commands/session/stats.js';
import { sessionsSearch } from './commands/session/search.js';
import { listMcpServers } from './commands/mcp/list.js';
import { mcpStatus } from './commands/mcp/status.js';
import { mcpServer } from './commands/mcp/server.js';
import { mcpTools } from './commands/mcp/tools.js';
import { mcpEnable } from './commands/mcp/enable.js';
import { mcpDisable } from './commands/mcp/disable.js';
import { mcpInit } from './commands/mcp/init.js';
import { mcpValidate } from './commands/mcp/validate.js';
import { mcpEdit } from './commands/mcp/edit.js';
import { permissionsMode } from './commands/permissions/mode.js';
import { permissionsSet } from './commands/permissions/set.js';
import { permissionsAutoApprove } from './commands/permissions/auto-approve.js';
import { permissionsPolicies } from './commands/permissions/policies.js';
import { permissionsTools } from './commands/permissions/tools.js';
import { permissionsGrant } from './commands/permissions/grant.js';
import { permissionsRevoke } from './commands/permissions/revoke.js';
import { configGet } from './commands/config/get.js';
import { configSet } from './commands/config/set.js';
import { configCategories } from './commands/config/categories.js';
import { configCategory } from './commands/config/category.js';
import { configReset } from './commands/config/reset.js';
import { autoResearchEvaluate } from './commands/autoresearch/evaluate.js';
import { autoResearchList } from './commands/autoresearch/list.js';
import { autoResearchBench } from './commands/autoresearch/bench.js';
import { autoResearchExperiment } from './commands/autoresearch/experiment.js';
import { autoResearchFix } from './commands/autoresearch/fix.js';
import { tmuxList } from './commands/tmux/list.js';
import { middlewareList } from './commands/middleware/list.js';
import { middlewareStatus } from './commands/middleware/status.js';
import { middlewareEnable } from './commands/middleware/enable.js';
import { middlewareDisable } from './commands/middleware/disable.js';
import { middlewareConfig } from './commands/middleware/config.js';
import { artifactList } from './commands/artifact/list.js';
import { artifactStop } from './commands/artifact/stop.js';
import { artifactRestart } from './commands/artifact/restart.js';
import { artifactStatus } from './commands/artifact/status.js';
import { sessionCompact } from './commands/session/compact.js';
import { contextStatus } from './commands/context/status.js';
import { contextCompact } from './commands/context/compact.js';
import { contextBoundaries } from './commands/context/boundaries.js';
import { contextStrategy } from './commands/context/strategy.js';
import { contextSavings } from './commands/context/savings.js';
import { toolsList } from './commands/tools/list.js';
import { toolsInfo } from './commands/tools/info.js';
import { cacheMetrics } from './commands/cache/metrics.js';
import { systemMessagesList } from './commands/system-messages/list.js';
import { systemMessagesView } from './commands/system-messages/view.js';
import { systemMessagesReload } from './commands/system-messages/reload.js';
import chalk from 'chalk';

const program = new Command();

program
  .name('cortex')
  .description('Nexus Cortex - Multi-provider LLM CLI')
  .version('4.0.0');

// Global options
program
  .option('--server <url>', 'Server URL', 'http://localhost:4000')
  .option('--debug', 'Enable debug logging')
  .option('--json', 'Output JSON format')
  .option('--no-color', 'Disable colored output');

// Interactive chat (the `chat` default command) lives in @nexus-cortex/tui now.
// Headless cli: use `message` for one-shot, or the `cortex` HTTP client / `neoncortex` TUI.

// Message command — send a single message and exit
program
  .command('message <prompt>')
  .description('Send a single message and exit')
  .option('-m, --model <id>', 'Model ID to use')
  .option('--system <message>', 'System message')
  .option('--max-tokens <number>', 'Maximum tokens', parseInt)
  .option('--json', 'Output full JSON response')
  .action(async (prompt, options) => {
    const globalOpts = program.opts();
    await sendSingleMessage(prompt, {
      serverUrl: globalOpts.server,
      model: options.model,
      system: options.system,
      maxTokens: options.maxTokens,
      json: options.json || globalOpts.json,
    });
  });

// Models commands
const models = program.command('models').description('Model management');

models
  .command('list')
  .description('List all available models')
  .option('--provider <name>', 'Filter by provider')
  .action(async (options) => {
    const globalOpts = program.opts();
    await listModels({
      serverUrl: globalOpts.server,
      provider: options.provider,
      json: globalOpts.json,
    });
  });

models
  .command('info <id>')
  .description('Show detailed model information')
  .action(async (id) => {
    const globalOpts = program.opts();
    await modelInfo(id, {
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

models
  .command('search <query>')
  .description('Search models by keyword')
  .option('--provider <name>', 'Filter by provider')
  .action(async (query, options) => {
    const globalOpts = program.opts();
    await modelsSearch(query, {
      serverUrl: globalOpts.server,
      provider: options.provider,
      json: globalOpts.json,
    });
  });

models
  .command('compare <model1> <model2>')
  .description('Compare two models side-by-side')
  .action(async (model1, model2) => {
    const globalOpts = program.opts();
    await modelsCompare(model1, model2, {
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

models
  .command('cost <id>')
  .description('Show pricing details for a model')
  .action(async (id) => {
    const globalOpts = program.opts();
    await modelsCost(id, {
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

models
  .command('providers')
  .description('List all providers')
  .action(async () => {
    const globalOpts = program.opts();
    await modelsProviders({
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

models
  .command('switch <session-id> <model-id>')
  .description('Switch model for a session')
  .option('--reason <text>', 'Reason for model switch')
  .action(async (sessionId, modelId, options) => {
    const globalOpts = program.opts();
    await modelSwitch(sessionId, modelId, {
      serverUrl: globalOpts.server,
      json: globalOpts.json,
      reason: options.reason,
    });
  });

// Server commands
const server = program.command('server').description('Server management');

server
  .command('status')
  .description('Check server status')
  .action(async () => {
    const globalOpts = program.opts();
    const { CortexClient } = await import('./client/CortexClient.js');
    const client = new CortexClient(globalOpts.server);

    try {
      const health = await client.health();
      console.log(chalk.green('✓ Server is running'));
      console.log(chalk.gray(JSON.stringify(health, null, 2)));
    } catch (error: any) {
      console.error(chalk.red('✗ Server is not responding'));
      console.error(chalk.gray(error.message));
      process.exit(1);
    }
  });

server
  .command('start')
  .description('Start server (if not running)')
  .option('-p, --port <number>', 'Server port', parseInt)
  .option('-d, --detach', 'Run in background')
  .action(async (options) => {
    const globalOpts = program.opts();
    await serverStart({
      serverUrl: globalOpts.server,
      port: options.port,
      detach: options.detach,
    });
  });

// Session commands
const sessions = program.command('sessions').description('Session management');

sessions
  .command('list')
  .description('List all sessions')
  .option('--limit <number>', 'Limit number of sessions', parseInt)
  .action(async (options) => {
    const globalOpts = program.opts();
    await listSessions({
      serverUrl: globalOpts.server,
      json: globalOpts.json,
      limit: options.limit,
    });
  });

sessions
  .command('view <id>')
  .description('View session details')
  .action(async (id) => {
    const globalOpts = program.opts();
    await viewSession(id, {
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

sessions
  .command('export <id>')
  .description('Export session to JSON')
  .option('-o, --output <file>', 'Output file')
  .action(async (id, options) => {
    const globalOpts = program.opts();
    await exportSession(id, {
      serverUrl: globalOpts.server,
      output: options.output,
    });
  });

sessions
  .command('resume <id>')
  .description('Resume from a checkpoint')
  .option('--checkpoint-id <id>', 'Checkpoint ID to resume from')
  .action(async (id, options) => {
    const globalOpts = program.opts();
    await resumeSession(id, {
      serverUrl: globalOpts.server,
      checkpointId: options.checkpointId,
    });
  });

sessions
  .command('checkpoints <id>')
  .description('List session checkpoints')
  .action(async (id) => {
    const globalOpts = program.opts();
    await listCheckpoints(id, {
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

sessions
  .command('stats <id>')
  .description('Show session statistics')
  .action(async (id) => {
    const globalOpts = program.opts();
    await sessionStats(id, {
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

sessions
  .command('search <query>')
  .description('Search sessions by keyword')
  .option('--limit <number>', 'Limit number of results', parseInt)
  .action(async (query, options) => {
    const globalOpts = program.opts();
    await sessionsSearch(query, {
      serverUrl: globalOpts.server,
      limit: options.limit,
      json: globalOpts.json,
    });
  });

// MCP commands
const mcp = program.command('mcp').description('MCP server management');

mcp
  .command('list')
  .description('List all MCP servers')
  .action(async () => {
    const globalOpts = program.opts();
    await listMcpServers({
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

mcp
  .command('status')
  .description('Show overall MCP status')
  .action(async () => {
    const globalOpts = program.opts();
    await mcpStatus({
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

mcp
  .command('server <name>')
  .description('Show specific MCP server details')
  .action(async (name) => {
    const globalOpts = program.opts();
    await mcpServer(name, {
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

mcp
  .command('tools [server]')
  .description('List MCP tools (from specific server or all)')
  .option('--all', 'Show all MCP tools across all servers')
  .action(async (server, cmdOptions) => {
    const globalOpts = program.opts();
    await mcpTools(server, {
      serverUrl: globalOpts.server,
      json: globalOpts.json,
      all: cmdOptions.all,
    });
  });

mcp
  .command('enable <name>')
  .description('Enable an MCP server')
  .action(async (name) => {
    const globalOpts = program.opts();
    await mcpEnable(name, {
      serverUrl: globalOpts.server,
    });
  });

mcp
  .command('disable <name>')
  .description('Disable an MCP server')
  .action(async (name) => {
    const globalOpts = program.opts();
    await mcpDisable(name, {
      serverUrl: globalOpts.server,
    });
  });

mcp
  .command('init')
  .description('Initialize MCP configuration for project')
  .option('--force', 'Overwrite existing configuration')
  .option('--template <name>', 'Use configuration template')
  .action(async (options) => {
    await mcpInit({
      force: options.force,
      template: options.template,
    });
  });

mcp
  .command('validate')
  .description('Validate MCP_CONFIG.md syntax')
  .option('--file <path>', 'Path to config file')
  .action(async (options) => {
    await mcpValidate({
      file: options.file,
    });
  });

mcp
  .command('edit')
  .description('Edit MCP_CONFIG.md in editor')
  .option('--file <path>', 'Path to config file')
  .option('--editor <name>', 'Editor to use')
  .action(async (options) => {
    await mcpEdit({
      file: options.file,
      editor: options.editor,
    });
  });

// Permissions commands
const permissions = program.command('permissions').description('Permission management');

permissions
  .command('mode')
  .description('Show current permission mode')
  .action(async () => {
    const globalOpts = program.opts();
    await permissionsMode({
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

permissions
  .command('set <mode>')
  .description('Set permission mode (interactive/auto/disabled)')
  .action(async (mode) => {
    const globalOpts = program.opts();
    await permissionsSet(mode as 'interactive' | 'auto' | 'disabled', {
      serverUrl: globalOpts.server,
    });
  });

permissions
  .command('auto-approve')
  .description('Toggle auto-approve actions')
  .option('--enable', 'Enable auto-approve')
  .option('--disable', 'Disable auto-approve')
  .action(async (options) => {
    const globalOpts = program.opts();
    await permissionsAutoApprove({
      serverUrl: globalOpts.server,
      enable: options.enable,
      disable: options.disable,
    });
  });

permissions
  .command('policies')
  .description('List active policies')
  .action(async () => {
    const globalOpts = program.opts();
    await permissionsPolicies({
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

permissions
  .command('tools')
  .description('List all tool permissions')
  .action(async () => {
    const globalOpts = program.opts();
    await permissionsTools({
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

permissions
  .command('grant <tool>')
  .description('Grant permission for a tool')
  .action(async (tool) => {
    const globalOpts = program.opts();
    await permissionsGrant(tool, {
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

permissions
  .command('revoke <tool>')
  .description('Revoke permission for a tool')
  .action(async (tool) => {
    const globalOpts = program.opts();
    await permissionsRevoke(tool, {
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

// Config commands
const config = program.command('config').description('Configuration management');

config
  .command('get [key]')
  .description('Get configuration value(s)')
  .action(async (key) => {
    const globalOpts = program.opts();
    await configGet(key, {
      json: globalOpts.json,
    });
  });

config
  .command('set <key> <value>')
  .description('Set configuration value')
  .action(async (key, value) => {
    await configSet(key, value);
  });

config
  .command('categories')
  .description('List configuration categories')
  .action(async () => {
    const globalOpts = program.opts();
    await configCategories({
      json: globalOpts.json,
    });
  });

config
  .command('category <name>')
  .description('Show category settings')
  .action(async (name) => {
    const globalOpts = program.opts();
    await configCategory(name, {
      json: globalOpts.json,
    });
  });

config
  .command('reset')
  .description('Reset all settings to benchmark-proven optimal defaults (preserves API keys)')
  .option('--include-keys', 'Also reset API keys to empty')
  .action(async (opts) => {
    await configReset({
      includeKeys: opts.includeKeys,
    });
  });

// Auto-research keep/discard gate (recursive self-improvement decision layer)
const autoresearch = program
  .command('autoresearch')
  .description('Auto-research keep/discard decision gate (Monte-Carlo, FWER-adjusted)');

autoresearch
  .command('evaluate')
  .description('Run the keep/discard gate over recorded base/candidate runs → writes .cortex/experiments.jsonl')
  .requiredOption('--experiment-tag <tag>', 'experiment / swarm-member id')
  .requiredOption('--base <ref>', 'base harness ref (control)')
  .requiredOption('--candidate <ref>', 'candidate harness ref (under test)')
  .requiredOption('--branch <branch>', 'worktree branch the experiment runs on')
  .option('--deficiency-id <id>', 'ResearchBacklog deficiency this experiment addresses')
  .option('--benchmark-source <src>', "which benchmark lens (cortex-bench | swebench | …)")
  .option('--model-id <id>', 'restrict comparison to one model (default: all pooled)')
  .option('--n-family <n>', 'parallel experiments in the family (FWER N)', '1')
  .option('--alpha <a>', 'family-wise significance level', '0.05')
  .option('--seed <s>', 'PRNG seed for reproducible verdict')
  .option('--epsilon <e>', 'regression dead-band on the 0-100 scale')
  .option('--min-runs <n>', 'minimum runs per arm for a task to count')
  .option('--verify-holdout', 'also run the held-out gate (merge needs both)')
  .action(async (opts) => {
    const globalOpts = program.opts();
    await autoResearchEvaluate({ ...opts, json: globalOpts.json });
  });

autoresearch
  .command('fix')
  .description('Headless autonomous coding-agent edit of a worktree (Edit/Write/Bash, no approval) — edits, does NOT commit')
  .requiredOption('--cwd <path>', 'worktree to edit (the candidate checkout)')
  .option('--prompt <text>', 'fix instruction (deficiency description + repro + strategy; NO task sets)')
  .option('--prompt-file <path>', 'read the fix instruction from a file')
  .option('--model <id>', 'coding model (default: DEFAULT_MODEL_ID)')
  .option('--max-iterations <n>', 'max tool iterations')
  .action(async (opts) => {
    const globalOpts = program.opts();
    await autoResearchFix({ ...opts, json: globalOpts.json });
  });

autoresearch
  .command('experiment')
  .description('Full single experiment: build+serve base & candidate → bench both arms (train+holdout) → gate → verdict + JSONL artifact')
  .requiredOption('--experiment-tag <tag>', 'experiment / swarm-member id')
  .requiredOption('--candidate-dir <path>', 'checkout/worktree with the candidate fix (gets built + served)')
  .requiredOption('--task-set <path>', 'TRAIN task-set JSON file or dir (drives keep/discard)')
  .option('--base-dir <path>', 'base checkout (default: project root; assumed prebuilt unless --build-base)')
  .option('--holdout-set <path>', 'HOLDOUT task-set (separate file; required for a mergeable verdict)')
  .option('--branch <name>', 'branch label for the ledger record (default: candidate ref)')
  .option('--n-family <n>', 'parallel experiments this round (FWER width)', '1')
  .option('--runs <n>', 'runs per task per arm', '2')
  .option('--model <id>', 'model both arms use (default: DEFAULT_MODEL_ID)')
  .option('--deficiency-id <id>', 'ResearchBacklog deficiency this addresses')
  .option('--benchmark-source <src>', 'benchmark source label')
  .option('--base-ref <ref>', 'override base harness label (default: git short SHA of base-dir)')
  .option('--candidate-ref <ref>', 'override candidate harness label (default: git short SHA of candidate-dir)')
  .option('--build-base', 'also run npm build in base-dir (default: assume prebuilt)')
  .option('--no-build', 'skip the candidate build (config/env experiments where code is unchanged)')
  .option('--base-port <n>', 'base server port (default: auto free port)')
  .option('--candidate-port <n>', 'candidate server port (default: auto free port)')
  .option('--cortex-dir <path>', 'shared .cortex store + JSONL artifact dir (default: project root)')
  .option('--seed <s>', 'PRNG seed for reproducible verdict')
  .option('--alpha <a>', 'family-wise significance level')
  .option('--epsilon <e>', 'regression dead-band (0-100)')
  .option('--min-runs <n>', 'min runs per arm for a task to count')
  .action(async (opts) => {
    const globalOpts = program.opts();
    await autoResearchExperiment({ ...opts, json: globalOpts.json });
  });

autoresearch
  .command('bench')
  .description('Run + grade a task set through the harness → writes REAL scored records to router-matrix.jsonl')
  .requiredOption('--task-set <path>', 'task-set JSON file or directory of *.json (prompt + verifier per task)')
  .requiredOption('--experiment-tag <tag>', 'experiment / swarm-member id')
  .option('--runs <n>', 'runs per task (>=2 for significance)', '2')
  .option('--split <split>', "train | holdout (holdout is the overfitting-proof verifier set)", 'train')
  .option('--model <id>', 'model to bench (default: DEFAULT_MODEL_ID)')
  .option('--harness-ref <ref>', 'override the auto-stamped git SHA (single-box base/candidate sim)')
  .option('--benchmark-source <src>', 'benchmark source label (default: cortex-bench)')
  .option('--server-url <url>', 'cortex server URL (default: $CORTEX_SERVER_URL or http://localhost:4000)')
  .option('--run-cmd <template>', 'NON-CORTEX target: grade a shell command per task ({prompt}/{case} substituted) instead of a cortex server — pair with numeric verifiers')
  .option('--build-cmd <cmd>', 'one-shot build, run once in --cwd before benching a --run-cmd target')
  .option('--cwd <dir>', 'working dir for --run-cmd/--build-cmd (default: project root)')
  .option('--accept-exit <codes>', 'comma list of exit codes whose stdout is graded (default 0)', '0')
  .option('--no-seed-backlog', 'do not auto-seed a deficiency for each failing task (use for candidate-worktree benches)')
  .action(async (opts) => {
    const globalOpts = program.opts();
    await autoResearchBench({ ...opts, json: globalOpts.json });
  });

autoresearch
  .command('list')
  .description('Show recorded keep/discard decisions from .cortex/experiments.jsonl')
  .option('--decision <d>', 'filter: keep | discard | pending')
  .action(async (opts) => {
    const globalOpts = program.opts();
    await autoResearchList({ decision: opts.decision, json: globalOpts.json });
  });

// Tmux terminal integration commands
const tmux = program.command('tmux').description('Tmux terminal integration');

tmux
  .command('list')
  .description('List all tmux sessions')
  .action(async () => {
    const globalOpts = program.opts();
    await tmuxList({
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

// Middleware commands
const middleware = program.command('middleware').description('Middleware system management');

middleware
  .command('list')
  .description('List all middleware systems')
  .action(async () => {
    const globalOpts = program.opts();
    await middlewareList({
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

middleware
  .command('status <name>')
  .description('Show middleware status and configuration')
  .action(async (name) => {
    const globalOpts = program.opts();
    await middlewareStatus(name, {
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

middleware
  .command('enable <name>')
  .description('Enable a middleware system')
  .action(async (name) => {
    const globalOpts = program.opts();
    await middlewareEnable(name, {
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

middleware
  .command('disable <name>')
  .description('Disable a middleware system')
  .action(async (name) => {
    const globalOpts = program.opts();
    await middlewareDisable(name, {
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

middleware
  .command('config <name>')
  .description('Show middleware configuration details')
  .action(async (name) => {
    const globalOpts = program.opts();
    await middlewareConfig(name, {
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

// Artifact commands
const artifact = program.command('artifact').description('Artifact system - Visual programming');

artifact
  .command('list')
  .description('List all artifacts')
  .option('--status <status>', 'Filter by status (running, stopped, all)')
  .option('--type <type>', 'Filter by type')
  .action(async (options) => {
    const globalOpts = program.opts();
    await artifactList({
      serverUrl: globalOpts.server,
      json: globalOpts.json,
      status: options.status,
      type: options.type,
    });
  });

artifact
  .command('stop <id>')
  .description('Stop artifact')
  .action(async (id) => {
    const globalOpts = program.opts();
    await artifactStop(id, {
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

artifact
  .command('restart <id>')
  .description('Restart artifact')
  .action(async (id) => {
    const globalOpts = program.opts();
    await artifactRestart(id, {
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

artifact
  .command('status <id>')
  .description('Show artifact status')
  .action(async (id) => {
    const globalOpts = program.opts();
    await artifactStatus(id, {
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

// Session compact command
sessions
  .command('compact <id>')
  .description('Manually trigger compaction')
  .action(async (id) => {
    const globalOpts = program.opts();
    await sessionCompact(id, {
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

// Context Management commands
const context = program.command('context').description('Context budget management');

context
  .command('status <session-id>')
  .description('Show context budget status')
  .action(async (sessionId) => {
    const globalOpts = program.opts();
    await contextStatus(sessionId, {
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

context
  .command('compact <session-id>')
  .description('Trigger manual compaction')
  .action(async (sessionId) => {
    const globalOpts = program.opts();
    await contextCompact(sessionId, {
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

context
  .command('boundaries <session-id>')
  .description('List compaction boundaries')
  .action(async (sessionId) => {
    const globalOpts = program.opts();
    await contextBoundaries(sessionId, {
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

context
  .command('strategy [strategy]')
  .description('Get or set context strategy')
  .action(async (strategy) => {
    const globalOpts = program.opts();
    await contextStrategy(strategy, {
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

context
  .command('savings')
  .description('Show token savings from compaction')
  .action(async () => {
    const globalOpts = program.opts();
    await contextSavings({
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

// Tools commands
const tools = program.command('tools').description('Tool management');

tools
  .command('list')
  .description('List all available tools')
  .option('--grouped', 'Group tools by category')
  .action(async (options) => {
    const globalOpts = program.opts();
    await toolsList({
      serverUrl: globalOpts.server,
      json: globalOpts.json,
      grouped: options.grouped,
    });
  });

tools
  .command('info <name>')
  .description('Show detailed tool information')
  .action(async (name) => {
    const globalOpts = program.opts();
    await toolsInfo(name, {
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

// Cache commands
const cache = program.command('cache').description('Prompt cache management');

cache
  .command('metrics <session-id>')
  .description('Show cache metrics for session')
  .action(async (sessionId) => {
    const globalOpts = program.opts();
    await cacheMetrics(sessionId, {
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

// System Messages commands
const systemMessages = program.command('system-messages').description('System message management');

systemMessages
  .command('list')
  .description('List available system messages')
  .action(async () => {
    const globalOpts = program.opts();
    await systemMessagesList({
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

systemMessages
  .command('view <id>')
  .description('View system message content')
  .action(async (id) => {
    const globalOpts = program.opts();
    await systemMessagesView(id, {
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

systemMessages
  .command('reload')
  .description('Reload system messages from disk')
  .action(async () => {
    const globalOpts = program.opts();
    await systemMessagesReload({
      serverUrl: globalOpts.server,
      json: globalOpts.json,
    });
  });

// `ui` interactive command group moved to @nexus-cortex/tui (neoncortex / cli-full).

// Error handling
program.exitOverride((err) => {
  if (err.code !== 'commander.version' && err.code !== 'commander.helpDisplayed') {
    console.error(chalk.red('Error:'), err.message);
    process.exit(1);
  }
  process.exit(0);
});

// Parse command line
program.parse();
