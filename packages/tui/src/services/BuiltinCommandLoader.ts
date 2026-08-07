/**
 * BuiltinCommandLoader - Loads built-in slash commands
 *
 * Provides core commands like /mentorship, /model, /session, etc.
 */

import type { CommandLoader } from './CommandService.js';
import type { SlashCommand, CommandContext, MessageActionReturn } from '../ink-ui/commands/types.js';
import { CommandKind } from '../ink-ui/commands/types.js';
import type { Config } from '../ink-ui/core-stubs.js';
import { MentorshipConfigService } from '@nexus-cortex/core';
import { existsSync, readFileSync, realpathSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Get installation root from this file's location
// Use realpathSync to resolve symlinks (important for npm link)
// Compiled file is at: packages/cli/dist/services/BuiltinCommandLoader.js
// Installation root is 4 levels up: services -> dist -> cli -> packages -> root
const __filename = realpathSync(fileURLToPath(import.meta.url));
const __dirname = dirname(__filename);
const CLI_INSTALLATION_ROOT = join(__dirname, '..', '..', '..', '..');

/**
 * Find the Nexus Cortex installation root
 * Priority:
 * 1. CORTEX_ROOT env var (set by launcher)
 * 2. CLI_INSTALLATION_ROOT (derived from this file's location)
 */
function findInstallationRoot(_config: Config | null): string {
  // Priority 1: Environment variable
  const cortexRoot = (process.env.CORTEX_ROOT);
  if (cortexRoot && existsSync(cortexRoot)) {
    return cortexRoot;
  }

  // Priority 2: Use CLI's own installation location (most reliable)
  if (existsSync(join(CLI_INSTALLATION_ROOT, 'package.json'))) {
    try {
      const packageJson = JSON.parse(readFileSync(join(CLI_INSTALLATION_ROOT, 'package.json'), 'utf-8'));
      if (packageJson.name === 'nexus-cortex-monorepo') {
        return CLI_INSTALLATION_ROOT;
      }
    } catch {
      // Invalid package.json, continue
    }
  }

  // Fallback: return CLI installation root anyway
  return CLI_INSTALLATION_ROOT;
}

/**
 * BuiltinCommandLoader loads all built-in slash commands
 */
export class BuiltinCommandLoader implements CommandLoader {
  private config: Config | null;

  constructor(config: Config | null) {
    this.config = config;
  }

  async loadCommands(_signal?: AbortSignal): Promise<SlashCommand[]> {
    const commands: SlashCommand[] = [];

    // Add mentorship command
    commands.push(this.createMentorshipCommand());

    // Add other built-in commands here as needed
    // commands.push(this.createHelpCommand());
    // commands.push(this.createClearCommand());
    // etc.

    return commands;
  }

  /**
   * Create the /mentorship command with subcommands
   */
  private createMentorshipCommand(): SlashCommand {
    const config = this.config;
    const getProjectPath = (): string => {
      return findInstallationRoot(config);
    };

    return {
      name: 'mentorship',
      description: 'AI-to-AI mentorship system',
      kind: CommandKind.BUILT_IN,
      subCommands: [
        {
          name: 'status',
          description: 'Show mentorship status',
          kind: CommandKind.BUILT_IN,
          action: (): MessageActionReturn => {
            const projectPath = getProjectPath();
            const service = new MentorshipConfigService(projectPath);
            const summary = service.getSummary();

            const statusIcon = summary.status === 'enabled' ? '[ON]' : '[OFF]';
            const content = [
              '',
              ` Mentorship: ${statusIcon} ${summary.status.toUpperCase()}`,
              ` Helper:     ${summary.helperModel}`,
              ` Triggers:   ${summary.triggers.join(', ')}`,
              '',
              ' /mentorship enable|disable|config',
              '',
            ].join('\n');

            return { type: 'message', messageType: 'info', content };
          },
        },
        {
          name: 'enable',
          description: 'Enable mentorship',
          kind: CommandKind.BUILT_IN,
          action: async (): Promise<MessageActionReturn> => {
            const projectPath = getProjectPath();
            const service = new MentorshipConfigService(projectPath);
            await service.quickEnable();

            return {
              type: 'message',
              messageType: 'info',
              content: '\n  Mentorship enabled\n',
            };
          },
        },
        {
          name: 'disable',
          description: 'Disable mentorship',
          kind: CommandKind.BUILT_IN,
          action: async (): Promise<MessageActionReturn> => {
            const projectPath = getProjectPath();
            const service = new MentorshipConfigService(projectPath);
            await service.quickDisable();

            return {
              type: 'message',
              messageType: 'info',
              content: '\n  Mentorship disabled\n',
            };
          },
        },
        {
          name: 'config',
          description: 'Open configuration menu',
          kind: CommandKind.BUILT_IN,
          action: (_context: CommandContext): MessageActionReturn => {
            // For now, show a message that config menu is not yet implemented in Ink UI
            // TODO: Implement MenuRenderer integration here
            const projectPath = getProjectPath();
            const service = new MentorshipConfigService(projectPath);
            const summary = service.getSummary();
            const config = service.getConfig();

            const content = [
              '',
              ' Mentorship Configuration',
              ' ========================',
              '',
              ` Status:              ${summary.status === 'enabled' ? 'ENABLED' : 'DISABLED'}`,
              ` Helper Model:        ${config.helperModel}`,
              '',
              ' Triggers:',
              ` Error Trigger:     ${config.triggerOnError ? 'ON' : 'OFF'} (threshold: ${config.errorThreshold})`,
              ` Keywords:          ${config.keywordsEnabled ? 'ON' : 'OFF'}`,
              ` Turn-Based:        ${config.turnBasedEnabled ? 'ON' : 'OFF'} (every ${config.turnInterval} turns)`,
              ` Pattern Detection: ${config.patternDetection ? 'ON' : 'OFF'} (threshold: ${config.patternThreshold})`,
              '',
              ' Advanced:',
              ` Interleaved:       ${config.interleavedThinking ? 'ON' : 'OFF'}`,
              '',
              ' Use /mentorship enable|disable for quick toggles',
              '',
            ].join('\n');

            return { type: 'message', messageType: 'info', content };
          },
        },
      ],
      // Default action when just /mentorship is called - show status
      action: (): MessageActionReturn => {
        const projectPath = getProjectPath();
        const service = new MentorshipConfigService(projectPath);
        const summary = service.getSummary();

        const statusIcon = summary.status === 'enabled' ? '[ON]' : '[OFF]';
        const content = [
          '',
          ` Mentorship: ${statusIcon} ${summary.status.toUpperCase()}`,
          ` Helper:     ${summary.helperModel}`,
          ` Triggers:   ${summary.triggers.join(', ')}`,
          '',
          ' /mentorship enable|disable|config',
          '',
        ].join('\n');

        return { type: 'message', messageType: 'info', content };
      },
    };
  }
}
