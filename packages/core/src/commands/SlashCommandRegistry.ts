/**
 * Slash Command Registry
 *
 * Central registry for all slash commands with metadata, categories,
 * and hierarchical command tree support.
 *
 * @module commands/SlashCommandRegistry
 */

import {
  CommandDefinition,
  CommandCategory,
  CategoryMetadata,
  CommandTreeNode,
  CompletionSuggestion,
} from './types.js';

/**
 * Category metadata definitions
 */
const CATEGORY_METADATA: Record<CommandCategory, CategoryMetadata> = {
  models: {
    name: 'models',
    label: 'Models',
    description: 'Model management and switching',
    icon: '▸',
  },
  session: {
    name: 'session',
    label: 'Session',
    description: 'Session and checkpoint management',
    icon: '▸',
  },
  cache: {
    name: 'cache',
    label: 'Cache',
    description: 'Cache statistics and management',
    icon: '▸',
  },
  mcp: {
    name: 'mcp',
    label: 'MCP',
    description: 'MCP server management',
    icon: '▸',
  },
  tools: {
    name: 'tools',
    label: 'Tools',
    description: 'Tool management and permissions',
    icon: '▸',
  },
  config: {
    name: 'config',
    label: 'Config',
    description: 'Configuration management',
    icon: '▸',
  },
  system: {
    name: 'system',
    label: 'System',
    description: 'System commands and help',
    icon: '▸',
  },
  ide: {
    name: 'ide',
    label: 'IDE',
    description: 'IDE and editor integration',
    icon: '▸',
  },
  extensions: {
    name: 'extensions',
    label: 'Extensions',
    description: 'Extension management',
    icon: '▸',
  },
};

/**
 * Slash Command Registry
 *
 * Manages command definitions, categories, and provides lookup/search functionality.
 */
export class SlashCommandRegistry {
  private commands: Map<string, CommandDefinition> = new Map();
  private commandTree: Map<string, CommandTreeNode> = new Map();
  private categoryCommands: Map<CommandCategory, string[]> = new Map();

  constructor() {
    // Initialize category command lists
    for (const category of Object.keys(CATEGORY_METADATA) as CommandCategory[]) {
      this.categoryCommands.set(category, []);
    }

    // Register default commands
    this.registerDefaultCommands();
  }

  /**
   * Register a command
   */
  register(command: CommandDefinition): void {
    this.commands.set(command.name, command);

    // Add to category
    const categoryList = this.categoryCommands.get(command.category);
    if (categoryList && !categoryList.includes(command.name)) {
      categoryList.push(command.name);
    }

    // Build tree node
    this.buildTreeNode(command);

    // Register alias if present
    if (command.altName) {
      this.commands.set(command.altName, command);
    }
  }

  /**
   * Build command tree node for hierarchical traversal
   */
  private buildTreeNode(command: CommandDefinition): void {
    const node: CommandTreeNode = {
      name: command.name,
      definition: command,
      children: new Map(),
      isLeaf: !command.subcommands || command.subcommands.length === 0,
    };

    // Add subcommands as children
    if (command.subcommands) {
      for (const sub of command.subcommands) {
        const childNode: CommandTreeNode = {
          name: sub.name,
          definition: sub,
          children: new Map(),
          isLeaf: true,
        };
        node.children.set(sub.name, childNode);
        if (sub.altName) {
          node.children.set(sub.altName, childNode);
        }
      }
    }

    this.commandTree.set(command.name, node);
    if (command.altName) {
      this.commandTree.set(command.altName, node);
    }
  }

  /**
   * Get a command by name
   */
  getCommand(name: string): CommandDefinition | undefined {
    return this.commands.get(name.toLowerCase());
  }

  /**
   * Get all commands
   */
  getAllCommands(): CommandDefinition[] {
    // Filter out aliases to avoid duplicates
    const seen = new Set<string>();
    const result: CommandDefinition[] = [];

    for (const cmd of this.commands.values()) {
      if (!seen.has(cmd.name)) {
        seen.add(cmd.name);
        result.push(cmd);
      }
    }

    return result;
  }

  /**
   * Get commands by category
   */
  getCommandsByCategory(category: CommandCategory): CommandDefinition[] {
    const names = this.categoryCommands.get(category) || [];
    return names
      .map((name) => this.commands.get(name))
      .filter((cmd): cmd is CommandDefinition => cmd !== undefined);
  }

  /**
   * Get all category metadata
   */
  getCategories(): CategoryMetadata[] {
    return Object.values(CATEGORY_METADATA);
  }

  /**
   * Get category metadata
   */
  getCategoryMetadata(category: CommandCategory): CategoryMetadata {
    return CATEGORY_METADATA[category];
  }

  /**
   * Get command tree node for hierarchical traversal
   */
  getTreeNode(name: string): CommandTreeNode | undefined {
    return this.commandTree.get(name.toLowerCase());
  }

  /**
   * Traverse command tree by path
   * @param path Array of command parts (e.g., ['models', 'list'])
   * @returns The deepest matching node and remaining unmatched parts
   */
  traverseTree(path: string[]): {
    node: CommandTreeNode | null;
    matched: string[];
    remaining: string[];
  } {
    if (path.length === 0) {
      return { node: null, matched: [], remaining: [] };
    }

    const rootNode = this.commandTree.get(path[0]!.toLowerCase());
    if (!rootNode) {
      return { node: null, matched: [], remaining: path };
    }

    let currentNode: CommandTreeNode = rootNode;
    const matched: string[] = [path[0]!];

    for (let i = 1; i < path.length; i++) {
      const part = path[i]!.toLowerCase();
      const childNode = currentNode.children.get(part);

      if (childNode) {
        currentNode = childNode;
        matched.push(path[i]!);
      } else {
        return {
          node: currentNode,
          matched,
          remaining: path.slice(i),
        };
      }
    }

    return { node: currentNode, matched, remaining: [] };
  }

  /**
   * Search commands by query
   * Searches name, description, and subcommands
   */
  search(query: string): CommandDefinition[] {
    const lowerQuery = query.toLowerCase();

    return this.getAllCommands().filter((cmd) => {
      // Match command name
      if (cmd.name.toLowerCase().includes(lowerQuery)) {
        return true;
      }

      // Match alias
      if (cmd.altName?.toLowerCase().includes(lowerQuery)) {
        return true;
      }

      // Match description
      if (cmd.description.toLowerCase().includes(lowerQuery)) {
        return true;
      }

      // Match subcommands
      if (cmd.subcommands) {
        return cmd.subcommands.some(
          (sub) =>
            sub.name.toLowerCase().includes(lowerQuery) ||
            sub.altName?.toLowerCase().includes(lowerQuery) ||
            sub.description.toLowerCase().includes(lowerQuery)
        );
      }

      return false;
    });
  }

  /**
   * Get command name suggestions for autocomplete
   * @param partial Partial command name to match
   * @returns Matching command names sorted alphabetically
   */
  getSuggestions(partial: string): CompletionSuggestion[] {
    const lowerPartial = partial.toLowerCase();

    return this.getAllCommands()
      .filter(
        (cmd) =>
          cmd.name.startsWith(lowerPartial) ||
          cmd.altName?.startsWith(lowerPartial)
      )
      .map((cmd) => ({
        label: cmd.name,
        value: cmd.name,
        description: cmd.description,
        type: 'command' as const,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  /**
   * Get subcommand suggestions for a command
   * @param commandName Parent command name
   * @param partial Partial subcommand name to match
   */
  getSubcommandSuggestions(
    commandName: string,
    partial: string
  ): CompletionSuggestion[] {
    const command = this.getCommand(commandName);
    if (!command?.subcommands) {
      return [];
    }

    const lowerPartial = partial.toLowerCase();

    return command.subcommands
      .filter(
        (sub) =>
          sub.name.startsWith(lowerPartial) ||
          sub.altName?.startsWith(lowerPartial)
      )
      .map((sub) => ({
        label: sub.name,
        value: sub.name,
        description: sub.description,
        type: 'subcommand' as const,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  /**
   * Format help text for a command
   */
  formatHelp(command: CommandDefinition): string {
    let help = `${command.name} - ${command.description}\n\n`;

    if (command.usage) {
      help += `Usage: ${command.usage}\n`;
    }

    if (command.subcommands && command.subcommands.length > 0) {
      help += '\nSubcommands:\n';
      for (const sub of command.subcommands) {
        help += ` ${sub.name} - ${sub.description}\n`;
        if (sub.usage) {
          help += ` Usage: ${sub.usage}\n`;
        }
      }
    }

    if (command.examples && command.examples.length > 0) {
      help += '\nExamples:\n';
      for (const ex of command.examples) {
        help += ` ${ex}\n`;
      }
    }

    return help;
  }

  /**
   * Register default core commands
   */
  private registerDefaultCommands(): void {
    // Model picker command - interactive model selection
    this.register({
      name: 'model',
      altName: 'm',
      category: 'models',
      description: 'Open interactive model picker',
      subcommands: [
        {
          name: 'picker',
          description: 'Open visual model selection dialog',
          usage: '/model picker',
        },
      ],
    });

    // Session commands
    this.register({
      name: 'session',
      altName: 's',
      category: 'session',
      description: 'Manage sessions and checkpoints',
      subcommands: [
        {
          name: 'list',
          altName: 'ls',
          description: 'List all sessions',
          usage: '/session list',
        },
        {
          name: 'checkpoint',
          altName: 'cp',
          description: 'Create a checkpoint',
          usage: '/session checkpoint [name]',
        },
        {
          name: 'resume',
          description: 'Resume from a checkpoint',
          usage: '/session resume <checkpoint-id>',
        },
        {
          name: 'info',
          description: 'Show current session info',
          usage: '/session info',
        },
      ],
    });

    // Continue command
    this.register({
      name: 'continue',
      category: 'session',
      description: 'List and load previous conversation sessions',
      usage: '/continue',
      examples: [
        '/continue - Show recent sessions and select one to continue',
      ],
    });

    // Cache commands
    this.register({
      name: 'cache',
      category: 'cache',
      description: 'View cache statistics',
      subcommands: [
        {
          name: 'metrics',
          description: 'Show cache metrics',
          usage: '/cache metrics',
        },
        {
          name: 'report',
          description: 'Generate cache report',
          usage: '/cache report',
        },
      ],
    });

    // MCP commands
    this.register({
      name: 'mcp',
      category: 'mcp',
      description: 'Manage MCP servers',
      subcommands: [
        {
          name: 'list',
          altName: 'ls',
          description: 'List all MCP servers',
          usage: '/mcp list',
        },
        {
          name: 'enable',
          description: 'Enable an MCP server',
          usage: '/mcp enable <server-name>',
        },
        {
          name: 'disable',
          description: 'Disable an MCP server',
          usage: '/mcp disable <server-name>',
        },
        {
          name: 'status',
          description: 'Show MCP server status',
          usage: '/mcp status',
        },
      ],
    });

    // Tools commands
    this.register({
      name: 'tools',
      altName: 't',
      category: 'tools',
      description: 'List and manage tools',
      subcommands: [
        {
          name: 'list',
          altName: 'ls',
          description: 'List all available tools',
          usage: '/tools list [--grouped]',
        },
        {
          name: 'info',
          description: 'Show tool information',
          usage: '/tools info <tool-name>',
        },
      ],
    });

    // Config commands
    this.register({
      name: 'config',
      category: 'config',
      description: 'Interactive settings browser (or /config set <key> <value>)',
      usage: '/config',
      subcommands: [
        {
          name: 'get',
          description: 'Get configuration value',
          usage: '/config get <key>',
        },
        {
          name: 'set',
          description: 'Interactive browser, or /config set <key> <value> for direct set',
          usage: '/config set [<key> <value>]',
        },
        {
          name: 'list',
          altName: 'ls',
          description: 'List all configuration keys',
          usage: '/config list',
        },
        {
          name: 'reset',
          description: 'Reset all settings to benchmark-proven optimal defaults (preserves API keys)',
          usage: '/config reset',
        },
      ],
    });

    // System message management
    this.register({
      name: 'system-message',
      altName: 'sm',
      category: 'config',
      description: 'Manage system messages interactively',
      usage: '/system-message',
      examples: [
        '/system-message - Open interactive message manager',
      ],
    });

    // Agent management
    this.register({
      name: 'agent',
      category: 'config',
      description: 'Manage Task Agent profiles',
      usage: '/agent [subcommand]',
      subcommands: [
        {
          name: 'list',
          altName: 'ls',
          description: 'List all available agents',
          usage: '/agent list',
        },
        {
          name: 'info',
          description: 'Show agent details',
          usage: '/agent info <agent-name>',
        },
      ],
      examples: [
        '/agent - Open interactive agent manager',
        '/agent list - List all agents',
        '/agent info explore - Show explore agent details',
      ],
    });

    // Mentorship configuration
    this.register({
      name: 'mentorship',
      category: 'config',
      description: 'Configure AI-to-AI reactive mentorship system',
      usage: '/mentorship [subcommand]',
      subcommands: [
        {
          name: 'status',
          description: 'Show current mentorship configuration',
          usage: '/mentorship status',
        },
        {
          name: 'enable',
          description: 'Quick enable mentorship with sensible defaults',
          usage: '/mentorship enable',
        },
        {
          name: 'disable',
          description: 'Disable mentorship system',
          usage: '/mentorship disable',
        },
        {
          name: 'config',
          description: 'Open interactive configuration menu',
          usage: '/mentorship config',
        },
      ],
      examples: [
        '/mentorship - Open interactive configuration menu',
        '/mentorship status - Show current settings',
        '/mentorship enable - Quick enable with defaults',
        '/mentorship disable - Turn off mentorship',
      ],
    });

    // Init CORTEX.md
    this.register({
      name: 'init',
      category: 'config',
      description: 'Generate CORTEX.md project context file',
      usage: '/init [--global] [--depth <n>]',
      examples: [
        '/init - Generate CORTEX.md in current project',
        '/init --global - Generate CORTEX.md in ~/.cortex/',
        '/init --depth 5 - Generate with custom tree depth',
      ],
    });

    // Theme picker
    this.register({
      name: 'theme',
      category: 'config',
      description: 'Open interactive theme picker',
      usage: '/theme',
      examples: [
        '/theme - Open theme picker to select from 15 professional themes',
      ],
    });

    // System commands
    this.register({
      name: 'help',
      altName: 'h',
      category: 'system',
      description: 'Show help information',
      usage: '/help [command]',
    });

    this.register({
      name: 'clear',
      category: 'system',
      description: 'Clear conversation history',
      usage: '/clear',
    });

    this.register({
      name: 'debug',
      category: 'system',
      description: 'Toggle debug log visibility',
      usage: '/debug',
      examples: ['/debug - Toggle debug logs ON/OFF'],
    });

    this.register({
      name: 'yolo',
      category: 'tools',
      description: 'Enable YOLO mode (auto-approve all tools)',
      usage: '/yolo',
      examples: ['/yolo - Enable auto-approve for all tool executions'],
    });

    this.register({
      name: 'exit',
      altName: 'quit',
      category: 'system',
      description: 'Exit the chat',
      usage: '/exit',
    });

    // ==========================================
    // Additional commands from neoncortex
    // ==========================================

    // About/version info
    this.register({
      name: 'about',
      category: 'system',
      description: 'Show version and system information',
      usage: '/about',
    });

    // Authentication
    this.register({
      name: 'auth',
      category: 'config',
      description: 'Manage authentication and API keys',
      usage: '/auth',
      subcommands: [
        {
          name: 'status',
          description: 'Show current authentication status',
          usage: '/auth status',
        },
        {
          name: 'login',
          description: 'Login or switch authentication',
          usage: '/auth login',
        },
        {
          name: 'logout',
          description: 'Clear authentication',
          usage: '/auth logout',
        },
      ],
    });

    // Bug reporting
    this.register({
      name: 'bug',
      category: 'system',
      description: 'Report a bug or issue',
      usage: '/bug [description]',
      examples: [
        '/bug - Open bug reporter',
        '/bug Model fails to respond - Report with description',
      ],
    });

    // Chat subcommands
    this.register({
      name: 'chat',
      category: 'session',
      description: 'Chat management commands',
      usage: '/chat [subcommand]',
      subcommands: [
        {
          name: 'new',
          description: 'Start a new chat session',
          usage: '/chat new',
        },
        {
          name: 'history',
          description: 'Show chat history',
          usage: '/chat history',
        },
      ],
    });

    // Compress conversation
    this.register({
      name: 'compress',
      category: 'session',
      description: 'Compress conversation history to save context',
      usage: '/compress',
      examples: [
        '/compress - Compress current conversation',
      ],
    });

    // Copy to clipboard
    this.register({
      name: 'copy',
      category: 'system',
      description: 'Copy last response to clipboard',
      usage: '/copy',
    });

    // Corgi mode (easter egg)
    this.register({
      name: 'corgi',
      category: 'system',
      description: 'Toggle corgi mode',
      usage: '/corgi',
    });

    // Directory management
    this.register({
      name: 'directory',
      altName: 'dir',
      category: 'config',
      description: 'Manage project directory context',
      usage: '/directory [path]',
      subcommands: [
        {
          name: 'set',
          description: 'Set working directory',
          usage: '/directory set <path>',
        },
        {
          name: 'show',
          description: 'Show current directory',
          usage: '/directory show',
        },
      ],
    });

    // Documentation
    this.register({
      name: 'docs',
      category: 'system',
      description: 'Open documentation',
      usage: '/docs [topic]',
      examples: [
        '/docs - Open main docs',
        '/docs mcp - Open MCP documentation',
      ],
    });

    // Editor configuration
    this.register({
      name: 'editor',
      category: 'ide',
      description: 'Configure default editor',
      usage: '/editor',
    });

    // Extensions management
    this.register({
      name: 'extensions',
      altName: 'ext',
      category: 'extensions',
      description: 'Manage extensions and plugins',
      usage: '/extensions [subcommand]',
      subcommands: [
        {
          name: 'list',
          altName: 'ls',
          description: 'List installed extensions',
          usage: '/extensions list',
        },
        {
          name: 'install',
          description: 'Install an extension',
          usage: '/extensions install <name>',
        },
        {
          name: 'uninstall',
          description: 'Uninstall an extension',
          usage: '/extensions uninstall <name>',
        },
        {
          name: 'enable',
          description: 'Enable an extension',
          usage: '/extensions enable <name>',
        },
        {
          name: 'disable',
          description: 'Disable an extension',
          usage: '/extensions disable <name>',
        },
        {
          name: 'update',
          description: 'Update extensions',
          usage: '/extensions update [name]',
        },
      ],
    });

    // IDE integration
    this.register({
      name: 'ide',
      category: 'ide',
      description: 'IDE integration and setup',
      usage: '/ide [subcommand]',
      subcommands: [
        {
          name: 'connect',
          description: 'Connect to IDE',
          usage: '/ide connect',
        },
        {
          name: 'status',
          description: 'Show IDE connection status',
          usage: '/ide status',
        },
        {
          name: 'disconnect',
          description: 'Disconnect from IDE',
          usage: '/ide disconnect',
        },
      ],
    });

    // Memory/context management
    this.register({
      name: 'memory',
      category: 'session',
      description: 'View memory and context usage',
      usage: '/memory',
      subcommands: [
        {
          name: 'show',
          description: 'Show current memory usage',
          usage: '/memory show',
        },
        {
          name: 'clear',
          description: 'Clear memory/context',
          usage: '/memory clear',
        },
      ],
    });

    // Permissions management
    this.register({
      name: 'permissions',
      altName: 'perms',
      category: 'tools',
      description: 'Manage tool permissions',
      usage: '/permissions [subcommand]',
      subcommands: [
        {
          name: 'show',
          description: 'Show current permissions',
          usage: '/permissions show',
        },
        {
          name: 'grant',
          description: 'Grant permission to a tool or path',
          usage: '/permissions grant <tool|path>',
        },
        {
          name: 'revoke',
          description: 'Revoke permission',
          usage: '/permissions revoke <tool|path>',
        },
        {
          name: 'reset',
          description: 'Reset to default permissions',
          usage: '/permissions reset',
        },
      ],
    });

    // Policies
    this.register({
      name: 'policies',
      category: 'tools',
      description: 'Manage permission policies',
      usage: '/policies [subcommand]',
      subcommands: [
        {
          name: 'list',
          altName: 'ls',
          description: 'List active policies',
          usage: '/policies list',
        },
        {
          name: 'set',
          description: 'Set a policy',
          usage: '/policies set <policy-name>',
        },
      ],
    });

    // Privacy notice
    this.register({
      name: 'privacy',
      category: 'system',
      description: 'View privacy notice and data handling',
      usage: '/privacy',
    });

    // User profile
    this.register({
      name: 'profile',
      category: 'config',
      description: 'Manage user profile settings',
      usage: '/profile',
      subcommands: [
        {
          name: 'show',
          description: 'Show current profile',
          usage: '/profile show',
        },
        {
          name: 'edit',
          description: 'Edit profile settings',
          usage: '/profile edit',
        },
      ],
    });

    // Restore from checkpoint
    this.register({
      name: 'restore',
      category: 'session',
      description: 'Restore session from checkpoint',
      usage: '/restore [checkpoint-id]',
      examples: [
        '/restore - List available checkpoints',
        '/restore abc123 - Restore specific checkpoint',
      ],
    });

    // Resume (alias behavior to /continue)
    this.register({
      name: 'resume',
      category: 'session',
      description: 'Resume a previous session',
      usage: '/resume [session-id]',
      examples: [
        '/resume - List and select session to resume',
        '/resume abc123 - Resume specific session',
      ],
    });

    // Settings dialog
    this.register({
      name: 'settings',
      category: 'config',
      description: 'Open settings dialog',
      usage: '/settings',
    });

    // GitHub setup
    this.register({
      name: 'setup-github',
      altName: 'setup',
      category: 'ide',
      description: 'Setup GitHub integration',
      usage: '/setup-github',
      subcommands: [
        {
          name: 'auth',
          description: 'Authenticate with GitHub',
          usage: '/setup-github auth',
        },
        {
          name: 'repo',
          description: 'Configure repository settings',
          usage: '/setup-github repo',
        },
      ],
    });

    // Statistics
    this.register({
      name: 'stats',
      category: 'system',
      description: 'Show session and usage statistics',
      usage: '/stats',
      subcommands: [
        {
          name: 'session',
          description: 'Show session statistics',
          usage: '/stats session',
        },
        {
          name: 'model',
          description: 'Show model usage statistics',
          usage: '/stats model',
        },
        {
          name: 'tools',
          description: 'Show tool usage statistics',
          usage: '/stats tools',
        },
      ],
    });

    // Terminal setup
    this.register({
      name: 'terminal',
      category: 'ide',
      description: 'Configure terminal settings',
      usage: '/terminal',
      subcommands: [
        {
          name: 'setup',
          description: 'Run terminal setup wizard',
          usage: '/terminal setup',
        },
        {
          name: 'reset',
          description: 'Reset terminal configuration',
          usage: '/terminal reset',
        },
      ],
    });

    // Vim mode toggle
    this.register({
      name: 'vim',
      category: 'config',
      description: 'Toggle vim keybindings mode',
      usage: '/vim',
      examples: [
        '/vim - Toggle vim mode ON/OFF',
      ],
    });
  }
}

/**
 * Global registry instance
 */
export const slashCommandRegistry = new SlashCommandRegistry();
