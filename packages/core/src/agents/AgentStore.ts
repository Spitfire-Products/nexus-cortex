/**
 * AgentStore - Manages Task Agent profile definitions
 *
 * Loads, validates, and manages agent definitions from .cortex/agents/ directories.
 * Supports project-level and personal (global) agents with hot-reload capability.
 *
 * @module agents/AgentStore
 * @version 1.0.0
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import { resolveProjectAgentsDir } from './projectRoot.js';
import type {
  AgentDefinition,
  AgentPermissions,
  AgentPermissionMode,
} from '../orchestrator/SubAgentTypes.js';

/**
 * Execution tools that default to graylist (require approval)
 */
const EXECUTION_TOOLS = ['Bash', 'BashOutput', 'KillShell', 'Write', 'Edit', 'NotebookEdit'];

/**
 * Agent store configuration
 */
export interface AgentStoreConfig {
  /** Project .cortex/agents/ directory */
  projectDir?: string;

  /** Personal ~/.cortex/agents/ directory */
  personalDir?: string;

  /**
   * Built-in / shipped .cortex/agents/ directory (the install root). Defaults
   * to `$CORTEX_ROOT/.cortex/agents` so the agents that ship with the install
   * are discoverable regardless of the current working directory. Lowest
   * priority — project and personal agents override builtins by name.
   */
  builtinDir?: string;

  /** Enable file watching for hot reload */
  enableWatching?: boolean;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Parsed agent metadata from YAML frontmatter
 */
interface AgentFrontmatter {
  name: string;
  description: string;
  tools: string[] | 'all';
  model: string;
  permissions?: AgentPermissions;
}

/**
 * Create options for new agents
 */
export interface CreateAgentOptions {
  name: string;
  description: string;
  tools: string[] | 'all';
  model: string;
  systemPrompt?: string;
  location?: 'project' | 'personal';
  permissions?: AgentPermissions;
}

/**
 * AgentStore class
 */
export class AgentStore extends EventEmitter {
  private agents: Map<string, AgentDefinition> = new Map();
  // R17 (Opus parallel-bench): loadAllAgents() re-parsed every profile from
  // disk on every call (watcher fires it on every single-file change).
  // Cache parsed definitions keyed by filePath, invalidated by mtime.
  private agentFileCache: Map<string, { agent: AgentDefinition; mtime: number }> = new Map();
  private projectDir: string;
  private personalDir: string;
  private builtinDir?: string;
  private enableWatching: boolean;
  private debug: boolean;
  private watchers: fs.FileHandle[] = [];
  private watcherControllers: AbortController[] = [];

  constructor(config: AgentStoreConfig = {}) {
    super();
    // Walk up from cwd to the nearest project root containing .cortex/agents so
    // project agents resolve when launched from a subdirectory.
    this.projectDir = config.projectDir || resolveProjectAgentsDir(process.cwd());
    this.personalDir = config.personalDir || path.join(os.homedir(), '.cortex', 'agents');
    // Built-in/shipped agents live under the install root ($CORTEX_ROOT). This
    // makes them discoverable from any cwd — without it, the agents that ship
    // with the install only appear when you happen to launch from the install
    // directory. Undefined when CORTEX_ROOT is unset (no builtin tier).
    this.builtinDir =
      config.builtinDir ||
      (process.env.CORTEX_ROOT
        ? path.join(process.env.CORTEX_ROOT, '.cortex', 'agents')
        : undefined);
    this.enableWatching = config.enableWatching ?? false;
    this.debug = config.debug ?? false;
  }

  /**
   * Initialize the store - load all agents
   */
  async initialize(): Promise<void> {
    await this.loadAllAgents();

    if (this.enableWatching) {
      await this.startWatching();
    }
  }

  /**
   * Load all agents from both directories
   */
  async loadAllAgents(): Promise<void> {
    this.agents.clear();

    // Priority order (lowest first; each tier overwrites the previous by name):
    //   builtin (shipped/$CORTEX_ROOT) < personal (~/.cortex) < project (cwd)
    // Skip a tier whose directory duplicates a higher-priority one so the same
    // file isn't loaded twice under the wrong location label.
    const loaded = new Set<string>();
    const tiers: Array<[string | undefined, 'builtin' | 'personal' | 'project']> = [
      [this.builtinDir, 'builtin'],
      [this.personalDir, 'personal'],
      [this.projectDir, 'project'],
    ];
    for (let i = 0; i < tiers.length; i++) {
      const tier = tiers[i];
      if (!tier) continue;
      const [dir, location] = tier;
      if (!dir) continue;
      const abs = path.resolve(dir);
      // Skip if a later (higher-priority) tier points at the same directory.
      let shadowed = false;
      for (let j = i + 1; j < tiers.length; j++) {
        const later = tiers[j];
        if (later && later[0] && path.resolve(later[0]) === abs) {
          shadowed = true;
          break;
        }
      }
      if (shadowed || loaded.has(abs)) continue;
      loaded.add(abs);
      await this.loadAgentsFromDir(dir, location);
    }

    this.log(`Loaded ${this.agents.size} agents`);
  }

  /**
   * Load agents from a directory
   */
  private async loadAgentsFromDir(
    dir: string,
    location: 'project' | 'personal' | 'builtin'
  ): Promise<void> {
    try {
      await fs.access(dir);
    } catch {
      // Directory doesn't exist, skip
      this.log(`Directory not found: ${dir}`);
      return;
    }

    const files = await fs.readdir(dir);

    for (const file of files) {
      if (!file.endsWith('.md') || file === 'AGENT_PROFILE_GUIDE.md') {
        continue;
      }

      const filePath = path.join(dir, file);
      try {
        const mtime = (await fs.stat(filePath)).mtimeMs;
        const cached = this.agentFileCache.get(filePath);
        if (cached && cached.mtime === mtime) {
          this.agents.set(cached.agent.name, cached.agent);
          this.log(`Cache hit: ${cached.agent.name} from ${location}`);
          continue;
        }
        const agent = await this.loadAgentFile(filePath, location);
        if (agent) {
          this.agentFileCache.set(filePath, { agent, mtime });
          this.agents.set(agent.name, agent);
          this.log(`Loaded agent: ${agent.name} from ${location}`);
        }
      } catch (error: any) {
        this.log(`Failed to load ${file}: ${error.message}`);
      }
    }
  }

  /**
   * Load a single agent file
   */
  private async loadAgentFile(
    filePath: string,
    location: 'project' | 'personal' | 'builtin'
  ): Promise<AgentDefinition | null> {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = this.parseAgentFile(content, filePath);

    if (!parsed) {
      return null;
    }

    const { frontmatter, systemPrompt } = parsed;

    // Validate agent
    const validation = this.validateAgent(frontmatter);
    if (!validation.valid) {
      throw new Error(`Invalid agent: ${validation.errors.join(', ')}`);
    }

    // Build permissions with smart defaults
    const permissions = this.buildDefaultPermissions(frontmatter.tools, frontmatter.permissions);

    return {
      name: frontmatter.name,
      description: frontmatter.description,
      systemPrompt,
      tools: frontmatter.tools,
      model: frontmatter.model,
      location,
      filePath,
      permissions,
    };
  }

  /**
   * Build permissions with smart defaults based on tools
   *
   * - If no permissions specified, defaults to 'interactive' mode
   * - Execution tools (Bash, Write, Edit) default to graylist
   * - Read-only tools default to whitelist
   */
  private buildDefaultPermissions(
    tools: string[] | 'all',
    explicitPermissions?: AgentPermissions
  ): AgentPermissions {
    // Start with explicit permissions or defaults
    const permissions: AgentPermissions = {
      defaultMode: explicitPermissions?.defaultMode || 'interactive',
      toolLevels: { ...explicitPermissions?.toolLevels },
      whitelist: [...(explicitPermissions?.whitelist || [])],
      graylist: [...(explicitPermissions?.graylist || [])],
      blacklist: [...(explicitPermissions?.blacklist || [])],
      allowExecutionTools: explicitPermissions?.allowExecutionTools ?? true,
    };

    // If tools are specified, apply smart defaults for execution tools
    const toolList = tools === 'all' ? EXECUTION_TOOLS : tools;

    for (const tool of toolList) {
      const toolLower = tool.toLowerCase();
      const isExecutionTool = EXECUTION_TOOLS.some((t) => t.toLowerCase() === toolLower);

      // Only set default if not explicitly configured
      const hasExplicitLevel = permissions.toolLevels?.[tool] ||
        permissions.whitelist?.includes(tool) ||
        permissions.graylist?.includes(tool) ||
        permissions.blacklist?.includes(tool);

      if (!hasExplicitLevel && isExecutionTool) {
        // Execution tools default to graylist (require approval)
        permissions.graylist = permissions.graylist || [];
        permissions.graylist.push(tool);
      }
    }

    return permissions;
  }

  /**
   * Parse agent file with YAML frontmatter
   */
  private parseAgentFile(
    content: string,
    filePath: string
  ): { frontmatter: AgentFrontmatter; systemPrompt: string } | null {
    // Check for YAML frontmatter
    if (!content.startsWith('---')) {
      this.log(`No frontmatter in ${filePath}`);
      return null;
    }

    // Find end of frontmatter
    const endIndex = content.indexOf('\n---', 3);
    if (endIndex === -1) {
      this.log(`Invalid frontmatter in ${filePath}`);
      return null;
    }

    const frontmatterYaml = content.slice(4, endIndex);
    const systemPrompt = content.slice(endIndex + 4).trim();

    // Parse YAML manually (simple parser for our schema)
    const frontmatter = this.parseSimpleYaml(frontmatterYaml);

    if (!frontmatter) {
      return null;
    }

    return { frontmatter, systemPrompt };
  }

  /**
   * Simple YAML parser for agent frontmatter
   *
   * Handles basic key-value pairs, arrays, and nested permissions object
   */
  private parseSimpleYaml(yaml: string): AgentFrontmatter | null {
    const result: Partial<AgentFrontmatter> = {};
    const lines = yaml.split('\n');
    let currentKey = '';
    let inArray = false;
    let inPermissions = false;
    let permissionsKey = '';
    const arrayItems: string[] = [];
    const permissionsArrayItems: string[] = [];
    const permissions: Partial<AgentPermissions> = {};

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Calculate indentation level
      const indent = line.length - line.trimStart().length;

      // Array item within permissions
      if (trimmed.startsWith('- ') && inPermissions && permissionsKey) {
        permissionsArrayItems.push(trimmed.slice(2).trim());
        continue;
      }

      // Array item for tools
      if (trimmed.startsWith('- ') && inArray && currentKey === 'tools') {
        arrayItems.push(trimmed.slice(2).trim());
        continue;
      }

      // Key-value pair
      const colonIndex = trimmed.indexOf(':');
      if (colonIndex === -1) continue;

      const key = trimmed.slice(0, colonIndex).trim();
      const value = trimmed.slice(colonIndex + 1).trim();

      // Handle permissions block ending - new top-level key at indent 0
      if (inPermissions && indent === 0 && key !== 'permissions') {
        // Save any pending permissions array
        if (permissionsKey && permissionsArrayItems.length > 0) {
          this.savePermissionsArray(permissions, permissionsKey, permissionsArrayItems);
          permissionsArrayItems.length = 0;
        }
        inPermissions = false;
        permissionsKey = '';
        result.permissions = permissions as AgentPermissions;
      }

      // Handle tools array ending
      if (inArray && currentKey === 'tools' && key !== 'tools' && indent === 0) {
        result.tools = arrayItems.length > 0 ? [...arrayItems] : 'all';
        arrayItems.length = 0;
        inArray = false;
      }

      // Parse permissions nested keys (indented under permissions:)
      if (inPermissions && indent > 0) {
        // Save previous permissions array if starting a new key
        if (permissionsKey && permissionsArrayItems.length > 0) {
          this.savePermissionsArray(permissions, permissionsKey, permissionsArrayItems);
          permissionsArrayItems.length = 0;
        }

        permissionsKey = key;

        if (value === '') {
          // This key starts an array (whitelist:, graylist:, blacklist:)
          continue;
        }

        // Scalar value
        if (key === 'defaultMode') {
          permissions.defaultMode = value as AgentPermissionMode;
        } else if (key === 'allowExecutionTools') {
          permissions.allowExecutionTools = value === 'true';
        }
        continue;
      }

      // Top-level keys
      currentKey = key;

      // Check if this starts permissions block
      if (key === 'permissions' && value === '') {
        inPermissions = true;
        continue;
      }

      // Check if this starts tools array
      if (key === 'tools' && (value === '' || value === '|')) {
        inArray = true;
        continue;
      }

      // Handle 'all' for tools
      if (key === 'tools' && value === 'all') {
        result.tools = 'all';
        continue;
      }

      // Store scalar values
      if (key === 'name') result.name = value;
      else if (key === 'description') result.description = value;
      else if (key === 'model') result.model = value;
    }

    // Finalize any pending arrays/blocks
    if (inArray && currentKey === 'tools') {
      result.tools = arrayItems.length > 0 ? [...arrayItems] : 'all';
    }

    if (inPermissions) {
      if (permissionsKey && permissionsArrayItems.length > 0) {
        this.savePermissionsArray(permissions, permissionsKey, permissionsArrayItems);
      }
      result.permissions = permissions as AgentPermissions;
    }

    // Validate required fields exist
    if (!result.name || !result.description || !result.model) {
      return null;
    }

    if (!result.tools) {
      result.tools = 'all';
    }

    return result as AgentFrontmatter;
  }

  /**
   * Helper to save permissions arrays
   */
  private savePermissionsArray(
    permissions: Partial<AgentPermissions>,
    key: string,
    items: string[]
  ): void {
    if (key === 'whitelist') {
      permissions.whitelist = [...items];
    } else if (key === 'graylist') {
      permissions.graylist = [...items];
    } else if (key === 'blacklist') {
      permissions.blacklist = [...items];
    }
  }

  /**
   * Validate an agent definition
   */
  private validateAgent(agent: AgentFrontmatter): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Name validation
    if (!agent.name) {
      errors.push('name is required');
    } else if (!/^[a-zA-Z0-9-]+$/.test(agent.name)) {
      errors.push('name must be alphanumeric with hyphens only');
    } else if (agent.name.length > 64) {
      errors.push('name must be 64 characters or less');
    }

    // Description validation
    if (!agent.description) {
      errors.push('description is required');
    }

    // Model validation
    if (!agent.model) {
      errors.push('model is required');
    }

    // Tools validation
    if (!agent.tools) {
      errors.push('tools is required');
    } else if (agent.tools !== 'all' && !Array.isArray(agent.tools)) {
      errors.push('tools must be an array or "all"');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Get all loaded agents
   */
  getAll(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get an agent by name
   */
  getAgent(name: string): AgentDefinition | undefined {
    return this.agents.get(name);
  }

  /**
   * Check if an agent exists
   */
  hasAgent(name: string): boolean {
    return this.agents.has(name);
  }

  /**
   * Get agents by location
   */
  getByLocation(location: 'project' | 'personal' | 'builtin'): AgentDefinition[] {
    return this.getAll().filter((a) => a.location === location);
  }

  /**
   * Create a new agent
   */
  async createAgent(options: CreateAgentOptions): Promise<AgentDefinition> {
    // Validate name
    const validation = this.validateAgent({
      name: options.name,
      description: options.description,
      tools: options.tools,
      model: options.model,
    });

    if (!validation.valid) {
      throw new Error(`Invalid agent: ${validation.errors.join(', ')}`);
    }

    // Check for duplicates
    if (this.hasAgent(options.name)) {
      throw new Error(`Agent '${options.name}' already exists`);
    }

    // Determine location and path
    const location = options.location || 'project';
    const dir = location === 'project' ? this.projectDir : this.personalDir;
    const filePath = path.join(dir, `${options.name}.md`);

    // Ensure directory exists
    await fs.mkdir(dir, { recursive: true });

    // Build file content
    const toolsYaml = options.tools === 'all'
      ? 'all'
      : options.tools.map((t) => ` - ${t}`).join('\n');

    // Build permissions YAML if provided
    const permissionsYaml = this.serializePermissions(options.permissions);

    const content = `---
name: ${options.name}
description: ${options.description}
tools:${options.tools === 'all' ? ' all' : '\n' + toolsYaml}
model: ${options.model}${permissionsYaml}
---

${options.systemPrompt || `# ${options.name}\n\nAdd your agent's system prompt here.`}
`;

    // Write file
    await fs.writeFile(filePath, content, 'utf-8');

    // Build permissions with smart defaults
    const permissions = this.buildDefaultPermissions(options.tools, options.permissions);

    // Create agent definition
    const agent: AgentDefinition = {
      name: options.name,
      description: options.description,
      systemPrompt: options.systemPrompt || `# ${options.name}\n\nAdd your agent's system prompt here.`,
      tools: options.tools,
      model: options.model,
      location,
      filePath,
      permissions,
    };

    // Add to store
    this.agents.set(agent.name, agent);
    this.emit('change');

    return agent;
  }

  /**
   * Serialize permissions to YAML format
   */
  private serializePermissions(permissions?: AgentPermissions): string {
    if (!permissions) {
      return '';
    }

    const lines: string[] = ['', 'permissions:'];

    if (permissions.defaultMode) {
      lines.push(` defaultMode: ${permissions.defaultMode}`);
    }

    if (permissions.allowExecutionTools !== undefined) {
      lines.push(` allowExecutionTools: ${permissions.allowExecutionTools}`);
    }

    if (permissions.whitelist && permissions.whitelist.length > 0) {
      lines.push(' whitelist:');
      for (const tool of permissions.whitelist) {
        lines.push(` - ${tool}`);
      }
    }

    if (permissions.graylist && permissions.graylist.length > 0) {
      lines.push(' graylist:');
      for (const tool of permissions.graylist) {
        lines.push(` - ${tool}`);
      }
    }

    if (permissions.blacklist && permissions.blacklist.length > 0) {
      lines.push(' blacklist:');
      for (const tool of permissions.blacklist) {
        lines.push(` - ${tool}`);
      }
    }

    // Only return content if we have more than just "permissions:"
    return lines.length > 2 ? lines.join('\n') : '';
  }

  /**
   * Update an agent's content
   */
  async updateAgent(name: string, content: string): Promise<void> {
    const agent = this.getAgent(name);
    if (!agent) {
      throw new Error(`Agent '${name}' not found`);
    }

    await fs.writeFile(agent.filePath, content, 'utf-8');

    // Reload the agent
    const updated = await this.loadAgentFile(agent.filePath, agent.location);
    if (updated) {
      // If the name changed, remove the old entry from the map
      if (updated.name !== name) {
        this.agents.delete(name);
        this.log(`Agent renamed from '${name}' to '${updated.name}'`);
      }
      this.agents.set(updated.name, updated);
      this.emit('change');
    }
  }

  /**
   * Delete an agent
   */
  async deleteAgent(name: string): Promise<void> {
    const agent = this.getAgent(name);
    if (!agent) {
      throw new Error(`Agent '${name}' not found`);
    }

    await fs.unlink(agent.filePath);
    this.agents.delete(name);
    this.emit('change');
  }

  /**
   * Get raw file content for an agent
   */
  async getAgentContent(name: string): Promise<string> {
    const agent = this.getAgent(name);
    if (!agent) {
      throw new Error(`Agent '${name}' not found`);
    }

    return fs.readFile(agent.filePath, 'utf-8');
  }

  /**
   * Start watching directories for changes
   */
  private async startWatching(): Promise<void> {
    for (const dir of [this.projectDir, this.personalDir]) {
      try {
        await fs.access(dir);

        const controller = new AbortController();
        this.watcherControllers.push(controller);

        // Use recursive watching
        (async () => {
          try {
            const watcher = fs.watch(dir, {
              recursive: false,
              signal: controller.signal,
            });

            for await (const event of watcher) {
              if (event.filename?.endsWith('.md')) {
                this.log(`File changed: ${event.filename}`);
                await this.loadAllAgents();
                this.emit('change');
              }
            }
          } catch (error: any) {
            if (error.name !== 'AbortError') {
              this.log(`Watch error: ${error.message}`);
            }
          }
        })();

        this.log(`Watching: ${dir}`);
      } catch {
        // Directory doesn't exist, skip
      }
    }
  }

  /**
   * Add a change listener
   */
  onChange(listener: () => void): void {
    this.on('change', listener);
  }

  /**
   * Remove a change listener
   */
  removeChangeListener(listener: () => void): void {
    this.off('change', listener);
  }

  /**
   * Destroy the store and cleanup
   */
  async destroy(): Promise<void> {
    // Abort watchers
    for (const controller of this.watcherControllers) {
      controller.abort();
    }
    this.watcherControllers = [];

    // Close any open handles
    for (const watcher of this.watchers) {
      await watcher.close();
    }
    this.watchers = [];

    this.removeAllListeners();
  }

  /**
   * Debug logging
   */
  private log(message: string): void {
    if (this.debug) {
      console.log(`[AgentStore] ${message}`);
    }
  }

  /**
   * Get the project agents directory path
   */
  getProjectDir(): string {
    return this.projectDir;
  }

  /**
   * Get the personal agents directory path
   */
  getPersonalDir(): string {
    return this.personalDir;
  }
}

/**
 * Create an AgentStore with default paths for a project
 */
export function createAgentStore(
  projectRoot: string,
  options: { enableWatching?: boolean; debug?: boolean } = {}
): AgentStore {
  return new AgentStore({
    projectDir: resolveProjectAgentsDir(projectRoot),
    personalDir: path.join(os.homedir(), '.cortex', 'agents'),
    enableWatching: options.enableWatching,
    debug: options.debug,
  });
}
