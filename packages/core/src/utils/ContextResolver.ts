/**
 * Context Resolver
 *
 * Determines storage and configuration paths based on launch directory.
 * Implements context-aware runtime behavior:
 * - Workspace-level: Launched from workspace root
 * - Project-level: Launched from project subdirectory
 *
 * Similar to git's behavior with .git/ directories.
 */

import { join, dirname, resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';

/**
 * Storage configuration for a given context
 */
export interface StorageConfig {
  /** Session storage directory */
  sessionsDir: string;

  /** System messages directory */
  systemMessagesDir: string;

  /** Context level: workspace, project, or global */
  contextLevel: 'workspace' | 'project' | 'global';

  /** Root directory for this context */
  contextRoot: string;
}

/**
 * Context resolution options
 */
export interface ContextResolverOptions {
  /** Current working directory (default: process.cwd()) */
  cwd?: string;

  /** Force workspace root detection (for testing) */
  forceWorkspaceRoot?: string;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Workspace detection markers
 * If any of these exist, we consider it a workspace root
 */
const WORKSPACE_MARKERS = [
  '.git',           // Git repository root
  'package.json',   // Node.js project root
  'Cargo.toml',     // Rust workspace
  'go.mod',         // Go module
  'pyproject.toml', // Python project
  'pom.xml',        // Maven project
  '.workspace',     // Explicit workspace marker
];

/**
 * Context Resolver
 *
 * Determines whether to use workspace-level or project-level storage
 * based on launch directory.
 */
export class ContextResolver {
  private options: Required<ContextResolverOptions>;

  constructor(options: ContextResolverOptions = {}) {
    this.options = {
      cwd: options.cwd || process.cwd(),
      forceWorkspaceRoot: options.forceWorkspaceRoot || '',
      debug: options.debug || false
    };
  }

  /**
   * Resolve storage configuration for current context
   *
   * Algorithm:
   * 1. Check if launched from workspace root → workspace-level
   * 2. Check if launched from project subdirectory → project-level
   * 3. Fallback to global user directory
   *
   * @returns Storage configuration for current context
   */
  resolve(): StorageConfig {
    const cwd = resolve(this.options.cwd);

    if (this.options.debug) {
      console.log('[ContextResolver] Resolving context from:', cwd);
    }

    // Find workspace root
    const workspaceRoot = this.options.forceWorkspaceRoot || this.findWorkspaceRoot(cwd);

    if (!workspaceRoot) {
      // No workspace detected, use global user directory
      if (this.options.debug) {
        console.log('[ContextResolver] No workspace found, using global');
      }
      return this.createGlobalConfig();
    }

    // Check if we're at workspace root or in a subdirectory
    if (cwd === workspaceRoot) {
      // Launched from workspace root → workspace-level storage
      if (this.options.debug) {
        console.log('[ContextResolver] At workspace root, using workspace-level');
      }
      return this.createWorkspaceConfig(workspaceRoot);
    } else {
      // Launched from project subdirectory → project-level storage
      // Use the current directory (project subdirectory) as the context root
      if (this.options.debug) {
        console.log('[ContextResolver] In project subdirectory, using project-level storage');
      }
      return this.createProjectConfig(cwd);
    }
  }

  /**
   * Find workspace root by walking up directory tree
   *
   * Looks for workspace markers (.git, package.json, etc.)
   * Stops at filesystem root or home directory.
   *
   * For monorepos, prefers package.json with "workspaces" field over regular package.json
   *
   * @param startDir - Directory to start search from
   * @returns Workspace root path or null if not found
   */
  private findWorkspaceRoot(startDir: string): string | null {
    let currentDir = resolve(startDir);
    const homeDir = homedir();
    let fallbackRoot: string | null = null;

    // Walk up directory tree until we reach filesystem root or home
    while (true) {
      const parentDir = dirname(currentDir);

      // Stop if we've reached the filesystem root or home directory
      if (currentDir === parentDir || currentDir === homeDir) {
        break;
      }

      // Check for workspace markers
      for (const marker of WORKSPACE_MARKERS) {
        const markerPath = join(currentDir, marker);
        if (existsSync(markerPath)) {
          // Special handling for package.json - check if it's a monorepo root
          if (marker === 'package.json') {
            try {
              const packageJsonContent = readFileSync(markerPath, 'utf-8');
              const packageJson = JSON.parse(packageJsonContent);
              if (packageJson.workspaces) {
                // Found monorepo root - this takes priority
                if (this.options.debug) {
                  console.log(`[ContextResolver] Found monorepo root with workspaces at ${currentDir}`);
                }
                return currentDir;
              } else {
                // Regular package.json - save as fallback but keep searching UP
                if (!fallbackRoot) {
                  fallbackRoot = currentDir;
                  if (this.options.debug) {
                    console.log(`[ContextResolver] Found package.json at ${currentDir} (searching for monorepo root)`);
                  }
                }
                // Don't return, continue searching in parent directories
              }
            } catch (error) {
              // Invalid package.json, treat as regular marker
              if (this.options.debug) {
                console.log(`[ContextResolver] Found workspace marker: ${marker} at ${currentDir}`);
              }
              return currentDir;
            }
          } else {
            // Non-package.json marker (.git, etc.) - use immediately if no better match
            if (this.options.debug) {
              console.log(`[ContextResolver] Found workspace marker: ${marker} at ${currentDir}`);
            }
            // For .git marker, if we already have a fallback package.json, use that instead
            // (prefer package.json directory over .git directory)
            if (fallbackRoot) {
              return fallbackRoot;
            }
            return currentDir;
          }
        }
      }

      // Move up one level
      currentDir = dirname(currentDir);
    }

    // Return fallback if we found a package.json but no monorepo root
    if (fallbackRoot) {
      if (this.options.debug) {
        console.log(`[ContextResolver] Using fallback workspace root: ${fallbackRoot}`);
      }
      return fallbackRoot;
    }

    // No workspace found
    return null;
  }

  /**
   * Create workspace-level storage config
   *
   * Used when launched from workspace root (monorepo root).
   * ALL data goes to workspace-local .cortex/ directory.
   *
   * Example: cd nexus-cortex/ && cortex
   * → Uses nexus-cortex/.cortex/ (workspace-local storage)
   *
   * @param workspaceRoot - Workspace root directory
   * @returns Workspace-level storage config (uses workspace-local .cortex/)
   */
  private createWorkspaceConfig(workspaceRoot: string): StorageConfig {
    return {
      sessionsDir: join(workspaceRoot, '.cortex', 'sessions'),
      systemMessagesDir: join(workspaceRoot, '.cortex', 'system-messages'),
      contextLevel: 'workspace',
      contextRoot: workspaceRoot
    };
  }

  /**
   * Create project-level storage config
   *
   * Used when launched from project subdirectory.
   * ALL data is project-isolated in local .cortex/ directory.
   * This allows project-specific sessions, artifacts, and context.
   *
   * Example: cd dateroi/ && cortex
   * → Creates dateroi/.cortex/ with project-specific data
   *
   * @param projectDir - Project directory
   * @returns Project-level storage config
   */
  private createProjectConfig(projectDir: string): StorageConfig {
    return {
      sessionsDir: join(projectDir, '.cortex', 'sessions'),
      systemMessagesDir: join(projectDir, '.cortex', 'system-messages'),
      contextLevel: 'project',
      contextRoot: projectDir
    };
  }

  /**
   * Create global user-level storage config
   *
   * Used when no workspace is detected (rare case).
   * Stores in user home directory.
   *
   * @returns Global storage config
   */
  private createGlobalConfig(): StorageConfig {
    const homeDir = homedir();
    return {
      sessionsDir: join(homeDir, '.cortex', 'sessions'),
      systemMessagesDir: join(homeDir, '.cortex', 'system-messages'),
      contextLevel: 'global',
      contextRoot: homeDir
    };
  }

  /**
   * Check if current directory is a project (not workspace root)
   *
   * @returns True if in project subdirectory
   */
  isProjectContext(): boolean {
    const config = this.resolve();
    return config.contextLevel === 'project';
  }

  /**
   * Check if current directory is workspace root
   *
   * @returns True if at workspace root
   */
  isWorkspaceContext(): boolean {
    const config = this.resolve();
    return config.contextLevel === 'workspace';
  }

  /**
   * Get relative path from context root
   *
   * Useful for display purposes.
   *
   * @param contextRoot - Context root directory
   * @returns Relative path from cwd to context root
   */
  getRelativeContext(contextRoot: string): string {
    const cwd = resolve(this.options.cwd);
    if (cwd === contextRoot) {
      return '.';
    }
    return cwd.replace(contextRoot + '/', '');
  }
}

/**
 * Helper function to resolve context from current directory
 *
 * @param options - Resolution options
 * @returns Storage configuration
 */
export function resolveContext(options?: ContextResolverOptions): StorageConfig {
  const resolver = new ContextResolver(options);
  return resolver.resolve();
}
