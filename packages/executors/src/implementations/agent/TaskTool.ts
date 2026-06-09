import { BaseTool } from '../../base/BaseTool.js';
import type { ToolResult } from '../../base/ToolResult.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { glob } from 'glob';

/**
 * Parameters for Task tool
 */
export interface TaskParams {
  description: string;  // Short description of the task
  prompt: string;       // The task for the agent to perform
  subagent_type: string; // Type of specialized agent to use
  model?: string;       // Optional model override
  resume?: string;      // Optional session ID to resume
}

/**
 * Agent definition from AGENT.md file
 */
interface AgentDefinition {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  systemPrompt: string;
  location: 'project' | 'personal';
  filePath: string;
}

/**
 * TaskTool - Launch specialized sub-agents to handle complex tasks
 *
 * Loads agent definitions from .cortex/agents/*.md files and returns
 * the agent's system prompt and configuration for orchestrator to use.
 *
 * Agent files use YAML frontmatter:
 * ---
 * name: agent-name
 * description: When to use this agent
 * tools: Tool1, Tool2, Tool3
 * model: sonnet | opus | haiku | inherit
 * ---
 *
 * # Agent System Prompt
 * ...instructions...
 */
export class TaskToolExecutor extends BaseTool<TaskParams, ToolResult> {
  private agentsCache: Map<string, AgentDefinition> | null = null;
  private projectAgentsDir: string;
  private personalAgentsDir: string;

  constructor(config: { workingDirectory: string }) {
    const schema = {
      type: 'object' as const,
      properties: {
        description: {
          type: 'string' as const,
          description: 'Short description of the task (3-5 words)'
        },
        prompt: {
          type: 'string' as const,
          description: 'The task for the agent to perform'
        },
        subagent_type: {
          type: 'string' as const,
          description: 'Type of specialized agent to use'
        },
        model: {
          type: 'string' as const,
          description: 'Optional model override. Accepts Claude aliases (sonnet, opus, haiku), "inherit", or any full model ID (e.g., "deepseek-v4-pro", "grok-4.3") for cross-provider dispatch.'
        },
        resume: {
          type: 'string' as const,
          description: 'Optional session ID to resume from'
        }
      },
      required: ['description' as const, 'prompt' as const, 'subagent_type' as const]
    };

    super('Task', 'Task', 'Launch a sub-agent to handle complex tasks', schema);

    this.projectAgentsDir = join(config.workingDirectory, '.cortex', 'agents');
    this.personalAgentsDir = join(homedir(), '.cortex', 'agents');
  }

  validateToolParams(params: TaskParams): string | null {
    // "list" only needs subagent_type
    if (params.subagent_type?.trim() === 'list') return null;

    // Validate description
    if (typeof params.description !== 'string' || params.description.trim().length === 0) {
      return 'description must be a non-empty string';
    }

    // Validate prompt
    if (typeof params.prompt !== 'string' || params.prompt.trim().length === 0) {
      return 'prompt must be a non-empty string';
    }

    // Validate subagent_type
    if (typeof params.subagent_type !== 'string' || params.subagent_type.trim().length === 0) {
      return 'subagent_type must be a non-empty string';
    }

    const trimmedType = params.subagent_type.trim();

    if (!/^[a-zA-Z0-9-]+$/.test(trimmedType)) {
      return 'subagent_type must contain only letters, numbers, and hyphens';
    }

    if (trimmedType.length > 64) {
      return 'subagent_type must be 64 characters or less';
    }

    // Validate model if provided. Accept Claude aliases, 'inherit', or any
    // full model ID (e.g., 'deepseek-v4-pro', 'grok-4.3') for cross-provider
    // benchmarks. Downstream ModelAliasResolver handles resolution/failure.
    if (params.model) {
      const trimmed = params.model.trim();
      if (trimmed.length === 0) {
        return 'model must be a non-empty string if provided';
      }
      if (trimmed.length > 128) {
        return 'model must be 128 characters or less';
      }
      if (!/^[a-zA-Z0-9_.@-]+$/.test(trimmed)) {
        return 'model must contain only letters, numbers, dots, underscores, hyphens, and @';
      }
    }

    return null;
  }

  getDescription(params: TaskParams): string {
    if (params.subagent_type?.trim() === 'list') return 'Listing available agents';
    return `Launching ${params.subagent_type || 'general-purpose'} agent: ${params.description}`;
  }

  async execute(params: TaskParams, signal: AbortSignal): Promise<ToolResult> {
    const startTime = Date.now();

    // Handle "list" — enumerate all available agents
    if (params.subagent_type?.trim() === 'list') {
      if (!this.agentsCache) {
        await this.loadAgents(signal);
      }
      const listing = this.formatAgentListing();
      return {
        ...this.createSuccessResult(listing),
        metadata: { executionTime: Date.now() - startTime },
      };
    }

    // Validate parameters
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return this.createErrorResult(validationError);
    }

    try {
      // Load agent definition
      const agent = await this.loadAgent(params.subagent_type.trim(), signal);

      // Determine effective model
      const effectiveModel = params.model || agent.model || 'inherit';

      // Format output for LLM
      const output = this.formatAgentOutput(agent, params, effectiveModel);

      return {
        ...this.createSuccessResult(output),
        metadata: {
          executionTime: Date.now() - startTime,
          agentName: agent.name,
          location: agent.location,
          model: effectiveModel,
          tools: agent.tools || [],
          description: params.description,
          promptLength: params.prompt.length,
          // Full agent definition for SubAgentManager to use
          agentDefinition: {
            name: agent.name,
            description: agent.description,
            systemPrompt: agent.systemPrompt,
            tools: agent.tools || [],
            model: effectiveModel,
            location: agent.location,
            filePath: agent.filePath
          },
          // Task prompt for SubAgentManager
          taskPrompt: params.prompt,
          // Flag to indicate this should spawn a sub-agent
          shouldSpawnSubAgent: true
        }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return this.createErrorResult(`Failed to launch agent: ${errorMessage}`);
    }
  }

  /**
   * Load an agent definition by name
   */
  private async loadAgent(agentType: string, signal: AbortSignal): Promise<AgentDefinition> {
    // Check cache first
    if (this.agentsCache) {
      const cached = this.agentsCache.get(agentType);
      if (cached) {
        return cached;
      }
    }

    // Load all agents and cache them
    await this.loadAgents(signal);

    // Check cache again
    if (this.agentsCache) {
      const agent = this.agentsCache.get(agentType);
      if (agent) {
        return agent;
      }
    }

    // Agent not found - list available agents
    const available = this.agentsCache
      ? Array.from(this.agentsCache.keys()).sort()
      : [];

    if (available.length === 0) {
      throw new Error(
        `Agent '${agentType}' not found. No agents available in .cortex/agents/ or ~/.cortex/agents/\n\n` +
        `To create agents, add .md files to these directories.`
      );
    }

    throw new Error(
      `Agent '${agentType}' not found in .cortex/agents/ or ~/.cortex/agents/\n\n` +
      `Available agents: ${available.join(', ')}`
    );
  }

  /**
   * Load all agents from both project and personal directories
   */
  private async loadAgents(signal: AbortSignal): Promise<void> {
    this.agentsCache = new Map();

    // Load personal agents first (lower priority)
    await this.loadAgentsFromDirectory(this.personalAgentsDir, 'personal', signal);

    // Load project agents second (higher priority - will override personal)
    await this.loadAgentsFromDirectory(this.projectAgentsDir, 'project', signal);
  }

  /**
   * Load agents from a specific directory
   */
  private async loadAgentsFromDirectory(
    baseDir: string,
    location: 'personal' | 'project',
    signal: AbortSignal
  ): Promise<void> {
    try {
      const agentFiles = await glob('*.md', {
        cwd: baseDir,
        signal,
        absolute: false
      });

      for (const file of agentFiles) {
        signal.throwIfAborted();

        const agentPath = join(baseDir, file);
        const agentDef = await this.parseAgentFile(agentPath, location);

        if (agentDef) {
          // Project agents override personal agents
          if (!this.agentsCache!.has(agentDef.name) || location === 'project') {
            this.agentsCache!.set(agentDef.name, agentDef);
          }
        }
      }
    } catch (error) {
      // Directory might not exist, that's okay
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`Warning loading agents from ${baseDir}:`, error);
      }
    }
  }

  /**
   * Parse an agent definition file
   */
  private async parseAgentFile(
    filePath: string,
    location: 'personal' | 'project'
  ): Promise<AgentDefinition | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');

      // Extract YAML frontmatter
      const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);

      if (!frontmatterMatch) {
        console.warn(`No frontmatter found in ${filePath}`);
        return null;
      }

      const frontmatterText = frontmatterMatch[1] || '';
      const systemPrompt = frontmatterMatch[2] || '';

      // Parse frontmatter
      const frontmatter = this.parseFrontmatter(frontmatterText);

      if (!frontmatter.name) {
        console.warn(`Missing 'name' field in ${filePath}`);
        return null;
      }

      if (!frontmatter.description) {
        console.warn(`Missing 'description' field in ${filePath}`);
        return null;
      }

      return {
        name: frontmatter.name,
        description: frontmatter.description,
        tools: frontmatter.tools ? frontmatter.tools.split(',').map((t: string) => t.trim()) : undefined,
        model: frontmatter.model,
        systemPrompt: systemPrompt.trim(),
        location,
        filePath
      };
    } catch (error) {
      console.warn(`Error parsing agent file ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Parse YAML frontmatter into key-value pairs
   */
  private parseFrontmatter(text: string): Record<string, string> {
    const result: Record<string, string> = {};
    const lines = text.split('\n');

    for (const line of lines) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match && match[1] && match[2] !== undefined) {
        const key = match[1].trim();
        const value = match[2].trim();
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Format agent output for LLM consumption
   */
  private formatAgentOutput(
    agent: AgentDefinition,
    params: TaskParams,
    effectiveModel: string
  ): string {
    const lines: string[] = [];

    lines.push(`# Agent: ${agent.name}`);
    lines.push('');
    lines.push(`**Description**: ${agent.description}`);
    lines.push(`**Location**: ${agent.location} (${agent.location === 'project' ? '.cortex/agents/' : '~/.cortex/agents/'})`);
    lines.push(`**Model**: ${effectiveModel}`);

    if (agent.tools && agent.tools.length > 0) {
      lines.push(`**Tools**: ${agent.tools.join(', ')}`);
    }

    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## Task');
    lines.push('');
    lines.push(`**Description**: ${params.description}`);
    lines.push('');
    lines.push('**Prompt**:');
    lines.push('```');
    lines.push(params.prompt);
    lines.push('```');
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## Agent System Prompt');
    lines.push('');
    lines.push(agent.systemPrompt);

    return lines.join('\n');
  }

  /**
   * Format a readable listing of all available agents
   */
  private formatAgentListing(): string {
    const parts: string[] = [];

    // Always-available built-in agent
    parts.push('# Available Agents\n');
    parts.push('## Built-in (always available)');
    parts.push('- **general-purpose**: Complex multi-step tasks, code generation, any task\n');

    if (this.agentsCache && this.agentsCache.size > 0) {
      parts.push('## From .cortex/agents/\n');
      parts.push('| Agent | Description | Model | Tools |');
      parts.push('|-------|-------------|-------|-------|');

      for (const agent of this.agentsCache.values()) {
        const tools = agent.tools?.join(', ') || 'all';
        const model = agent.model || 'inherit';
        const desc = agent.description.split('\n')[0]!.substring(0, 120);
        parts.push(`| \`${agent.name}\` | ${desc} | ${model} | ${tools} |`);
      }
    } else {
      parts.push('No custom agents found in .cortex/agents/ or ~/.cortex/agents/');
    }

    parts.push('');
    parts.push('To launch: `task({ description: "...", prompt: "...", subagent_type: "agent-name" })`');

    return parts.join('\n');
  }

  /**
   * Clear the agent cache (for testing or when agents are modified)
   */
  public clearCache(): void {
    this.agentsCache = null;
  }
}
