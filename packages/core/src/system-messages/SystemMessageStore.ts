/**
 * System Message Store
 *
 * Central store for system messages with hot-reload capability.
 * Implements three-tier override hierarchy:
 * Runtime (.cortex/system-messages) > Workspace (.cortex/workspace-messages) > Built-in (dist)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { watch, FSWatcher } from 'chokidar';
import { SystemMessageRegistry } from './SystemMessageRegistry.js';
import type {
  SystemMessage,
  SystemMessageInfo,
  MessageSource,
  MessageTemplate,
  StoreEvent,
  StoreChangeListener,
} from './types.js';

/**
 * Store configuration
 */
export interface SystemMessageStoreConfig {
  /** Built-in messages directory (packages/core/dist/system-messages) */
  builtinDir: string;

  /** Runtime overrides directory (.cortex/system-messages) */
  runtimeDir: string;

  /** Context root directory (project or workspace root) for finding CORTEX.md */
  contextRoot?: string;

  /** Optional workspace-specific directory (.cortex/workspace-messages) */
  workspaceDir?: string;

  /** Enable file watching for hot-reload */
  enableWatching?: boolean;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Entry from injection registry for syncing names and priorities
 */
interface InjectionRegistryEntry {
  name: string;
  priority: number;
  description?: string;
}

/**
 * System Message Store
 *
 * Manages loading, storing, and hot-reloading of system messages
 */
export class SystemMessageStore {
  private config: SystemMessageStoreConfig;
  private messages: Map<string, SystemMessage>;
  private registry: SystemMessageRegistry;
  private watchers: Map<string, FSWatcher>;
  private listeners: Set<StoreChangeListener>;
  private initialized: boolean = false;
  private injectionRegistry: Map<string, InjectionRegistryEntry> | null = null;

  constructor(config: SystemMessageStoreConfig) {
    this.config = {
      enableWatching: true,
      debug: false,
      ...config,
    };

    this.messages = new Map();
    this.registry = new SystemMessageRegistry(config.runtimeDir);
    this.watchers = new Map();
    this.listeners = new Set();
  }

  /**
   * Initialize the store
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.log('Initializing system message store...');

    // Ensure runtime directory exists
    await fs.mkdir(this.config.runtimeDir, { recursive: true });
    await fs.mkdir(path.join(this.config.runtimeDir, 'messages'), { recursive: true });

    // Load registry
    await this.registry.load();

    // Load messages in priority order (lowest to highest priority)
    // 1. Built-in defaults
    await this.loadFromDirectory(this.config.builtinDir, 'builtin');

    // 2. Workspace overrides (if provided)
    if (this.config.workspaceDir) {
      await this.loadFromDirectory(this.config.workspaceDir, 'workspace');
    }

    // 3. Runtime overrides (highest priority)
    await this.loadFromDirectory(this.config.runtimeDir, 'runtime');

    // 4. Load CORTEX.md from root of .cortex/ if it exists (project context)
    await this.loadCortexMd(this.config.runtimeDir);

    // Start file watchers if enabled
    if (this.config.enableWatching) {
      this.startWatching();
    }

    this.initialized = true;
    this.log(`Initialized with ${this.messages.size} messages`);
  }

  /**
   * Load messages from a directory
   */
  private async loadFromDirectory(dir: string, source: MessageSource): Promise<void> {
    try {
      // Note: For builtin/workspace, we scan the messages directory directly
      // For runtime, metadata is managed by this.registry

      // Load messages from messages/ subdirectory
      const messagesDir = path.join(dir, 'messages');
      try {
        const files = await fs.readdir(messagesDir);

        for (const file of files) {
          if (file.endsWith('.md')) {
            const filePath = path.join(messagesDir, file);
            await this.loadMessage(filePath, source);
          }
        }
      } catch (error: any) {
        if (error.code !== 'ENOENT') {
          this.log(`Warning: Failed to read messages directory ${messagesDir}: ${error.message}`);
        }
      }
    } catch (error: any) {
      this.log(`Warning: Failed to load from ${dir}: ${error.message}`);
    }
  }

  /**
   * Load CORTEX.md from root of .cortex/ directory
   *
   * CORTEX.md is an auto-generated project context file that provides:
   * - File tree structure
   * - Dependencies
   * - Scripts
   * - Project overview
   *
   * Lookup order:
   * 1. Project-level: {contextRoot}/.cortex/CORTEX.md or parent of runtimeDir
   * 2. Global fallback: ~/.cortex/CORTEX.md
   * 3. Skip if neither exists (CORTEX.md is optional)
   */
  private async loadCortexMd(runtimeDir: string): Promise<void> {
    try {
      // 1. Try project-level CORTEX.md first
      let cortexPath: string;

      if (this.config.contextRoot) {
        cortexPath = path.join(this.config.contextRoot, '.cortex', 'CORTEX.md');
      } else {
        // Use parent directory of runtimeDir (e.g., .cortex/)
        const cortexDir = path.dirname(runtimeDir);
        cortexPath = path.join(cortexDir, 'CORTEX.md');
      }

      // Check if project-level CORTEX.md exists
      try {
        await fs.access(cortexPath);
        // Load project-level CORTEX.md
        await this.loadMessage(cortexPath, 'runtime');
        this.log(`Loaded CORTEX.md from project: ${cortexPath}`);
        return;
      } catch {
        // Project-level doesn't exist, try global fallback
        this.log(`Project CORTEX.md not found at ${cortexPath}, trying global...`);
      }

      // 2. Try global CORTEX.md fallback (~/.cortex/CORTEX.md)
      const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
      const globalCortexPath = path.join(homeDir, '.cortex', 'CORTEX.md');

      try {
        await fs.access(globalCortexPath);
        // Load global CORTEX.md
        await this.loadMessage(globalCortexPath, 'runtime');
        this.log(`Loaded CORTEX.md from global: ${globalCortexPath}`);
        return;
      } catch {
        // Neither exists - that's fine, CORTEX.md is optional
        this.log(`No CORTEX.md found (checked project and global ~/.cortex/)`);
      }
    } catch (error: any) {
      this.log(`Failed to load CORTEX.md: ${error.message}`);
    }
  }

  /**
   * Load a single message file
   */
  private async loadMessage(filePath: string, source: MessageSource): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const fileName = path.basename(filePath, '.md');

      // Convert filename to ID (e.g., TOOL_USAGE_GUIDE.md -> tool_usage_guide)
      const id = fileName.toLowerCase();

      // Check if message already exists (lower priority)
      const existing = this.messages.get(id);
      if (existing && this.getSourcePriority(existing.source) >= this.getSourcePriority(source)) {
        // Keep higher priority version
        return;
      }

      // Get injection registry for accurate names/priorities (source of truth)
      const injectionRegistry = await this.loadInjectionRegistry();
      const injectionEntry = injectionRegistry.get(id);

      // Get metadata from registry if available
      let metadata: any = {
        created: new Date().toISOString(),
        displayName: this.formatDisplayName(fileName),
      };

      let priority = 50;
      let enabled = true;
      let type: any = 'instruction';

      // First, apply injection registry values as defaults (for both builtin and runtime)
      // This ensures runtime overrides of builtin messages inherit correct priorities
      if (injectionEntry) {
        priority = injectionEntry.priority;
        metadata.displayName = injectionEntry.name;
        if (injectionEntry.description) {
          metadata.description = injectionEntry.description;
        }
      }

      // For runtime messages, override with user's registry values if explicitly set
      if (source === 'runtime') {
        const entry = this.registry.get(id);
        if (entry) {
          // Only override priority if user explicitly set it (not default 50)
          if (entry.priority !== 50 || !injectionEntry) {
            priority = entry.priority;
          }
          metadata = { ...metadata, ...entry.metadata };
          enabled = entry.enabled;
          type = entry.type;
        }
      }

      // Extract displayName from content - this takes priority over registry/filename
      // This ensures that when users edit the markdown header, the name updates
      const contentDisplayName = this.extractDisplayNameFromContent(content);
      if (contentDisplayName) {
        metadata = { ...metadata, displayName: contentDisplayName };
      }

      // Create message object
      const message: SystemMessage = {
        id,
        type,
        path: path.relative(path.dirname(path.dirname(filePath)), filePath),
        enabled,
        source,
        priority,
        content,
        metadata,
      };

      this.messages.set(id, message);
      this.log(`Loaded message: ${id} from ${source}`);
    } catch (error: any) {
      this.log(`Error loading message ${filePath}: ${error.message}`);
    }
  }

  /**
   * Get source priority (higher = more important)
   */
  private getSourcePriority(source: MessageSource): number {
    switch (source) {
      case 'builtin':
        return 1;
      case 'workspace':
        return 2;
      case 'runtime':
        return 3;
      default:
        return 0;
    }
  }

  /**
   * Load injection registry from system-message-registry.json
   * Used to sync display names and priorities with actual injection values
   *
   * Creates entries indexed by both:
   * - Registry ID (e.g., "tool_examples")
   * - Filename-derived ID (e.g., "examples" from "messages/EXAMPLES.md")
   * This ensures proper matching regardless of how IDs are derived.
   */
  private async loadInjectionRegistry(): Promise<Map<string, InjectionRegistryEntry>> {
    if (this.injectionRegistry) {
      return this.injectionRegistry;
    }

    const registryPath = path.join(this.config.builtinDir, 'system-message-registry.json');
    try {
      const content = await fs.readFile(registryPath, 'utf-8');
      const registry = JSON.parse(content);
      const entries = new Map<string, InjectionRegistryEntry>();

      for (const msg of registry.messages || []) {
        const entry: InjectionRegistryEntry = {
          name: msg.name,
          priority: msg.injection?.priority ?? 50,
          description: msg.description,
        };

        // Index by registry ID
        entries.set(msg.id, entry);

        // Also index by filename-derived ID for matching
        // e.g., "messages/EXAMPLES.md" -> "examples"
        if (msg.file) {
          const fileName = path.basename(msg.file, '.md').toLowerCase();
          if (fileName !== msg.id) {
            entries.set(fileName, entry);
          }
        }
      }

      this.injectionRegistry = entries;
      this.log(`Loaded injection registry with ${entries.size} entries`);
      return entries;
    } catch (error: any) {
      this.log(`Warning: Failed to load injection registry: ${error.message}`);
      return new Map();
    }
  }

  /**
   * Format filename to display name
   */
  private formatDisplayName(fileName: string): string {
    return fileName
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /**
   * Extract display name from markdown content
   * Looks for the first # header in the content
   */
  private extractDisplayNameFromContent(content: string): string | undefined {
    // Look for the first markdown header (# Title or # Title Here)
    const match = content.match(/^#\s+(.+)$/m);
    if (match && match[1]) {
      return match[1].trim();
    }
    return undefined;
  }

  /**
   * Start watching directories for changes
   *
   * Watches:
   * - .cortex/system-messages/messages/*.md - Message content
   * - .cortex/registry.json - Priority and enable/disable changes
   * - .cortex/CORTEX.md - Project context file
   */
  private startWatching(): void {
    const watcherOptions = {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    };

    // Watch messages directory for .md files
    const messagesDir = path.join(this.config.runtimeDir, 'messages');
    const messagesWatcher = watch(messagesDir, watcherOptions);

    messagesWatcher.on('change', async (filePath) => {
      if (filePath.endsWith('.md')) {
        await this.handleFileChange(filePath);
      }
    });

    messagesWatcher.on('add', async (filePath) => {
      if (filePath.endsWith('.md')) {
        await this.handleFileAdd(filePath);
      }
    });

    messagesWatcher.on('unlink', async (filePath) => {
      if (filePath.endsWith('.md')) {
        await this.handleFileDelete(filePath);
      }
    });

    this.watchers.set('messages', messagesWatcher);

    // Watch registry.json for priority/enable changes
    const cortexDir = path.dirname(this.config.runtimeDir); // .cortex/
    const registryPath = path.join(cortexDir, 'registry.json');
    const registryWatcher = watch(registryPath, watcherOptions);

    registryWatcher.on('change', async () => {
      this.log('Registry changed, reloading...');
      await this.handleRegistryChange();
    });

    this.watchers.set('registry', registryWatcher);

    // Watch CORTEX.md for project context changes
    const cortexMdPath = path.join(cortexDir, 'CORTEX.md');
    const cortexMdWatcher = watch(cortexMdPath, watcherOptions);

    cortexMdWatcher.on('change', async () => {
      this.log('CORTEX.md changed, reloading...');
      await this.handleCortexMdChange(cortexMdPath);
    });

    cortexMdWatcher.on('add', async () => {
      this.log('CORTEX.md added, loading...');
      await this.handleCortexMdChange(cortexMdPath);
    });

    this.watchers.set('cortex', cortexMdWatcher);

    this.log('File watching started (messages, registry.json, CORTEX.md)');
  }

  /**
   * Handle registry.json change - reload all message metadata
   */
  private async handleRegistryChange(): Promise<void> {
    // Reload the runtime registry
    await this.registry.load();

    // Clear injection registry cache to pick up any changes
    this.injectionRegistry = null;

    // Reload all messages to apply new priorities/enabled states
    this.messages.clear();
    await this.loadFromDirectory(this.config.builtinDir, 'builtin');
    if (this.config.workspaceDir) {
      await this.loadFromDirectory(this.config.workspaceDir, 'workspace');
    }
    await this.loadFromDirectory(this.config.runtimeDir, 'runtime');
    await this.loadCortexMd(this.config.runtimeDir);

    // Emit a general refresh event
    this.emitEvent({
      type: 'registry_updated',
      timestamp: new Date(),
    });
  }

  /**
   * Handle CORTEX.md change - reload the cortex message
   */
  private async handleCortexMdChange(cortexPath: string): Promise<void> {
    try {
      // Remove existing cortex message
      this.messages.delete('cortex');

      // Reload CORTEX.md
      await this.loadMessage(cortexPath, 'runtime');

      const message = this.messages.get('cortex');
      if (message) {
        this.emitEvent({
          type: 'message_updated',
          messageId: 'cortex',
          message,
          timestamp: new Date(),
        });
      }
    } catch (error: any) {
      this.log(`Failed to reload CORTEX.md: ${error.message}`);
    }
  }

  /**
   * Handle file change event
   */
  private async handleFileChange(filePath: string): Promise<void> {
    this.log(`File changed: ${filePath}`);
    await this.reloadMessage(filePath);

    const id = this.getMessageIdFromPath(filePath);
    const message = this.messages.get(id);

    if (message) {
      this.emitEvent({
        type: 'message_updated',
        messageId: id,
        message,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Handle file add event
   */
  private async handleFileAdd(filePath: string): Promise<void> {
    this.log(`File added: ${filePath}`);
    await this.reloadMessage(filePath);

    const id = this.getMessageIdFromPath(filePath);
    const message = this.messages.get(id);

    if (message) {
      this.emitEvent({
        type: 'message_created',
        messageId: id,
        message,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Handle file delete event
   */
  private async handleFileDelete(filePath: string): Promise<void> {
    this.log(`File deleted: ${filePath}`);

    const id = this.getMessageIdFromPath(filePath);
    const message = this.messages.get(id);

    // Remove from messages map
    this.messages.delete(id);

    // Try to fall back to lower priority version
    const builtinPath = path.join(this.config.builtinDir, 'messages', path.basename(filePath));
    try {
      await this.loadMessage(builtinPath, 'builtin');
    } catch (error) {
      // No fallback available
    }

    this.emitEvent({
      type: 'message_deleted',
      messageId: id,
      message,
      timestamp: new Date(),
    });
  }

  /**
   * Reload a specific message file
   */
  private async reloadMessage(filePath: string): Promise<void> {
    await this.loadMessage(filePath, 'runtime');
  }

  /**
   * Get message ID from file path
   */
  private getMessageIdFromPath(filePath: string): string {
    const fileName = path.basename(filePath, '.md');
    return fileName.toLowerCase();
  }

  /**
   * Force reload a specific message file
   * Useful for immediate refresh after writes without waiting for file watcher
   */
  async reloadMessageFile(filePath: string, source: MessageSource = 'runtime'): Promise<void> {
    // Force reload by first removing the existing message to bypass priority check
    const id = this.getMessageIdFromPath(filePath);
    this.messages.delete(id);

    await this.loadMessage(filePath, source);
    const message = this.messages.get(id);
    if (message) {
      this.emitEvent({
        type: 'message_updated',
        messageId: id,
        message,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Refresh the internal registry from disk
   * Useful after external registry modifications
   */
  async refreshRegistry(): Promise<void> {
    await this.registry.load();
    this.log('Registry refreshed from disk');
  }

  /**
   * Update the priority of a message
   * Updates both the registry and in-memory data
   */
  async updateMessagePriority(id: string, newPriority: number): Promise<void> {
    const message = this.messages.get(id);
    if (!message) {
      throw new Error(`Message '${id}' not found`);
    }

    if (message.source !== 'runtime') {
      throw new Error(`Can only update priority for runtime messages`);
    }

    // Update registry
    const entry = this.registry.get(id);
    if (entry) {
      entry.priority = newPriority;
      await this.registry.update(id, entry);
    }

    // Update in-memory message
    message.priority = newPriority;
    this.messages.set(id, message);

    // Emit update event
    this.emitEvent({
      type: 'message_updated',
      messageId: id,
      message,
      timestamp: new Date(),
    });

    this.log(`Updated priority for '${id}' to ${newPriority}`);
  }

  /**
   * Get message by ID
   */
  getMessage(id: string): SystemMessage | null {
    return this.messages.get(id) || null;
  }

  /**
   * Get all messages
   */
  getAll(): SystemMessage[] {
    return Array.from(this.messages.values());
  }

  /**
   * Get all enabled messages
   */
  getEnabled(): SystemMessage[] {
    return Array.from(this.messages.values()).filter((m) => m.enabled);
  }

  /**
   * List all messages with info
   */
  listAll(): SystemMessageInfo[] {
    return Array.from(this.messages.values()).map((msg) => ({
      id: msg.id,
      type: msg.type,
      source: msg.source,
      path: msg.path,
      enabled: msg.enabled,
      priority: msg.priority,
      metadata: msg.metadata,
    }));
  }

  /**
   * Create new custom message
   */
  async createMessage(template: MessageTemplate): Promise<void> {
    const fileName = template.id.toUpperCase() + '.md';
    const filePath = path.join(this.config.runtimeDir, 'messages', fileName);

    // Check if already exists
    if (this.messages.has(template.id)) {
      throw new Error(`Message with ID '${template.id}' already exists`);
    }

    // Create template content
    const content = this.generateTemplate(template);

    // Write file
    await fs.writeFile(filePath, content, 'utf-8');

    // Add to registry
    const entry = SystemMessageRegistry.createEntry(
      template.id,
      template.type,
      `messages/${fileName}`,
      {
        priority: template.priority,
        description: template.description,
        displayName: template.displayName,
      }
    );

    await this.registry.add(entry);

    // Load into store
    await this.loadMessage(filePath, 'runtime');

    this.log(`Created message: ${template.id}`);
  }

  /**
   * Generate template content
   */
  private generateTemplate(template: MessageTemplate): string {
    const displayName = template.displayName || this.formatDisplayName(template.id);

    return `# ${displayName}

<!-- System Message Metadata
id: ${template.id}
type: ${template.type}
priority: ${template.priority || 50}
description: ${template.description || 'Custom system message'}
-->

## Purpose
${template.description || 'Describe what this system message is for'}

## Guidelines
- Add your guidelines here
-
-

## Examples
[Optional: Add examples of how this should be applied]

<!-- End System Message -->
`;
  }

  /**
   * Delete custom message
   */
  async deleteMessage(id: string): Promise<void> {
    const message = this.getMessage(id);
    if (!message) {
      throw new Error(`Message '${id}' not found`);
    }

    if (message.source !== 'runtime') {
      throw new Error(`Cannot delete ${message.source} message '${id}'`);
    }

    // Delete file
    const filePath = path.join(this.config.runtimeDir, message.path);
    await fs.unlink(filePath);

    // Remove from registry
    await this.registry.remove(id);

    // Message will be removed by file watcher
    this.log(`Deleted message: ${id}`);
  }

  /**
   * Reset message to builtin default
   */
  async resetToDefault(id: string): Promise<void> {
    const message = this.getMessage(id);
    if (!message) {
      throw new Error(`Message '${id}' not found`);
    }

    if (message.source === 'builtin') {
      throw new Error(`Message '${id}' is already using builtin version`);
    }

    // Delete runtime override
    if (message.source === 'runtime') {
      const filePath = path.join(this.config.runtimeDir, message.path);
      try {
        await fs.unlink(filePath);
        await this.registry.remove(id);
      } catch (error) {
        // File may not exist
      }
    }

    // Reload builtin version
    const builtinPath = path.join(
      this.config.builtinDir,
      'messages',
      id.toUpperCase() + '.md'
    );
    await this.loadMessage(builtinPath, 'builtin');

    this.log(`Reset message to default: ${id}`);
  }

  /**
   * Toggle message enabled state
   */
  async toggleEnabled(id: string): Promise<boolean> {
    const message = this.getMessage(id);
    if (!message) {
      throw new Error(`Message '${id}' not found`);
    }

    const newState = !message.enabled;

    // Update in registry if runtime message
    if (message.source === 'runtime') {
      await this.registry.toggleEnabled(id);
    }

    // Update in memory
    message.enabled = newState;

    this.emitEvent({
      type: 'message_toggled',
      messageId: id,
      message,
      enabled: newState,
      timestamp: new Date(),
    });

    this.log(`Toggled message ${id}: ${newState ? 'enabled' : 'disabled'}`);
    return newState;
  }

  /**
   * Subscribe to store events
   */
  onChange(listener: StoreChangeListener): void {
    this.listeners.add(listener);
  }

  /**
   * Unsubscribe from store events
   */
  removeListener(listener: StoreChangeListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Emit store event
   */
  private emitEvent(event: StoreEvent): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error: any) {
        this.log(`Error in event listener: ${error.message}`);
      }
    });
  }

  /**
   * Cleanup watchers
   */
  async destroy(): Promise<void> {
    for (const watcher of this.watchers.values()) {
      await watcher.close();
    }
    this.watchers.clear();
    this.listeners.clear();
    this.log('Store destroyed');
  }

  /**
   * Get the runtime directory path
   */
  getRuntimeDir(): string {
    return this.config.runtimeDir;
  }

  /**
   * Get the builtin directory path
   */
  getBuiltinDir(): string {
    return this.config.builtinDir;
  }

  /**
   * Debug logging
   */
  private log(message: string): void {
    if (this.config.debug) {
      console.log(`[SystemMessageStore] ${message}`);
    }
  }
}
