/**
 * System Message Loader - Simplified Direct File Loading
 *
 * Loads system messages directly from files on each injection.
 * Three-tier lookup priority:
 *   1. Project level: {projectPath}/.cortex/system-messages/
 *   2. Global default: ~/.cortex/system-messages/
 *   3. Built-in: packages/core/dist/system-messages/messages/
 *
 * No caching between turns - always reads fresh from disk.
 * This allows /system-message edits to take effect on the next turn.
 */

import { readFile, access, readdir, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import type {
  SystemMessageRegistrySchema,
  SystemMessageDefinition,
  InjectionContext,
  LoadedSystemMessage,
  TemplateVariables,
  SystemMessageForInjection
} from './SystemMessageRegistry.interface.js';
import type { MessageRegistryEntry } from './types.js';
import { truncateDocForInjection, resolveDocMaxBytes } from './docTruncation.js';

/**
 * User registry format (from .cortex/registry.json)
 */
interface UserRegistry {
  version: string;
  lastModified: string;
  messages: MessageRegistryEntry[];
}

// Get directory path for ES modules (built-in messages location)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * System Message Loader Options
 */
export interface SystemMessageLoaderOptions {
  /** Project root path (for .cortex/system-messages/) */
  projectPath?: string;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * System Message Loader
 * Simple, direct file loading with project-level overrides
 */
export class SystemMessageLoader {
  private registry: SystemMessageRegistrySchema | null = null;
  private lastInjectedHashes = new Set<string>();

  /**
   * mtime-keyed cache for file content. The orchestrator calls
   * `getMessagesForInjection` once per turn, which fans out to 5+
   * `fs.readFile` calls for CLAUDE.md / MEMORY.md / CORTEX.md / AGENTS.md /
   * GEMINI.md. Without caching this is pure waste — those files don't
   * change between turns under normal use.
   *
   * Invalidation: per-file mtime check (one `stat` call) before returning
   * cached content. A `stat` is roughly 10× cheaper than reading a 30KB
   * file, and edits land on the next turn because we re-read on mtime
   * change. Hot-reload semantics preserved.
   */
  private fileContentCache = new Map<string, { content: string; mtimeMs: number }>();

  private readonly builtinPath: string;
  private readonly debug: boolean;
  private projectPath: string;

  constructor(options: SystemMessageLoaderOptions = {}) {
    this.builtinPath = __dirname;
    this.projectPath = options.projectPath || process.cwd();
    this.debug = options.debug || false;
  }

  /**
   * Update project path (called when session context changes)
   */
  setProjectPath(projectPath: string): void {
    this.projectPath = projectPath;
    if (this.debug) {
      console.log(`[SystemMessageLoader] Project path set to: ${projectPath}`);
    }
  }

  /**
   * Load the registry configuration
   */
  async loadRegistry(): Promise<void> {
    const registryPath = join(this.builtinPath, 'system-message-registry.json');
    try {
      const content = await this.readFileCached(registryPath);
      this.registry = JSON.parse(content);

      if (this.debug) {
        console.log('[SystemMessageLoader] Registry loaded');
        console.log(` Messages: ${this.registry!.messages.length}`);
      }
    } catch (error) {
      console.error('[SystemMessageLoader] Failed to load registry:', error);
      throw error;
    }
  }

  /**
   * Get registry (load if not loaded)
   */
  private async getRegistry(): Promise<SystemMessageRegistrySchema> {
    if (!this.registry) {
      await this.loadRegistry();
    }
    return this.registry!;
  }

  /**
   * Load user registry from .cortex/registry.json
   * Returns a map of message ID to registry entry for easy lookup
   */
  private async loadUserRegistry(): Promise<Map<string, MessageRegistryEntry>> {
    const userRegistryPath = join(this.projectPath, '.cortex', 'registry.json');
    try {
      const content = await this.readFileCached(userRegistryPath);
      const registry: UserRegistry = JSON.parse(content);
      const entries = new Map<string, MessageRegistryEntry>();

      for (const msg of registry.messages || []) {
        entries.set(msg.id, msg);
      }

      if (this.debug) {
        console.log(`[SystemMessageLoader] Loaded user registry with ${entries.size} entries`);
      }

      return entries;
    } catch {
      // No user registry exists or failed to parse - that's fine
      if (this.debug) {
        console.log(`[SystemMessageLoader] No user registry found at ${userRegistryPath}`);
      }
      return new Map();
    }
  }

  /**
   * Create a SystemMessageDefinition from a user registry entry
   * Used for user-created messages that don't exist in built-in registry
   */
  private createDefinitionFromUserEntry(entry: MessageRegistryEntry): SystemMessageDefinition {
    return {
      id: entry.id,
      name: entry.metadata.displayName || entry.id,
      file: entry.path, // User messages have relative paths like 'messages/MY_MESSAGE.md'
      description: entry.metadata.description || 'User-created system message',
      cache: false, // User messages always read fresh from disk
      // User messages may contain template variables (projectPath, currentDate,
      // toolCount, toolNames). Mark as dynamic so applyTemplates() runs and
      // unresolved {{placeholder}} strings don't leak into the prompt. The
      // built-in registry's SYSTEM_PROMPT.md does this already; user messages
      // should too, or runtime overrides of built-in messages silently break
      // template substitution.
      dynamic: true,
      conditions: {
        // User messages inject on all turns by default unless they specify conditions
        hasTools: entry.conditions?.requireTools,
        // Pass through turn gating so a user-registry message CAN declare
        // itself turn-varying. Without this a user message is always
        // turn-0-static → pinned in the cached `system` field, where some
        // models (e.g. grok-4.3) under-attend it. Setting turnNumberModulo
        // routes it to the live user turn instead (R28 / turnVaryingClassifier).
        turnNumber: entry.conditions?.turnNumber,
        turnNumberModulo: entry.conditions?.turnNumberModulo,
      },
      injection: {
        position: 'append', // User messages append by default
        role: 'user', // Inject as user message content
        priority: entry.priority,
      },
    };
  }

  /**
   * Check if file exists
   */
  private async fileExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read file content, with mtime-keyed caching.
   *
   * Replaces ~5 raw `readFile` calls per turn (CLAUDE.md/MEMORY.md/etc.)
   * with a `stat`+cache lookup. On cache hit, no disk read at all. On miss
   * or mtime change, reads fresh and updates the cache.
   *
   * Throws on missing file (matches `readFile` semantics) so existing call
   * sites that already gate on `fileExists` can drop this in unchanged.
   */
  private async readFileCached(path: string): Promise<string> {
    const s = await stat(path); // throws ENOENT if missing
    const mtimeMs = s.mtimeMs;

    const cached = this.fileContentCache.get(path);
    if (cached && cached.mtimeMs === mtimeMs) {
      return cached.content;
    }

    const content = await readFile(path, 'utf-8');
    this.fileContentCache.set(path, { content, mtimeMs });
    return content;
  }

  /**
   * Load message content with three-tier lookup:
   * 1. Project .cortex/system-messages/{file}
   * 2. Global ~/.cortex/system-messages/{file}
   * 3. Built-in messages/{file}
   *
   * Special case for CORTEX.md: loads from .cortex/CORTEX.md with global fallback
   */
  private async loadMessageFile(definition: SystemMessageDefinition): Promise<string> {
    // Special handling for CORTEX.md - it's in .cortex/ root, not system-messages/
    if (definition.id === 'cortex') {
      // Try project-level first
      const projectCortexPath = join(this.projectPath, '.cortex', 'CORTEX.md');
      if (await this.fileExists(projectCortexPath)) {
        const content = await this.readFileCached(projectCortexPath);
        if (this.debug) {
          console.log(`[SystemMessageLoader] Loaded CORTEX.md from project: ${projectCortexPath}`);
        }
        return content;
      }

      // Try global fallback (~/.cortex/CORTEX.md)
      const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
      const globalCortexPath = join(homeDir, '.cortex', 'CORTEX.md');
      if (await this.fileExists(globalCortexPath)) {
        const content = await this.readFileCached(globalCortexPath);
        if (this.debug) {
          console.log(`[SystemMessageLoader] Using global CORTEX.md: ${globalCortexPath}`);
        }
        return content;
      }

      // CORTEX.md is optional - return empty if not found
      if (this.debug) {
        console.log(`[SystemMessageLoader] CORTEX.md not found at ${projectCortexPath} or ${globalCortexPath} (optional)`);
      }
      throw new Error(`CORTEX.md not found - run /init to generate`);
    }

    // Special handling for CLAUDE.md - platform-agnostic project instructions
    if (definition.id === 'claude_md') {
      // Try project-level first
      const projectClaudeMd = join(this.projectPath, 'CLAUDE.md');
      if (await this.fileExists(projectClaudeMd)) {
        const content = await this.readFileCached(projectClaudeMd);
        if (this.debug) {
          console.log(`[SystemMessageLoader] Loaded CLAUDE.md from project: ${projectClaudeMd}`);
        }
        return content;
      }

      // Try parent directories (for monorepo packages)
      for (let i = 1; i <= 2; i++) {
        const parentPath = join(this.projectPath, ...Array(i).fill('..'), 'CLAUDE.md');
        if (await this.fileExists(parentPath)) {
          const content = await this.readFileCached(parentPath);
          if (this.debug) {
            console.log(`[SystemMessageLoader] Loaded CLAUDE.md from parent (${i} level${i > 1 ? 's' : ''} up): ${parentPath}`);
          }
          return content;
        }
      }

      // Fallback: try AGENTS.md (industry-standard name replacing CLAUDE.md)
      const agentsMdPath = join(this.projectPath, 'AGENTS.md');
      if (await this.fileExists(agentsMdPath)) {
        const content = await this.readFileCached(agentsMdPath);
        if (this.debug) {
          console.log(`[SystemMessageLoader] Loaded AGENTS.md as CLAUDE.md fallback: ${agentsMdPath}`);
        }
        return content;
      }
      for (let i = 1; i <= 2; i++) {
        const parentAgentsPath = join(this.projectPath, ...Array(i).fill('..'), 'AGENTS.md');
        if (await this.fileExists(parentAgentsPath)) {
          const content = await this.readFileCached(parentAgentsPath);
          if (this.debug) {
            console.log(`[SystemMessageLoader] Loaded AGENTS.md fallback from parent (${i} level${i > 1 ? 's' : ''} up): ${parentAgentsPath}`);
          }
          return content;
        }
      }

      if (this.debug) {
        console.log(`[SystemMessageLoader] CLAUDE.md/AGENTS.md not found at ${projectClaudeMd} or parent directories (optional)`);
      }
      throw new Error(`CLAUDE.md or AGENTS.md not found in project or parent directories`);
    }

    // Special handling for AGENTS.md - platform-agnostic agent instructions
    if (definition.id === 'agents_md') {
      const projectAgentsMd = join(this.projectPath, 'AGENTS.md');
      if (await this.fileExists(projectAgentsMd)) {
        const content = await this.readFileCached(projectAgentsMd);
        if (this.debug) {
          console.log(`[SystemMessageLoader] Loaded AGENTS.md from project: ${projectAgentsMd}`);
        }
        return content;
      }

      for (let i = 1; i <= 2; i++) {
        const parentPath = join(this.projectPath, ...Array(i).fill('..'), 'AGENTS.md');
        if (await this.fileExists(parentPath)) {
          const content = await this.readFileCached(parentPath);
          if (this.debug) {
            console.log(`[SystemMessageLoader] Loaded AGENTS.md from parent (${i} level${i > 1 ? 's' : ''} up): ${parentPath}`);
          }
          return content;
        }
      }

      if (this.debug) {
        console.log(`[SystemMessageLoader] AGENTS.md not found (optional)`);
      }
      throw new Error(`AGENTS.md not found in project or parent directories`);
    }

    // Special handling for GEMINI.md - Gemini-specific project instructions
    if (definition.id === 'gemini_md') {
      const projectGeminiMd = join(this.projectPath, 'GEMINI.md');
      if (await this.fileExists(projectGeminiMd)) {
        const content = await this.readFileCached(projectGeminiMd);
        if (this.debug) {
          console.log(`[SystemMessageLoader] Loaded GEMINI.md from project: ${projectGeminiMd}`);
        }
        return content;
      }

      for (let i = 1; i <= 2; i++) {
        const parentPath = join(this.projectPath, ...Array(i).fill('..'), 'GEMINI.md');
        if (await this.fileExists(parentPath)) {
          const content = await this.readFileCached(parentPath);
          if (this.debug) {
            console.log(`[SystemMessageLoader] Loaded GEMINI.md from parent (${i} level${i > 1 ? 's' : ''} up): ${parentPath}`);
          }
          return content;
        }
      }

      if (this.debug) {
        console.log(`[SystemMessageLoader] GEMINI.md not found (optional)`);
      }
      throw new Error(`GEMINI.md not found in project or parent directories`);
    }

    // Special handling for MEMORY.md - persistent cross-session memory
    if (definition.id === 'claude_memory') {
      // Try .cortex/ location first (created by /init)
      const cortexMemoryPath = join(this.projectPath, '.cortex', 'MEMORY.md');
      if (await this.fileExists(cortexMemoryPath)) {
        const content = await this.readFileCached(cortexMemoryPath);
        if (this.debug) {
          console.log(`[SystemMessageLoader] Loaded MEMORY.md from .cortex/: ${cortexMemoryPath}`);
        }
        return content;
      }

      // Try .claude/ location: {projectPath}/.claude/MEMORY.md
      const simpleMemoryPath = join(this.projectPath, '.claude', 'MEMORY.md');
      if (await this.fileExists(simpleMemoryPath)) {
        const content = await this.readFileCached(simpleMemoryPath);
        if (this.debug) {
          console.log(`[SystemMessageLoader] Loaded MEMORY.md from: ${simpleMemoryPath}`);
        }
        return content;
      }

      // Try external-agent auto-memory: {projectPath}/.claude/projects/*/memory/MEMORY.md
      const projectsDir = join(this.projectPath, '.claude', 'projects');
      try {
        const entries = await readdir(projectsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const memoryPath = join(projectsDir, entry.name, 'memory', 'MEMORY.md');
            if (await this.fileExists(memoryPath)) {
              const content = await this.readFileCached(memoryPath);
              if (this.debug) {
                console.log(`[SystemMessageLoader] Loaded MEMORY.md from external-agent auto-memory: ${memoryPath}`);
              }
              return content;
            }
          }
        }
      } catch {
        // .claude/projects/ doesn't exist - that's fine
      }

      // Try global fallback: ~/.claude/MEMORY.md
      const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
      const globalMemoryPath = join(homeDir, '.claude', 'MEMORY.md');
      if (await this.fileExists(globalMemoryPath)) {
        const content = await this.readFileCached(globalMemoryPath);
        if (this.debug) {
          console.log(`[SystemMessageLoader] Loaded MEMORY.md from global: ${globalMemoryPath}`);
        }
        return content;
      }

      if (this.debug) {
        console.log(`[SystemMessageLoader] MEMORY.md not found (optional)`);
      }
      throw new Error(`MEMORY.md not found in .claude/ directories`);
    }

    // Try project-level override first
    const projectFile = join(this.projectPath, '.cortex', 'system-messages', definition.file);
    if (await this.fileExists(projectFile)) {
      const content = await this.readFileCached(projectFile);
      if (this.debug) {
        console.log(`[SystemMessageLoader] Loaded from project: ${definition.id}`);
      }
      return content;
    }

    // Global fallback (~/.cortex/system-messages/)
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    if (homeDir) {
      const globalFile = join(homeDir, '.cortex', 'system-messages', definition.file);
      if (await this.fileExists(globalFile)) {
        const content = await this.readFileCached(globalFile);
        if (this.debug) {
          console.log(`[SystemMessageLoader] Loaded from global: ${definition.id}`);
        }
        return content;
      }
    }

    // Fall back to built-in
    const builtinFile = join(this.builtinPath, definition.file);
    if (await this.fileExists(builtinFile)) {
      const content = await this.readFileCached(builtinFile);
      if (this.debug) {
        console.log(`[SystemMessageLoader] Loaded from builtin: ${definition.id}`);
      }
      return content;
    }

    throw new Error(`System message file not found: ${definition.file}`);
  }

  /**
   * #28: optional per-doc byte cap.
   *
   * Only applies to the large project-doc injectors (CLAUDE.md, MEMORY.md,
   * AGENTS.md, GEMINI.md, CORTEX.md). Smaller built-in messages
   * (SYSTEM_PROMPT.md, TOOL_USAGE_GUIDE.md, etc.) are untouched — they're
   * already tightly authored.
   *
   * Defaults to "no cap" when SYSTEM_MESSAGE_DOC_MAX_BYTES is unset/0, so
   * existing deployments keep current behavior. Operators opt in by setting
   * a positive integer.
   */
  private static readonly CAPPED_DOC_IDS = new Set([
    'claude_md',
    'claude_memory',
    'agents_md',
    'gemini_md',
    'cortex',
  ]);

  private maybeCapDocContent(content: string, definition: SystemMessageDefinition): string {
    if (!SystemMessageLoader.CAPPED_DOC_IDS.has(definition.id)) return content;
    const maxBytes = resolveDocMaxBytes(process.env.SYSTEM_MESSAGE_DOC_MAX_BYTES);
    if (maxBytes <= 0) return content;
    return truncateDocForInjection(content, {
      maxBytes,
      sourcePath: definition.file,
      label: definition.id,
    });
  }

  /**
   * Apply template variables to content
   */
  private applyTemplates(content: string, variables: TemplateVariables): string {
    let result = content;

    // Replace {{variable}} patterns
    for (const [key, value] of Object.entries(variables)) {
      const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      result = result.replace(pattern, String(value));
    }

    return result;
  }

  /**
   * Generate content hash for deduplication
   */
  private generateContentHash(content: string): string {
    return createHash('sha256')
      .update(content, 'utf-8')
      .digest('hex')
      .substring(0, 32);
  }

  /**
   * Check if injection conditions are met
   */
  private checkConditions(
    definition: SystemMessageDefinition,
    context: InjectionContext
  ): boolean {
    const { conditions } = definition;

    // Check hasTools
    if (conditions.hasTools !== undefined && conditions.hasTools !== context.hasTools) {
      return false;
    }

    // Check turnNumber
    if (conditions.turnNumber !== undefined && conditions.turnNumber !== context.turnNumber) {
      return false;
    }

    // Check turnNumberModulo
    if (conditions.turnNumberModulo) {
      const { divisor, remainder } = conditions.turnNumberModulo;
      if (context.turnNumber % divisor !== remainder) {
        return false;
      }
    }

    // Check sessionPhase
    if (conditions.sessionPhase) {
      const phases = Array.isArray(conditions.sessionPhase)
        ? conditions.sessionPhase
        : [conditions.sessionPhase];

      if (!phases.includes(context.sessionPhase)) {
        return false;
      }
    }

    // Check modelCapabilities
    if (conditions.modelCapabilities) {
      const hasAllCapabilities = conditions.modelCapabilities.every(cap =>
        context.modelCapabilities.includes(cap)
      );
      if (!hasAllCapabilities) {
        return false;
      }
    }

    // Check apiPattern
    if (conditions.apiPattern) {
      const patterns = Array.isArray(conditions.apiPattern)
        ? conditions.apiPattern
        : [conditions.apiPattern];

      if (!patterns.includes(context.apiPattern)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get messages to inject for given context
   * Reads fresh from disk each time - no caching
   * Merges user registry overrides with built-in definitions
   */
  async getMessagesForContext(
    context: InjectionContext,
    templateVars: TemplateVariables = {}
  ): Promise<LoadedSystemMessage[]> {
    const registry = await this.getRegistry();
    const userRegistry = await this.loadUserRegistry();
    const messages: LoadedSystemMessage[] = [];

    // Clear deduplication tracking for new context
    this.lastInjectedHashes.clear();

    // Filter and merge built-in messages with user overrides
    const applicableDefinitions: SystemMessageDefinition[] = registry.messages
      .filter(def => {
        // Check if user disabled this message
        const userEntry = userRegistry.get(def.id);
        if (userEntry && userEntry.enabled === false) {
          if (this.debug) {
            console.log(`[SystemMessageLoader] User disabled: ${def.id}`);
          }
          return false;
        }
        return this.checkConditions(def, context);
      })
      .map(def => {
        // Apply user priority override if set
        const userEntry = userRegistry.get(def.id);
        if (userEntry && typeof userEntry.priority === 'number') {
          if (this.debug) {
            console.log(`[SystemMessageLoader] User priority override for ${def.id}: ${def.injection.priority} -> ${userEntry.priority}`);
          }
          return {
            ...def,
            injection: { ...def.injection, priority: userEntry.priority }
          };
        }
        return def;
      })
      // Filter out messages with priority 0 (user excluded from injection)
      .filter(def => {
        if (def.injection.priority === 0) {
          if (this.debug) {
            console.log(`[SystemMessageLoader] Excluded (priority 0): ${def.id}`);
          }
          return false;
        }
        return true;
      });

    // Add user-created messages not in built-in registry
    const builtinIds = new Set(registry.messages.map(m => m.id));
    for (const [id, userEntry] of userRegistry.entries()) {
      // Skip disabled, priority 0 (excluded), or already in built-in
      if (builtinIds.has(id) || userEntry.enabled === false || userEntry.priority === 0) {
        if (this.debug && userEntry.priority === 0) {
          console.log(`[SystemMessageLoader] Excluded user message (priority 0): ${id}`);
        }
        continue;
      }
      // Create definition from user entry
      const userDef = this.createDefinitionFromUserEntry(userEntry);
      // Check if conditions are met (user messages may have conditions)
      if (this.checkConditions(userDef, context)) {
        applicableDefinitions.push(userDef);
        if (this.debug) {
          console.log(`[SystemMessageLoader] Adding user message: ${id}`);
        }
      }
    }

    // Sort by priority (lower = first)
    applicableDefinitions.sort((a, b) => a.injection.priority - b.injection.priority);

    // Load content for each message
    for (const definition of applicableDefinitions) {
      try {
        let content = await this.loadMessageFile(definition);

        // #28: optional per-doc byte cap. Large project docs (CLAUDE.md,
        // MEMORY.md, AGENTS.md, GEMINI.md, CORTEX.md) inject on every fresh
        // turn-0 request and dominate first-turn input tokens. Opt-in via
        // SYSTEM_MESSAGE_DOC_MAX_BYTES so existing deployments don't see
        // surprise truncation.
        content = this.maybeCapDocContent(content, definition);

        // Always apply templates — messages without {{placeholders}} are
        // unaffected by substitution, so there's no reason to gate on `dynamic`.
        // (Previously, ALL built-in registry entries had dynamic=unset, which
        // made applyTemplates a no-op everywhere and leaked literal
        // {{projectPath}} / {{currentDate}} / {{toolCount}} into prompts.)
        content = this.applyTemplates(content, templateVars);

        const contentHash = this.generateContentHash(content);

        // Check deduplication within same injection
        if (registry.injection_rules.deduplication.enabled) {
          if (this.lastInjectedHashes.has(contentHash)) {
            if (this.debug) {
              console.log(`[SystemMessageLoader] Skipping duplicate: ${definition.id}`);
            }
            continue;
          }
        }

        messages.push({
          definition,
          content,
          contentHash,
          cached: false // Never cached in simplified version
        });

        // Track for deduplication
        this.lastInjectedHashes.add(contentHash);
      } catch (error: any) {
        // Log but don't fail - some messages are optional (like CORTEX.md)
        if (this.debug) {
          console.log(`[SystemMessageLoader] Skipping ${definition.id}: ${error.message}`);
        }
      }
    }

    // No max limit - users can have as many messages as they need
    // Context window is the real constraint, handled by HelperModelMiddleware compaction

    if (this.debug) {
      console.log(`[SystemMessageLoader] Injecting ${messages.length} system messages`);
      messages.forEach(msg => {
        console.log(` - ${msg.definition.id} (priority: ${msg.definition.injection.priority})`);
      });
    }

    return messages;
  }

  /**
   * Clear deduplication tracking (call between turns if needed)
   */
  clearDeduplication(): void {
    this.lastInjectedHashes.clear();
  }

  /**
   * Reload registry
   */
  async reload(): Promise<void> {
    this.registry = null;
    this.lastInjectedHashes.clear();
    await this.loadRegistry();
  }

  /**
   * Get specific message by ID
   */
  async getMessageById(id: string, templateVars: TemplateVariables = {}): Promise<LoadedSystemMessage | null> {
    const registry = await this.getRegistry();
    const definition = registry.messages.find(m => m.id === id);

    if (!definition) {
      return null;
    }

    try {
      let content = await this.loadMessageFile(definition);

      // #28: same per-doc byte cap as the bulk-injection path
      content = this.maybeCapDocContent(content, definition);

      if (definition.dynamic) {
        content = this.applyTemplates(content, templateVars);
      }

      return {
        definition,
        content,
        contentHash: this.generateContentHash(content),
        cached: false
      };
    } catch {
      return null;
    }
  }

  /**
   * Get messages formatted for injection into content array
   */
  async getMessagesForInjection(
    context: InjectionContext,
    templateVars: TemplateVariables = {}
  ): Promise<SystemMessageForInjection[]> {
    const loaded = await this.getMessagesForContext(context, templateVars);

    return loaded.map(msg => ({
      content: msg.content,
      position: msg.definition.injection.position,
      priority: msg.definition.injection.priority,
      wrapInSystemReminder: true,
      contentHash: msg.contentHash,
      definition: msg.definition
    }));
  }

  /**
   * List all registered message definitions
   */
  async listMessages(): Promise<SystemMessageDefinition[]> {
    const registry = await this.getRegistry();
    return registry.messages;
  }

  /**
   * Get project-level system messages directory
   */
  getProjectMessagesDir(): string {
    return join(this.projectPath, '.cortex', 'system-messages');
  }

  /**
   * Get built-in system messages directory
   */
  getBuiltinMessagesDir(): string {
    return join(this.builtinPath, 'messages');
  }
}
