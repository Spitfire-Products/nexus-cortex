import { BaseTool } from '../../base/BaseTool.js';
import type { ToolResult } from '../../base/ToolResult.js';
import { spawn, ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { watch } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { visualBridge, VisualSnapshot } from './VisualFeedbackBridge.js';
import { broadcaster } from './SandboxEventBroadcaster.js';
import { viewServer } from './SandboxViewServer.js';
import { SandboxRegistry } from '../../utils/SandboxRegistry.js';
import { ArtifactRegistry, type ArtifactRuntime } from '../../utils/ArtifactRegistry.js';
import { TmuxManager } from '../../utils/TmuxManager.js';
import { SessionPersistence } from '../../utils/SessionPersistence.js';

const execAsync = promisify(exec);

/**
 * Package manager types
 */
type PackageManager = 'npm' | 'pip' | 'uv' | 'nix';

/**
 * Artifact mode
 */
type ArtifactMode = 'oneshot' | 'dev' | 'persistent';

/**
 * Running artifact session
 */
interface ArtifactSession {
  id: string;
  name: string;
  process?: ChildProcess;
  tmuxSessionId?: string;  // NEW: Tmux session ID for persistent mode
  url?: string;
  port?: number;
  mode: ArtifactMode;
  startTime: Date;
  lastActivity: Date;
  watchers?: any[];
  visualSnapshot?: VisualSnapshot;  // NEW: Visual feedback for model
}

/**
 * Parameters for CreateArtifactTool
 */
export interface CreateArtifactToolParams {
  name: string;
  description: string;
  parameters: Record<string, any>;

  implementation: {
    language: 'javascript' | 'python' | 'rust' | 'go' | 'shell' | 'html' | 'other';
    code: string;
    fileName?: string;                 // Optional: Specify exact filename (e.g., 'main.rs', 'app.go')
    entryPoint?: string;               // Optional: Specify entry file if multiple files
    command?: string;                  // Optional: Custom command to run the artifact (e.g., 'cargo run', 'go run main.go')
    buildCommand?: string;             // Optional: Build command before running (e.g., 'cargo build --release')
    dependencies?: string[];
    packageManager?: PackageManager;
  };

  mode?: ArtifactMode;                 // NEW: oneshot, dev, persistent
  persistent?: boolean;
  enableVisualFeedback?: boolean;     // NEW: Enable visual feedback for model
  enableReactIntrospection?: boolean;  // React fiber introspection in snapshots (sandbox_scan/grab/detect always available)

  devConfig?: {                        // NEW: Dev mode configuration
    hotReload?: boolean;               // Auto-reload on code changes
    watchFiles?: string[];             // Files to watch
    openBrowser?: boolean;             // Auto-open browser
    liveBridge?: boolean;              // WebSocket for live updates
  };

  uiConfig?: {                         // NEW: UI display configuration
    type?: 'web' | 'terminal' | 'both';
    framework?: 'express' | 'fastapi' | 'flask' | 'nextjs';
    autoStart?: boolean;
  };

  testCases?: Array<{
    input: Record<string, any>;
    expectedOutput?: Record<string, any>;
  }>;

  artifactConfig?: {
    type?: 'docker' | 'local' | 'nix'; // NEW: Added nix
    image?: string;
    ports?: number[];
    volumes?: Record<string, string>;
    env?: Record<string, string>;
    nixConfig?: {                       // NEW: Nix-specific config
      packages?: string[];              // Nix packages to install
      shellHook?: string;               // Shell initialization
    };
  };
}

/**
 * Active artifactes registry
 */
const activeArtifactes = new Map<string, ArtifactSession>();

/**
 * CreateAddonToolEnhanced - Next-generation dynamic tool creation
 *
 * Features:
 * - UV + NIX package manager support
 * - Dev mode with hot reloading
 * - Automatic UI display (browser popup)
 * - Persistent artifact sessions
 * - Live editing with file watching
 * - Multi-step orchestration
 * - WebSocket live updates
 *
 * Example: TradeStation Proxy
 * ```
 * Model creates:
 * 1. Proxy server (Express.js)
 * 2. Traffic monitor (captures inbound/outbound)
 * 3. Real-time dashboard (React/Socket.io)
 * 4. Auto-opens browser at localhost:3000
 * 5. Hot reloads on code changes
 * ```
 */
export class CreateArtifactToolExecutor extends BaseTool<CreateArtifactToolParams, ToolResult> {
  private artifactDir: string;
  private workingDirectory: string;

  constructor(config: { workingDirectory: string }) {
    const schema = {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string' as const,
          description: 'Unique name for the addon tool'
        },
        description: {
          type: 'string' as const,
          description: 'What the tool does'
        },
        parameters: {
          type: 'object' as const,
          description: 'JSON Schema for tool parameters'
        },
        implementation: {
          type: 'object' as const,
          properties: {
            language: {
              type: 'string' as const,
              enum: ['javascript', 'python'],
              description: 'Programming language'
            },
            code: {
              type: 'string' as const,
              description: 'Source code'
            },
            dependencies: {
              type: 'array' as const,
              items: { type: 'string' as const },
              description: 'Required packages'
            },
            packageManager: {
              type: 'string' as const,
              enum: ['npm', 'pip', 'uv', 'nix'],
              description: 'Package manager (npm, pip, uv, nix)'
            }
          },
          required: ['language' as const, 'code' as const]
        },
        mode: {
          type: 'string' as const,
          enum: ['oneshot', 'dev', 'persistent'],
          description: 'Execution mode: oneshot (default), dev (hot reload), persistent (keep alive)'
        },
        enableVisualFeedback: {
          type: 'boolean' as const,
          description: 'Enable comprehensive visual feedback system for you (the model) to see and iterate on your creations. Captures: (1) screenshots (base64 PNG) of actual UI rendering, (2) DOM structure (HTML), (3) console logs (runtime output), (4) network requests (API calls), (5) performance metrics. Visual data is included in response metadata, allowing you to analyze what you built, identify issues, and make improvements. Essential for iterative UI development.'
        },
        enableReactIntrospection: {
          type: 'boolean' as const,
          description: 'Include a framework report (React/Vue/Svelte detection, React version, renderer count) in the initial visual snapshot. The sandbox_scan / sandbox_grab / sandbox_detect_framework tools work regardless of this flag (they enable introspection on first use). Default: false.'
        },
        devConfig: {
          type: 'object' as const,
          properties: {
            hotReload: {
              type: 'boolean' as const,
              description: 'Enable hot reload on file changes'
            },
            watchFiles: {
              type: 'array' as const,
              items: { type: 'string' as const },
              description: 'Files to watch for changes'
            },
            openBrowser: {
              type: 'boolean' as const,
              description: 'Auto-open browser on start'
            },
            liveBridge: {
              type: 'boolean' as const,
              description: 'Enable WebSocket live updates'
            }
          }
        },
        uiConfig: {
          type: 'object' as const,
          properties: {
            type: {
              type: 'string' as const,
              enum: ['web', 'terminal', 'both'],
              description: 'UI display type'
            },
            framework: {
              type: 'string' as const,
              enum: ['express', 'fastapi', 'flask', 'nextjs'],
              description: 'Web framework to use'
            },
            autoStart: {
              type: 'boolean' as const,
              description: 'Start UI server automatically'
            }
          }
        },
        artifactConfig: {
          type: 'object' as const,
          properties: {
            type: {
              type: 'string' as const,
              enum: ['docker', 'local', 'nix'],
              description: 'Artifact type'
            },
            nixConfig: {
              type: 'object' as const,
              properties: {
                packages: {
                  type: 'array' as const,
                  items: { type: 'string' as const },
                  description: 'Nix packages to install'
                },
                shellHook: {
                  type: 'string' as const,
                  description: 'Shell initialization script'
                }
              }
            }
          }
        }
      },
      required: ['name' as const, 'description' as const, 'parameters' as const, 'implementation' as const]
    };

    super(
      'CreateArtifactTool',
      'CreateArtifactTool',
      'Create persistent artifacts (web apps, tools, scripts) with hot reload, UV/NIX support, and auto UI display. Enable visual feedback to see your own creations: capture screenshots, DOM structure, console logs, network activity, and performance metrics. Use this data to iteratively improve and debug your work.',
      schema
    );

    this.workingDirectory = config.workingDirectory;
    // Use unified artifacts directory structure
    this.artifactDir = join(config.workingDirectory, '.cortex', 'artifacts');

    // Initialize unified artifact registry (singleton)
    const registry = ArtifactRegistry.getInstance(config.workingDirectory);
    registry.initialize().catch((error: any) => {
      console.error(`⚠  Failed to initialize ArtifactRegistry: ${error.message}`);
    });

    // Also initialize sandbox registry for backwards compatibility
    const sandboxRegistry = SandboxRegistry.getInstance(config.workingDirectory);
    sandboxRegistry.initialize().catch((error: any) => {
      console.error(`⚠  Failed to initialize SandboxRegistry: ${error.message}`);
    });
  }

  /**
   * Sanitize name to filesystem-safe format (kebab-case slug)
   * Industry best practice: Accept human-friendly input, auto-convert to system-safe format
   */
  private sanitizeName(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with hyphens
      .replace(/^-+|-+$/g, '')      // Remove leading/trailing hyphens
      .replace(/-{2,}/g, '-')       // Collapse multiple hyphens
      || 'unnamed-tool';             // Fallback if empty after sanitization
  }

  validateToolParams(params: CreateArtifactToolParams): string | null {
    // Basic validation
    if (!params.name || params.name.trim().length === 0) {
      return 'name must be a non-empty string';
    }

    // #18 — restore 64-char name cap (dropped during the CreateAddonTool →
    // CreateArtifactTool rename refactor; unanimously diagnosed as a silent
    // regression by the round-10 multi-agent audit). Checked BEFORE
    // sanitization so callers see the same length contract they passed in;
    // sanitization would only shrink a too-long name, masking the error.
    if (params.name.length > 64) {
      return 'name must be 64 characters or less';
    }

    // Auto-sanitize name instead of rejecting
    // This accepts "Stock Chart App" and converts to "stock-chart-app"
    const originalName = params.name;
    params.name = this.sanitizeName(params.name);

    if (params.name.length === 0 || params.name === 'unnamed-tool') {
      return `name "${originalName}" contains no valid characters (letters, numbers)`;
    }

    if (!params.description || params.description.trim().length === 0) {
      return 'description must be a non-empty string';
    }

    if (!params.implementation?.code) {
      return 'implementation.code is required';
    }

    if (!['javascript', 'python'].includes(params.implementation.language)) {
      return 'language must be javascript or python';
    }

    // Validate package manager
    if (params.implementation.packageManager) {
      const validManagers = ['npm', 'pip', 'uv', 'nix'];
      if (!validManagers.includes(params.implementation.packageManager)) {
        return `packageManager must be one of: ${validManagers.join(', ')}`;
      }
    }

    // Validate mode
    if (params.mode && !['oneshot', 'dev', 'persistent'].includes(params.mode)) {
      return 'mode must be oneshot, dev, or persistent';
    }

    return null;
  }

  async execute(params: CreateArtifactToolParams, signal: AbortSignal): Promise<ToolResult> {
    const startTime = Date.now();
    const originalName = params.name; // Preserve original before sanitization

    const validationError = this.validateToolParams(params);
    if (validationError) {
      return this.createErrorResult(validationError);
    }

    // Notify if name was sanitized
    const nameSanitized = originalName !== params.name;

    try {
      await fs.mkdir(this.artifactDir, { recursive: true });

      const mode = params.mode || 'oneshot';
      const artifactId = randomUUID();

      // Create artifact directory with workspace subdirectory
      const artifactPath = join(this.artifactDir, artifactId);
      const workspacePath = join(artifactPath, 'workspace');

      await fs.mkdir(artifactPath, { recursive: true });
      await fs.mkdir(workspacePath, { recursive: true });
      await fs.mkdir(join(artifactPath, 'snapshots'), { recursive: true });

      // Install dependencies in workspace
      await this.installDependencies(
        params.implementation,
        workspacePath,
        signal
      );

      // Write code files to workspace
      await this.writeToolFiles(
        params.implementation,
        params.uiConfig,
        workspacePath
      );

      // Launch artifact based on mode
      let session: ArtifactSession | null = null;

      if (mode === 'dev' || mode === 'persistent') {
        session = await this.launchPersistentArtifact(
          artifactId,
          params,
          workspacePath,
          signal
        );
      } else {
        // Oneshot execution
        const result = await this.executeOneshot(
          params.implementation,
          workspacePath,
          signal
        );

        await fs.rm(artifactPath, { recursive: true, force: true });

        return {
          ...this.createSuccessResult(result.output),
          metadata: {
            executionTime: Date.now() - startTime,
            toolName: params.name,
            mode: 'oneshot',
            success: result.success
          }
        };
      }

      // Format output for persistent/dev mode
      const output = this.formatPersistentOutput(session!, params, nameSanitized ? originalName : undefined);

      return {
        ...this.createSuccessResult(output),
        metadata: {
          executionTime: Date.now() - startTime,
          toolName: params.name,
          originalName: nameSanitized ? originalName : undefined,
          sanitized: nameSanitized,
          mode,
          artifactId: session!.id,
          url: session!.url,
          port: session!.port,
          status: 'running',
          visualFeedbackEnabled: params.enableVisualFeedback || false,
          hasVisualSnapshot: !!session!.visualSnapshot
        }
      };
    } catch (error) {
      return this.createErrorResult(`Failed to create addon tool: ${(error as Error).message}`);
    }
  }

  /**
   * Install dependencies using specified package manager
   */
  private async installDependencies(
    implementation: CreateArtifactToolParams['implementation'],
    artifactPath: string,
    signal: AbortSignal
  ): Promise<void> {
    if (!implementation.dependencies || implementation.dependencies.length === 0) {
      return;
    }

    const packageManager = implementation.packageManager ||
      (implementation.language === 'javascript' ? 'npm' : 'pip');

    switch (packageManager) {
      case 'npm':
        await this.installNpm(implementation.dependencies, artifactPath, signal);
        break;
      case 'pip':
        await this.installPip(implementation.dependencies, artifactPath, signal);
        break;
      case 'uv':
        await this.installUv(implementation.dependencies, artifactPath, signal);
        break;
      case 'nix':
        // Nix handles dependencies declaratively in shell.nix
        await this.setupNix(implementation.dependencies, artifactPath);
        break;
    }
  }

  /**
   * Install with npm
   */
  private async installNpm(deps: string[], artifactPath: string, signal: AbortSignal): Promise<void> {
    const packageJson = {
      name: 'addon-tool',
      version: '1.0.0',
      dependencies: Object.fromEntries(deps.map(d => [d, 'latest']))
    };

    await fs.writeFile(
      join(artifactPath, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    );

    await this.runCommand('npm', ['install'], artifactPath, signal);
  }

  /**
   * Install with pip
   */
  private async installPip(deps: string[], artifactPath: string, signal: AbortSignal): Promise<void> {
    await fs.writeFile(
      join(artifactPath, 'requirements.txt'),
      deps.join('\n')
    );

    await this.runCommand('pip3', ['install', '-r', 'requirements.txt'], artifactPath, signal);
  }

  /**
   * Install with UV (fast Python package manager)
   */
  private async installUv(deps: string[], artifactPath: string, signal: AbortSignal): Promise<void> {
    // Check if UV is installed
    try {
      await execAsync('uv --version');
    } catch {
      throw new Error('UV is not installed. Install with: curl -LsSf https://astral.sh/uv/install.sh | sh');
    }

    await fs.writeFile(
      join(artifactPath, 'requirements.txt'),
      deps.join('\n')
    );

    // UV is 10-100x faster than pip
    await this.runCommand('uv', ['pip', 'install', '-r', 'requirements.txt'], artifactPath, signal);
  }

  /**
   * Setup Nix environment
   */
  private async setupNix(deps: string[], artifactPath: string): Promise<void> {
    // Create shell.nix for declarative environment
    const shellNix = `
{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    ${deps.map(d => ` ${d}`).join('\n')}
  ];

  shellHook = ''
    echo "Nix environment activated"
    echo "Packages: ${deps.join(', ')}"
  '';
}
`;

    await fs.writeFile(join(artifactPath, 'shell.nix'), shellNix);
  }

  /**
   * Write tool files to artifact
   */
  private async writeToolFiles(
    implementation: CreateArtifactToolParams['implementation'],
    uiConfig: CreateArtifactToolParams['uiConfig'],
    artifactPath: string
  ): Promise<void> {
    // Detect if code is HTML (starts with <!DOCTYPE or <html)
    const isHtml = implementation.code.trim().match(/^<!DOCTYPE|^<html/i);

    let fileName: string;
    let code = implementation.code;

    if (isHtml) {
      // HTML file - save as index.html
      fileName = 'index.html';
    } else {
      // Regular script file
      fileName = implementation.language === 'javascript' ? 'index.js' : 'main.py';

      // If UI framework specified, wrap code with framework boilerplate
      if (uiConfig?.framework) {
        code = this.wrapWithFramework(implementation.code, uiConfig.framework, implementation.language);
      } else {
        // Post-process: Replace hardcoded ports with process.env.PORT for Node.js/Python servers
        // This ensures artifacts use dynamically assigned ports instead of hardcoded values
        if (implementation.language === 'javascript') {
          // Replace common Node.js/Express server port patterns
          code = code
            // Match: server.listen(3000) or server.listen(3000, ...)
            .replace(/\.listen\((\d{4,5})(\s*[,)])/g, '.listen(process.env.PORT || $1$2')
            // Match: const PORT = 3000
            .replace(/\b(const|let|var)\s+PORT\s*=\s*(\d{4,5})\b/g, '$1 PORT = process.env.PORT || $2')
            // Match: app.listen(3000)
            .replace(/app\.listen\((\d{4,5})(\s*[,)])/g, 'app.listen(process.env.PORT || $1$2');

          console.log(`[CreateArtifactTool] Post-processed JavaScript code to use process.env.PORT`);
        } else if (implementation.language === 'python') {
          // Replace common Flask/FastAPI port patterns
          code = code
            // Match: app.run(port=5000)
            .replace(/\.run\((.*?)port\s*=\s*(\d{4,5})/g, (match, before, port) => {
              return `.run(${before}port=int(os.getenv('PORT', ${port}))`;
            })
            // Match: uvicorn.run(..., port=8000)
            .replace(/uvicorn\.run\((.*?)port\s*=\s*(\d{4,5})/g, (match, before, port) => {
              return `uvicorn.run(${before}port=int(os.getenv('PORT', ${port}))`;
            });

          // Ensure os module is imported
          if (!code.includes('import os')) {
            code = 'import os\n' + code;
          }

          console.log(`[CreateArtifactTool] Post-processed Python code to use os.getenv('PORT')`);
        }
      }
    }

    const filePath = join(artifactPath, fileName);
    await fs.writeFile(filePath, code);
  }

  /**
   * Wrap user code with web framework boilerplate
   */
  private wrapWithFramework(code: string, framework: string, language: string): string {
    if (language === 'javascript') {
      switch (framework) {
        case 'express':
          return `
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// User code
${code}

// Default route
app.get('/', (req, res) => {
  res.send('<h1>Tool Running</h1><p>Port: ' + PORT + '</p>');
});

app.listen(PORT, () => {
  console.log(\` Server running at http://localhost:\${PORT}\`);
});
`;
        case 'nextjs':
          return `
// Next.js API route wrapper
${code}

export default async function handler(req, res) {
  const result = await main(req.body || req.query);
  res.status(200).json(result);
}
`;
        default:
          return code;
      }
    } else {
      // Python
      switch (framework) {
        case 'fastapi':
          return `
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
import uvicorn

app = FastAPI()

# User code
${code}

@app.get("/", response_class=HTMLResponse)
async def root():
    return "<h1>Tool Running</h1><p>Port: 8000</p>"

if __name__ == "__main__":
    print(" Server running at http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)
`;
        case 'flask':
          return `
from flask import Flask, request, jsonify
app = Flask(__name__)

# User code
${code}

@app.route('/')
def index():
    return '<h1>Tool Running</h1><p>Port: 5000</p>'

if __name__ == '__main__':
    print(' Server running at http://localhost:5000')
    app.run(host='0.0.0.0', port=5000, debug=True)
`;
        default:
          return code;
      }
    }
  }

  /**
   * Find an available port starting from a base port
   */
  private async findAvailablePort(startPort: number = 3000): Promise<number> {
    const net = await import('net');

    const isPortAvailable = (port: number): Promise<boolean> => {
      return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
          server.close();
          resolve(true);
        });
        server.listen(port);
      });
    };

    let port = startPort;
    while (port < startPort + 100) {
      if (await isPortAvailable(port)) {
        return port;
      }
      port++;
    }

    throw new Error(`No available ports found in range ${startPort}-${startPort + 99}`);
  }

  /**
   * Launch persistent artifact with tmux integration
   * Supports arbitrary languages and custom commands
   */
  private async launchPersistentArtifact(
    artifactId: string,
    params: CreateArtifactToolParams,
    artifactPath: string,
    signal: AbortSignal
  ): Promise<ArtifactSession> {
    let fileName: string;
    let command: string;
    let runtime: ArtifactRuntime;

    // If user provides custom command, use it directly
    if (params.implementation.command) {
      command = params.implementation.command;
      fileName = params.implementation.fileName || params.implementation.entryPoint || 'artifact';
      runtime = `tmux+custom`;
    } else {
      // Auto-detect based on language or content
      const isHtml = params.implementation.code.trim().match(/^<!DOCTYPE|^<html/i);

      if (isHtml || params.implementation.language === 'html') {
        // HTML file - serve with http-server
        fileName = params.implementation.fileName || 'index.html';
        command = `npx http-server -p ${params.artifactConfig?.ports?.[0] || 3000} --silent`;
        runtime = 'tmux+http-server';
      } else if (params.implementation.language === 'javascript') {
        fileName = params.implementation.fileName || 'index.js';
        command = `node ${fileName}`;
        runtime = 'tmux+node';
      } else if (params.implementation.language === 'python') {
        fileName = params.implementation.fileName || 'main.py';
        command = `python3 ${fileName}`;
        runtime = 'tmux+python';
      } else if (params.implementation.language === 'rust') {
        fileName = params.implementation.fileName || 'main.rs';
        command = params.implementation.buildCommand
          ? `${params.implementation.buildCommand} && cargo run --release`
          : 'cargo run';
        runtime = 'tmux+rust';
      } else if (params.implementation.language === 'go') {
        fileName = params.implementation.fileName || 'main.go';
        command = params.implementation.buildCommand
          ? `${params.implementation.buildCommand} && ./artifact`
          : `go run ${fileName}`;
        runtime = 'tmux+go';
      } else if (params.implementation.language === 'shell') {
        fileName = params.implementation.fileName || 'run.sh';
        command = `chmod +x ${fileName} && ./${fileName}`;
        runtime = 'tmux+shell';
      } else {
        // Generic/other - use custom command or fail
        fileName = params.implementation.fileName || 'artifact';
        command = params.implementation.command || `echo "No command specified for language: ${params.implementation.language}"`;
        runtime = 'tmux+other';
      }
    }

    // Find an available port dynamically
    // Port 4000 = API server, Port 4001 = Dashboard
    // Artifacts start from port 3000 and increment (3000, 3001, 3002, etc.)
    const requestedPort = params.artifactConfig?.ports?.[0] || 3000;
    const port = await this.findAvailablePort(requestedPort);
    const url = `http://localhost:${port}`;

    // Update command with actual port if it's http-server or contains port reference
    if (command.includes('http-server')) {
      command = command.replace(/\-p \d+/, `-p ${port}`);
    }

    // For Node.js/JavaScript artifacts, inject PORT environment variable
    if (runtime === 'tmux+node' || params.implementation.language === 'javascript') {
      command = `PORT=${port} ${command}`;
    }

    // For Python artifacts, inject PORT environment variable
    if (runtime === 'tmux+python' || params.implementation.language === 'python') {
      command = `PORT=${port} ${command}`;
    }

    // Initialize tmux manager
    const tmuxManager = TmuxManager.getInstance();

    // Check if tmux is available
    const tmuxAvailable = await tmuxManager.isAvailable();
    if (!tmuxAvailable) {
      throw new Error('tmux is not installed. Persistent mode requires tmux for session management.');
    }

    // Create tmux session with artifact ID as session name
    const tmuxSessionId = `artifact-${artifactId.substring(0, 8)}`;
    await tmuxManager.createSession(tmuxSessionId, artifactPath);

    // Send command to tmux session
    await tmuxManager.sendKeys(tmuxSessionId, command);

    // Wait a moment for process to start
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Save tmux session metadata for dashboard
    const sessionPersistence = new SessionPersistence(this.workingDirectory);
    await sessionPersistence.saveSession({
      sessionId: tmuxSessionId,
      created: new Date(),
      lastUsed: new Date(),
      cwd: artifactPath,
      env: {}
    });

    const session: ArtifactSession = {
      id: artifactId,
      name: params.name,
      tmuxSessionId,
      url,
      port,
      mode: params.mode || 'persistent',
      startTime: new Date(),
      lastActivity: new Date(),
      watchers: []
    };

    // Store session in memory
    activeArtifactes.set(artifactId, session);

    // Store in unified artifact registry
    const artifactRegistry = ArtifactRegistry.getInstance(this.workingDirectory);

    await artifactRegistry.register({
      id: artifactId,
      name: params.name,
      type: 'web-app',
      runtime,
      created: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      workspaceDir: artifactPath,
      entryPoint: fileName,
      mode: params.mode || 'persistent',
      port,
      url,
      tmuxSession: tmuxSessionId,
      description: params.description
    });

    // Also store in sandbox registry for backwards compatibility
    const sandboxRegistry = SandboxRegistry.getInstance(this.workingDirectory);
    await sandboxRegistry.register({
      id: artifactId,
      name: params.name,
      port,
      url,
      pid: undefined, // No PID for tmux sessions, use tmux session ID instead
      mode: params.mode || 'persistent',
      startTime: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      path: artifactPath
    });

    // Emit artifact created event
    broadcaster.emitSandboxEvent({
      type: 'sandbox-created',
      sandboxId: session.id,
      timestamp: Date.now(),
      data: {
        name: session.name,
        url: session.url,
        mode: session.mode,
        port: session.port,
        tmuxSession: tmuxSessionId
      }
    });

    // Start view server if not already running
    if (!viewServer.isServerRunning()) {
      await viewServer.start().catch(err => {
        console.warn('Could not start view server:', err);
      });
    }

    // Setup hot reload if dev mode
    if (params.mode === 'dev' && params.devConfig?.hotReload) {
      await this.setupHotReload(session, artifactPath, fileName, command, params.enableVisualFeedback);
    }

    // Open browser if requested
    if (params.devConfig?.openBrowser) {
      await this.openBrowser(url);
    }

    // Initialize visual feedback if requested
    if (params.enableVisualFeedback) {
      await this.initializeVisualFeedback(session, params);
    }

    // Log tmux session info
    console.log(`[${params.name}] Running in tmux session: ${tmuxSessionId}`);
    console.log(`[${params.name}] Access at: ${url}`);
    console.log(`[${params.name}] View output: tmux attach -t ${tmuxSessionId}`);

    return session;
  }

  /**
   * Setup hot reload with file watching
   */
  private async setupHotReload(
    session: ArtifactSession,
    artifactPath: string,
    fileName: string,
    command: string,
    enableVisualFeedback?: boolean
  ): Promise<void> {
    const filePath = join(artifactPath, fileName);

    const watcher = watch(filePath, async (eventType) => {
      if (eventType === 'change') {
        console.log(` File changed, reloading ${session.name}...`);

        // Emit file changed event
        broadcaster.emitFileChange(session.id, fileName, 'modified');

        // Emit hot reload triggered event
        broadcaster.emitHotReload(session.id, fileName);

        // Kill old process
        session.process?.kill();

        // Start new process
        const newProcess = spawn(command, [fileName], {
          cwd: artifactPath,
          stdio: ['pipe', 'pipe', 'pipe']
        });

        session.process = newProcess;
        session.lastActivity = new Date();

        console.log(`[OK] ${session.name} reloaded`);

        // Emit process restarted event
        broadcaster.emitProcessRestart(session.id, 'Hot reload triggered');

        // Capture new visual snapshot after reload
        if (enableVisualFeedback && session.url) {
          // Wait for server to restart
          await new Promise(resolve => setTimeout(resolve, 2000));

          try {
            console.log(` Capturing updated visual snapshot...`);
            session.visualSnapshot = await visualBridge.captureSnapshot(session.url);
            console.log(`[OK] Visual snapshot updated`);

            // Emit screenshot captured event
            broadcaster.emitScreenshot(session.id, session.visualSnapshot.screenshot, session.url);
          } catch (error) {
            console.warn(`⚠  Could not update visual snapshot: ${error}`);
            broadcaster.emitError(session.id, error as Error);
          }
        }
      }
    });

    session.watchers = [watcher];
  }

  /**
   * Initialize visual feedback bridge
   */
  private async initializeVisualFeedback(
    session: ArtifactSession,
    params: CreateArtifactToolParams
  ): Promise<void> {
    try {
      // Initialize Playwright browser
      await visualBridge.initialize();

      // Opt-in React introspection: inject the fiber pre-load BEFORE the first
      // navigation so the initial snapshot carries the framework report.
      if (params.enableReactIntrospection) {
        await visualBridge.enableReactIntrospection();
      }

      // Wait for server to be ready (give it 2 seconds)
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Capture initial snapshot
      if (session.url) {
        console.log(` Capturing visual snapshot of ${params.name}...`);
        session.visualSnapshot = await visualBridge.captureSnapshot(session.url);
        console.log(`[OK] Visual snapshot captured (${session.visualSnapshot.screenshot.length} bytes)`);

        // Emit screenshot captured event
        broadcaster.emitScreenshot(session.id, session.visualSnapshot.screenshot, session.url);
      }
    } catch (error) {
      console.warn(`⚠  Could not capture visual snapshot: ${error}`);
      broadcaster.emitError(session.id, error as Error);
    }
  }

  /**
   * Open browser automatically
   */
  private async openBrowser(url: string): Promise<void> {
    const platform = process.platform;
    let command: string;

    if (platform === 'darwin') {
      command = `open ${url}`;
    } else if (platform === 'win32') {
      command = `start ${url}`;
    } else {
      command = `xdg-open ${url}`;
    }

    try {
      await execAsync(command);
      console.log(` Opened browser at ${url}`);
    } catch (error) {
      console.warn(`Could not open browser: ${error}`);
    }
  }

  /**
   * Execute tool in oneshot mode
   */
  private async executeOneshot(
    implementation: CreateArtifactToolParams['implementation'],
    artifactPath: string,
    signal: AbortSignal
  ): Promise<{ success: boolean; output: string }> {
    const fileName = implementation.language === 'javascript' ? 'index.js' : 'main.py';
    const command = implementation.language === 'javascript' ? 'node' : 'python3';

    const result = await this.runCommand(command, [fileName], artifactPath, signal);

    return {
      success: result.exitCode === 0,
      output: result.stdout
    };
  }

  /**
   * Run command and capture output
   */
  private async runCommand(
    command: string,
    args: string[],
    cwd: string,
    signal: AbortSignal
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const child = spawn(command, args, { cwd });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (exitCode) => {
        resolve({ stdout, stderr, exitCode: exitCode || 0 });
      });

      signal.addEventListener('abort', () => {
        child.kill();
      });
    });
  }

  /**
   * Format output for persistent/dev artifact
   */
  private formatPersistentOutput(
    session: ArtifactSession,
    params: CreateArtifactToolParams,
    originalName?: string
  ): string {
    const lines: string[] = [];

    lines.push(`#  ${params.name} - ${params.mode?.toUpperCase()} MODE`);
    lines.push('');

    // Notify if name was auto-sanitized
    if (originalName && originalName !== params.name) {
      lines.push(`_Note: Name auto-sanitized from "${originalName}" to "${params.name}" (filesystem-safe format)_`);
      lines.push('');
    }

    lines.push(`**Status**: Running`);
    lines.push(`**URL**: ${session.url}`);
    lines.push(`**Port**: ${session.port}`);
    lines.push(`**Artifact ID**: ${session.id}`);
    lines.push('');

    if (params.mode === 'dev') {
      lines.push('## Dev Mode Features');
      lines.push('');
      if (params.devConfig?.hotReload) {
        lines.push('[OK] Hot reload enabled');
      }
      if (params.devConfig?.openBrowser) {
        lines.push('[OK] Browser auto-opened');
      }
      if (params.devConfig?.liveBridge) {
        lines.push('[OK] Live WebSocket updates');
      }
      lines.push('');
    }

    lines.push('## Package Manager');
    lines.push('');
    lines.push(`**Manager**: ${params.implementation.packageManager || 'default'}`);
    if (params.implementation.dependencies) {
      lines.push(`**Dependencies**: ${params.implementation.dependencies.join(', ')}`);
    }
    lines.push('');

    lines.push('## Access');
    lines.push('');
    lines.push(`**Artifact URL**: ${session.url}`);
    lines.push(`**View Dashboard**: ${viewServer.getViewUrl(session.id)}`);
    lines.push('');
    lines.push('The dashboard provides:');
    lines.push('- Live preview of artifact UI');
    lines.push('- Real-time console logs');
    lines.push('- Screenshot history');
    lines.push('- Network request monitoring');
    lines.push('');

    if (params.mode === 'dev') {
      lines.push('Edit files in the artifact to see live updates in both the artifact and dashboard!');
    }

    // Include visual snapshot if available
    if (session.visualSnapshot) {
      lines.push('');
      lines.push('---');
      lines.push('');
      lines.push('##  Visual Snapshot');
      lines.push('');
      lines.push('The model can now SEE its creation!');
      lines.push('');
      lines.push(visualBridge.formatForModel(session.visualSnapshot));
      lines.push('');
      lines.push('**Note**: The model can use this visual feedback to iterate and improve the tool.');
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Get active artifact by ID
   */
  public static getActiveArtifact(id: string): ArtifactSession | undefined {
    return activeArtifactes.get(id);
  }

  /**
   * List all active artifactes
   */
  public static listActiveArtifactes(): ArtifactSession[] {
    return Array.from(activeArtifactes.values());
  }

  /**
   * Get all active artifactes (alias for listActiveArtifactes)
   */
  public static getActiveArtifactes(): ArtifactSession[] {
    return Array.from(activeArtifactes.values());
  }

  /**
   * Stop a artifact
   */
  public static stopArtifact(id: string): boolean {
    const session = activeArtifactes.get(id);
    if (!session) return false;

    session.process?.kill();
    session.watchers?.forEach(w => w.close());
    activeArtifactes.delete(id);

    return true;
  }

  /**
   * Get visual snapshot for a artifact
   */
  public static getVisualSnapshot(id: string): VisualSnapshot | undefined {
    const session = activeArtifactes.get(id);
    return session?.visualSnapshot;
  }

  /**
   * Capture fresh visual snapshot for a running artifact
   */
  public static async refreshVisualSnapshot(id: string): Promise<VisualSnapshot | null> {
    const session = activeArtifactes.get(id);
    if (!session || !session.url) return null;

    try {
      await visualBridge.initialize();
      session.visualSnapshot = await visualBridge.captureSnapshot(session.url);
      return session.visualSnapshot;
    } catch (error) {
      console.error(`Failed to refresh visual snapshot: ${error}`);
      return null;
    }
  }

  // ===== BACKWARDS COMPATIBILITY ALIASES (for sandbox tools) =====
  /**
   * @deprecated Use getActiveArtifact instead
   */
  public static getActiveSandbox(id: string): ArtifactSession | undefined {
    return this.getActiveArtifact(id);
  }

  /**
   * @deprecated Use listActiveArtifactes instead
   */
  public static getActiveSandboxes(): ArtifactSession[] {
    return this.listActiveArtifactes();
  }

  /**
   * @deprecated Use listActiveArtifactes instead
   */
  public static listActiveSandboxes(): ArtifactSession[] {
    return this.listActiveArtifactes();
  }

  /**
   * @deprecated Use stopArtifact instead
   */
  public static stopSandbox(id: string): boolean {
    return this.stopArtifact(id);
  }
}
