/**
 * Interactive chat mode with enhanced formatting
 */
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { OrchestratorClient, type ReasoningEffort } from '@nexus-cortex/cli/dist/orchestrator/OrchestratorClient.js';
import { ThemeManager } from '@nexus-cortex/cli/dist/themes/ThemeManager.js';
import { ToolFormatter, generateAndParseDiff, parseUnifiedDiff } from '@nexus-cortex/cli/dist/utils/ToolFormatter.js';
import type { DiffContent, FileContent } from '@nexus-cortex/cli/dist/utils/ToolFormatter.js';
import { MarkdownRenderer } from '@nexus-cortex/cli/dist/utils/MarkdownRenderer.js';
import { parseSlashCommand } from '@nexus-cortex/cli/dist/commands/slash/SlashCommandParser.js';
import { commandPalette } from '@nexus-cortex/cli/dist/commands/slash/CommandPalette.js';
import { slashCommandRegistry } from '@nexus-cortex/cli/dist/commands/slash/SlashCommandRegistry.js';
import { createSystemMessageCommand } from '../system-message/index.js';
import { createAgentCommand, listAgents, showAgentInfo } from '../agent/index.js';
import { renderSplashScreen, renderCompactHeader, type StatusLineState } from '../../ui/SplashScreen.js';
import { rawQuestion } from '../../ui/RawInput.js';
import { createPersistentInput } from '../../ui/PersistentInput.js';
import { runThemePicker } from '../../ui/ChalkThemePicker.js';
import { showModelPicker } from '../../ui/InkModelPicker.js';
import type { ModelDisplayInfo } from '@nexus-cortex/core';
import { MentorshipConfigService } from '@nexus-cortex/core';
import { loadPersistedModelForPlatform, type Platform } from '@nexus-cortex/cli/dist/themes/colors.js';
import { showInteractiveMenu } from '../../ui/InkMenuPicker.js';
import { showCommandPalette } from '../../ui/InkCommandPalette.js';
import { showHelp } from '../../ui/InkHelp.js';
import { showApprovalDialog } from '../../ui/InkApprovalDialog.js';
import * as readline from 'readline';

// Platform identifier for fuzzycortex CLI
const PLATFORM: Platform = 'fuzzycortex';

export interface ChatOptions {
  serverUrl?: string;
  model?: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string | any[];
}

/**
 * Generate diff preview from Edit tool parameters
 * Uses the shared DiffParser from core
 */
function generateDiffPreview(oldString: string, newString: string, filePath: string): DiffContent | null {
  return generateAndParseDiff(oldString, newString, filePath);
}

export async function interactiveChat(options: ChatOptions): Promise<void> {
  /**
   * Startup cleanup - reset terminal in case previous session crashed
   * This ensures we start with a clean terminal state
   */
  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(false);
    } catch {
      // Ignore - stdin may already be in normal mode
    }
  }
  process.stdout.write(
    '\x1b[?25h' +  // Show cursor (may have been hidden)
    '\x1b[0m' +    // Reset text attributes
    '\x1b[r' // Reset scroll region to full screen
  );

  /**
   * Reset terminal to clean state
   * Called on exit, crash, or signal to prevent terminal pollution
   */
  const resetTerminal = () => {
    // Reset to normal mode (not raw)
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(false);
      } catch {
        // Ignore errors if stdin is already closed
      }
    }
    // Show cursor
    process.stdout.write('\x1b[?25h');
    // Reset all attributes
    process.stdout.write('\x1b[0m');
    // Reset scroll region
    process.stdout.write('\x1b[r');
    // Move to new line
    process.stdout.write('\n');
  };

  // ESC abort tracking - declared early so handlers can access them
  let escPressed = false;
  let isAborting = false;

  // Register cleanup handlers for various exit scenarios
  process.on('exit', resetTerminal);
  process.on('SIGINT', () => {
    resetTerminal();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    resetTerminal();
    process.exit(143);
  });
  process.on('uncaughtException', (err) => {
    // If we're in the middle of an ESC abort, don't crash - this is expected
    if (isAborting || escPressed) {
      // Log but don't exit during intentional abort
      if (process.env.DEBUG === 'true') {
        console.error('[DEBUG] Suppressed uncaught exception during ESC abort:', err.message);
      }
      return;
    }
    resetTerminal();
    console.error('Uncaught exception:', err);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    // If we're in the middle of an ESC abort, don't crash - this is expected
    // The SDK may reject promises after we've aborted the stream
    if (isAborting || escPressed) {
      // Log but don't exit during intentional abort
      if (process.env.DEBUG === 'true') {
        console.error('[DEBUG] Suppressed unhandled rejection during ESC abort:', reason);
      }
      return;
    }
    resetTerminal();
    console.error('Unhandled rejection:', reason);
    process.exit(1);
  });

  const theme = ThemeManager.getExtendedTheme();
  const toolFormatter = new ToolFormatter();
  const markdownRenderer = new MarkdownRenderer();

  // Determine mode: Check environment variable set by launcher
  const envMode = (process.env.CORTEX_MODE);
  const mode = envMode === 'server' ? 'server' : 'direct';
  const serverUrl = options.serverUrl;

  // Create orchestrator client (don't initialize yet - need to set callbacks first)
  // projectPath = user's cwd (where tools resolve files). CORTEX_ROOT is for config only.
  // Priority: CLI arg > persisted model (fuzzycortex) > env var > fallback
  const persistedModel = loadPersistedModelForPlatform(PLATFORM);
  const effectiveModelId = options.model || persistedModel || process.env.DEFAULT_MODEL_ID || 'grok-code-fast-1';

  const client = new OrchestratorClient({
    mode,
    serverUrl,
    defaultModelId: effectiveModelId,
    projectPath: process.env.PROJECT_PATH || process.cwd(),
    debug: process.env.DEBUG === 'true'
  });

  // Note: client.initialize() is called after persistentInput is created
  //       so we can wire up the input handler callbacks for approval dialogs

  // DEBUG Mode: Show/hide debug logs
  // Initialize from .env DEBUG setting
  let showDebug = process.env.DEBUG === 'true';

  // PHASE 2.8: Extended Thinking Display
  // Track thinking display state (Tab key toggle)
  let showThinking = false;

  // Track if we're in tool execution mode (for interleaved thinking)
  // Interleaved thinking (during tool calls) is ALWAYS shown
  // Extended thinking (front/rear loaded) respects Tab toggle
  let isInToolExecution = false;

  // Track reasoning effort for OpenAI GPT-5 models
  // Tab toggle switches between 'none' and 'high' for models that support reasoning
  let reasoningEffort: ReasoningEffort = 'none';

  // Track auto-approve and YOLO mode states for status line
  let autoApproveEnabled = false;
  let yoloModeEnabled = false;

  /**
   * Get current status line state for rendering
   */
  const getStatusState = (): StatusLineState => {
    const currentModel = client.getCurrentModel();
    return {
      model: currentModel?.id || options.model || process.env.DEFAULT_MODEL_ID || 'default',
      showThinking,
      reasoningEffort,
      supportsReasoning: currentModel?.reasoning?.supported === true,
      autoApprove: autoApproveEnabled,
      yoloMode: yoloModeEnabled,
    };
  };

  // Display compact header on startup (full splash available via /about)
  console.clear();
  console.log(renderCompactHeader({
    model: options.model || process.env.DEFAULT_MODEL_ID || 'default',
    cwd: process.cwd(),
  }));

  // Show debug status inline if enabled
  if (showDebug) {
    console.log(theme.colors.warning(' DEBUG ON') + theme.dimmed(' - use /debug to toggle'));
  }

  // Create readline interface for sub-prompts (e.g., /continue session selection)
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Abort controller for cancelling streaming/tool execution (ESC key)
  let currentAbortController: AbortController | null = null;

  // Document expansion state for collapsible document previews
  const expandedDocuments = new Set<string>();
  let documentsExpanded = false; // Global toggle for all documents
  let loadedSessionMessages: any[] = []; // Store loaded session messages for re-rendering

  /**
   * Toggle handlers for raw input mode
   */
  const onToggleThinking = () => {
    showThinking = !showThinking;

    // Also toggle reasoning effort for models that support it (GPT-5, o-series)
    const currentModel = client.getCurrentModel();
    const supportsReasoning = currentModel?.reasoning?.supported === true;
    if (supportsReasoning) {
      reasoningEffort = showThinking ? 'high' : 'none';
    }
  };

  const onToggleAutoApprove = async () => {
    try {
      const isYoloActive = client.isYoloModeActive();

      if (isYoloActive) {
        // If YOLO is active, disable YOLO AND auto-approve (double off)
        await client.disableYoloMode();
        await client.setApprovalMode(false);
        yoloModeEnabled = false;
        autoApproveEnabled = false;
      } else {
        // Normal toggle of auto-approve mode
        const currentMode = await client.getApprovalMode();
        const newMode = !currentMode.autoApproveActions;
        await client.setApprovalMode(newMode);
        autoApproveEnabled = newMode;
      }
    } catch {
      // Silently ignore errors during toggle
    }
  };

  const onEscape = () => {
    escPressed = true;
    isAborting = true; // Mark that we're intentionally aborting
    // Abort any ongoing operations (tool execution, API calls)
    if (currentAbortController) {
      currentAbortController.abort();
    }
  };

  const onToggleDocuments = () => {
    documentsExpanded = !documentsExpanded;
    // Toggle all document IDs in or out of the expanded set
    const orchestratorHistory = client.getMessageHistory();
    const allMessages = [...loadedSessionMessages, ...orchestratorHistory];

    if (documentsExpanded) {
      // Collect all document IDs from loaded session messages AND orchestrator history
      for (const msg of allMessages) {
        const content = (msg as any).message?.content;
        if (Array.isArray(content)) {
          content.forEach((block: any, i: number) => {
            if (block.type === 'tool_result' && block.metadata?.documentPreview) {
              expandedDocuments.add(`${(msg as any).uuid}-doc-${i}`);
            }
          });
        }
      }
    } else {
      // Collapse all
      expandedDocuments.clear();
    }

    // Clear screen and re-render if we have any messages to show
    if (allMessages.length > 0) {
      // Clear terminal
      process.stdout.write('\x1b[2J\x1b[H');
      console.log(theme.dimmed(`Document previews: ${documentsExpanded ? 'expanded' : 'collapsed'}`));
      console.log();
      // Re-render all messages (loaded session + current conversation)
      renderSessionHistory(allMessages);
    }
  };

  /**
   * Render session history messages with document previews
   */
  const renderSessionHistory = (messages: any[]) => {
    for (const msg of messages) {
      const msgAny = msg as any;
      const actualMsg = msgAny.message || msgAny;
      const role = actualMsg.role;

      // Skip system messages
      if (role === 'system') continue;

      if (role === 'user') {
        // Check if this message contains ONLY tool results
        const hasOnlyToolResults = Array.isArray(actualMsg.content) &&
          actualMsg.content.every((c: any) => c.type === 'tool_result') &&
          actualMsg.content.length > 0;

        if (!hasOnlyToolResults) {
          console.log(theme.colors.info('> You: '));
        }

        if (typeof actualMsg.content === 'string') {
          console.log(actualMsg.content);
        } else if (Array.isArray(actualMsg.content)) {
          actualMsg.content.forEach((c: any, contentIdx: number) => {
            if (c.type === 'text') {
              console.log(c.text);
            } else if (c.type === 'tool_result') {
              if (c.is_error) {
                const result = toolFormatter.formatToolResult({ error: c.content });
                process.stdout.write(result);
              } else {
                const hasDiff = c.metadata?.diff && c.tool_name?.toLowerCase() === 'edit';
                const hasWritePreview = c.metadata?.writePreview && c.tool_name?.toLowerCase() === 'write';
                const hasDocumentPreview = c.metadata?.documentPreview && c.tool_name?.toLowerCase() === 'write';

                if (hasDiff) {
                  const parsedDiff = parseUnifiedDiff(c.metadata.diff);
                  if (parsedDiff) {
                    const fileStats = c.metadata.fileStats;
                    const filePath = fileStats?.path || parsedDiff.file;
                    let additions = 0, deletions = 0;
                    for (const chunk of parsedDiff.chunks) {
                      for (const line of chunk.changes) {
                        if (line.type === 'added') additions++;
                        if (line.type === 'removed') deletions++;
                      }
                    }
                    const summary = `${filePath} +${additions}/-${deletions}`;
                    const result = toolFormatter.formatToolResult({
                      summary: theme.colors.success('✓ ') + summary,
                      diff: parsedDiff
                    });
                    process.stdout.write(result);
                  }
                } else if (hasDocumentPreview) {
                  // Document preview with expand/collapse
                  const docPreview = c.metadata.documentPreview;
                  const docId = `${msgAny.uuid}-doc-${contentIdx}`;
                  const isExpanded = expandedDocuments.has(docId);

                  if (!isExpanded) {
                    // Collapsed view
                    console.log(
                      theme.colors.success('+ ') + chalk.bold(docPreview.filePath) +
                      theme.dimmed(` (${docPreview.lineCount} lines, ${docPreview.wordCount} words)`) +
                      theme.colors.info(' [Ctrl+E to expand]')
                    );
                  } else {
                    // Expanded view
                    console.log(
                      theme.colors.success('- ') + chalk.bold(docPreview.filePath) +
                      theme.dimmed(` (${docPreview.lineCount} lines, ${docPreview.wordCount} words)`) +
                      theme.colors.info(' [Ctrl+E to collapse]')
                    );
                    const absolutePath = path.isAbsolute(docPreview.filePath)
                      ? docPreview.filePath
                      : path.resolve(process.cwd(), docPreview.filePath);
                    try {
                      const content = fs.readFileSync(absolutePath, 'utf-8');
                      const termWidth = process.stdout.columns || 80;
                      const contentWidth = Math.max(termWidth - 6, 40);
                      for (const line of content.split('\n')) {
                        if (line.length <= contentWidth) {
                          console.log(' ' + line);
                        } else {
                          let remaining = line;
                          while (remaining.length > contentWidth) {
                            const bp = remaining.lastIndexOf(' ', contentWidth);
                            const breakPoint = bp > contentWidth * 0.4 ? bp : contentWidth;
                            console.log(' ' + remaining.slice(0, breakPoint));
                            remaining = remaining.slice(breakPoint).trimStart();
                          }
                          if (remaining) console.log(' ' + remaining);
                        }
                      }
                      console.log(theme.dimmed(' ───────────────────────────────────────'));
                    } catch {
                      console.log(theme.colors.error(' [File not found]'));
                    }
                  }
                } else if (hasWritePreview) {
                  // Code file preview with line numbers
                  const preview = c.metadata.writePreview;
                  const formatBytes = (bytes: number) => {
                    if (bytes < 1024) return `${bytes} B`;
                    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
                    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
                  };
                  console.log(
                    theme.colors.success('+ Created ') + preview.filePath +
                    theme.dimmed(` (${preview.lineCount} lines, ${formatBytes(preview.byteSize)})`)
                  );
                  const lines = preview.content.split('\n').slice(0, 50);
                  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
                    const lineNum = String(lineIdx + 1).padStart(4, ' ');
                    console.log(theme.dimmed(`${lineNum} │ `) + lines[lineIdx]);
                  }
                  if (preview.lineCount > 50) {
                    console.log(theme.dimmed(` ... ${preview.lineCount - 50} more lines`));
                  }
                } else {
                  const result = toolFormatter.formatToolResult({
                    summary: typeof c.content === 'string'
                      ? c.content.substring(0, 100) + (c.content.length > 100 ? '...' : '')
                      : 'Tool completed successfully'
                  });
                  process.stdout.write(result);
                }
              }
            }
          });
        }
        console.log();
      } else if (role === 'assistant') {
        const modelName = msgAny.model?.id || 'Assistant';
        console.log(theme.colors.primary(`\n ${modelName}:`));
        console.log();
        markdownRenderer.reset();
        if (typeof actualMsg.content === 'string') {
          const rendered = markdownRenderer.processChunk(actualMsg.content);
          const flushed = markdownRenderer.flush();
          process.stdout.write(rendered);
          if (flushed) process.stdout.write(flushed);
        } else if (Array.isArray(actualMsg.content)) {
          for (const block of actualMsg.content) {
            if (block.type === 'text') {
              const rendered = markdownRenderer.processChunk(block.text);
              const flushed = markdownRenderer.flush();
              process.stdout.write(rendered);
              if (flushed) process.stdout.write(flushed);
            } else if (block.type === 'tool_use') {
              // Handle both nested (block.toolUse) and direct (block.name/block.input) structures
              const toolName = block.toolUse?.name || block.name || 'Unknown';
              const toolInput = block.toolUse?.input || block.input || {};
              const result = toolFormatter.formatToolCall({
                name: toolName,
                params: toolInput
              });
              process.stdout.write(result);
            } else if (block.type === 'thinking') {
              // Skip thinking blocks in display
              continue;
            }
          }
        } else {
          // Fallback for unexpected content format
          console.log(JSON.stringify(actualMsg.content));
        }
        console.log();
      }
    }
  };

  // Create persistent input handler for streaming mode
  const persistentInput = createPersistentInput({
    getStatusState,
    theme,
    onToggleThinking,
    onToggleAutoApprove,
    onToggleDocuments,
    onEscape,
  });

  // Now initialize the client
  if (process.env.DEBUG === 'true') {
    console.log(theme.dimmed(`\n... Initializing ${mode} mode...`));
  }
  await client.initialize();

  // Inject Ink-based approval handler (same React component as neoncortex)
  client.setApprovalHandler({
    requestApproval: async (request: { toolName: string; toolInput: any; reason: string; timestamp: Date }) => {
      // Pause PersistentInput so Ink owns stdin
      if (persistentInput.isCapturing()) {
        persistentInput.clearThinking();
        persistentInput.pause();
      }

      try {
        // Render diff/file preview before the dialog
        if (request.toolName === 'Edit' && request.toolInput?.old_string && request.toolInput?.new_string) {
          const diffPreview = generateDiffPreview(
            request.toolInput.old_string,
            request.toolInput.new_string,
            request.toolInput.file_path || 'file'
          );
          if (diffPreview) {
            process.stdout.write(toolFormatter.formatDiff(diffPreview, true));
          }
        }
        if (request.toolName === 'Write' && request.toolInput?.content) {
          const content = String(request.toolInput.content);
          const filePath = request.toolInput.file_path || 'file';
          const lines = content.split('\n');
          const fileContent: FileContent = {
            file: filePath,
            content: content,
            lineCount: lines.length,
            preview: lines.length > 50
          };
          process.stdout.write(toolFormatter.formatFileContent(fileContent));
        }

        const result = await showApprovalDialog(request);

        if (result === 'yolo') {
          await client.setApprovalMode(true);
          console.log('[OK] Operation approved (auto-approve: ON)');
          return true;
        }
        if (result === 'approve') {
          console.log('[OK] Operation approved');
          return true;
        }
        console.log('[--] Operation skipped');
        return false;
      } finally {
        // Resume PersistentInput
        if (persistentInput.isCapturing()) {
          persistentInput.resume();
        }
      }
    }
  });

  /**
   * Handle slash commands
   */
  async function handleSlashCommand(
    parsed: ReturnType<typeof parseSlashCommand>,
    theme: any,
    rl: readline.Interface,
    prompt: () => void
  ): Promise<void> {
    // Empty command - show interactive command palette
    if (!parsed.command) {
      try {
        const result = await showCommandPalette('/');

        if (result.selected && result.fullPath) {
          // Execute the selected command
          const selectedParsed = parseSlashCommand(result.fullPath);
          await handleSlashCommand(selectedParsed, theme, rl, prompt);
          return;
        }
      } catch (error: any) {
        console.log();
        console.log(theme.errorMessage(`Command palette error: ${error.message}`));
        console.log();
      }
      prompt();
      return;
    }

    // Handle built-in commands
    switch (parsed.command) {
      case '?':
      case 'help':
        if (parsed.subcommand) {
          // Show help for specific command (chalk-based for quick inline display)
          console.log();
          console.log(commandPalette.renderHelp(parsed.subcommand));
          console.log();
          prompt();
        } else {
          // Show full interactive help using shared Ink component
          await showHelp();
          prompt();
        }
        return;

      case 'clear':
        console.log();
        console.log(theme.warningMessage('Note: History clearing not yet implemented'));
        console.log(theme.dimmed('[i] In direct mode, restart the CLI to start a fresh session'));
        console.log();
        prompt();
        return;

      case 'exit':
      case 'quit':
      case 'q':
        console.log();
        console.log(theme.roundedBox(
          'Thank you for using Nexus Cortex!\n' +
          'Your session has been saved.',
          'Goodbye'
        ));
        console.log();
        rl.close();
        process.exit(0);
        return;

      case 'debug':
        showDebug = !showDebug;
        client.setDebug(showDebug);
        console.log();
        if (showDebug) {
          console.log(theme.colors.warning('[DEBUG] ON'));
        } else {
          console.log(theme.dimmed('[DEBUG] OFF'));
        }
        console.log();
        prompt();
        return;

      case 'yolo':
        try {
          // Check if explicitly disabling with /yolo off
          const isDisabling = parsed.args[0] === 'off';
          const isYoloActive = client.isYoloModeActive();

          if (isDisabling || isYoloActive) {
            // Disable YOLO mode
            await client.disableYoloMode();
            yoloModeEnabled = false;
            autoApproveEnabled = false;
            console.log();
            console.log(theme.successMessage('✓ YOLO mode disabled'));
            console.log(theme.dimmed('Interactive approval restored. Blacklist items will prompt for approval.'));
            console.log();
          } else {
            // Enable TRUE YOLO mode - auto-approves ALL (white/gray/blacklist)
            await client.enableYoloMode();
            yoloModeEnabled = true;
            autoApproveEnabled = true;
            console.log();
            console.log(theme.roundedBox(
              ' YOLO MODE ACTIVATED \n\n' +
              'TRUE auto-approve is now ENABLED.\n' +
              'ALL tool executions will be auto-approved!\n' +
              '(Bypasses whitelist/graylist/blacklist)\n\n' +
              'Type /yolo or /yolo off to disable.\n' +
              'Shift+Tab also disables YOLO mode.',
              '⚠  WARNING ⚠'
            ));
            console.log();
          }
        } catch (error: any) {
          console.log();
          console.log(theme.errorMessage(`Error: ${error.message}`));
          console.log();
        }
        prompt();
        return;

      case 'thinking':
        showThinking = !showThinking;
        console.log();
        console.log(theme.infoMessage(`Show thinking: ${showThinking ? 'ON' : 'OFF'}`));
        console.log();
        prompt();
        return;

      case 'about':
        console.log(renderSplashScreen());
        prompt();
        return;

      case 'm':  // Alias for /model
      case 'model':
        // Handle /model picker command - opens directly without subcommand menu
        if (parsed.subcommand === 'picker' || !parsed.subcommand) {
          try {
            console.log();
            console.log(theme.dimmed('... Loading models...'));
            const models = await client.listModels();

            // Clear loading message
            process.stdout.write('\r' + ' '.repeat(30) + '\r');

            if (!models || models.length === 0) {
              console.log(theme.errorMessage('No models available'));
              prompt();
              return;
            }

            // Convert to ModelDisplayInfo format (matching neoncortex mapping)
            const modelInfos: ModelDisplayInfo[] = models.map((m: any) => ({
              id: m.id,
              displayName: m.displayName || m.name || m.id,
              provider: m.owned_by || m.provider || 'Unknown',
              contextWindow: m.contextWindow,
              inputCost: m.inputCostPer1M ?? m.pricing?.input,
              outputCost: m.outputCostPer1M ?? m.pricing?.output,
              supportsReasoning: m.reasoning?.supported === true,
              supportsVision: m.capabilities?.vision,
              supportsStreaming: m.capabilities?.streaming,
            }));

            const currentModel = client.getCurrentModel();
            const currentModelId = currentModel?.id || '';

            const result = await showModelPicker(modelInfos, currentModelId);

            if (result.selected && result.modelId) {
              console.log();
              console.log(theme.dimmed(`... Switching to ${result.modelId}...`));
              await client.switchModel(result.modelId);

              // Persist is already done in the picker
              console.log(theme.successMessage(`✓ Switched to model: ${theme.colors.highlight(result.modelId)}`));
              console.log(theme.dimmed('[i] New messages will use this model'));
              console.log();
            } else {
              console.log(theme.dimmed('\nModel picker cancelled'));
              console.log();
            }
          } catch (error: any) {
            console.log();
            console.log(theme.errorMessage(`Error: ${error.message}`));
            console.log();
          }
        } else {
          console.log();
          console.log(theme.warningMessage(`Unknown subcommand: /model ${parsed.subcommand || ''}`));
          console.log(theme.dimmed('[i] Available:'));
          console.log(theme.dimmed(' /model picker   - Open interactive model picker'));
          console.log(theme.dimmed(' /model          - Open interactive model picker'));
          console.log();
        }
        prompt();
        return;

      case 'session':
        if (parsed.subcommand === 'checkpoint') {
          const checkpointName = parsed.args.join(' ') || `Checkpoint ${new Date().toLocaleString()}`;
          try {
            console.log();
            console.log(theme.dimmed('... Creating checkpoint...'));
            const checkpoint = await client.createCheckpoint(checkpointName);

            // Clear loading message
            process.stdout.write('\r' + ' '.repeat(40) + '\r');

            console.log(theme.dimmed('━'.repeat(60)));
            console.log(`${theme.colors.info('▸')} ${theme.colors.primary('Checkpoint Created')}`);
            console.log(theme.dimmed('━'.repeat(60)));
            console.log();
            console.log(` ${theme.colors.secondary('ID:')} ${theme.colors.highlight(checkpoint.id)}`);
            if (checkpoint.name) {
              console.log(` ${theme.colors.secondary('Name:')} ${theme.text(checkpoint.name)}`);
            }
            console.log(` ${theme.colors.secondary('Messages:')} ${theme.dimmed(checkpoint.messageCount || 0)}`);
            console.log();
            console.log(theme.dimmed('━'.repeat(60)));
            console.log(theme.dimmed('[i] Use /session resume <id> to restore this checkpoint'));
            console.log(theme.dimmed('━'.repeat(60)));
            console.log();
          } catch (error: any) {
            console.log();
            console.log(theme.errorMessage(`Error creating checkpoint: ${error.message}`));
            console.log();
          }
        } else if (parsed.subcommand === 'list') {
          try {
            console.log();
            console.log(theme.dimmed('... Loading sessions...'));
            const result = await client.listSessions();
            const sessions = result.sessions;

            // Clear loading message
            process.stdout.write('\r' + ' '.repeat(40) + '\r');

            console.log(theme.dimmed('━'.repeat(60)));
            console.log(`${theme.colors.info('▸')} ${theme.colors.primary('Sessions')}`);
            console.log(theme.dimmed('━'.repeat(60)));
            console.log();

            if (sessions && sessions.length > 0) {
              sessions.slice(0, 10).forEach((session: any) => {
                const id = theme.colors.highlight(session.id);
                const name = session.name ? theme.text(session.name) : theme.dimmed('(unnamed)');
                const messages = theme.dimmed(`${session.messageCount || 0} messages`);
                console.log(` ${id} - ${name} ${messages}`);
              });

              if (sessions.length > 10) {
                console.log();
                console.log(theme.dimmed(` ... and ${sessions.length - 10} more`));
              }
            } else {
              console.log(theme.dimmed(' No sessions found'));
            }

            console.log();
            console.log(theme.dimmed('━'.repeat(60)));
            console.log();
          } catch (error: any) {
            console.log();
            console.log(theme.errorMessage(`Error loading sessions: ${error.message}`));
            console.log();
          }
        } else {
          console.log();
          console.log(theme.warningMessage(`Unknown subcommand: /session ${parsed.subcommand || ''}`));
          console.log(theme.dimmed('[i] Available: /session checkpoint [name], /session list'));
          console.log();
        }
        prompt();
        return;

      case 'cache':
        if (parsed.subcommand === 'metrics') {
          try {
            console.log();
            console.log(theme.dimmed('... Loading cache metrics...'));
            const metrics = await client.getCacheMetrics();

            // Clear loading message
            process.stdout.write('\r' + ' '.repeat(40) + '\r');

            console.log(theme.dimmed('━'.repeat(60)));
            console.log(`${theme.colors.info('▸')} ${theme.colors.primary('Cache Metrics')}`);
            console.log(theme.dimmed('━'.repeat(60)));
            console.log();

            // Display metrics
            if (metrics?.metrics) {
              const m = metrics.metrics;
              const hitRate = m.overallCacheHitRate ? `${(m.overallCacheHitRate * 100).toFixed(1)}%` : '0%';
              const costSavings = m.overallCostSavingsRatio ? `${(m.overallCostSavingsRatio * 100).toFixed(1)}%` : '0%';

              console.log(` ${theme.colors.secondary('Total Requests:')} ${theme.dimmed(m.requestCount || 0)}`);
              console.log(` ${theme.colors.secondary('Requests with Cache Hits:')} ${theme.dimmed(m.requestsWithCacheHits || 0)}`);
              console.log();
              console.log(` ${theme.colors.secondary('Total Input Tokens:')} ${theme.dimmed((m.totalInputTokens || 0).toLocaleString())}`);
              console.log(` ${theme.colors.secondary(' Cache Creation:')} ${theme.dimmed((m.totalCacheCreationTokens || 0).toLocaleString())}`);
              console.log(` ${theme.colors.secondary(' Cache Reads:')} ${theme.colors.success((m.totalCacheReadTokens || 0).toLocaleString())}`);
              console.log(` ${theme.colors.secondary(' Uncached:')} ${theme.dimmed((m.totalUncachedInputTokens || 0).toLocaleString())}`);
              console.log();
              console.log(` ${theme.colors.secondary('Cache Hit Rate:')} ${theme.colors.highlight(hitRate)}`);
              console.log(` ${theme.colors.secondary('Est. Cost Savings:')} ${theme.colors.success(costSavings)}`);

              // Show provider breakdown if available
              if (Object.keys(m.byProvider || {}).length > 0) {
                console.log();
                console.log(` ${theme.colors.secondary('By Provider:')}`);
                for (const [provider, pm] of Object.entries(m.byProvider) as [string, any][]) {
                  const providerHitRate = pm.cacheHitRate ? `${(pm.cacheHitRate * 100).toFixed(1)}%` : '0%';
                  console.log(` ${theme.dimmed(provider)}: ${pm.cacheReadTokens.toLocaleString()} cached (${providerHitRate})`);
                }
              }
            } else {
              console.log(theme.dimmed(' No cache metrics available'));
              console.log(theme.dimmed(' [i] Make some API requests with caching enabled'));
            }

            console.log();
            console.log(theme.dimmed('━'.repeat(60)));
            console.log();
          } catch (error: any) {
            console.log();
            console.log(theme.errorMessage(`Error loading cache metrics: ${error.message}`));
            console.log();
          }
        } else if (parsed.subcommand === 'report') {
          try {
            console.log();
            console.log(theme.dimmed('... Generating cache report...'));
            const report = await client.getCacheReport();

            // Clear loading message
            process.stdout.write('\r' + ' '.repeat(40) + '\r');

            console.log(theme.dimmed('━'.repeat(60)));
            console.log(`${theme.colors.info('▸')} ${theme.colors.primary('Cache Report')}`);
            console.log(theme.dimmed('━'.repeat(60)));
            console.log();

            if (report) {
              console.log(theme.text(report));
            } else {
              console.log(theme.dimmed(' No report available'));
            }

            console.log();
            console.log(theme.dimmed('━'.repeat(60)));
            console.log();
          } catch (error: any) {
            console.log();
            console.log(theme.errorMessage(`Error generating cache report: ${error.message}`));
            console.log();
          }
        } else {
          console.log();
          console.log(theme.warningMessage(`Unknown subcommand: /cache ${parsed.subcommand || ''}`));
          console.log(theme.dimmed('[i] Available: /cache metrics, /cache report'));
          console.log();
        }
        prompt();
        return;

      case 'mcp':
        if (parsed.subcommand === 'list') {
          try {
            console.log();
            console.log(theme.dimmed('... Loading MCP servers...'));
            const result = await client.listMcpServers();
            const servers = result.servers;

            // Clear loading message
            process.stdout.write('\r' + ' '.repeat(40) + '\r');

            console.log(theme.dimmed('━'.repeat(60)));
            console.log(`${theme.colors.info('▸')} ${theme.colors.primary('MCP Servers')}`);
            console.log(theme.dimmed('━'.repeat(60)));
            console.log();

            if (servers && servers.length > 0) {
              servers.forEach((server: any) => {
                const name = theme.colors.highlight(server.name);
                const status = server.enabled
                  ? theme.colors.success('enabled')
                  : theme.dimmed('disabled');
                const description = server.description
                  ? theme.dimmed(` - ${server.description}`)
                  : '';
                console.log(` ${name} ${status}${description}`);
              });
            } else {
              console.log(theme.dimmed(' No MCP servers configured'));
            }

            console.log();
            console.log(theme.dimmed('━'.repeat(60)));
            console.log(theme.dimmed('[i] Use /mcp enable/disable <name> to toggle servers'));
            console.log(theme.dimmed('━'.repeat(60)));
            console.log();
          } catch (error: any) {
            console.log();
            console.log(theme.errorMessage(`Error loading MCP servers: ${error.message}`));
            console.log();
          }
        } else if (parsed.subcommand === 'enable') {
          const serverName = parsed.args[0];
          if (!serverName) {
            console.log();
            console.log(theme.errorMessage('Error: Server name required'));
            console.log(theme.dimmed('[i] Usage: /mcp enable <server-name>'));
            console.log(theme.dimmed('[i] Use /mcp list to see available servers'));
            console.log();
          } else {
            try {
              console.log();
              console.log(theme.dimmed(`... Enabling ${serverName}...`));
              await client.enableMCPServer(serverName);

              // Clear loading message
              process.stdout.write('\r' + ' '.repeat(50) + '\r');

              console.log(theme.successMessage(`✓ Enabled MCP server: ${theme.colors.highlight(serverName)}`));
              console.log();
            } catch (error: any) {
              console.log();
              console.log(theme.errorMessage(`Error enabling MCP server: ${error.message}`));
              console.log(theme.dimmed('[i] Use /mcp list to see available servers'));
              console.log();
            }
          }
        } else if (parsed.subcommand === 'disable') {
          const serverName = parsed.args[0];
          if (!serverName) {
            console.log();
            console.log(theme.errorMessage('Error: Server name required'));
            console.log(theme.dimmed('[i] Usage: /mcp disable <server-name>'));
            console.log(theme.dimmed('[i] Use /mcp list to see available servers'));
            console.log();
          } else {
            try {
              console.log();
              console.log(theme.dimmed(`... Disabling ${serverName}...`));
              await client.disableMCPServer(serverName);

              // Clear loading message
              process.stdout.write('\r' + ' '.repeat(50) + '\r');

              console.log(theme.successMessage(`✓ Disabled MCP server: ${theme.colors.highlight(serverName)}`));
              console.log();
            } catch (error: any) {
              console.log();
              console.log(theme.errorMessage(`Error disabling MCP server: ${error.message}`));
              console.log(theme.dimmed('[i] Use /mcp list to see available servers'));
              console.log();
            }
          }
        } else {
          console.log();
          console.log(theme.warningMessage(`Unknown subcommand: /mcp ${parsed.subcommand || ''}`));
          console.log(theme.dimmed('[i] Available: /mcp list, /mcp enable <name>, /mcp disable <name>'));
          console.log();
        }
        prompt();
        return;

      case 'tools':
        if (parsed.subcommand === 'list') {
          const grouped = parsed.args.includes('--grouped');
          try {
            console.log();
            console.log(theme.dimmed('... Loading tools...'));
            const tools = await client.listTools();

            // Clear loading message
            process.stdout.write('\r' + ' '.repeat(40) + '\r');

            console.log(theme.dimmed('━'.repeat(60)));
            console.log(`${theme.colors.info('▸')} ${theme.colors.primary('Available Tools')}`);
            console.log(theme.dimmed('━'.repeat(60)));
            console.log();

            if (tools && tools.length > 0) {
              if (grouped) {
                // Group by category
                const categories = new Map<string, any[]>();
                tools.forEach((tool: any) => {
                  const category = tool.category || 'Other';
                  if (!categories.has(category)) {
                    categories.set(category, []);
                  }
                  categories.get(category)!.push(tool);
                });

                categories.forEach((toolList, category) => {
                  console.log(` ${theme.colors.secondary(category)}:`);
                  toolList.forEach((tool: any) => {
                    const name = theme.colors.highlight(tool.name);
                    const description = tool.description
                      ? theme.dimmed(` - ${tool.description}`)
                      : '';
                    console.log(` ${name}${description}`);
                  });
                  console.log();
                });
              } else {
                // Flat list
                tools.forEach((tool: any) => {
                  const name = theme.colors.highlight(tool.name);
                  const description = tool.description
                    ? theme.dimmed(` - ${tool.description}`)
                    : '';
                  console.log(` ${name}${description}`);
                });
              }
            } else {
              console.log(theme.dimmed(' No tools available'));
            }

            console.log();
            console.log(theme.dimmed('━'.repeat(60)));
            console.log(theme.dimmed('[i] Use /tools info <tool-name> for details'));
            console.log(theme.dimmed('━'.repeat(60)));
            console.log();
          } catch (error: any) {
            console.log();
            console.log(theme.errorMessage(`Error loading tools: ${error.message}`));
            console.log();
          }
        } else if (parsed.subcommand === 'info') {
          const toolName = parsed.args[0];
          if (!toolName) {
            console.log();
            console.log(theme.errorMessage('Error: Tool name required'));
            console.log(theme.dimmed('[i] Usage: /tools info <tool-name>'));
            console.log(theme.dimmed('[i] Use /tools list to see available tools'));
            console.log();
          } else {
            try {
              console.log();
              console.log(theme.dimmed(`... Loading tool info...`));
              const toolInfo = await client.getToolInfo(toolName);

              // Clear loading message
              process.stdout.write('\r' + ' '.repeat(40) + '\r');

              console.log(theme.dimmed('━'.repeat(60)));
              console.log(`${theme.colors.info('▸')} ${theme.colors.primary('Tool Information')}`);
              console.log(theme.dimmed('━'.repeat(60)));
              console.log();

              if (toolInfo) {
                console.log(` ${theme.colors.secondary('Name:')} ${theme.colors.highlight(toolInfo.name)}`);
                if (toolInfo.description) {
                  console.log(` ${theme.colors.secondary('Description:')} ${theme.text(toolInfo.description)}`);
                }
                if (toolInfo.category) {
                  console.log(` ${theme.colors.secondary('Category:')} ${theme.dimmed(toolInfo.category)}`);
                }
                if (toolInfo.parameters) {
                  console.log();
                  console.log(` ${theme.colors.secondary('Parameters:')}`);
                  console.log(` ${theme.dimmed(JSON.stringify(toolInfo.parameters, null, 2))}`);
                }
              } else {
                console.log(theme.dimmed(' Tool not found'));
              }

              console.log();
              console.log(theme.dimmed('━'.repeat(60)));
              console.log();
            } catch (error: any) {
              console.log();
              console.log(theme.errorMessage(`Error loading tool info: ${error.message}`));
              console.log(theme.dimmed('[i] Use /tools list to see available tools'));
              console.log();
            }
          }
        } else {
          console.log();
          console.log(theme.warningMessage(`Unknown subcommand: /tools ${parsed.subcommand || ''}`));
          console.log(theme.dimmed('[i] Available: /tools list [--grouped], /tools info <name>'));
          console.log();
        }
        prompt();
        return;

      case 'config':
        if (!parsed.subcommand || (parsed.subcommand === 'set' && !parsed.args[0])) {
          // /config or /config set (no args) — open interactive menu
          rl.pause();
          const { showConfigMenu } = await import('../../ui/InkConfigMenu.js');
          await showConfigMenu(
            process.cwd(),
            (updates) => client.updateRuntimeConfig(updates),
          );
          rl.resume();
        } else if (parsed.subcommand === 'get') {
          const key = parsed.args[0];
          if (!key) {
            console.log();
            console.log(theme.errorMessage('Error: Configuration key required'));
            console.log(theme.dimmed('[i] Usage: /config get <key>'));
            console.log(theme.dimmed('[i] Example: /config get ANTHROPIC_API_KEY'));
            console.log();
          } else {
            try {
              console.log();
              console.log(theme.dimmed(`... Loading configuration...`));
              const value = await client.getConfig(key);

              // Clear loading message
              process.stdout.write('\r' + ' '.repeat(40) + '\r');

              console.log(theme.dimmed('━'.repeat(60)));
              console.log(`${theme.colors.info('▸')} ${theme.colors.primary('Configuration')}`);
              console.log(theme.dimmed('━'.repeat(60)));
              console.log();

              console.log(` ${theme.colors.secondary('Key:')} ${theme.colors.highlight(key)}`);
              const isSensitive = key.toLowerCase().includes('key') ||
                                 key.toLowerCase().includes('token') ||
                                 key.toLowerCase().includes('secret');
              const displayValue = isSensitive && value.length > 10
                ? `${value.substring(0, 10)}...` + theme.dimmed('[masked]')
                : value;
              console.log(` ${theme.colors.secondary('Value:')} ${theme.text(displayValue)}`);

              console.log();
              console.log(theme.dimmed('━'.repeat(60)));
              console.log(theme.dimmed('[i] Use /config set <key> <value> to update'));
              console.log(theme.dimmed('━'.repeat(60)));
              console.log();
            } catch (error: any) {
              console.log();
              console.log(theme.errorMessage(`Error: ${error.message}`));
              console.log(theme.dimmed('[i] In direct mode, use environment variables'));
              console.log();
            }
          }
        } else if (parsed.subcommand === 'set') {
          const key = parsed.args[0];
          const value = parsed.args[1];
          if (!value) {
            console.log();
            console.log(theme.errorMessage('Error: Value required'));
            console.log(theme.dimmed('[i] Usage: /config set <key> <value>'));
            console.log();
          } else {
            try {
              console.log();
              console.log(theme.dimmed(`... Updating configuration...`));
              await client.setConfig(key, value);

              // Clear loading message
              process.stdout.write('\r' + ' '.repeat(40) + '\r');

              const { getRuntimeConfigEntry, isLiveToggleable } = await import('@nexus-cortex/core');
              const entry = getRuntimeConfigEntry(key);
              if (entry?.tier === 'config' && entry.mapper) {
                client.updateRuntimeConfig(entry.mapper(value));
              }

              const label = isLiveToggleable(key) ? '(live)' : '(restart required)';
              console.log(theme.successMessage(`[OK] ${theme.colors.highlight(key)} updated ${label}`));
              console.log();
            } catch (error: any) {
              console.log();
              console.log(theme.errorMessage(`Error: ${error.message}`));
              console.log(theme.dimmed('[i] In direct mode, restart with updated environment variables'));
              console.log();
            }
          }
        } else if (parsed.subcommand === 'list') {
          // /config list — show all keys
          try {
            const keys = await client.listConfigKeys();
            console.log();
            console.log(theme.dimmed('━'.repeat(60)));
            console.log(`${theme.colors.info('▸')} ${theme.colors.primary('All Configuration Keys')}`);
            console.log(theme.dimmed('━'.repeat(60)));
            for (const k of keys) {
              console.log(` ${k}`);
            }
            console.log();
            console.log(theme.dimmed('[i] /config to open interactive settings browser'));
            console.log();
          } catch (error: any) {
            console.log();
            console.log(theme.errorMessage(`Error: ${error.message}`));
            console.log();
          }
        } else {
          console.log();
          console.log(theme.warningMessage(`Unknown subcommand: /config ${parsed.subcommand || ''}`));
          console.log(theme.dimmed('[i] Available: /config, /config get <key>, /config set <key> <value>, /config list'));
          console.log();
        }
        prompt();
        return;

      case 'system-message':
        try {
          console.log();
          console.log(theme.dimmed('Opening system message manager...'));
          console.log(theme.dimmed('[i] Press Q to return to chat'));
          console.log();

          // Pause readline to allow Ink to take over
          rl.pause();

          // Use current working directory as context root
          // createSystemMessageCommand will determine if it's a project or global context
          const contextRoot = process.cwd();

          // Launch interactive system message manager with orchestrator for AI generation
          await createSystemMessageCommand(contextRoot, {
            debug: false,
            orchestratorClient: client,
          });

          // Restore stdin state after Ink unmounts
          // Ink may have unref'd or altered stdin state - we need to fully restore it
          // Use setImmediate to ensure Ink's cleanup callbacks have completed
          await new Promise<void>(resolve => setImmediate(resolve));

          if (process.stdin.isTTY) {
            // Reset to a known state before rawQuestion takes over
            process.stdin.setRawMode(false);
            process.stdin.ref();
            process.stdin.resume();
          }

          // Resume readline after Ink exits
          rl.resume();
          console.log();
          console.log(theme.dimmed('Returned to chat'));
          console.log();
        } catch (error: any) {
          console.log();
          console.log(theme.errorMessage(`Error: ${error.message}`));
          console.log();
        }
        prompt();
        return;

      case 'agent':
        try {
          const args = parsed.args || [];
          const subcommand = parsed.subcommand;

          // Determine project root (go up from packages/cli/dist/commands/chat)
          const { fileURLToPath: fileURLToPathAgent } = await import('url');
          const { dirname: dirnameAgent, join: joinAgent } = await import('path');
          const currentFileAgent = fileURLToPathAgent(import.meta.url);
          const projectRootAgent = joinAgent(dirnameAgent(currentFileAgent), '..', '..', '..', '..', '..');

          if (subcommand === 'list') {
            // List agents non-interactively
            console.log();
            await listAgents(projectRootAgent);
            console.log();
          } else if (subcommand === 'info' && args.length > 0) {
            // Show agent info
            console.log();
            await showAgentInfo(projectRootAgent, args[0] as string);
            console.log();
          } else {
            // Open interactive agent manager
            console.log();
            console.log(theme.dimmed('Opening agent manager...'));
            console.log(theme.dimmed('[i] Press Q to return to chat'));
            console.log();

            // Pause readline to allow Ink to take over
            rl.pause();

            // Get current model for inheritance option
            const currentModelInfo = client.getCurrentModel();
            const currentModelId = currentModelInfo?.id || options.model || process.env.DEFAULT_MODEL_ID || 'sonnet';

            // Launch interactive agent manager with orchestrator for AI generation
            await createAgentCommand(projectRootAgent, {
              debug: false,
              initialAgentName: subcommand || undefined,
              currentModel: currentModelId,
              orchestratorClient: client,
            });

            // Restore stdin state after Ink unmounts
            // Ink may have unref'd or altered stdin state - we need to fully restore it
            // Use setImmediate to ensure Ink's cleanup callbacks have completed
            await new Promise<void>(resolve => setImmediate(resolve));

            if (process.stdin.isTTY) {
              // Reset to a known state before rawQuestion takes over
              process.stdin.setRawMode(false);
              process.stdin.ref();
              process.stdin.resume();
            }

            // Resume readline after Ink exits
            rl.resume();
            console.log();
            console.log(theme.dimmed('Returned to chat'));
            console.log();
          }
        } catch (error: any) {
          console.log();
          console.log(theme.errorMessage(`Error: ${error.message}`));
          console.log();
        }
        prompt();
        return;

      case 'init':
        try {
          console.log();
          console.log(theme.dimmed('[INIT] Scanning project...'));

          const { InitCortexContext } = await import('@nexus-cortex/core');
          const initArgs = parsed.args || [];
          const isGlobal = initArgs.includes('--global');
          const depthIndex = initArgs.indexOf('--depth');
          const depthArg = depthIndex >= 0 ? initArgs[depthIndex + 1] : undefined;

          const scan = await InitCortexContext.scan(
            process.cwd(),
            {
              scope: isGlobal ? 'global' : 'auto',
              max_depth: depthArg ? parseInt(depthArg, 10) : undefined,
            }
          );
          const initPrompt = InitCortexContext.formatScanAsPrompt(scan);
          console.log(theme.dimmed('[INIT] Scan complete. Generating CORTEX.md...'));
          console.log();

          await processMessage(initPrompt);
        } catch (error: any) {
          console.log();
          console.log(theme.errorMessage(`Error: ${error.message}`));
          console.log();
          prompt();
        }
        return;

      case 'theme':
        try {
          console.log();
          console.log(theme.dimmed('Opening theme picker...'));
          console.log(theme.dimmed('[i] Use ↑/↓ to navigate, Enter to select, Esc to exit'));
          console.log();

          // Pause readline to allow ChalkThemePicker to take over
          rl.pause();

          // Run the theme picker
          await runThemePicker();

          // Resume readline after theme picker exits
          rl.resume();

          console.log();
        } catch (error: any) {
          // Resume readline if there was an error
          rl.resume();

          console.log();
          console.log(theme.errorMessage(`Error: ${error.message}`));
          console.log();
        }
        prompt();
        return;

      case 'continue':
        try {
          const { resolveContext, JSONLHistoryStore } = await import('@nexus-cortex/core');

          console.log();
          console.log(theme.dimmed(' Loading previous sessions...'));
          console.log();

          // Use ContextResolver to find the correct storage directory
          const context = resolveContext({ cwd: process.cwd() });

          // Create history store
          const historyStore = new JSONLHistoryStore({
            baseDir: context.sessionsDir
          });

          // List all sessions
          const sessions = await historyStore.listSessions();

          if (sessions.length === 0) {
            console.log(theme.warningMessage('No previous sessions found'));
            console.log(theme.dimmed('[i] Start chatting to create a session'));
            console.log();
            prompt();
            return;
          }

          // Sort by most recent first
          sessions.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());

          // Display sessions as numbered list
          console.log();
          console.log(theme.colors.primary('Available Sessions:'));
          console.log(theme.dimmed('─'.repeat(80)));

          const displaySessions = sessions.slice(0, 20);
          displaySessions.forEach((session, index) => {
            const sessionId = session.sessionId.slice(0, 8);
            const date = session.lastModified.toLocaleDateString();
            const time = session.lastModified.toLocaleTimeString();
            const size = (session.fileSize / 1024).toFixed(1);
            const messages = session.messageCount;

            // Calculate days ago
            const now = new Date();
            const diffMs = now.getTime() - session.lastModified.getTime();
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            const ageStr = diffDays === 0 ? 'Today' : diffDays === 1 ? '1 day ago' : `${diffDays} days ago`;

            console.log(` ${theme.colors.info((index + 1).toString().padStart(2))}. ${sessionId} - ${ageStr} (${messages} msgs, ${size} KB) - ${date} ${time}`);
          });

          console.log(theme.dimmed('─'.repeat(80)));
          console.log();

          // Use existing readline to avoid breaking it
          rl.question(theme.colors.info('Select session number (or press Enter to cancel): '), async (input) => {
            const choice = input.trim();

            if (!choice) {
              console.log();
              prompt();
              return;
            }

            const num = parseInt(choice, 10);
            if (isNaN(num) || num < 1 || num > displaySessions.length) {
              console.log();
              console.log(theme.errorMessage('Invalid selection'));
              console.log();
              prompt();
              return;
            }

            const selectedSession = displaySessions[num - 1];
            if (!selectedSession) {
              console.log();
              console.log(theme.errorMessage('Invalid selection'));
              console.log();
              prompt();
              return;
            }

            const selectedSessionId = selectedSession.sessionId;

            // Resume selected session
            console.log();
            console.log(theme.dimmed(`Resuming session ${selectedSessionId.slice(0, 8)}...`));
            console.log();

            // Load messages from the session
            try {
              const messages = await historyStore.loadSession(selectedSessionId);

              if (process.env.DEBUG === 'true') {
                console.log(theme.dimmed(`DEBUG: Loaded ${messages.length} messages from session`));
                if (messages.length > 0) {
                  console.log(theme.dimmed(`DEBUG: First message role: ${(messages[0] as any).role}`));
                  console.log(theme.dimmed(`DEBUG: Last message role: ${(messages[messages.length - 1] as any).role}`));
                }
              }

              console.log(theme.dimmed(`Loaded ${messages.length} messages`));
              console.log();

              // Store messages for re-rendering on Ctrl+E toggle
              loadedSessionMessages = messages;

              // Display all messages using the shared render function
              renderSessionHistory(messages);

              console.log(theme.dimmed('─'.repeat(process.stdout.columns || 80)));
              console.log();

              // NOW resume the session in the orchestrator (after displaying messages)
              console.log(theme.dimmed('Initializing session state...'));
              await client.resumeSession(selectedSessionId);

              console.log(theme.successMessage(`Session resumed (${selectedSessionId.slice(0, 8)}) - Continue your conversation below`));
              console.log();

            } catch (error: any) {
              console.log();
              console.log(theme.errorMessage(`Failed to browse sessions: ${error.message}`));
              if (process.env.DEBUG === 'true') {
                console.log(theme.dimmed('Stack trace:'));
                console.log(theme.dimmed(error.stack));
              }
              console.log();
            }

            prompt();
          });
        } catch (error: any) {
          console.log();
          console.log(theme.errorMessage(`Failed to load sessions: ${error.message}`));
          console.log();
          prompt();
        }
        return;

      case 'resume': {
        const selector = parsed.subcommand || parsed.args[0];
        if (!selector) {
          console.log();
          console.log(theme.errorMessage('Usage: /resume <session-id>'));
          console.log(theme.dimmed('[i] Use /continue to browse sessions interactively'));
          console.log();
          prompt();
          return;
        }
        try {
          console.log();
          console.log(theme.dimmed(`Resuming session ${selector.slice(0, 8)}...`));
          await client.resumeSession(selector);
          const { JSONLHistoryStore, resolveContext } = await import('@nexus-cortex/core');
          const context = resolveContext({ cwd: process.cwd() });
          const historyStore = new JSONLHistoryStore({ baseDir: context.sessionsDir });
          const messages = await historyStore.loadSession(selector);
          loadedSessionMessages = messages;
          renderSessionHistory(messages);
          console.log(theme.successMessage(`Session resumed (${selector.slice(0, 8)}) - Continue your conversation below`));
          console.log();
        } catch (error: any) {
          console.log();
          console.log(theme.errorMessage(`Failed to resume session: ${error.message}`));
          console.log();
        }
        prompt();
        return;
      }

      case 'mentorship': {
        // Direct mentorship commands - no multi-step menu BS
        const projectPath = client.getProjectPath();
        const mentorshipService = new MentorshipConfigService(projectPath);

        // /mentorship or /mentorship status - show status immediately
        if (!parsed.subcommand || parsed.subcommand === 'status') {
          const summary = mentorshipService.getSummary();
          const statusColor = summary.status === 'enabled' ? chalk.green : chalk.red;
          console.log();
          console.log(` Mentorship: ${statusColor(summary.status.toUpperCase())}`);
          console.log(` Helper:     ${chalk.cyan(summary.helperModel)}`);
          console.log(` Triggers:   ${chalk.dim(summary.triggers.join(', '))}`);
          console.log();
          console.log(theme.dimmed(' /mentorship enable|disable|config'));
          console.log();
          prompt();
          return;
        }

        if (parsed.subcommand === 'enable') {
          await mentorshipService.quickEnable();
          client.updateRuntimeConfig({
            reactiveMentorship: {
              enabled: true,
              triggerOnError: true,
              errorSeverityThreshold: 'medium',
              enableKeywords: false,
              patternDetection: true,
            },
          });
          console.log();
          console.log(theme.successMessage('Mentorship enabled'));
          console.log();
          prompt();
          return;
        }

        if (parsed.subcommand === 'disable') {
          await mentorshipService.quickDisable();
          client.updateRuntimeConfig({
            reactiveMentorship: { enabled: false, triggerOnError: false, errorSeverityThreshold: 'medium', enableKeywords: false },
          });
          console.log();
          console.log(theme.dimmed('Mentorship disabled'));
          console.log();
          prompt();
          return;
        }

        // /mentorship config - open interactive menu for power users
        if (parsed.subcommand === 'config') {
          try {
            const menuDef = mentorshipService.getMenuDefinition();
            const initialValues: Record<string, unknown> = {};
            const config = mentorshipService.getConfig();

            for (const section of menuDef.sections) {
              for (const item of section.items) {
                if (item.key in config) {
                  initialValues[item.key] = config[item.key as keyof typeof config];
                }
              }
            }

            console.log();
            const result = await showInteractiveMenu(
              menuDef,
              initialValues,
              async (key, value) => {
                const configKey = key.replace('MENTORSHIP_', '').toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
                await mentorshipService.setConfig({ [configKey]: value } as any);
              }
            );

            if (result.action === 'save' && result.hasChanges) {
              const updates: Record<string, unknown> = {};
              for (const [key, value] of Object.entries(result.changes)) {
                const configKey = key.replace('MENTORSHIP_', '').toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
                updates[configKey] = value;
              }
              await mentorshipService.setConfig(updates as any);
              console.log();
              console.log(theme.successMessage('Configuration saved'));
            } else if (result.action === 'reset') {
              await mentorshipService.resetToDefaults();
              console.log();
              console.log(theme.successMessage('Reset to defaults'));
            }
            console.log();
          } catch (error: any) {
            console.log();
            console.log(theme.errorMessage(`Error: ${error.message}`));
            console.log();
          }
          prompt();
          return;
        }

        // Unknown subcommand
        console.log();
        console.log(theme.errorMessage(`Unknown: /mentorship ${parsed.subcommand}`));
        console.log(theme.dimmed(' /mentorship [status|enable|disable|config]'));
        console.log();
        prompt();
        return;
      }

      default:
        // Check if command exists in registry
        const command = slashCommandRegistry.getCommand(parsed.command);
        if (command) {
          console.log();
          console.log(theme.warningMessage(`Command /${parsed.command} is registered but not yet implemented`));
          console.log(theme.dimmed(`[i] Coming soon! For now, use the command palette (/) to explore available commands`));
          console.log();
        } else {
          console.log();
          console.log(theme.errorMessage(`Unknown command: /${parsed.command}`));
          console.log(theme.dimmed(`[i] Type / to see available commands or /help for more information`));
          console.log();
        }
        prompt();
        return;
    }
  }

  const prompt = async () => {
    // Use raw terminal input with persistent status line below
    const userInput = (await rawQuestion({
      getStatusState,
      theme,
      onToggleThinking,
      onToggleAutoApprove,
      onToggleDocuments,
      onEscape,
    })).trim();

    // Handle empty input - just reprompt
    if (!userInput) {
      prompt();
      return;
    }

    if (process.env.DEBUG === 'true') {
      console.log('[DEBUG] Received input:', userInput);
    }

    // Parse slash commands
    const parsed = parseSlashCommand(userInput);

    if (process.env.DEBUG === 'true') {
      console.log('[DEBUG] Is command:', parsed.isCommand);
    }

    if (parsed.isCommand) {
      // Handle slash commands
      await handleSlashCommand(parsed, theme, rl, prompt);
      return;
    }

    if (process.env.DEBUG === 'true') {
      console.log('[DEBUG] Not a slash command, proceeding to message handling');
    }

    // Handle legacy text commands for backwards compatibility
    if (userInput.toLowerCase() === 'exit') {
      console.log();
      console.log(theme.roundedBox(
        'Thank you for using Nexus Cortex!\n' +
        'Your session has been saved.',
        'Goodbye'
      ));
      console.log();
      rl.close();
      process.exit(0);
      return;
    }

    if (userInput.toLowerCase() === 'clear') {
      // Note: In direct mode, the orchestrator maintains its own history
      // This command doesn't actually clear it yet - that would require a new session
      console.log();
      console.log(theme.warningMessage('Note: History clearing not yet implemented'));
      console.log(theme.dimmed('[i] In direct mode, restart the CLI to start a fresh session'));
      console.log();
      prompt();
      return;
    }

    if (process.env.DEBUG === 'true') {
      console.log('[DEBUG] About to enter streaming try block');
    }

    // Process the message with persistent input box
    await processMessage(userInput);

    // Check for queued messages and process them
    while (persistentInput.hasQueuedMessages()) {
      const queued = persistentInput.getQueuedMessages();
      for (const queuedMessage of queued) {
        await processMessage(queuedMessage);
      }
    }

    prompt();
  };

  /**
   * Process a single message with streaming and persistent input
   */
  async function processMessage(messageText: string): Promise<void> {
    // Start capturing input during streaming
    persistentInput.startCapture();

    try {
      // Note: User input was already echoed by rawQuestion's clearInputFrame()
      // so we don't need to echo it again here

      // Show thinking indicator
      persistentInput.showThinking();
      let thinkingCleared = false;

      // Create abort controller for this request (allows ESC to interrupt tool execution)
      currentAbortController = new AbortController();

      // Stream the message with real-time display
      const stream = client.streamMessage(messageText, {
        model: options.model,
        system: options.system,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        tools: [], // Enable all tools (empty array = use all default tools)
        reasoningEffort, // Pass GPT-5 reasoning effort (none, low, medium, high)
        abortSignal: currentAbortController.signal, // Allow ESC to abort tool execution
      });

      // Accumulate response for final display
      let fullTextContent = '';
      const toolsUsed: any[] = [];
      let hasStartedThinking = false;  // Track if we've shown thinking header
      let turnUsageData: { inputTokens: number; outputTokens: number } | null = null;
      let turnDurationMs: number | null = null;

      // Reset markdown renderer for new message
      markdownRenderer.reset();

      // Reset ESC/abort flags before streaming
      escPressed = false;
      isAborting = false;

      // Process streaming chunks with inner try-catch to handle abort errors
      // The stream iteration can throw when abort() is called, even if the
      // underlying SDK doesn't properly support AbortSignal
      let streamingAborted = false;
      try {
        for await (const chunk of stream) {
          // Check if user pressed ESC to abort FIRST (before processing chunk)
          if (escPressed) {
            persistentInput.printLine(); // New line after abort message
            persistentInput.printLine(theme.colors.warning('⏸  Operation halted by user (ESC pressed)'));
            streamingAborted = true;
            break; // Exit streaming loop immediately
          }

          if (showDebug) {
            persistentInput.printLine(`[CLI] Received chunk type: ${chunk.type}, delta length: ${chunk.delta?.length || 0}`);
          }

        // PHASE 2.8: Interleaved reasoning (Grok, Claude, OpenAI)
        // content_block_delta with reasoning=true is the model's natural reasoning output.
        // ALWAYS shown — matches neoncortex behavior. Tab toggle only controls
        // front/rear-loaded extended thinking (thinking_delta chunks below).
        if (chunk.type === 'content_block_delta') {
          const data = chunk.data as any;

          if (data.reasoning === true) {
            if (!thinkingCleared) {
              persistentInput.clearThinking();
              thinkingCleared = true;
            }
            const thinkingText = chunk.delta || '';
            if (thinkingText) {
              persistentInput.writeOutput(chalk.dim(chalk.italic(thinkingText)));
            }
            continue;
          }
        }

        // Extended thinking blocks (Gemini <thinking>, Claude <thinking>)
        // Controlled by Tab toggle — these are front/rear-loaded, not interleaved.
        if (chunk.type === 'thinking_delta') {
          if (!thinkingCleared) {
            persistentInput.clearThinking();
            thinkingCleared = true;
          }

          if (showThinking || isInToolExecution) {
            if (!hasStartedThinking) {
              persistentInput.printLine();
              hasStartedThinking = true;
            }
            const thinkingText = chunk.delta || '';
            if (thinkingText) {
              persistentInput.writeOutput(chalk.dim(chalk.italic(thinkingText)));
            }
          }
          continue;
        }

        // Regular text content (may include mentorship thinking)
        if (chunk.type === 'text_delta') {
          // Clear thinking indicator on first content
          if (!thinkingCleared && chunk.delta) {
            persistentInput.clearThinking();
            thinkingCleared = true;
          }

          // Reset thinking header flag when text starts (allows multiple thinking blocks)
          if (hasStartedThinking && chunk.delta) {
            persistentInput.printLine();  // Add newline after thinking
            hasStartedThinking = false;
          }

          // When we get substantive text after tool execution, mark tool execution as complete
          // This means any further thinking is extended thinking (respects Tab toggle)
          if (isInToolExecution && chunk.delta && chunk.delta.trim().length > 0) {
            isInToolExecution = false;
          }

          let text = chunk.delta || '';

          // DEBUG Mode: Filter out debug/log messages unless showDebug is enabled
          // Skip chunks that are debug logs (start with [ or contain system markers)
          const isDebugLog = text.startsWith('[') ||
                             text.includes('[Gateway]') ||
                             text.includes('[Orchestrator') ||
                             text.includes('[XAI Messages API]') ||
                             text.includes('[Phase ') ||
                             text.includes('Validated tool format:') ||
                             text.includes('"name":') && text.includes('"description":') && text.includes('"input_schema":');

          if (isDebugLog && !showDebug) {
            continue; // Skip debug output - don't display or accumulate
          }

          // If debug mode is ON and this is a debug log, colorize it
          if (isDebugLog && showDebug) {
            text = theme.dimmed(text);
          }

          // PHASE 2.8: Mentorship Thinking (from @ultrathink)
          // Parse <thinking> tags in text content
          if (text.includes('<thinking>') || text.includes('</thinking>')) {
            if (showThinking) {
              // Show mentorship thinking with blue bold (emoji optional based on USE_EMOJI setting)
              const useEmoji = process.env.USE_EMOJI === 'true';
              const prefix = useEmoji ? ' ' : '[Thinking] ';
              text = text.replace(
                /<thinking>([\s\S]*?)<\/thinking>/g,
                (_match: string, content: string) => theme.colors.info(`\n${prefix}${content.trim()}\n`)
              );
              persistentInput.writeOutput(text);
            } else {
              // Hide mentorship thinking if toggle is OFF
              text = text.replace(/<thinking>[\s\S]*?<\/thinking>/g, '');
              if (text) {
                // Process through markdown renderer
                const formatted = markdownRenderer.processChunk(text);
                persistentInput.writeOutput(formatted);
              }
            }
          } else {
            // Regular text with no thinking tags - render as markdown
            const formatted = markdownRenderer.processChunk(text);
            persistentInput.writeOutput(formatted);
          }

          fullTextContent += chunk.delta || '';
        }

        // Tool execution complete
        if (chunk.type === 'tool_use_complete') {
          // Mark that we're in tool execution mode (for interleaved thinking)
          isInToolExecution = true;

          const toolUse = chunk.toolUse;
          if (toolUse) {
            persistentInput.setPhase(`Running ${toolUse.name}`);
            // Store for summary (backward compat)
            toolsUsed.push({
              name: toolUse.name,
              args: toolUse.input,
              status: 'success' as const,
              result: '',
              duration: 0
            });

            // Display tool call with new formatter
            // Note: Diff/file previews are shown via previewRenderer callback BEFORE
            // the approval prompt, so we don't need to show them here
            persistentInput.printLine();
            const toolCall = toolFormatter.formatToolCall({
              name: toolUse.name,
              params: toolUse.input
            });
            persistentInput.writeOutput(toolCall);
          }
        }

        // Tool result received (emitted after tool execution)
        if (chunk.type === 'tool_result') {
          const toolResult = chunk.toolResult;
          if (toolResult) {
            const MAX_RESULT_DISPLAY = 20000;

            if (toolResult.tool_name === 'Edit') {
              if (toolResult.is_error) {
                const result = toolFormatter.formatToolResult({
                  error: toolResult.content
                });
                persistentInput.writeOutput(result);
              } else {
                const stats = toolResult.metadata?.fileStats;
                const occurrences = stats?.occurrences || 1;
                const rawDiff = toolResult.metadata?.diff;

                if (rawDiff && typeof rawDiff === 'string') {
                  const parsed = parseUnifiedDiff(rawDiff);
                  if (parsed && parsed.chunks.length > 0) {
                    const diffOutput = toolFormatter.formatDiff(parsed);
                    persistentInput.writeOutput(diffOutput);
                  }
                }

                const result = toolFormatter.formatToolResult({
                  summary: `Applied (${occurrences} replacement${occurrences > 1 ? 's' : ''})`
                });
                persistentInput.writeOutput(result);
              }
            } else if (toolResult.tool_name?.toLowerCase() === 'write') {
              if (toolResult.is_error) {
                const result = toolFormatter.formatToolResult({
                  error: toolResult.content
                });
                persistentInput.writeOutput(result);
              } else {
                const writePreview = toolResult.metadata?.writePreview;
                const docPreview = toolResult.metadata?.documentPreview;

                if (writePreview?.content) {
                  const filePreview = toolFormatter.formatFileContent({
                    file: writePreview.filePath || 'file',
                    content: writePreview.content,
                    lineCount: writePreview.lineCount || writePreview.content.split('\n').length,
                    preview: writePreview.content.length > MAX_RESULT_DISPLAY,
                  });
                  persistentInput.writeOutput(filePreview);
                } else if (docPreview) {
                  const wordInfo = docPreview.wordCount ? `, ${docPreview.wordCount} words` : '';
                  const result = toolFormatter.formatToolResult({
                    summary: `Created ${docPreview.filePath} (${docPreview.lineCount} lines${wordInfo})`
                  });
                  persistentInput.writeOutput(result);
                } else {
                  const stats = toolResult.metadata?.fileStats;
                  const sizeInfo = stats?.size ? ` (${stats.size} bytes)` : '';
                  const result = toolFormatter.formatToolResult({
                    summary: `File created successfully${sizeInfo}`
                  });
                  persistentInput.writeOutput(result);
                }
              }
            } else if (toolResult.tool_name === 'Bash') {
              if (toolResult.is_error) {
                const result = toolFormatter.formatToolResult({
                  error: toolResult.content
                });
                persistentInput.writeOutput(result);
              } else {
                const content = toolResult.content.trim();
                if (content && content !== '(command completed successfully)') {
                  let displayContent = content;
                  let truncatedNote = '';
                  if (displayContent.length > MAX_RESULT_DISPLAY) {
                    const lines = displayContent.split('\n');
                    const totalLines = lines.length;
                    displayContent = displayContent.substring(0, MAX_RESULT_DISPLAY);
                    const keptLines = displayContent.split('\n').length;
                    truncatedNote = `\n... (${totalLines - keptLines} lines truncated)`;
                  }
                  const result = toolFormatter.formatToolResult({
                    summary: displayContent + truncatedNote
                  });
                  persistentInput.writeOutput(result);
                } else {
                  const result = toolFormatter.formatToolResult({
                    summary: '(success)'
                  });
                  persistentInput.writeOutput(result);
                }
              }
            } else if (toolResult.tool_name === 'Read' && toolResult.metadata?.fileStats) {
              const stats = toolResult.metadata.fileStats;
              const lineInfo = stats.lines ? ` (${stats.lines} lines)` : '';
              const result = toolFormatter.formatToolResult({
                summary: `Read ${stats.path}${lineInfo}`
              });
              persistentInput.writeOutput(result);
            } else if (toolResult.is_error) {
              const result = toolFormatter.formatToolResult({
                error: toolResult.content
              });
              persistentInput.writeOutput(result);
            } else {
              let content = toolResult.content;
              if (content.length > MAX_RESULT_DISPLAY) {
                const totalLines = content.split('\n').length;
                content = content.substring(0, MAX_RESULT_DISPLAY);
                const keptLines = content.split('\n').length;
                content += `\n... (${totalLines - keptLines} lines truncated)`;
              }
              const result = toolFormatter.formatToolResult({
                summary: content.split('\n')[0] || 'Success',
                details: content.split('\n').slice(1).join('\n')
              });
              persistentInput.writeOutput(result);
            }
          }
        }

        // Message complete
        if (chunk.type === 'message_stop') {
          // Flush any remaining markdown content
          const flushed = markdownRenderer.flush();
          if (flushed) {
            persistentInput.writeOutput(flushed);
          }
          persistentInput.printLine(); // Final newline

          // Capture usage data for turn summary
          if (chunk.data?.usage) {
            turnUsageData = chunk.data.usage;
          }
          if (chunk.data?.durationMs) {
            turnDurationMs = chunk.data.durationMs;
          }
        }
      }
      } catch (streamError) {
        // Catch errors from the streaming loop (including abort-related errors)
        // If ESC was pressed, this is expected - handle gracefully
        if (escPressed || isAborting) {
          streamingAborted = true;
          if (process.env.DEBUG === 'true') {
            console.error('[DEBUG] Stream error during ESC abort (expected):', streamError);
          }
        } else {
          // Re-throw non-abort errors to be handled by outer catch
          throw streamError;
        }
      }

      // Check if user aborted with ESC key
      if (escPressed || streamingAborted) {
        persistentInput.printLine();
        persistentInput.printLine(theme.colors.warning('Operation was halted. Please provide feedback:'));
        persistentInput.printLine(theme.dimmed(' • Why did you halt the operation?'));
        persistentInput.printLine(theme.dimmed(' • What would you like me to do instead?'));
        persistentInput.printLine(theme.dimmed(' • Is the investigation going off track?'));
        persistentInput.printLine();
        escPressed = false;
        isAborting = false;
      }

      // Turn summary line — CC-style: "duration · input/output tokens · tools"
      const elapsedMs = turnDurationMs || persistentInput.getElapsed();
      const parts: string[] = [];
      if (elapsedMs > 0) {
        const s = elapsedMs / 1000;
        parts.push(s < 10 ? `${s.toFixed(1)}s` : s < 60 ? `${Math.floor(s)}s` : `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`);
      }
      if (turnUsageData && (turnUsageData.inputTokens > 0 || turnUsageData.outputTokens > 0)) {
        parts.push(`${turnUsageData.inputTokens.toLocaleString()} in / ${turnUsageData.outputTokens.toLocaleString()} out`);
      }
      if (toolsUsed.length > 0) {
        parts.push(`${toolsUsed.length} tool${toolsUsed.length !== 1 ? 's' : ''}`);
      }
      if (parts.length > 0) {
        persistentInput.printLine();
        persistentInput.printLine(theme.dimmed(parts.join(' · ')));
      }

    } catch (error: any) {
      // Show error (but be aware it might be abort-related)
      persistentInput.printLine();

      // If this is an abort error, show a gentler message
      if (escPressed || isAborting) {
        // Abort-related errors - show minimal info
        persistentInput.printLine(theme.dimmed('(Operation interrupted)'));
      } else {
        // Regular error - show full details
        persistentInput.printLine(theme.errorMessage(error.message));
        persistentInput.printLine();

        // Show help for common errors
        if (error.message?.includes('ECONNREFUSED')) {
          persistentInput.printLine(theme.infoMessage('Hint: Make sure the server is running'));
          persistentInput.printLine(theme.dimmed(` Start server: cortex-dev or npm run dev:full`));
        } else if (error.message?.includes('Streaming not yet supported')) {
          persistentInput.printLine(theme.infoMessage('Hint: Use direct mode (default) for streaming'));
          persistentInput.printLine(theme.dimmed(` Remove --server flag to use direct mode`));
        }
      }
    } finally {
      // Clean up abort state
      currentAbortController = null;
      isAborting = false;
      // Stop capturing and restore normal terminal
      persistentInput.stopCapture();
    }
  }

  prompt();
}
