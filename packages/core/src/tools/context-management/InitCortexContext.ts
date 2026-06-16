/**
 * InitCortexContext Tool
 *
 * Generates CORTEX.md file with project context that gets injected as a system message.
 * Similar to CLAUDE.md but auto-generated with:
 * - File tree structure
 * - Dependencies (package.json, requirements.txt, etc.)
 * - Scripts and build commands
 * - Project overview
 *
 * Usage:
 * - init_cortex_context() - Generate in current directory (.cortex/CORTEX.md)
 * - init_cortex_context({ scope: 'global' }) - Generate in ~/.cortex/CORTEX.md
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { CanonicalTool } from '../types/CanonicalTool.js';

export interface InitCortexContextInput {
  /**
   * Target location for CORTEX.md
   * - 'auto' (default): Use current directory (.cortex/CORTEX.md)
   * - 'global': Use ~/.cortex/CORTEX.md
   */
  scope?: 'auto' | 'global';

  /**
   * Maximum depth for file tree
   * Default: Auto-detect (5 for monorepos, 4 for regular projects)
   */
  max_depth?: number;

  /**
   * Include file sizes in tree (default: false)
   */
  include_sizes?: boolean;

  /**
   * Dry run - show what would be generated without writing file
   */
  dry_run?: boolean;
}

interface ProjectContext {
  tree: string;
  dependencies: DependencyInfo[];
  scripts: ScriptInfo[];
  overview: string;
  isMonorepo: boolean;
  packages?: PackageInfo[];
  readmeContent?: string;
  keyDirectories?: KeyDirectoryInfo[];
  architecturePatterns?: string[];
}

interface PackageInfo {
  name: string;
  path: string;
  description?: string;
  type?: string; // 'cli', 'core', 'library', etc.
}

interface KeyDirectoryInfo {
  path: string;
  description: string;
  category: 'core' | 'cli' | 'config' | 'tools' | 'other';
}

interface DependencyInfo {
  type: string; // 'npm', 'python', 'rust', 'go', etc.
  file: string;
  count: number;
  main?: string[];
}

interface ScriptInfo {
  source: string; // 'package.json', 'Makefile', etc.
  name: string;
  command: string;
}

/**
 * Directory patterns to exclude (optimized for context efficiency)
 */
const EXCLUDE_PATTERNS = [
  '.git',
  'node_modules',
  'bower_components',
  'dist',
  'build',
  '.cortex',
  '.claude',
  '.npm',
  '.pythonlibs',
  '.config',
  'coverage',
  '.next',
  '.nuxt',
  '.cache',
  'tmp',
  'temp',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  'vendor',
  '.venv',
  'venv',
  'env',
  // Additional exclusions for token efficiency
  '.backups',
  'docs_archive',
  'archive',
  'zcli_design_docs_archive',
  'training_docs',
  'research',
  '.addon-tools',
  '.test-projects',
];

export interface InitCortexContextOutput {
  status: 'success' | 'error';
  message: string;
  cortexPath?: string;
  memoryPath?: string;
  dryRun: boolean;
  tree?: string;
  dependencyCount?: number;
  scriptCount?: number;
}

export interface ProjectScanResult {
  tree: string;
  dependencies: DependencyInfo[];
  scripts: ScriptInfo[];
  overview: string;
  isMonorepo: boolean;
  packages?: PackageInfo[];
  architecturePatterns?: string[];
  existingCortexMd?: string;
  existingClaudeMd?: string;
  existingGeminiMd?: string;
  targetPath: string;
  scope: string;
}

/**
 * InitCortexContext Tool Implementation
 */
export class InitCortexContext {
  /**
   * Scan a project and return structured data for the model to write CORTEX.md.
   * This is the raw data gathering step — the model does the synthesis.
   */
  static async scan(
    workingDir: string,
    options: { scope?: 'auto' | 'global'; max_depth?: number } = {}
  ): Promise<ProjectScanResult> {
    const scope = options.scope || 'auto';
    const scanDir = scope === 'global' ? process.env.HOME || '~' : workingDir;
    const targetDir = scope === 'global'
      ? path.join(process.env.HOME || '~', '.cortex')
      : path.join(workingDir, '.cortex');

    const isMonorepo = await this.detectMonorepo(scanDir);
    const maxDepth = options.max_depth || (isMonorepo ? 5 : 4);
    const context = await this.analyzeProject(scanDir, maxDepth, false);

    // Read existing context files if present
    let existingCortexMd: string | undefined;
    let existingClaudeMd: string | undefined;
    let existingGeminiMd: string | undefined;

    try { existingCortexMd = await fs.readFile(path.join(targetDir, 'CORTEX.md'), 'utf-8'); } catch {}
    try { existingClaudeMd = await fs.readFile(path.join(scanDir, 'CLAUDE.md'), 'utf-8'); } catch {}
    try { existingGeminiMd = await fs.readFile(path.join(scanDir, 'GEMINI.md'), 'utf-8'); } catch {}

    return {
      tree: context.tree,
      dependencies: context.dependencies,
      scripts: context.scripts,
      overview: context.overview,
      isMonorepo: context.isMonorepo,
      packages: context.packages,
      architecturePatterns: context.architecturePatterns,
      existingCortexMd,
      existingClaudeMd,
      existingGeminiMd,
      targetPath: path.join(targetDir, 'CORTEX.md'),
      scope,
    };
  }

  /**
   * Format scan results as a prompt for the model to write CORTEX.md.
   */
  static formatScanAsPrompt(scan: ProjectScanResult): string {
    const sections: string[] = [];

    sections.push(`Analyze this project and write a CORTEX.md file at: ${scan.targetPath}`);
    sections.push('');

    // Existing context files
    if (scan.existingCortexMd) {
      sections.push('## Existing CORTEX.md (improve, do not rewrite from scratch)');
      sections.push('```markdown');
      sections.push(scan.existingCortexMd);
      sections.push('```');
      sections.push('');
    }

    if (scan.existingClaudeMd) {
      sections.push('## Existing CLAUDE.md (incorporate relevant parts)');
      sections.push('```markdown');
      sections.push(scan.existingClaudeMd.slice(0, 3000));
      if (scan.existingClaudeMd.length > 3000) sections.push('... (truncated)');
      sections.push('```');
      sections.push('');
    }

    if (scan.existingGeminiMd) {
      sections.push('## Existing GEMINI.md (incorporate relevant parts)');
      sections.push('```markdown');
      sections.push(scan.existingGeminiMd.slice(0, 2000));
      if (scan.existingGeminiMd.length > 2000) sections.push('... (truncated)');
      sections.push('```');
      sections.push('');
    }

    // Project scan data
    sections.push('## Project Scan Data');
    sections.push('');
    sections.push(`**Overview**: ${scan.overview}`);
    sections.push(`**Monorepo**: ${scan.isMonorepo ? 'Yes' : 'No'}`);
    if (scan.packages && scan.packages.length > 0) {
      sections.push(`**Packages**: ${scan.packages.map(p => `${p.name} (${p.type || 'unknown'})`).join(', ')}`);
    }
    sections.push('');

    if (scan.architecturePatterns && scan.architecturePatterns.length > 0) {
      sections.push('### Architecture Patterns Detected');
      scan.architecturePatterns.forEach(p => sections.push(`- ${p}`));
      sections.push('');
    }

    sections.push('### File Structure');
    sections.push('```');
    sections.push(scan.tree);
    sections.push('```');
    sections.push('');

    if (scan.dependencies.length > 0) {
      sections.push('### Dependencies');
      scan.dependencies.forEach(dep => {
        const main = dep.main?.length ? ` (main: ${dep.main.join(', ')})` : '';
        sections.push(`- ${dep.type} (${dep.file}): ${dep.count} total${main}`);
      });
      sections.push('');
    }

    if (scan.scripts.length > 0) {
      sections.push('### Scripts');
      scan.scripts.forEach(s => sections.push(`- \`${s.command}\` — ${s.name} (${s.source})`));
      sections.push('');
    }

    // Instructions for the model
    sections.push('## Writing Instructions');
    sections.push('');
    sections.push('Write a CORTEX.md that helps an AI agent work effectively in this codebase.');
    sections.push('Model it after a standard coding CLI\'s CLAUDE.md style — concise, actionable, under 80 lines.');
    sections.push('');
    sections.push('Include these sections:');
    sections.push('1. **Project** — one-liner description, language, architecture');
    sections.push('2. **Key Commands** — build, test, run, lint (only commands that exist)');
    sections.push('3. **Architecture** — how the pieces connect, key patterns');
    sections.push('4. **Key Files** — 10-15 most important files with one-line role descriptions');
    sections.push('5. **Conventions** — naming, IDs, patterns an agent should follow');
    sections.push('6. **When Modifying** — operational guidelines (what to read first, what not to break)');
    sections.push('');
    sections.push('Do NOT include:');
    sections.push('- File trees (too verbose, stale quickly)');
    sections.push('- Full dependency lists (use package.json)');
    sections.push('- Full script listings (use npm run)');
    sections.push('- Auto-generated boilerplate or timestamps');
    sections.push('');
    if (scan.existingCortexMd) {
      sections.push('An existing CORTEX.md was found. Suggest improvements and incorporate new findings.');
      sections.push('Preserve any manually-written sections that are still accurate.');
    }
    sections.push(`Write the file to: ${scan.targetPath}`);

    return sections.join('\n');
  }

  /**
   * Execute the init_cortex_context tool.
   *
   * When called by the model as a tool, returns scan data + writing instructions
   * so the model writes CORTEX.md itself (via an /init flow).
   * Also auto-creates MEMORY.md if none exists.
   */
  static async execute(
    input: InitCortexContextInput,
    workingDir: string
  ): Promise<InitCortexContextOutput> {
    try {
      const scope = input.scope || 'auto';
      const dryRun = input.dry_run || false;

      const scan = await this.scan(workingDir, {
        scope,
        max_depth: input.max_depth,
      });

      // Auto-create MEMORY.md if none exists
      const targetDir = path.dirname(scan.targetPath);
      await fs.mkdir(targetDir, { recursive: true });

      let memoryCreated = false;
      const memoryMdPath = path.join(targetDir, 'MEMORY.md');
      const scanDir = scope === 'global' ? process.env.HOME || '~' : workingDir;
      const memoryLocations = [
        memoryMdPath,
        path.join(scanDir, '.claude', 'MEMORY.md'),
        path.join(scanDir, 'MEMORY.md'),
      ];
      let memoryExists = false;
      for (const loc of memoryLocations) {
        try {
          await fs.access(loc);
          memoryExists = true;
          break;
        } catch {}
      }
      if (!memoryExists && !dryRun) {
        const memoryTemplate = `# Memory

Persistent cross-session memory for this project — injected as a system message
on every conversation turn. Maintain it with your file tools: keep it small,
current, and factual (it costs context every turn). Record patterns as they
emerge; delete what turns out to be wrong.

Capability discovery (for a first session here): \`Skill\` with
\`command: "list"\` shows the installed skill library (autoresearch,
cortex-bench, best-of-n, verify-work, the document skills, …); \`Task\` with
\`subagent_type: "list"\` shows the agent profiles. Remove this paragraph once
you know the install.

## Project Patterns

## Key Files

## Known Issues
`;
        await fs.writeFile(memoryMdPath, memoryTemplate, 'utf-8');
        memoryCreated = true;
      }

      // Return scan data for the model to write CORTEX.md
      const prompt = this.formatScanAsPrompt(scan);

      let message: string;
      if (dryRun) {
        message = `DRY RUN - Project scan complete. Would write to: ${scan.targetPath}\n\n${prompt}`;
      } else {
        message = prompt;
        if (memoryCreated) {
          message += `\n\nNote: MEMORY.md was auto-created at ${memoryMdPath}`;
        }
      }

      return {
        status: 'success',
        message,
        cortexPath: scan.targetPath,
        memoryPath: memoryCreated ? memoryMdPath : undefined,
        dryRun,
        tree: scan.tree,
        dependencyCount: scan.dependencies.length,
        scriptCount: scan.scripts.length
      };
    } catch (error: any) {
      return {
        status: 'error',
        message: `Failed to scan project: ${error.message}`,
        dryRun: input.dry_run || false
      };
    }
  }

  /**
   * Analyze project directory and gather context
   */
  private static async analyzeProject(
    baseDir: string,
    maxDepth: number,
    includeSizes: boolean
  ): Promise<ProjectContext> {
    const isMonorepo = await this.detectMonorepo(baseDir);
    const tree = await this.generateFileTree(baseDir, maxDepth, includeSizes);
    const dependencies = await this.analyzeDependencies(baseDir, isMonorepo);
    const scripts = await this.analyzeScripts(baseDir);
    const readmeContent = await this.readProjectDescription(baseDir);
    const packages = isMonorepo ? await this.analyzePackages(baseDir) : undefined;
    const keyDirectories = await this.identifyKeyDirectories(baseDir, packages);
    const architecturePatterns = await this.detectArchitecturePatterns(baseDir);
    const overview = await this.generateOverview(baseDir, dependencies, readmeContent, packages);

    return {
      tree,
      dependencies,
      scripts,
      overview,
      isMonorepo,
      packages,
      readmeContent,
      keyDirectories,
      architecturePatterns
    };
  }

  /**
   * Check if entry should be included based on patterns
   */
  private static shouldIncludeEntry(entry: any, depth: number): boolean {
    const name = entry.name;

    // Exclude by directory name
    if (EXCLUDE_PATTERNS.includes(name)) return false;

    // Exclude test files by pattern
    if (name.match(/^test-.*\.(ts|js|sh|cjs)$/)) return false;

    // Exclude XAI test artifacts
    if (name.match(/^xai-.*\.json$/)) return false;

    // Exclude build cache
    if (name.endsWith('.tsbuildinfo')) return false;

    // Exclude log files
    if (name.endsWith('.log')) return false;

    // Exclude lock files
    if (name === 'package-lock.json') return false;

    // At root level (depth 0), exclude most markdown files
    if (depth === 0 && name.endsWith('.md')) {
      const keepList = ['README.md', 'CLAUDE.md', 'QUICK_START.md'];
      return keepList.includes(name);
    }

    return true;
  }

  /**
   * Generate file tree with selective expansion
   */
  private static async generateFileTree(
    baseDir: string,
    maxDepth: number,
    includeSizes: boolean
  ): Promise<string> {
    const lines: string[] = [];
    const baseName = path.basename(baseDir);
    lines.push(baseName + '/');

    await this.walkDirectorySelective(baseDir, '', 0, maxDepth, lines, baseDir, includeSizes);

    return lines.join('\n');
  }

  /**
   * Selective directory walker - expands important paths, collapses others
   */
  private static async walkDirectorySelective(
    dir: string,
    prefix: string,
    depth: number,
    maxDepth: number,
    lines: string[],
    baseDir: string,
    includeSizes: boolean
  ): Promise<void> {
    if (depth >= maxDepth) return;

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const filtered = entries.filter(e => this.shouldIncludeEntry(e, depth));
      const sorted = filtered.sort((a, b) => {
        // Directories first, then alphabetical
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

      const relativePath = path.relative(baseDir, dir);

      for (let i = 0; i < sorted.length; i++) {
        const entry = sorted[i];
        if (!entry) continue;

        const isLast = i === sorted.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        const extension = isLast ? ' ' : '│   ';

        const entryPath = path.join(dir, entry.name);
        const relativeEntryPath = path.relative(baseDir, entryPath);

        if (entry.isDirectory()) {
          const description = this.getEnhancedDescription(entry.name, relativeEntryPath);

          let sizeStr = '';
          if (includeSizes) {
            try {
              const stats = await fs.stat(entryPath);
              sizeStr = ` [${this.formatSize(stats.size)}]`;
            } catch {
              // Ignore stat errors
            }
          }

          lines.push(`${prefix}${connector}${entry.name}/${sizeStr}${description ? ` # ${description}` : ''}`);

          // Decide whether to expand this directory
          if (this.shouldExpand(relativeEntryPath, depth)) {
            // Show key files and subdirectories
            await this.expandDirectory(entryPath, prefix + extension, depth + 1, maxDepth, lines, baseDir, includeSizes);
          }
        } else {
          // Only show important files
          if (this.isImportantFile(entry.name, relativePath)) {
            const description = this.getFileDescription(entry.name, relativeEntryPath);

            let sizeStr = '';
            if (includeSizes) {
              try {
                const stats = await fs.stat(entryPath);
                sizeStr = ` [${this.formatSize(stats.size)}]`;
              } catch {
                // Ignore stat errors
              }
            }

            lines.push(`${prefix}${connector}${entry.name}${sizeStr}${description ? ` # ${description}` : ''}`);
          }
        }
      }

      // Add blank line after major sections at root level
      if (depth === 0 && sorted.length > 0) {
        lines.push('│');
      }
    } catch (error) {
      // Ignore permission errors
    }
  }

  /**
   * Expand directory showing key contents
   */
  private static async expandDirectory(
    dir: string,
    prefix: string,
    depth: number,
    maxDepth: number,
    lines: string[],
    baseDir: string,
    includeSizes: boolean
  ): Promise<void> {
    if (depth >= maxDepth) return;

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const filtered = entries.filter(e => this.shouldIncludeEntry(e, depth));

      // Separate directories and important files
      const dirs = filtered.filter(e => e.isDirectory());
      const files = filtered.filter(e => !e.isDirectory() && this.isImportantFile(e.name, path.relative(baseDir, dir)));

      const sorted = [...dirs, ...files].sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

      for (let i = 0; i < sorted.length; i++) {
        const entry = sorted[i];
        if (!entry) continue;

        const isLast = i === sorted.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        const extension = isLast ? ' ' : '│   ';

        const entryPath = path.join(dir, entry.name);
        const relativeEntryPath = path.relative(baseDir, entryPath);

        if (entry.isDirectory()) {
          const description = this.getEnhancedDescription(entry.name, relativeEntryPath);

          let sizeStr = '';
          if (includeSizes) {
            try {
              const stats = await fs.stat(entryPath);
              sizeStr = ` [${this.formatSize(stats.size)}]`;
            } catch {
              // Ignore stat errors
            }
          }

          lines.push(`${prefix}${connector}${entry.name}/${sizeStr}${description ? ` # ${description}` : ''}`);

          // Recursively expand if important
          if (this.shouldExpand(relativeEntryPath, depth)) {
            await this.expandDirectory(entryPath, prefix + extension, depth + 1, maxDepth, lines, baseDir, includeSizes);
          }
        } else {
          const description = this.getFileDescription(entry.name, relativeEntryPath);

          let sizeStr = '';
          if (includeSizes) {
            try {
              const stats = await fs.stat(entryPath);
              sizeStr = ` [${this.formatSize(stats.size)}]`;
            } catch {
              // Ignore stat errors
            }
          }

          lines.push(`${prefix}${connector}${entry.name}${sizeStr}${description ? ` # ${description}` : ''}`);
        }
      }
    } catch (error) {
      // Ignore permission errors
    }
  }

  /**
   * Check if directory should be expanded
   */
  private static shouldExpand(relativePath: string, depth: number): boolean {
    // Expand packages and their immediate children (packages/cli, packages/core, etc.)
    if (relativePath.match(/^packages\/[^/]+$/)) return true;

    // Expand src/, bin/, tests/ directories inside packages
    if (relativePath.match(/^packages\/[^/]+\/(src|bin|tests|docs)$/)) return true;

    // Expand key subdirectories in src/
    if (relativePath.match(/^packages\/[^/]+\/src\/(orchestrator|providers|tools|commands|themes|routes|mcp|session|system-messages)$/)) return true;

    // Expand .cortex and its subdirectories
    if (relativePath === '.cortex') return true;
    if (relativePath === '.cortex/system-messages') return true;

    // Expand scripts at root
    if (relativePath === 'scripts') return true;

    // Stop at depth 4 to prevent excessive nesting
    if (depth >= 4) return false;

    // Default: expand everything else up to depth limit
    return depth < 3;
  }

  /**
   * Check if file is important enough to show
   */
  private static isImportantFile(fileName: string, parentPath: string): boolean {
    // Always show package.json, tsconfig.json, README.md, .env files
    if (['package.json', 'tsconfig.json', 'README.md', '.env', '.env.example', '.gitignore'].includes(fileName)) return true;

    // Show main entry points
    if (fileName === 'index.ts' || fileName === 'index.js') return true;

    // Show all TypeScript/JavaScript files in key directories
    if (parentPath.match(/packages\/(cli|core|server)\/src$/) && fileName.match(/\.(ts|js)$/)) {
      return true;
    }

    // In bin/, show all executables
    if (parentPath.endsWith('/bin')) return true;

    // Show markdown files in docs/
    if (parentPath.match(/\/docs$/) && fileName.endsWith('.md')) {
      return true;
    }

    // Show scripts
    if (parentPath === 'scripts' && fileName.match(/\.(sh|js|ts)$/)) {
      return true;
    }

    return false;
  }

  /**
   * Get enhanced description for directories
   */
  private static getEnhancedDescription(dirName: string, relativePath: string): string {
    // Package descriptions
    if (relativePath === 'packages/cli') return 'CLI interface and UI';
    if (relativePath === 'packages/core') return 'Core orchestration library';
    if (relativePath === 'packages/server') return 'HTTP server (optional)';
    if (relativePath === 'packages/executors') return 'Tool execution layer';
    if (relativePath === 'packages/types') return 'Shared TypeScript types';

    // Core subdirectories
    if (relativePath === 'packages/core/src') return 'TypeScript source';
    if (relativePath.endsWith('/orchestrator')) return 'Main orchestrator engine';
    if (relativePath.endsWith('/providers')) return 'AI provider adapters';
    if (relativePath.endsWith('/tools')) return 'Tool definitions';
    if (relativePath.endsWith('/mcp')) return 'MCP integration';
    if (relativePath.endsWith('/system-messages')) return 'Auto-loaded messages';
    if (relativePath.endsWith('/session')) return 'Session management';
    if (relativePath.endsWith('/models')) return 'Model registry';

    // CLI subdirectories
    if (relativePath === 'packages/cli/src') return 'TypeScript source';
    if (relativePath.endsWith('/commands')) return 'Command handlers';
    if (relativePath.endsWith('/themes')) return 'UI themes';

    // Common patterns
    if (dirName === 'src') return 'Source code';
    if (dirName === 'tests') return 'Test files';
    if (dirName === 'bin') return 'Executables';
    if (dirName === 'docs') return 'Documentation';
    if (dirName === 'scripts') return 'Build and utility scripts';

    // Config
    if (relativePath === '.cortex') return 'Project context (auto-loaded)';
    if (relativePath === '.cortex/system-messages') return 'Custom system messages';

    return '';
  }

  /**
   * Get description for files
   */
  private static getFileDescription(fileName: string, relativePath: string): string {
    // Entry points
    if (fileName === 'index.ts' && relativePath.includes('orchestrator')) return 'Orchestrator exports';
    if (fileName === 'CortexOrchestrator.ts') return 'Main orchestrator';

    // Config files
    if (fileName === 'package.json') return 'Package config';
    if (fileName === 'tsconfig.json') return 'TypeScript config';

    return '';
  }


  /**
   * Format file size
   */
  private static formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  /**
   * Analyze dependencies from various manifest files
   */
  private static async analyzeDependencies(baseDir: string, isMonorepo: boolean): Promise<DependencyInfo[]> {
    const deps: DependencyInfo[] = [];

    if (isMonorepo) {
      // For monorepo: aggregate workspace dependencies
      const allDeps = new Set<string>();
      const allDevDeps = new Set<string>();

      try {
        const packagesDir = path.join(baseDir, 'packages');
        const entries = await fs.readdir(packagesDir, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;

          const pkgJsonPath = path.join(packagesDir, entry.name, 'package.json');
          try {
            const content = await fs.readFile(pkgJsonPath, 'utf-8');
            const pkg = JSON.parse(content);

            Object.keys(pkg.dependencies || {}).forEach(dep => allDeps.add(dep));
            Object.keys(pkg.devDependencies || {}).forEach(dep => allDevDeps.add(dep));
          } catch {}
        }

        if (allDeps.size > 0 || allDevDeps.size > 0) {
          const main = Array.from(allDeps).slice(0, 5);
          deps.push({
            type: 'npm',
            file: 'packages/*/package.json',
            count: allDeps.size + allDevDeps.size,
            main
          });
        }
      } catch {}
    } else {
      // Single package.json
      const pkgJsonPath = path.join(baseDir, 'package.json');
      try {
        const content = await fs.readFile(pkgJsonPath, 'utf-8');
        const pkg = JSON.parse(content);
        const depCount = Object.keys(pkg.dependencies || {}).length +
                         Object.keys(pkg.devDependencies || {}).length;
        const main = Object.keys(pkg.dependencies || {}).slice(0, 5);
        deps.push({ type: 'npm', file: 'package.json', count: depCount, main });
      } catch {}
    }

    // Python (requirements.txt, pyproject.toml)
    const reqTxtPath = path.join(baseDir, 'requirements.txt');
    try {
      const content = await fs.readFile(reqTxtPath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
      const main = lines.slice(0, 5).map(l => l.split('==')[0] || l).map(s => s.trim());
      deps.push({ type: 'python', file: 'requirements.txt', count: lines.length, main });
    } catch {}

    // Rust (Cargo.toml)
    const cargoPath = path.join(baseDir, 'Cargo.toml');
    try {
      const content = await fs.readFile(cargoPath, 'utf-8');
      const depMatches = content.match(/\[dependencies\]([\s\S]*?)(\[|$)/);
      if (depMatches && depMatches[1]) {
        const depLines = depMatches[1].split('\n').filter(l => l.trim() && !l.startsWith('#'));
        const main = depLines.slice(0, 5).map(l => l.split('=')[0] || l).map(s => s.trim());
        deps.push({ type: 'rust', file: 'Cargo.toml', count: depLines.length, main });
      }
    } catch {}

    // Go (go.mod)
    const goModPath = path.join(baseDir, 'go.mod');
    try {
      const content = await fs.readFile(goModPath, 'utf-8');
      const requireMatches = content.match(/require \(([\s\S]*?)\)/);
      if (requireMatches && requireMatches[1]) {
        const depLines = requireMatches[1].split('\n').filter(l => l.trim());
        const main = depLines.slice(0, 5).map(l => l.split(' ')[0] || l).map(s => s.trim());
        deps.push({ type: 'go', file: 'go.mod', count: depLines.length, main });
      }
    } catch {}

    return deps;
  }

  /**
   * Analyze scripts from package.json, Makefile, etc.
   */
  private static async analyzeScripts(baseDir: string): Promise<ScriptInfo[]> {
    const scripts: ScriptInfo[] = [];

    // package.json scripts
    const pkgJsonPath = path.join(baseDir, 'package.json');
    try {
      const content = await fs.readFile(pkgJsonPath, 'utf-8');
      const pkg = JSON.parse(content);
      if (pkg.scripts) {
        for (const [name, command] of Object.entries(pkg.scripts)) {
          scripts.push({
            source: 'package.json',
            name,
            command: command as string
          });
        }
      }
    } catch {}

    // Makefile targets (basic extraction)
    const makefilePath = path.join(baseDir, 'Makefile');
    try {
      const content = await fs.readFile(makefilePath, 'utf-8');
      const targetMatches = content.matchAll(/^([a-zA-Z0-9_-]+):/gm);
      for (const match of targetMatches) {
        if (match[1]) {
          scripts.push({
            source: 'Makefile',
            name: match[1],
            command: `make ${match[1]}`
          });
        }
      }
    } catch {}

    return scripts;
  }

  /**
   * Detect if project is a monorepo
   */
  private static async detectMonorepo(baseDir: string): Promise<boolean> {
    try {
      // Check for packages/ directory
      const packagesDir = path.join(baseDir, 'packages');
      try {
        const stat = await fs.stat(packagesDir);
        if (stat.isDirectory()) return true;
      } catch {}

      // Check for workspace configuration in package.json
      const pkgJsonPath = path.join(baseDir, 'package.json');
      try {
        const content = await fs.readFile(pkgJsonPath, 'utf-8');
        const pkg = JSON.parse(content);
        if (pkg.workspaces) return true;
      } catch {}

      // Check for lerna.json
      const lernaPath = path.join(baseDir, 'lerna.json');
      try {
        await fs.access(lernaPath);
        return true;
      } catch {}

      // Check for pnpm-workspace.yaml
      const pnpmPath = path.join(baseDir, 'pnpm-workspace.yaml');
      try {
        await fs.access(pnpmPath);
        return true;
      } catch {}

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Read project description from README.md
   */
  private static async readProjectDescription(baseDir: string): Promise<string | undefined> {
    try {
      const readmePath = path.join(baseDir, 'README.md');
      const content = await fs.readFile(readmePath, 'utf-8');

      // Extract first meaningful paragraph (after title)
      const lines = content.split('\n');
      let description = '';
      let foundTitle = false;

      for (const line of lines) {
        const trimmed = line.trim();

        // Skip title line
        if (trimmed.startsWith('#')) {
          foundTitle = true;
          continue;
        }

        // Skip empty lines until we find content
        if (!trimmed) continue;

        // Get first paragraph after title
        if (foundTitle && trimmed && !trimmed.startsWith('```')) {
          description = trimmed;
          break;
        }
      }

      // Limit to 200 chars
      if (description.length > 200) {
        description = description.substring(0, 197) + '...';
      }

      return description || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Analyze packages in a monorepo
   */
  private static async analyzePackages(baseDir: string): Promise<PackageInfo[]> {
    const packages: PackageInfo[] = [];

    try {
      const packagesDir = path.join(baseDir, 'packages');
      try {
        await fs.access(packagesDir);
      } catch {
        return packages; // No packages/ directory
      }

      const entries = await fs.readdir(packagesDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const pkgPath = path.join(packagesDir, entry.name);
        const pkgJsonPath = path.join(pkgPath, 'package.json');

        try {
          const content = await fs.readFile(pkgJsonPath, 'utf-8');
          const pkg = JSON.parse(content);

          packages.push({
            name: pkg.name || entry.name,
            path: `packages/${entry.name}`,
            description: pkg.description,
            type: this.inferPackageType(entry.name, pkg)
          });
        } catch {
          // Package doesn't have package.json, skip it
        }
      }
    } catch {}

    return packages;
  }

  /**
   * Infer package type from name and package.json
   */
  private static inferPackageType(dirName: string, pkg: any): string | undefined {
    const name = dirName.toLowerCase();

    if (name.includes('cli') || pkg.bin) return 'CLI';
    if (name.includes('core')) return 'Core Library';
    if (name.includes('server') || name.includes('api')) return 'Server';
    if (name.includes('ui') || name.includes('component')) return 'UI Components';
    if (name.includes('util') || name.includes('helper')) return 'Utilities';
    if (name.includes('test')) return 'Testing';

    return undefined;
  }

  /**
   * Generate project overview
   */
  private static async generateOverview(
    baseDir: string,
    deps: DependencyInfo[],
    readmeContent?: string,
    packages?: PackageInfo[]
  ): Promise<string> {
    const sections: string[] = [];

    // Add README description if available
    if (readmeContent) {
      sections.push(readmeContent);
      sections.push(''); // Blank line
    }

    const parts: string[] = [];

    // Detect project type
    const types: string[] = [];
    if (deps.some(d => d.type === 'npm')) types.push('Node.js/TypeScript');
    if (deps.some(d => d.type === 'python')) types.push('Python');
    if (deps.some(d => d.type === 'rust')) types.push('Rust');
    if (deps.some(d => d.type === 'go')) types.push('Go');

    if (types.length > 0) {
      parts.push(`**Project Type**: ${types.join(', ')}`);
    }

    // Check for monorepo
    if (packages && packages.length > 0) {
      parts.push(`**Architecture**: Monorepo with ${packages.length} packages`);
    }

    // Check for frameworks
    const pkgJsonPath = path.join(baseDir, 'package.json');
    try {
      const content = await fs.readFile(pkgJsonPath, 'utf-8');
      const pkg = JSON.parse(content);
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

      const frameworks: string[] = [];
      if (allDeps['react']) frameworks.push('React');
      if (allDeps['vue']) frameworks.push('Vue');
      if (allDeps['next']) frameworks.push('Next.js');
      if (allDeps['express']) frameworks.push('Express');
      if (allDeps['fastify']) frameworks.push('Fastify');

      if (frameworks.length > 0) {
        parts.push(`**Frameworks**: ${frameworks.join(', ')}`);
      }
    } catch {}

    if (parts.length > 0) {
      sections.push(parts.join(' | '));
    }

    // Add package descriptions for monorepos
    if (packages && packages.length > 0) {
      sections.push(''); // Blank line
      sections.push('**Packages**:');
      packages.forEach(pkg => {
        const typeStr = pkg.type ? ` (${pkg.type})` : '';
        const descStr = pkg.description ? ` - ${pkg.description}` : '';
        sections.push(`- \`${pkg.name}\`${typeStr}${descStr}`);
      });
    }

    return sections.join('\n');
  }

  /**
   * Identify key directories worth highlighting
   */
  private static async identifyKeyDirectories(
    baseDir: string,
    _packages?: PackageInfo[]
  ): Promise<KeyDirectoryInfo[]> {
    const keyDirs: KeyDirectoryInfo[] = [];

    // Check for common patterns
    const patterns = [
      // Core system directories
      { path: 'packages/core/src/orchestrator', description: 'CortexOrchestrator (main engine)', category: 'core' as const },
      { path: 'packages/core/src/providers', description: 'Multi-provider adapters', category: 'core' as const },
      { path: 'packages/core/src/tools', description: 'Tool definitions and executors', category: 'tools' as const },
      { path: 'packages/core/src/mcp', description: 'Model Context Protocol integration', category: 'core' as const },
      { path: 'packages/core/src/system-messages', description: 'System message auto-loading', category: 'core' as const },

      // CLI interface
      { path: 'packages/cli/src/commands', description: 'Command handlers and slash commands', category: 'cli' as const },
      { path: 'packages/cli/src/themes', description: 'Terminal UI themes', category: 'cli' as const },
      { path: 'packages/cli/bin', description: 'CLI entry points', category: 'cli' as const },

      // Configuration
      { path: '.cortex', description: 'Auto-loaded project context', category: 'config' as const },
      { path: '.cortex/system-messages', description: 'Custom system messages', category: 'config' as const },

      // Server
      { path: 'packages/server/src/routes', description: 'REST API endpoints', category: 'other' as const },

      // General patterns (src, lib, bin)
      { path: 'src', description: 'Source code', category: 'other' as const },
      { path: 'lib', description: 'Library code', category: 'other' as const },
      { path: 'bin', description: 'Executable scripts', category: 'other' as const },
    ];

    for (const pattern of patterns) {
      try {
        const fullPath = path.join(baseDir, pattern.path);
        await fs.access(fullPath);
        keyDirs.push(pattern);
      } catch {
        // Directory doesn't exist, skip it
      }
    }

    return keyDirs;
  }

  /**
   * Detect architecture patterns from codebase
   */
  private static async detectArchitecturePatterns(baseDir: string): Promise<string[]> {
    const patterns: string[] = [];

    // Check for direct-wired architecture
    const orchestratorClientPath = path.join(baseDir, 'packages/cli/src/orchestrator/OrchestratorClient.ts');
    try {
      await fs.access(orchestratorClientPath);
      patterns.push('**Direct-Wired Execution**: Core library imports directly into CLI process for zero-latency tool execution');
    } catch {}

    // Check for session management
    const sessionStorePath = path.join(baseDir, 'packages/core/src/session');
    try {
      await fs.access(sessionStorePath);
      patterns.push('**Session Management**: JSONL format with UUID-based message tracking');
    } catch {}

    // Check for MCP integration
    const mcpPath = path.join(baseDir, 'packages/core/src/mcp');
    try {
      await fs.access(mcpPath);
      patterns.push('**MCP Integration**: Full Model Context Protocol support for extended capabilities');
    } catch {}

    // Check for system messages
    const systemMsgPath = path.join(baseDir, 'packages/core/src/system-messages');
    try {
      await fs.access(systemMsgPath);
      patterns.push('**System Messages**: Auto-loaded from .cortex/system-messages/ with hot-reload');
    } catch {}

    // Check for multi-provider support
    const providersPath = path.join(baseDir, 'packages/core/src/providers');
    try {
      const entries = await fs.readdir(providersPath);
      const providerCount = entries.filter(e => e.endsWith('.ts') && !e.includes('Base')).length;
      if (providerCount > 0) {
        patterns.push(`**Multi-Provider Support**: ${providerCount}+ AI providers with unified interface`);
      }
    } catch {}

    return patterns;
  }

  /**
   * Get the canonical tool definition for init_cortex_context
   */
  static getToolDefinition(): CanonicalTool {
    return {
      name: 'InitCortexContext',
      // Deferred by default to keep the hot-path context lean. The orchestrator promotes
      // this to 'essential' only when the project has no CORTEX.md yet (see
      // getContextManagementTools) — so it's discoverable exactly when initialization is
      // relevant, and out of the way once the project is initialized.
      discoveryTier: 'standard',
      description: 'Scan the project and return structured data for you to write a CORTEX.md project context file. You will receive file structure, dependencies, scripts, and architecture patterns. Use this data plus your own analysis to write a concise CORTEX.md (like CLAUDE.md). Write the file yourself using WriteFile.',
      schema: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            description: 'Where to generate CORTEX.md: "auto" (current directory) or "global" (~/.cortex/)',
            enum: ['auto', 'global']
          },
          max_depth: {
            type: 'number',
            description: 'Maximum depth for file tree (default: auto-detect - 5 for monorepos, 4 for regular projects)'
          },
          include_sizes: {
            type: 'boolean',
            description: 'Include file sizes in tree (default: false)'
          },
          dry_run: {
            type: 'boolean',
            description: 'Preview what would be generated without creating file (default: false)'
          }
        }
      }
    };
  }
}
