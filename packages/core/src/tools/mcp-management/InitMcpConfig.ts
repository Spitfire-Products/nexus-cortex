/**
 * InitMcpConfig Tool
 *
 * Analyzes the current project directory and creates a tailored MCP_CONFIG.md
 * with recommended MCP servers based on detected project characteristics.
 *
 * Features:
 * - Detects project type (Node.js, Python, database, web, etc.)
 * - Recommends relevant MCP servers based on project files
 * - Creates MCP_CONFIG.md in current directory or ~/.cortex/
 * - Provides explanations for each recommendation
 *
 * Phase 2.6: MCP Model Management Tools
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { CanonicalTool } from '../types/CanonicalTool.js';
import type { McpServerRegistry } from '../../mcp/McpServerRegistry.js';
import type { McpConfigManager, McpConfigServerEntry } from '../../mcp/McpConfigManager.js';

export interface InitMcpConfigInput {
  /**
   * Target directory for MCP_CONFIG.md
   * - If 'auto': Use current working directory
   * - If 'global': Use ~/.cortex/
   * - If path string: Use specified path
   */
  scope?: 'auto' | 'global' | string;

  /**
   * Override auto-detection and manually specify server names
   */
  servers?: string[];

  /**
   * Include all recommended servers (default: only essential ones)
   */
  include_optional?: boolean;

  /**
   * Dry run - show recommendations without creating file
   */
  dry_run?: boolean;
}

export interface ProjectAnalysis {
  type: string[];              // e.g., ['nodejs', 'typescript', 'web']
  features: string[];           // e.g., ['database', 'api', 'testing']
  detectedFiles: string[];      // Files that influenced analysis
  recommendedServers: ServerRecommendation[];
}

export interface ServerRecommendation {
  name: string;
  priority: 'essential' | 'recommended' | 'optional';
  reason: string;
  autoStart: boolean;
  args?: string[];
  env?: Record<string, string>;
}

export interface InitMcpConfigOutput {
  status: 'success' | 'already_exists' | 'error';
  message: string;
  analysis: ProjectAnalysis;
  configPath?: string;
  serversEnabled: number;
  dryRun: boolean;
}

export class InitMcpConfig {
  /**
   * Execute the init_mcp_config tool
   *
   * @param input Tool input parameters
   * @param serverRegistry MCP server registry
   * @param configManager MCP config manager
   * @param workingDir Current working directory
   * @returns Result of initialization
   */
  static async execute(
    input: InitMcpConfigInput,
    serverRegistry: McpServerRegistry,
    configManager: McpConfigManager,
    workingDir: string
  ): Promise<InitMcpConfigOutput> {
    const dryRun = input.dry_run || false;

    // 1. Determine target directory and scope
    const { targetDir, scope } = await this.determineTargetDir(input.scope, workingDir);

    // 2. Check if MCP_CONFIG.md already exists
    const configPath = path.join(targetDir, 'MCP_CONFIG.md');
    const configExists = await this.fileExists(configPath);

    if (configExists && !dryRun) {
      return {
        status: 'already_exists',
        message: `MCP_CONFIG.md already exists at ${configPath}. Delete it first or use dry_run to preview changes.`,
        analysis: {
          type: [],
          features: [],
          detectedFiles: [],
          recommendedServers: []
        },
        serversEnabled: 0,
        dryRun
      };
    }

    // 3. Analyze project directory
    const analysis = input.servers
      ? await this.manualAnalysis(input.servers, serverRegistry)
      : await this.analyzeProject(targetDir, serverRegistry, input.include_optional || false);

    // 4. Create MCP_CONFIG.md (unless dry run)
    let serversEnabled = 0;
    if (!dryRun) {
      await this.createMcpConfig(
        targetDir,
        scope,
        analysis,
        configManager
      );
      serversEnabled = analysis.recommendedServers.length;
    }

    // 5. Format success message
    const message = this.formatSuccessMessage(
      analysis,
      configPath,
      dryRun,
      scope
    );

    return {
      status: 'success',
      message,
      analysis,
      configPath: dryRun ? undefined : configPath,
      serversEnabled,
      dryRun
    };
  }

  /**
   * Determine target directory based on scope
   */
  private static async determineTargetDir(
    scopeInput: string | undefined,
    workingDir: string
  ): Promise<{ targetDir: string; scope: 'project' | 'global' }> {
    if (scopeInput === 'global') {
      const homeDir = process.env.HOME || process.env.USERPROFILE || '';
      const globalDir = path.join(homeDir, '.cortex');
      await fs.mkdir(globalDir, { recursive: true });
      return { targetDir: globalDir, scope: 'global' };
    }

    if (scopeInput && scopeInput !== 'auto') {
      // Custom path provided
      const resolvedPath = path.isAbsolute(scopeInput)
        ? scopeInput
        : path.join(workingDir, scopeInput);
      return { targetDir: resolvedPath, scope: 'project' };
    }

    // Auto mode: use working directory
    return { targetDir: workingDir, scope: 'project' };
  }

  /**
   * Analyze project directory to recommend MCP servers
   */
  private static async analyzeProject(
    targetDir: string,
    serverRegistry: McpServerRegistry,
    includeOptional: boolean
  ): Promise<ProjectAnalysis> {
    const detectedFiles: string[] = [];
    const projectTypes: Set<string> = new Set();
    const features: Set<string> = new Set();
    const recommendations: ServerRecommendation[] = [];

    try {
      const files = await fs.readdir(targetDir);

      // Analyze project files
      for (const file of files) {
        const filePath = path.join(targetDir, file);
        const stat = await fs.stat(filePath);

        if (stat.isFile()) {
          detectedFiles.push(file);

          // Detect project type
          if (file === 'package.json') {
            projectTypes.add('nodejs');
            features.add('filesystem');
          }
          if (file === 'tsconfig.json') {
            projectTypes.add('typescript');
          }
          if (file === 'requirements.txt' || file === 'pyproject.toml' || file === 'setup.py') {
            projectTypes.add('python');
            features.add('filesystem');
          }
          if (file === 'Cargo.toml') {
            projectTypes.add('rust');
            features.add('filesystem');
          }
          if (file === 'go.mod') {
            projectTypes.add('go');
            features.add('filesystem');
          }
          if (file === '.env' || file.includes('.env.')) {
            features.add('environment');
          }
          if (file.includes('docker-compose') || file === 'Dockerfile') {
            features.add('docker');
          }
          if (file.includes('database') || file.endsWith('.sql')) {
            features.add('database');
          }
        }
      }

      // Check for common directories
      if (files.includes('src') || files.includes('lib')) {
        features.add('source-code');
      }
      if (files.includes('test') || files.includes('tests') || files.includes('__tests__')) {
        features.add('testing');
      }
      if (files.includes('public') || files.includes('static')) {
        features.add('web');
      }
      if (files.includes('.git')) {
        features.add('git');
      }

      // Generate recommendations based on analysis
      recommendations.push(...this.generateRecommendations(
        Array.from(projectTypes),
        Array.from(features),
        serverRegistry,
        includeOptional,
        targetDir
      ));

    } catch (error) {
      // If can't read directory, provide no recommendations
      // Nexus Cortex has comprehensive native tools (Read, Write, Edit, Glob, Grep, Bash)
      // that handle file operations without MCP servers
    }

    return {
      type: Array.from(projectTypes),
      features: Array.from(features),
      detectedFiles,
      recommendedServers: recommendations
    };
  }

  /**
   * Generate MCP server recommendations based on project analysis
   */
  private static generateRecommendations(
    projectTypes: string[],
    features: string[],
    serverRegistry: McpServerRegistry,
    includeOptional: boolean,
    _targetDir: string  // Unused but kept for API compatibility
  ): ServerRecommendation[] {
    const recommendations: ServerRecommendation[] = [];

    // NOTE: Filesystem, Git, and Brave Search MCP servers are NOT recommended
    // because Nexus Cortex has comprehensive native tools:
    // - File operations: Read, Write, Edit, Glob, Grep
    // - Git operations: Bash tool (git commands)
    // - Web search: WebSearch tool
    // See MCP_REDUNDANCY_ANALYSIS.md for full analysis

    // nexus-browser - the canonical browser-automation MCP (the built-in `browse` tool
    // drives this server). Hosted HTTP service with auto-provisioned free-tier keys.
    if (includeOptional && (features.includes('web') || projectTypes.includes('nodejs')) && serverRegistry.hasServer('nexus-browser')) {
      recommendations.push({
        name: 'nexus-browser',
        priority: 'recommended',
        reason: 'Browser automation — the canonical nexus-browser MCP that the `browse` tool drives (hosted, auto-provisioning)',
        autoStart: true
      });
    }

    // PostgreSQL - OPTIONAL for structured database API
    // (Native alternative: Bash + psql commands)
    if (includeOptional && features.includes('database') && serverRegistry.hasServer('postgres')) {
      recommendations.push({
        name: 'postgres',
        priority: 'optional',
        reason: 'Structured database API - requires DATABASE_URL (alternative: Bash + psql)',
        autoStart: false,
        env: { DATABASE_URL: 'postgresql://user:pass@localhost:5432/dbname' }
      });
    }

    // SQLite - OPTIONAL for structured database API
    // (Native alternative: Bash + sqlite3 commands)
    if (includeOptional && features.includes('database') && serverRegistry.hasServer('sqlite')) {
      recommendations.push({
        name: 'sqlite',
        priority: 'optional',
        reason: 'Lightweight database API (alternative: Bash + sqlite3)',
        autoStart: false
      });
    }

    // All recommendations are optional only - no auto-enabled servers
    return includeOptional ? recommendations : [];
  }

  /**
   * Manual analysis when user specifies servers explicitly
   */
  private static async manualAnalysis(
    serverNames: string[],
    serverRegistry: McpServerRegistry
  ): Promise<ProjectAnalysis> {
    const recommendations: ServerRecommendation[] = [];

    for (const serverName of serverNames) {
      const serverDef = serverRegistry.getServer(serverName);
      if (serverDef) {
        recommendations.push({
          name: serverName,
          priority: 'essential',
          reason: 'Manually specified by user',
          autoStart: true
        });
      }
    }

    return {
      type: ['manual'],
      features: ['manual'],
      detectedFiles: [],
      recommendedServers: recommendations
    };
  }

  /**
   * Create MCP_CONFIG.md file
   */
  private static async createMcpConfig(
    _targetDir: string,
    scope: 'project' | 'global',
    analysis: ProjectAnalysis,
    configManager: McpConfigManager
  ): Promise<void> {
    const servers: McpConfigServerEntry[] = [];

    for (const rec of analysis.recommendedServers) {
      const serverDef = await this.lookupServerDefinition(rec.name);
      if (serverDef) {
        const isHttp = serverDef.transport === 'http' || !!serverDef.url;
        servers.push({
          name: rec.name,
          status: 'available',  // Changed from 'enabled' - servers are opt-in, not auto-enabled
          description: serverDef.description || rec.reason,
          ...(isHttp
            ? { transport: 'http' as const, url: serverDef.url, headers: serverDef.headers }
            : { command: serverDef.command, args: rec.args || serverDef.defaultArgs }),
          env: rec.env,
          autoStart: rec.autoStart
        });
      }
    }

    const config = {
      servers,
      notes: this.generateConfigNotes(analysis, scope)
    };

    await configManager.writeConfig(scope, config);
  }

  /**
   * Lookup server definition from registry
   */
  private static async lookupServerDefinition(serverName: string): Promise<any> {
    // This would normally use the serverRegistry.getServer()
    // For now, return basic definitions
    const definitions: Record<string, any> = {
      filesystem: {
        command: 'npx',
        defaultArgs: ['-y', '@modelcontextprotocol/server-filesystem'],
        description: 'File system operations (read, write, list, search files)'
      },
      git: {
        command: 'npx',
        defaultArgs: ['-y', '@modelcontextprotocol/server-git'],
        description: 'Git version control operations'
      },
      'nexus-browser': {
        transport: 'http',
        url: 'https://browser.spitfire-products.com/mcp',
        headers: { Authorization: 'Bearer ${NEXUS_BROWSER_API_KEY}' },
        command: '',
        description: 'Headless Chrome browser automation (hosted MCP service — auto-provisions a free-tier API key on first connect)'
      },
      postgres: {
        command: 'npx',
        defaultArgs: ['-y', '@modelcontextprotocol/server-postgres'],
        description: 'PostgreSQL database access'
      },
      sqlite: {
        command: 'npx',
        defaultArgs: ['-y', '@modelcontextprotocol/server-sqlite'],
        description: 'SQLite database access'
      },
      'brave-search': {
        command: 'npx',
        defaultArgs: ['-y', '@modelcontextprotocol/server-brave-search'],
        description: 'Web search via Brave Search API'
      }
    };

    return definitions[serverName];
  }

  /**
   * Generate config notes section
   */
  private static generateConfigNotes(
    analysis: ProjectAnalysis,
    scope: 'project' | 'global'
  ): string {
    const lines: string[] = [];

    lines.push('## Configuration Notes');
    lines.push('');
    lines.push(`**Scope**: ${scope === 'global' ? 'Global (all projects)' : 'Project-specific'}`);
    lines.push(`**Generated**: ${new Date().toISOString()}`);
    lines.push('');

    if (analysis.type.length > 0) {
      lines.push(`**Detected Project Type**: ${analysis.type.join(', ')}`);
    }

    if (analysis.features.length > 0) {
      lines.push(`**Detected Features**: ${analysis.features.join(', ')}`);
    }

    lines.push('');
    lines.push('**Important**: Nexus Cortex has comprehensive native tools that handle most operations:');
    lines.push('- File operations: Read, Write, Edit, Glob, Grep');
    lines.push('- Git operations: Bash tool (run git commands directly)');
    lines.push('- Web search: WebSearch tool');
    lines.push('');
    lines.push('**MCP servers are optional** and provide specialized functionality:');
    lines.push('- All servers listed below are marked as "available" (not enabled)');
    lines.push('- Use native tools first, enable MCP servers only if needed');
    lines.push('- Enable with: `EnableMcpServer` tool or edit this file to set status: "enabled"');
    lines.push('- See: MCP_REDUNDANCY_ANALYSIS.md for detailed comparison');

    return lines.join('\n');
  }

  /**
   * Format success message
   */
  private static formatSuccessMessage(
    analysis: ProjectAnalysis,
    configPath: string,
    dryRun: boolean,
    _scope: 'project' | 'global'
  ): string {
    const lines: string[] = [];

    if (dryRun) {
      lines.push('# MCP Config Analysis (Dry Run)');
      lines.push('');
      lines.push('No files were created. Here\'s what would be configured:');
    } else {
      lines.push('# MCP Config Created Successfully');
      lines.push('');
      lines.push(`[OK] Created MCP_CONFIG.md at: ${configPath}`);
    }

    lines.push('');
    lines.push('## Project Analysis');
    if (analysis.type.length > 0) {
      lines.push(`**Type**: ${analysis.type.join(', ')}`);
    }
    if (analysis.features.length > 0) {
      lines.push(`**Features**: ${analysis.features.join(', ')}`);
    }

    lines.push('');
    lines.push('## Recommended Servers');
    lines.push('');

    for (const rec of analysis.recommendedServers) {
      const icon = rec.priority === 'essential' ? '' : rec.priority === 'recommended' ? '' : '⚪';
      lines.push(`${icon} **${rec.name}** (${rec.priority})`);
      lines.push(` ${rec.reason}`);
      lines.push(` Auto-start: ${rec.autoStart ? 'Yes' : 'No'}`);
      if (rec.env) {
        lines.push(` Requires env: ${Object.keys(rec.env).join(', ')}`);
      }
      lines.push('');
    }

    if (!dryRun) {
      lines.push('---');
      lines.push('');
      lines.push('**Next Steps**:');
      lines.push('1. Review the generated MCP_CONFIG.md');
      lines.push('2. All servers are marked as "available" (not enabled)');
      lines.push('3. Use native tools (Read, Write, Grep, Bash) for most operations');
      lines.push('4. Enable specific servers only if you need their specialized APIs');
      lines.push('5. Use `EnableMcpServer` tool or edit MCP_CONFIG.md to enable servers');
      lines.push('6. See MCP_REDUNDANCY_ANALYSIS.md for guidance on when to use MCP vs native tools');
    }

    return lines.join('\n');
  }

  /**
   * Check if file exists
   */
  private static async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the canonical tool definition for init_mcp_config
   */
  static getToolDefinition(): CanonicalTool {
    return {
      name: 'InitMcpConfig',
      description: 'Analyzes the current project and creates a tailored MCP_CONFIG.md with recommended MCP servers based on detected project characteristics (Node.js, Python, database, etc.)',
      schema: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            description: 'Target for MCP_CONFIG.md: "auto" (current directory), "global" (~/.cortex/), or custom path',
            enum: ['auto', 'global']
          },
          servers: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional: Manually specify server names instead of auto-detection'
          },
          include_optional: {
            type: 'boolean',
            description: 'Include optional servers in recommendations (default: false)'
          },
          dry_run: {
            type: 'boolean',
            description: 'Preview recommendations without creating file (default: false)'
          }
        }
      }
    };
  }
}
