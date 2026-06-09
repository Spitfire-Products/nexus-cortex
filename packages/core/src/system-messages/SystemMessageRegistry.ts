/**
 * System Message Registry
 *
 * Manages the registry.json file that tracks user modifications
 * and custom messages in the runtime directory.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  MessageRegistry,
  MessageRegistryEntry,
  MessageType,
  MessageConditions,
} from './types.js';

/**
 * Default registry structure
 */
const DEFAULT_REGISTRY: MessageRegistry = {
  version: '1.0.0',
  lastModified: new Date().toISOString(),
  messages: [],
};

/**
 * System Message Registry
 *
 * Handles CRUD operations on the registry.json file
 */
export class SystemMessageRegistry {
  private registryPath: string;
  private registry: MessageRegistry;

  constructor(runtimeDir: string) {
    this.registryPath = path.join(runtimeDir, 'registry.json');
    this.registry = { ...DEFAULT_REGISTRY };
  }

  /**
   * Load registry from disk (or create default if doesn't exist)
   */
  async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.registryPath, 'utf-8');
      this.registry = JSON.parse(content);

      // Validate version
      if (this.registry.version !== '1.0.0') {
        console.warn(
          `[Registry] Unknown registry version: ${this.registry.version}, using anyway`
        );
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // Registry doesn't exist, create default
        this.registry = { ...DEFAULT_REGISTRY };
        await this.save();
      } else {
        throw new Error(`Failed to load registry: ${error.message}`);
      }
    }
  }

  /**
   * Save registry to disk
   */
  async save(): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(this.registryPath);
    await fs.mkdir(dir, { recursive: true });

    // Update last modified
    this.registry.lastModified = new Date().toISOString();

    // Write with pretty formatting
    const content = JSON.stringify(this.registry, null, 2);
    await fs.writeFile(this.registryPath, content, 'utf-8');
  }

  /**
   * Get all messages
   */
  getAll(): MessageRegistryEntry[] {
    return [...this.registry.messages];
  }

  /**
   * Get message by ID
   */
  get(id: string): MessageRegistryEntry | null {
    return this.registry.messages.find((m) => m.id === id) || null;
  }

  /**
   * Check if message exists
   */
  has(id: string): boolean {
    return this.registry.messages.some((m) => m.id === id);
  }

  /**
   * Add new message to registry
   */
  async add(entry: MessageRegistryEntry): Promise<void> {
    // Check for duplicates
    if (this.has(entry.id)) {
      throw new Error(`Message with ID '${entry.id}' already exists in registry`);
    }

    this.registry.messages.push(entry);
    await this.save();
  }

  /**
   * Update existing message in registry
   */
  async update(id: string, updates: Partial<MessageRegistryEntry>): Promise<void> {
    const index = this.registry.messages.findIndex((m) => m.id === id);
    if (index === -1) {
      throw new Error(`Message '${id}' not found in registry`);
    }

    // Merge updates
    this.registry.messages[index] = {
      ...this.registry.messages[index]!,
      ...updates,
      metadata: {
        ...this.registry.messages[index]!.metadata,
        ...(updates.metadata || {}),
        modified: new Date().toISOString(),
      },
    };

    await this.save();
  }

  /**
   * Remove message from registry
   */
  async remove(id: string): Promise<void> {
    const index = this.registry.messages.findIndex((m) => m.id === id);
    if (index === -1) {
      throw new Error(`Message '${id}' not found in registry`);
    }

    this.registry.messages.splice(index, 1);
    await this.save();
  }

  /**
   * Toggle message enabled state
   */
  async toggleEnabled(id: string): Promise<boolean> {
    const entry = this.get(id);
    if (!entry) {
      throw new Error(`Message '${id}' not found in registry`);
    }

    const newState = !entry.enabled;
    await this.update(id, { enabled: newState });
    return newState;
  }

  /**
   * Create registry entry from template
   */
  static createEntry(
    id: string,
    type: MessageType,
    filePath: string,
    options: {
      priority?: number;
      description?: string;
      displayName?: string;
      conditions?: MessageConditions;
    } = {}
  ): MessageRegistryEntry {
    return {
      id,
      type,
      path: filePath,
      enabled: true,
      priority: options.priority ?? 50,
      conditions: options.conditions,
      metadata: {
        created: new Date().toISOString(),
        description: options.description,
        displayName: options.displayName,
        author: 'user',
      },
    };
  }

  /**
   * Clear all messages (for testing)
   */
  async clear(): Promise<void> {
    this.registry.messages = [];
    await this.save();
  }
}
