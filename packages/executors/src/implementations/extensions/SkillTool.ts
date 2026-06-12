/**
 * Skill Tool - Invoke specialized skills from .agents/skills/ or .cortex/skills/
 *
 * Loads and invokes skills defined as directories containing SKILL.md files
 * with YAML frontmatter. Skills are model-invoked capabilities that extend
 * the agent's functionality.
 *
 * Search order: .agents/skills/ → .cortex/skills/ → ~/.cortex/skills/
 */

import { BaseTool, type ToolResult } from '../../base/index.js';
import { promises as fs } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { glob } from 'glob';
import { homedir } from 'node:os';

/**
 * Parameters for the Skill tool
 */
export interface SkillParams {
  /** The skill name (no arguments), e.g., "pdf" or "xlsx" */
  command: string;
}

/**
 * Parsed skill definition from SKILL.md file
 */
interface SkillDefinition {
  name: string;
  description: string;
  allowedTools?: string[];
  content: string;
  location: 'personal' | 'project' | 'central' | 'builtin';
  path: string;
}

/**
 * Skill Tool Executor
 *
 * Invokes specialized skills from skill directories.
 * Skills are model-invoked capabilities defined in SKILL.md files.
 *
 * Example skill directory structure:
 * ```
 * .agents/skills/pdf-documents/
 * ├── SKILL.md          # Required: skill definition
 * ├── sections/         # Optional: spoke files referenced by hub
 * ├── reference.md      # Optional: reference docs
 * └── scripts/          # Optional: helper scripts
 * ```
 *
 * Search order (first match wins — cwd-specific overrides/extends central):
 * 1. Project `.agents/skills/` (cwd-specific overlay — cross-harness convention)
 * 2. Project `.cortex/skills/` (cwd-specific overlay — nexus-cortex native)
 * 3. Central `~/.agents/skills/` (the universal master list, shared across cwds)
 * 4. Personal `~/.cortex/skills/` (nexus-cortex personal skills)
 *
 * Skills are mostly universal, so they live centrally in `~/.agents/skills/`
 * and are reachable from any cwd; a project may add cwd-specific skills (or
 * override a central one) by name in its own `.agents/skills/`, searched first.
 *
 * Usage: Skill({ command: "pdf-documents" })
 */
export class SkillToolExecutor extends BaseTool<SkillParams, ToolResult> {
  private skillsCache: Map<string, SkillDefinition> | null = null;
  private skillsDirs: { path: string; location: 'project' | 'central' | 'personal' | 'builtin' }[];

  constructor(config: { workingDirectory: string }) {
    super('Skill', 'Skill', 'Invoke specialized skills', {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Use "list" to see all available skills, or a skill name to load it. E.g., "list", "pdf-documents", "spacetimedb-rust"',
        },
      },
      required: ['command'],
    });

    this.skillsDirs = [
      // cwd-specific overlay (searched first → overrides/extends the central list)
      { path: join(config.workingDirectory, '.agents', 'skills'), location: 'project' },
      { path: join(config.workingDirectory, '.cortex', 'skills'), location: 'project' },
      // central universal master list (shared across all cwds) + nexus-cortex personal
      { path: join(homedir(), '.agents', 'skills'), location: 'central' },
      { path: join(homedir(), '.cortex', 'skills'), location: 'personal' },
      // shipped/builtin tier (lowest priority) — $CORTEX_ROOT/.cortex/skills, the
      // skills packed with the install (git clone root, or the npm package's vendored
      // scaffold). Mirrors AgentStore's builtin agent tier. Absent when CORTEX_ROOT
      // is unset; a missing dir is skipped harmlessly at load time.
      ...(process.env.CORTEX_ROOT
        ? [{ path: join(process.env.CORTEX_ROOT, '.cortex', 'skills'), location: 'builtin' as const }]
        : []),
    ];
  }

  validateToolParams(params: SkillParams): string | null {
    if (!params.command || typeof params.command !== 'string') {
      return 'command must be a non-empty string';
    }

    // Trim and validate skill name
    const trimmedCommand = params.command.trim();
    if (!trimmedCommand) {
      return 'command must be a non-empty string';
    }

    // Skill names should be simple (no slashes, no special chars except hyphens)
    if (!/^[a-zA-Z0-9-]+$/.test(trimmedCommand)) {
      return 'skill name must contain only letters, numbers, and hyphens';
    }

    return null;
  }

  getDescription(params: SkillParams): string {
    if (params.command?.trim() === 'list') return 'Listing available skills';
    return `Invoking skill: ${params.command}`;
  }

  async execute(
    params: SkillParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      // Validate parameters
      const validationError = this.validateToolParams(params);
      if (validationError) {
        return {
          ...this.createErrorResult(validationError),
          metadata: { executionTime: Date.now() - startTime },
        };
      }

      // Parse skill name
      const skillName = params.command.trim();

      // Handle "list" command — enumerate all available skills
      if (skillName === 'list') {
        if (!this.skillsCache) {
          await this.loadAllSkills(signal);
        }
        const listing = this.formatSkillListing();
        return {
          ...this.createSuccessResult(listing),
          metadata: { executionTime: Date.now() - startTime },
        };
      }

      // Load skill definition
      const skillDef = await this.loadSkill(skillName, signal);
      if (!skillDef) {
        return {
          ...this.createErrorResult(
            `Skill '${skillName}' not found.\n` +
              `Searched: .agents/skills/, .cortex/skills/, ~/.agents/skills/, ~/.cortex/skills/\n\n` +
              `Available skills: ${await this.getAvailableSkills()}`,
          ),
          metadata: {
            executionTime: Date.now() - startTime,
            skillName,
          },
        };
      }

      // Return the skill's content
      const output = this.formatSkillOutput(skillDef);

      return {
        ...this.createSuccessResult(output),
        metadata: {
          executionTime: Date.now() - startTime,
          skillName: skillDef.name,
          location: skillDef.location,
          description: skillDef.description,
          allowedTools: skillDef.allowedTools,
        },
      };
    } catch (error: any) {
      if (signal.aborted) {
        return {
          ...this.createErrorResult('Skill invocation was cancelled'),
          metadata: { executionTime: Date.now() - startTime },
        };
      }

      return {
        ...this.createErrorResult(
          `Error invoking skill: ${error.message || String(error)}`,
        ),
        metadata: {
          executionTime: Date.now() - startTime,
          error: error.message || String(error),
        },
      };
    }
  }

  /**
   * Load skill definition from .cortex/skills/ directories
   * Searches project skills first, then personal skills
   */
  private async loadSkill(
    skillName: string,
    signal: AbortSignal,
  ): Promise<SkillDefinition | null> {
    // Load all skills if not cached
    if (!this.skillsCache) {
      await this.loadAllSkills(signal);
    }

    if (!this.skillsCache) {
      return null;
    }

    return this.skillsCache.get(skillName) || null;
  }

  /**
   * Load all skill definitions from project and personal directories.
   * First match wins — earlier dirs in skillsDirs take precedence.
   */
  private async loadAllSkills(signal: AbortSignal): Promise<void> {
    this.skillsCache = new Map();

    for (const dir of this.skillsDirs) {
      await this.loadSkillsFromDirectory(dir.path, dir.location, signal);
    }
  }

  /**
   * Load skills from a specific directory
   */
  private async loadSkillsFromDirectory(
    baseDir: string,
    location: 'personal' | 'project' | 'central' | 'builtin',
    signal: AbortSignal,
  ): Promise<void> {
    try {
      // Check if directory exists
      try {
        await fs.access(baseDir);
      } catch {
        // Directory doesn't exist, skip
        return;
      }

      // Find all SKILL.md files in skill directories
      const skillFiles = await glob('*/SKILL.md', {
        cwd: baseDir,
        nodir: true,
        dot: false,
        signal,
      });

      // Load each skill
      for (const file of skillFiles) {
        const parts = file.split('/');
        const skillDir = parts[0] || ''; // Get directory name
        if (!skillDir) continue; // Skip if no directory

        const skillPath = join(baseDir, file);
        const skillDef = await this.parseSkillFile(skillPath, skillDir, location);

        if (skillDef && !this.skillsCache!.has(skillDef.name)) {
          // Only add if not already present (project skills take precedence)
          this.skillsCache!.set(skillDef.name, skillDef);
        }
      }
    } catch (error: any) {
      // Silently fail if directory doesn't exist or can't be read
      if (error.code !== 'ENOENT') {
        console.error(`[Skill] Error loading skills from ${baseDir}: ${error.message}`);
      }
    }
  }

  /**
   * Parse skill definition from SKILL.md file
   *
   * Format:
   * ```markdown
   * ---
   * name: skill-name
   * description: What this skill does
   * allowed-tools: Read, Write, Grep  # Optional
   * ---
   *
   * # Skill Name
   *
   * ## Instructions
   * Step-by-step guidance...
   * ```
   */
  private async parseSkillFile(
    filePath: string,
    skillDir: string,
    location: 'personal' | 'project' | 'central' | 'builtin',
  ): Promise<SkillDefinition | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');

      // Extract frontmatter and body
      const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);

      if (!frontmatterMatch) {
        console.error(
          `[Skill] Invalid SKILL.md format: ${filePath} (missing frontmatter)`,
        );
        return null;
      }

      const frontmatterText = frontmatterMatch[1] || '';
      const body = frontmatterMatch[2] || '';

      // Parse frontmatter
      const frontmatter = this.parseFrontmatter(frontmatterText);

      // Get skill name (from frontmatter or fallback to directory name)
      const skillName = frontmatter.name || skillDir;

      // Parse allowed-tools if present
      let allowedTools: string[] | undefined;
      if (frontmatter['allowed-tools']) {
        allowedTools = frontmatter['allowed-tools']
          .split(',')
          .map((tool) => tool.trim())
          .filter(Boolean);
      }

      return {
        name: skillName,
        description: frontmatter.description || `Skill: ${skillName}`,
        allowedTools,
        content: body.trim(),
        location,
        path: filePath,
      };
    } catch (error: any) {
      console.error(`[Skill] Error parsing skill file ${filePath}: ${error.message}`);
      return null;
    }
  }

  /**
   * Simple YAML frontmatter parser
   * Handles basic key: value pairs
   */
  private parseFrontmatter(text: string): Record<string, string> {
    const result: Record<string, string> = {};

    const lines = text.split('\n');
    for (const line of lines) {
      const match = line.match(/^(\S+):\s*(.*)$/);
      if (match && match[1] && match[2] !== undefined) {
        const key = match[1].trim();
        const value = match[2].trim();
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Format skill output for display
   */
  private formatSkillOutput(skillDef: SkillDefinition): string {
    const parts: string[] = [];

    // Skill header
    parts.push(`# Skill: ${skillDef.name}`);
    parts.push('');
    parts.push(`**Description**: ${skillDef.description}`);
    parts.push(`**Location**: ${skillDef.path}`);

    if (skillDef.allowedTools && skillDef.allowedTools.length > 0) {
      parts.push(`**Allowed Tools**: ${skillDef.allowedTools.join(', ')}`);
    }

    parts.push('');
    parts.push('---');
    parts.push('');

    // Skill content (instructions)
    parts.push(skillDef.content);

    return parts.join('\n');
  }

  /**
   * Format a readable listing of all available skills
   */
  private formatSkillListing(): string {
    if (!this.skillsCache || this.skillsCache.size === 0) {
      return 'No skills found.\n\nSkill directories searched:\n- .agents/skills/\n- .cortex/skills/\n- ~/.agents/skills/\n- ~/.cortex/skills/';
    }

    const parts: string[] = [];
    parts.push(`# Available Skills (${this.skillsCache.size})\n`);

    for (const skill of this.skillsCache.values()) {
      parts.push(`- **${skill.name}** (${skill.location}): ${skill.description}`);
    }

    parts.push('');
    parts.push('To load a skill: `Skill({ command: "skill-name" })`');

    return parts.join('\n');
  }

  /**
   * Get list of available skills (for error messages)
   */
  private async getAvailableSkills(): Promise<string> {
    if (!this.skillsCache) {
      await this.loadAllSkills(new AbortController().signal);
    }

    if (!this.skillsCache || this.skillsCache.size === 0) {
      return '(none found)';
    }

    return Array.from(this.skillsCache.values())
      .map((skill) => `${skill.name} (${skill.location})`)
      .join(', ');
  }

  /**
   * Clear the skills cache (useful for testing or reloading)
   */
  clearCache(): void {
    this.skillsCache = null;
  }
}
