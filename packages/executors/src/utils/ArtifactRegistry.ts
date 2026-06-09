/**
 * ArtifactRegistry - Unified registry for all artifacts and sessions
 *
 * Consolidates the previous split between:
 * - SandboxRegistry (.addon-tools/registry.json)
 * - SessionPersistence (.cortex/tmux-sessions/metadata/)
 *
 * New unified structure:
 * .cortex/
 * └── artifacts/
 *     ├── registry.json             # Master registry
 *     └── <artifact-id>/            # One directory per artifact
 *         ├── metadata.json         # Type, runtime, ports, etc.
 *         ├── workspace/            # Code files
 *         ├── tmux/                 # Tmux-specific data (if applicable)
 *         └── snapshots/            # Historical captures
 */

import { promises as fs } from 'fs';
import { join } from 'path';

export type ArtifactType = 'web-app' | 'cli-tool' | 'script' | 'service';
export type ArtifactRuntime =
  | 'tmux+node'
  | 'tmux+python'
  | 'tmux+http-server'
  | 'tmux+rust'
  | 'tmux+go'
  | 'tmux+shell'
  | 'tmux+custom'
  | 'tmux+other'
  | 'process'
  | 'docker';
export type ArtifactMode = 'oneshot' | 'dev' | 'persistent';

/**
 * Unified artifact metadata (combines sandbox + tmux session info)
 */
export interface ArtifactMetadata {
  // Core identification
  id: string;
  name: string;
  type: ArtifactType;
  runtime: ArtifactRuntime;

  // Timestamps
  created: string;
  lastUsed: string;

  // Location and access
  workspaceDir: string;           // Path to workspace/ directory
  entryPoint?: string;            // Main file (index.html, main.py, etc.)

  // Runtime details
  mode: ArtifactMode;
  port?: number;
  url?: string;
  pid?: number;

  // Tmux integration (if applicable)
  tmuxSession?: string;

  // Additional metadata
  description?: string;
  tags?: string[];
  env?: Record<string, string>;
  metadata?: Record<string, any>;
}

/**
 * Master registry schema (v2.0.0)
 */
export interface ArtifactRegistrySchema {
  version: '2.0.0';
  artifacts: Record<string, ArtifactMetadata>;
}

/**
 * ArtifactRegistry - Singleton for unified artifact/session management
 */
export class ArtifactRegistry {
  private static instance: ArtifactRegistry;
  private registryPath: string;
  private artifactsDir: string;
  private registry: ArtifactRegistrySchema;
  private initialized: boolean = false;

  private constructor(projectRoot: string) {
    this.artifactsDir = join(projectRoot, '.cortex', 'artifacts');
    this.registryPath = join(this.artifactsDir, 'registry.json');
    this.registry = {
      version: '2.0.0',
      artifacts: {}
    };
  }

  /**
   * Get singleton instance
   */
  public static getInstance(projectRoot: string): ArtifactRegistry {
    if (!ArtifactRegistry.instance) {
      ArtifactRegistry.instance = new ArtifactRegistry(projectRoot);
    }
    return ArtifactRegistry.instance;
  }

  /**
   * Initialize registry (load from disk or create)
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Ensure artifacts directory exists
      await fs.mkdir(this.artifactsDir, { recursive: true });

      // Load existing registry or create new
      try {
        const content = await fs.readFile(this.registryPath, 'utf-8');
        this.registry = JSON.parse(content);

        // Validate version
        if (this.registry.version !== '2.0.0') {
          console.warn(`⚠  Registry version mismatch: ${this.registry.version}. Migrating to 2.0.0...`);
          await this.migrateRegistry();
        }
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          // No registry exists, start fresh. Log to stderr (not stdout) with a
          // text label — stdout must stay clean for --json consumers (e.g. the
          // auto-research Fixer parsing `cortex autoresearch fix --json`), and
          // no emojis in production output.
          await this.save();
          console.error(`[INIT] Created new artifact registry at ${this.registryPath}`);
        } else {
          throw error;
        }
      }

      this.initialized = true;
    } catch (error: any) {
      console.error(`Failed to initialize ArtifactRegistry: ${error.message}`);
      throw error;
    }
  }

  /**
   * Register a new artifact
   */
  public async register(metadata: ArtifactMetadata): Promise<void> {
    if (!this.initialized) await this.initialize();

    // Create artifact directory structure
    const artifactDir = join(this.artifactsDir, metadata.id);
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.mkdir(join(artifactDir, 'workspace'), { recursive: true });

    if (metadata.tmuxSession) {
      await fs.mkdir(join(artifactDir, 'tmux'), { recursive: true });
    }

    await fs.mkdir(join(artifactDir, 'snapshots'), { recursive: true });

    // Write metadata file
    await fs.writeFile(
      join(artifactDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2)
    );

    // Add to registry
    this.registry.artifacts[metadata.id] = metadata;
    await this.save();
  }

  /**
   * Update artifact metadata
   */
  public async update(id: string, updates: Partial<ArtifactMetadata>): Promise<void> {
    if (!this.initialized) await this.initialize();

    const artifact = this.registry.artifacts[id];
    if (!artifact) {
      throw new Error(`Artifact not found: ${id}`);
    }

    // Merge updates
    Object.assign(artifact, updates);
    artifact.lastUsed = new Date().toISOString();

    // Update metadata file
    const artifactDir = join(this.artifactsDir, id);
    await fs.writeFile(
      join(artifactDir, 'metadata.json'),
      JSON.stringify(artifact, null, 2)
    );

    // Update registry
    this.registry.artifacts[id] = artifact;
    await this.save();
  }

  /**
   * Get artifact by ID
   */
  public async get(id: string): Promise<ArtifactMetadata | null> {
    if (!this.initialized) await this.initialize();
    return this.registry.artifacts[id] || null;
  }

  /**
   * List all artifacts
   */
  public async list(): Promise<ArtifactMetadata[]> {
    if (!this.initialized) await this.initialize();
    return Object.values(this.registry.artifacts);
  }

  /**
   * Remove artifact
   */
  public async remove(id: string): Promise<void> {
    if (!this.initialized) await this.initialize();

    const artifact = this.registry.artifacts[id];
    if (!artifact) return;

    // Remove artifact directory
    const artifactDir = join(this.artifactsDir, id);
    await fs.rm(artifactDir, { recursive: true, force: true });

    // Remove from registry
    delete this.registry.artifacts[id];
    await this.save();
  }

  /**
   * Get artifact workspace directory
   */
  public getWorkspaceDir(id: string): string {
    return join(this.artifactsDir, id, 'workspace');
  }

  /**
   * Get artifact tmux directory
   */
  public getTmuxDir(id: string): string {
    return join(this.artifactsDir, id, 'tmux');
  }

  /**
   * Get artifact snapshots directory
   */
  public getSnapshotsDir(id: string): string {
    return join(this.artifactsDir, id, 'snapshots');
  }

  /**
   * Save registry to disk
   */
  private async save(): Promise<void> {
    await fs.writeFile(
      this.registryPath,
      JSON.stringify(this.registry, null, 2)
    );
  }

  /**
   * Migrate from old registry format
   */
  private async migrateRegistry(): Promise<void> {
    // This will handle migration from v1.0.0 (SandboxRegistry) format
    // For now, just reset to v2.0.0
    console.log('Performing registry migration...');
    this.registry = {
      version: '2.0.0',
      artifacts: {}
    };
    await this.save();
    console.log('[OK] Registry migration complete');
  }

  /**
   * Find artifacts by type
   */
  public async findByType(type: ArtifactType): Promise<ArtifactMetadata[]> {
    if (!this.initialized) await this.initialize();
    return Object.values(this.registry.artifacts).filter(a => a.type === type);
  }

  /**
   * Find artifacts by runtime
   */
  public async findByRuntime(runtime: ArtifactRuntime): Promise<ArtifactMetadata[]> {
    if (!this.initialized) await this.initialize();
    return Object.values(this.registry.artifacts).filter(a => a.runtime === runtime);
  }

  /**
   * Find artifact by tmux session ID
   */
  public async findByTmuxSession(sessionId: string): Promise<ArtifactMetadata | null> {
    if (!this.initialized) await this.initialize();
    const artifacts = Object.values(this.registry.artifacts);
    return artifacts.find(a => a.tmuxSession === sessionId) || null;
  }

  /**
   * Get all ports currently in use by artifacts
   */
  public getUsedPorts(): number[] {
    const ports: number[] = [];
    for (const artifact of Object.values(this.registry.artifacts)) {
      if (artifact.port) {
        ports.push(artifact.port);
      }
    }
    return ports;
  }

  /**
   * Get all artifacts (synchronous version for use in registry queries)
   */
  public getAll(): ArtifactMetadata[] {
    return Object.values(this.registry.artifacts);
  }

  /**
   * Get registry statistics
   */
  public async getStats(): Promise<{
    total: number;
    byType: Record<ArtifactType, number>;
    byRuntime: Record<ArtifactRuntime, number>;
    byMode: Record<ArtifactMode, number>;
  }> {
    if (!this.initialized) await this.initialize();

    const artifacts = Object.values(this.registry.artifacts);
    const stats = {
      total: artifacts.length,
      byType: {} as Record<ArtifactType, number>,
      byRuntime: {} as Record<ArtifactRuntime, number>,
      byMode: {} as Record<ArtifactMode, number>
    };

    artifacts.forEach(a => {
      stats.byType[a.type] = (stats.byType[a.type] || 0) + 1;
      stats.byRuntime[a.runtime] = (stats.byRuntime[a.runtime] || 0) + 1;
      stats.byMode[a.mode] = (stats.byMode[a.mode] || 0) + 1;
    });

    return stats;
  }
}
