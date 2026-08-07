/**
 * Core Stubs for Nexus Cortex Ink UI
 *
 * This provides minimal stubs for the gemini-cli core library exports
 * that are used by the ink-ui components. As we integrate more of the
 * ink-ui, we can add more exports here or replace them with real implementations.
 */

// Debug logger stub - logs to stderr in debug mode
export const debugLogger = {
  log: (...args: unknown[]) => {
    if (process.env['DEBUG'] === 'true' || process.env['DEBUG'] === '1') {
      console.error('[DEBUG]', ...args);
    }
  },
  error: (...args: unknown[]) => {
    console.error('[ERROR]', ...args);
  },
  warn: (...args: unknown[]) => {
    if (process.env['DEBUG'] === 'true' || process.env['DEBUG'] === '1') {
      console.error('[WARN]', ...args);
    }
  },
};

// Config interface stub
export interface Config {
  theme?: string;
  yoloMode?: boolean;
  debugMode?: boolean;
  sandboxMode?: string;
  storage?: Storage;

  // Methods
  getProjectRoot(): string;
  getSessionId(): string;
  getGeminiClient?(): { setHistory: (history: Content[]) => void } | undefined;
}

// Core events stub (minimal for now)
export enum CoreEvent {
  FolderTrustChanged = 'folder-trust-changed',
  ConfigChanged = 'config-changed',
  SessionStarted = 'session-started',
  SessionEnded = 'session-ended',
  ExternalEditorClosed = 'external-editor-closed',
}

import { EventEmitter } from 'node:events';
export const coreEvents = new EventEmitter();

// Mouse event control stubs - these are used by mouse.ts
// In a real implementation, these would write ANSI escape codes to stdout
export const enableMouseEvents = () => {
  // Enable SGR mouse mode: ESC[?1000h (button events) ESC[?1002h (button + motion) ESC[?1006h (SGR extended)
  process.stdout.write('\x1b[?1000h\x1b[?1002h\x1b[?1006h');
};

export const disableMouseEvents = () => {
  // Disable mouse mode
  process.stdout.write('\x1b[?1000l\x1b[?1002l\x1b[?1006l');
};

// Write to stdout helper
export const writeToStdout = (data: string) => {
  process.stdout.write(data);
};

// Session ID stub
export const sessionId = `session-${Date.now()}`;

// Utility functions
export const unescapePath = (path: string): string => {
  return path.replace(/\\ /g, ' ').replace(/\\([\\])/g, '$1');
};

export const escapePath = (path: string): string => {
  return path.replace(/ /g, '\\ ').replace(/\\/g, '\\\\');
};

// Spawn async stub
export const spawnAsync = async (
  command: string,
  args: string[],
  _options?: { cwd?: string; env?: Record<string, string> }
): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve) => {
    const proc = spawn(command, args, { shell: true });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (data) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data) => { stderr += data.toString(); });
    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
};

// Storage stub
export class Storage {
  private basePath: string;
  private data = new Map<string, string>();

  constructor(basePath: string = process.cwd()) {
    this.basePath = basePath;
  }

  get(key: string): string | undefined {
    return this.data.get(key);
  }

  set(key: string, value: string): void {
    this.data.set(key, value);
  }

  delete(key: string): void {
    this.data.delete(key);
  }

  getBasePath(): string {
    return this.basePath;
  }
}

// GitService stub
export class GitService {
  private projectRoot: string;

  constructor(projectRoot: string, _storage: Storage) {
    this.projectRoot = projectRoot;
  }

  getProjectRoot(): string {
    return this.projectRoot;
  }

  async getStatus(): Promise<string> {
    return '';
  }

  async getCurrentBranch(): Promise<string> {
    return 'main';
  }
}

// Logger stub
export class Logger {
  private sessionId: string;

  constructor(sessionId: string, _storage: Storage) {
    this.sessionId = sessionId;
  }

  log(...args: unknown[]): void {
    if (process.env['DEBUG'] === 'true' || process.env['DEBUG'] === '1') {
      console.log(`[${this.sessionId}]`, ...args);
    }
  }

  error(...args: unknown[]): void {
    console.error(`[${this.sessionId}]`, ...args);
  }

  async initialize(): Promise<void> {
    // No-op for stub
  }
}

// SlashCommand telemetry stubs
export enum SlashCommandStatus {
  SUCCESS = 'success',
  ERROR = 'error',
}

export interface SlashCommandEvent {
  command: string;
  subcommand?: string;
  status: SlashCommandStatus;
  extension_id?: string;
}

export function makeSlashCommandEvent(data: SlashCommandEvent): SlashCommandEvent {
  return data;
}

export function logSlashCommand(_config: Config, _event: SlashCommandEvent): void {
  // No-op for stub - would send telemetry in real implementation
}

// Tool confirmation stub
export enum ToolConfirmationOutcome {
  Proceed = 'proceed',
  ProceedAlways = 'proceed_always',
  Cancel = 'cancel',
}

// IdeClient stub (singleton)
let ideClientInstance: IdeClientClass | null = null;

export class IdeClientClass {
  private statusChangeListeners: (() => void)[] = [];

  static async getInstance(): Promise<IdeClientClass> {
    if (!ideClientInstance) {
      ideClientInstance = new IdeClientClass();
    }
    return ideClientInstance;
  }

  addStatusChangeListener(listener: () => void): void {
    this.statusChangeListeners.push(listener);
  }

  removeStatusChangeListener(listener: () => void): void {
    const index = this.statusChangeListeners.indexOf(listener);
    if (index >= 0) {
      this.statusChangeListeners.splice(index, 1);
    }
  }
}

export const IdeClient = {
  connect: async () => null,
  getInstance: async (): Promise<IdeClientClass> => IdeClientClass.getInstance(),
}

// Node error check
export const isNodeError = (error: unknown): error is NodeJS.ErrnoException => {
  return error instanceof Error && 'code' in error;
};

// Session metrics types
export interface ToolCallStats {
  count: number;
  success: number;
  fail: number;
  durationMs: number;
  decisions: Record<string, number>;
}

export interface ModelMetrics {
  api: {
    totalRequests: number;
    totalErrors: number;
    totalLatencyMs: number;
  };
  tokens: {
    prompt: number;
    candidates: number;
    total: number;
    cached: number;
    thoughts: number;
    tool: number;
  };
}

export interface SessionMetrics {
  models: Record<string, ModelMetrics>;
  tools: {
    totalCalls: number;
    totalSuccess: number;
    totalFail: number;
    totalDurationMs: number;
    totalDecisions: Record<string, number>;
    byName: Record<string, ToolCallStats>;
  };
  files: {
    totalLinesAdded: number;
    totalLinesRemoved: number;
  };
}

// Type exports for compatibility
export type Part = { text?: string; inlineData?: unknown };
export type PartUnion = Part;
export type PartListUnion = Part[] | string;
export type Content = { role: string; parts: Part[] };
export type AnsiOutput = { lines: AnsiLine[] };
export type AnsiLine = { tokens: AnsiToken[] };
export type AnsiToken = { text: string; style?: string };
export type IdeInfo = { name: string; version: string };
export type IdeContext = { ide?: IdeInfo };
export type MCPServerConfig = { command: string; args?: string[] };
export type McpClient = { name: string; status: string };
export type DiscoveredMCPPrompt = { name: string; description?: string };
export type AnyToolInvocation = { name: string; input: unknown };
export type FileSearch = { search: (query: string) => Promise<string[]> };
export type EditorType = 'vscode' | 'cursor' | 'windsurf' | 'other';
export type AuthType = 'api-key' | 'oauth';
export type ResumedSessionData = { messages: Content[] };
export type GeminiCLIExtension = { name: string; version: string };
export type CompressionStatus = 'pending' | 'compressing' | 'complete' | 'error';
export type ThoughtSummary = { content: string; tokenCount: number };
export type ToolCallConfirmationDetails = {
  toolName: string;
  args: Record<string, unknown>;
  description?: string;
};
export type ToolResultDisplay = {
  toolName: string;
  result: string;
  success: boolean;
};

// Enums
export enum ApprovalMode {
  Suggest = 'suggest',
  AutoApprove = 'auto-approve',
}

export enum MCPServerStatus {
  Connected = 'connected',
  Disconnected = 'disconnected',
  Error = 'error',
}

export enum FinishReason {
  Stop = 'stop',
  Length = 'length',
  ContentFilter = 'content_filter',
}

// Tool names
export const SHELL_TOOL_NAME = 'Bash';

// Factory/service stubs
export const FileSearchFactory = {
  create: (): FileSearch => ({
    search: async () => [],
  }),
};

export const ShellExecutionService = {
  execute: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
};

export const CoreToolScheduler = class {
  schedule() { return Promise.resolve(); }
};

// Utility function stubs
export const getPackageJson = (): { version: string } => ({ version: '4.0.0' });
export const getResponseText = (content: Content): string => {
  return content.parts.map(p => p.text || '').join('');
};
export const partListUnionToString = (parts: PartListUnion): string => {
  if (typeof parts === 'string') return parts;
  return parts.map((p: Part) => p.text || '').join('');
};
export const decodeTagName = (name: string): string => name;
export const isBinary = (_path: string): boolean => false;
export const listExtensions = async (): Promise<GeminiCLIExtension[]> => [];
export const refreshServerHierarchicalMemory = async (): Promise<void> => {};
export const recordFlickerFrame = (): void => {};

// Telemetry stub
type TelemetryListener = (data: { metrics: SessionMetrics; lastPromptTokenCount: number }) => void;
const telemetryListeners = new Map<string, TelemetryListener[]>();

export const uiTelemetryService = {
  recordEvent: () => {},
  flush: async () => {},
  getMetrics: (): SessionMetrics => ({
    models: {},
    tools: {
      totalCalls: 0,
      totalSuccess: 0,
      totalFail: 0,
      totalDurationMs: 0,
      totalDecisions: {},
      byName: {},
    },
    files: {
      totalLinesAdded: 0,
      totalLinesRemoved: 0,
    },
  }),
  getLastPromptTokenCount: (): number => 0,
  on: (_event: string, listener: TelemetryListener) => {
    const listeners = telemetryListeners.get(_event) || [];
    listeners.push(listener);
    telemetryListeners.set(_event, listeners);
  },
  off: (_event: string, listener: TelemetryListener) => {
    const listeners = telemetryListeners.get(_event) || [];
    const index = listeners.indexOf(listener);
    if (index >= 0) {
      listeners.splice(index, 1);
    }
  },
};

// IDE integration stubs
export const getCurrentIdeType = (): EditorType | undefined => undefined;
export const getIdeInfo = (): IdeInfo | undefined => undefined;
export const ideRegistrar = {
  register: () => {},
  unregister: () => {},
};

// Config management stubs
export const getConfig = (): Config => ({
  getProjectRoot: () => process.cwd(),
  getSessionId: () => 'default-session',
});
export const setConfig = (_config: Partial<Config>): void => {};
export const saveConfig = async (): Promise<void> => {};

// Kitty keyboard protocol stubs (used by kittyProtocolDetector.ts)
export const enableKittyKeyboardProtocol = (): void => {
  // Enable kitty progressive enhancement
  process.stdout.write('\x1b[>4;1u');
};

export const disableKittyKeyboardProtocol = (): void => {
  // Disable kitty progressive enhancement
  process.stdout.write('\x1b[>4;0u');
};
