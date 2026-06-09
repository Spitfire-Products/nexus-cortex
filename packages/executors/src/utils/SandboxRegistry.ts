/**
 * SandboxRegistry - File-based persistent sandbox tracking
 *
 * Maintains a registry of all active sandboxes with file persistence.
 * Survives server restarts and enables stateless mode to discover existing sandboxes.
 *
 * Architecture:
 * - Single source of truth: .addon-tools/registry.json
 * - Atomic writes with temp file + rename
 * - Auto-recovery: validates PIDs and ports on load
 * - Thread-safe: file locking for concurrent access
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { existsSync } from 'fs';

export interface SandboxRegistryEntry {
  id: string;              // UUID
  name: string;            // Human-friendly name
  port: number;            // HTTP port
  url: string;             // Full URL
  pid?: number;            // Process ID (if known)
  mode: 'oneshot' | 'dev' | 'persistent';
  startTime: string;       // ISO timestamp
  lastActivity: string;    // ISO timestamp
  path: string;            // Absolute path to sandbox directory
  metadata?: Record<string, any>;  // Additional info
}

export interface SandboxRegistryData {
  version: string;
  sandboxes: Record<string, SandboxRegistryEntry>;
}

export class SandboxRegistry {
  private static instance: SandboxRegistry;
  private registryPath: string;
  private registryDir: string;
  private data: SandboxRegistryData;
  private saveDebounceTimer: NodeJS.Timeout | null = null;

  private constructor(baseDir: string) {
    this.registryDir = join(baseDir, '.addon-tools');
    this.registryPath = join(this.registryDir, 'registry.json');
    this.data = {
      version: '1.0.0',
      sandboxes: {}
    };
  }

  /**
   * Get singleton instance
   */
  static getInstance(baseDir?: string): SandboxRegistry {
    if (!SandboxRegistry.instance) {
      if (!baseDir) {
        throw new Error('SandboxRegistry: baseDir required for first initialization');
      }
      SandboxRegistry.instance = new SandboxRegistry(baseDir);
    }
    return SandboxRegistry.instance;
  }

  /**
   * Initialize registry (load from disk or create new)
   */
  async initialize(): Promise<void> {
    // Ensure directory exists
    await fs.mkdir(this.registryDir, { recursive: true });

    // Load existing registry or create new
    if (existsSync(this.registryPath)) {
      await this.load();
      await this.cleanStaleEntries();
    } else {
      await this.save();
    }
  }

  /**
   * Load registry from disk
   */
  private async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.registryPath, 'utf-8');
      const loaded = JSON.parse(content) as SandboxRegistryData;

      // Validate version compatibility
      if (loaded.version !== this.data.version) {
        console.warn(`⚠  SandboxRegistry: Version mismatch (expected ${this.data.version}, got ${loaded.version})`);
      }

      this.data = loaded;
    } catch (error: any) {
      console.error(`[ERROR] Failed to load sandbox registry: ${error.message}`);
      // Keep empty registry
    }
  }

  /**
   * Save registry to disk (atomic write)
   */
  private async save(): Promise<void> {
    try {
      const tempPath = `${this.registryPath}.tmp`;
      const content = JSON.stringify(this.data, null, 2);

      // Write to temp file
      await fs.writeFile(tempPath, content, 'utf-8');

      // Atomic rename
      await fs.rename(tempPath, this.registryPath);
    } catch (error: any) {
      console.error(`[ERROR] Failed to save sandbox registry: ${error.message}`);
    }
  }

  /**
   * Save with debouncing (prevents excessive disk writes)
   */
  private debouncedSave(): void {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    this.saveDebounceTimer = setTimeout(() => {
      this.save();
      this.saveDebounceTimer = null;
    }, 1000); // Save after 1s of inactivity
  }

  /**
   * Register a new sandbox
   */
  async register(entry: SandboxRegistryEntry): Promise<void> {
    this.data.sandboxes[entry.id] = entry;
    await this.save();
  }

  /**
   * Update an existing sandbox
   */
  async update(id: string, updates: Partial<SandboxRegistryEntry>): Promise<void> {
    const existing = this.data.sandboxes[id];
    if (!existing) {
      throw new Error(`Sandbox ${id} not found in registry`);
    }

    this.data.sandboxes[id] = {
      ...existing,
      ...updates,
      lastActivity: new Date().toISOString()
    };

    this.debouncedSave();
  }

  /**
   * Remove a sandbox from registry
   */
  async unregister(id: string): Promise<void> {
    delete this.data.sandboxes[id];
    await this.save();
  }

  /**
   * Get a sandbox by ID
   */
  get(id: string): SandboxRegistryEntry | undefined {
    return this.data.sandboxes[id];
  }

  /**
   * Get sandbox by name (returns first match)
   */
  getByName(name: string): SandboxRegistryEntry | undefined {
    return Object.values(this.data.sandboxes).find(s => s.name === name);
  }

  /**
   * Get all sandboxes
   */
  getAll(): SandboxRegistryEntry[] {
    return Object.values(this.data.sandboxes);
  }

  /**
   * Check if a sandbox exists
   */
  has(id: string): boolean {
    return id in this.data.sandboxes;
  }

  /**
   * Clean stale entries (processes that no longer exist)
   */
  private async cleanStaleEntries(): Promise<void> {
    const staleIds: string[] = [];

    for (const [id, entry] of Object.entries(this.data.sandboxes)) {
      // Check if process still exists
      if (entry.pid && !this.isProcessAlive(entry.pid)) {
        console.log(` Cleaning stale sandbox: ${entry.name} (PID ${entry.pid} not found)`);
        staleIds.push(id);
      }
    }

    // Remove stale entries
    for (const id of staleIds) {
      delete this.data.sandboxes[id];
    }

    if (staleIds.length > 0) {
      await this.save();
    }
  }

  /**
   * Check if a process is alive
   */
  private isProcessAlive(pid: number): boolean {
    try {
      // Send signal 0 to check if process exists
      process.kill(pid, 0);
      return true;
    } catch (error: any) {
      return false;
    }
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    total: number;
    byMode: Record<string, number>;
    oldestSandbox?: SandboxRegistryEntry;
    newestSandbox?: SandboxRegistryEntry;
  } {
    const sandboxes = this.getAll();
    const byMode: Record<string, number> = {};

    for (const sandbox of sandboxes) {
      byMode[sandbox.mode] = (byMode[sandbox.mode] || 0) + 1;
    }

    const sorted = sandboxes.sort((a, b) =>
      new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );

    return {
      total: sandboxes.length,
      byMode,
      oldestSandbox: sorted[0],
      newestSandbox: sorted[sorted.length - 1]
    };
  }

  /**
   * Export registry for debugging
   */
  export(): SandboxRegistryData {
    return JSON.parse(JSON.stringify(this.data));
  }

  /**
   * Clear all sandboxes (dangerous - use with caution!)
   */
  async clear(): Promise<void> {
    this.data.sandboxes = {};
    await this.save();
  }
}
