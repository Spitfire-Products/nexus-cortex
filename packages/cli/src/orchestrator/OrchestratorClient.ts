/**
 * Unified Orchestrator Client
 *
 * Supports two modes:
 * 1. Direct Mode (DEFAULT): Imports core library directly for maximum performance
 * 2. Server Mode (--server): Uses HTTP client to connect to remote server
 *
 * Usage:
 *   const client = new OrchestratorClient({ mode: 'direct' });
 *   const client = new OrchestratorClient({ mode: 'server', serverUrl: 'http://localhost:4000' });
 */

import { existsSync, readFileSync, realpathSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { CortexOrchestrator, SubAgentEventCallback } from '@nexus-cortex/core';

// Get installation root from this file's location
// Use realpathSync to resolve symlinks (important for npm link)
// Compiled file is at: packages/cli/dist/orchestrator/OrchestratorClient.js
// Installation root is 4 levels up: orchestrator -> dist -> cli -> packages -> root
const __filename = realpathSync(fileURLToPath(import.meta.url));
const __dirname = dirname(__filename);
const CLI_INSTALLATION_ROOT = join(__dirname, '..', '..', '..', '..');

export type ClientMode = 'direct' | 'server';

export interface OrchestratorClientOptions {
  mode?: ClientMode;
  serverUrl?: string;
  defaultModelId?: string;
  projectPath?: string;
  debug?: boolean;
  /**
   * Callbacks for pausing/resuming custom input handling during approval dialogs.
   * Use this with persistent input systems that manage their own terminal state.
   */
  inputHandlerCallbacks?: {
    onBeforeApproval: () => void;
    onAfterApproval: () => void;
  };
  /**
   * Callback to render tool-specific previews before approval prompts.
   * Use this to show diffs for Edit tools, file content for Write tools, etc.
   */
  previewRenderer?: (request: { toolName: string; toolInput: any; reason: string; timestamp: Date }) => void;
  /**
   * Callback for sub-agent events (parallel agent activity).
   * Use this to display real-time sub-agent progress in the UI.
   */
  onSubAgentEvent?: SubAgentEventCallback;
}

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high';

export interface MessageOptions {
  model?: string;
  system?: string;
  tools?: any[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  /** OpenAI GPT-5 reasoning effort level (none, low, medium, high) */
  reasoningEffort?: ReasoningEffort;
  /** Abort signal for cancelling long-running operations (ESC key) */
  abortSignal?: AbortSignal;
}

export class OrchestratorClient {
  private mode: ClientMode;
  private orchestrator?: CortexOrchestrator;
  private serverUrl?: string;
  private options: OrchestratorClientOptions;

  constructor(options: OrchestratorClientOptions = {}) {
    this.mode = options.mode || 'direct';
    this.serverUrl = options.serverUrl;
    this.options = options;
  }

  /**
   * Set input handler callbacks for pausing/resuming custom input during approval dialogs.
   * Call this before initialize() if you need to set up callbacks that depend on other
   * objects created after the client (e.g., persistentInput).
   */
  setInputHandlerCallbacks(callbacks: {
    onBeforeApproval: () => void;
    onAfterApproval: () => void;
  }): void {
    this.options.inputHandlerCallbacks = callbacks;
  }

  /**
   * Set preview renderer for showing tool-specific previews before approval prompts.
   * Call this before initialize() to configure diff previews for Edit tools, etc.
   */
  setPreviewRenderer(renderer: (request: { toolName: string; toolInput: any; reason: string; timestamp: Date }) => void): void {
    this.options.previewRenderer = renderer;
  }

  /**
   * Initialize the client
   */
  async initialize(): Promise<void> {
    if (this.mode === 'direct') {
      await this.initializeDirect();
    } else {
      await this.initializeServer();
    }
  }

  /**
   * Resume an existing session
   */
  async resumeSession(sessionId: string): Promise<void> {
    if (this.mode === 'direct' && this.orchestrator) {
      const projectPath = this.options.projectPath || OrchestratorClient.findProjectRoot(process.cwd());
      await this.orchestrator.resumeSession(sessionId, projectPath);

      if (this.options.debug) {
        console.log(' Session resumed');
        console.log(` Session ID: ${sessionId}`);
        console.log(` Messages: ${this.orchestrator.getMessageHistory().length}`);
      }
    } else if (this.mode === 'server') {
      throw new Error('Session resume not yet supported in server mode');
    }
  }

  /**
   * Find Nexus Cortex installation root (for locating .cortex/ config, not for tool cwd)
   */
  static findInstallRoot(): string {
    const cortexRoot = (process.env.CORTEX_ROOT);
    if (cortexRoot && existsSync(cortexRoot)) {
      return cortexRoot;
    }
    if (existsSync(join(CLI_INSTALLATION_ROOT, 'package.json'))) {
      try {
        const packageJson = JSON.parse(readFileSync(join(CLI_INSTALLATION_ROOT, 'package.json'), 'utf-8'));
        if (packageJson.name === 'nexus-cortex-monorepo') {
          return CLI_INSTALLATION_ROOT;
        }
      } catch {
        // Invalid package.json, continue
      }
    }
    return CLI_INSTALLATION_ROOT;
  }

  /**
   * @deprecated Use findInstallRoot() for config, process.cwd() for tool cwd
   */
  static findProjectRoot(_startPath: string): string {
    return OrchestratorClient.findInstallRoot();
  }

  /**
   * Get the resolved project path — this is the working directory for tool execution.
   * Always uses the user's cwd unless explicitly overridden via constructor option.
   */
  getProjectPath(): string {
    return this.options.projectPath || process.cwd();
  }

  /**
   * Initialize direct mode (import core library)
   */
  private async initializeDirect(): Promise<void> {
    const { createOrchestrator } = await import('@nexus-cortex/core');

    const defaultModelId = this.options.defaultModelId ||
                          process.env.DEFAULT_MODEL_ID ||
                          'grok-4-fast';

    const installRoot = OrchestratorClient.findInstallRoot();
    const workingDir = this.options.projectPath || process.cwd();

    this.orchestrator = await createOrchestrator({
      defaultModelId,
      projectPath: installRoot,
      workingDirectory: workingDir,
      enableTimeline: true,
      debug: this.options.debug || false,
      // Pass sub-agent event callback for real-time UI updates
      onSubAgentEvent: this.options.onSubAgentEvent
    }, {
      permissionMode: 'interactive',
      // Pass input handler callbacks for pausing/resuming during approval dialogs
      inputHandlerCallbacks: this.options.inputHandlerCallbacks,
      // Pass preview renderer for showing diffs before approval prompts
      previewRenderer: this.options.previewRenderer
    });

    await this.orchestrator.createSession(installRoot, defaultModelId);

    if (this.options.debug) {
      console.log(' Direct mode initialized');
      console.log(` Model: ${defaultModelId}`);
      console.log(` Session: ${this.orchestrator.getSessionId()}`);
    }
  }

  /**
   * Initialize server mode (check server health)
   */
  private async initializeServer(): Promise<void> {
    if (!this.serverUrl) {
      throw new Error('Server URL required for server mode');
    }

    try {
      const response = await fetch(`${this.serverUrl}/health`);
      if (!response.ok) {
        throw new Error(`Server health check failed: ${response.status}`);
      }

      const health = await response.json();

      if (this.options.debug) {
        console.log(' Server mode initialized');
        console.log(` URL: ${this.serverUrl}`);
        console.log(` Status: ${health.status}`);
      }

      // Create a new session on the server
      await this.createNewSession();
    } catch (error: any) {
      throw new Error(`Failed to connect to server: ${error.message}`);
    }
  }

  /**
   * Send a message
   */
  async sendMessage(content: string | any[], options: MessageOptions = {}): Promise<any> {
    if (this.mode === 'direct') {
      return await this.sendMessageDirect(content, options);
    } else {
      return await this.sendMessageServer(content, options);
    }
  }

  /**
   * Send message in direct mode
   */
  private async sendMessageDirect(content: string | any[], options: MessageOptions): Promise<any> {
    if (!this.orchestrator) {
      throw new Error('Orchestrator not initialized');
    }

    // Map CLI options to core orchestrator options
    // IMPORTANT: Only include tools if explicitly provided, otherwise let orchestrator use its defaults
    const sendOptions: any = {};

    // Only pass tools if explicitly provided (non-undefined)
    if (options.tools !== undefined) {
      sendOptions.tools = options.tools;
    }

    if (options.model) {
      sendOptions.modelId = options.model;
    }

    if (options.system) {
      sendOptions.systemMessages = [options.system];
    }

    if (options.max_tokens !== undefined) {
      sendOptions.maxTokens = options.max_tokens;
    }

    if (options.temperature !== undefined) {
      sendOptions.temperature = options.temperature;
    }

    if (options.top_p !== undefined) {
      sendOptions.topP = options.top_p;
    }

    // Send message through orchestrator (pass content directly, not messages array)
    // The orchestrator maintains its own internal message history
    const result = await this.orchestrator.sendMessage(content, sendOptions);

    return result;
  }

  /**
   * Send message in server mode
   */
  private async sendMessageServer(content: string | any[], options: MessageOptions): Promise<any> {
    const response = await fetch(`${this.serverUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        model: this.options.defaultModelId,
        ...options
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Request failed');
    }

    return await response.json();
  }

  /**
   * Stream a message with real-time response chunks
   *
   * Returns async generator that yields StreamChunk objects:
   * - text_delta: Text content
   * - content_block_delta: Thinking/reasoning content (check chunk.data.reasoning === true)
   * - tool_use_complete: Complete tool ready for execution
   * - message_start, message_stop, etc.
   */
  async *streamMessage(content: string | any[], options: MessageOptions = {}): AsyncGenerator<any, void, unknown> {
    if (this.mode === 'direct') {
      yield* this.streamMessageDirect(content, options);
    } else {
      // Server mode streaming not yet implemented
      throw new Error('Streaming not yet supported in server mode. Use direct mode (default) for streaming.');
    }
  }

  /**
   * Stream message in direct mode
   */
  private async *streamMessageDirect(content: string | any[], options: MessageOptions): AsyncGenerator<any, void, unknown> {
    if (!this.orchestrator) {
      throw new Error('Orchestrator not initialized');
    }

    // Map CLI options to core orchestrator options
    // IMPORTANT: Only include tools if explicitly provided, otherwise let orchestrator use its defaults
    const sendOptions: any = {};

    // Only pass tools if explicitly provided (non-undefined)
    if (options.tools !== undefined) {
      sendOptions.tools = options.tools;
    }

    if (options.model) {
      sendOptions.modelId = options.model;
    }

    if (options.system) {
      sendOptions.systemMessages = [options.system];
    }

    if (options.max_tokens !== undefined) {
      sendOptions.maxTokens = options.max_tokens;
    }

    if (options.temperature !== undefined) {
      sendOptions.temperature = options.temperature;
    }

    if (options.top_p !== undefined) {
      sendOptions.topP = options.top_p;
    }

    // Pass reasoning effort for OpenAI GPT-5 models
    if (options.reasoningEffort !== undefined) {
      sendOptions.parameters = sendOptions.parameters || {};
      sendOptions.parameters.reasoningEffort = options.reasoningEffort;
    }

    // Pass abort signal for ESC key cancellation
    if (options.abortSignal) {
      sendOptions.abortSignal = options.abortSignal;
    }

    // Track whether stream completed normally (vs interrupted by ESC)
    let streamCompleted = false;
    let stream: AsyncGenerator<any, void, unknown> | null = null;

    try {
      // Stream message through orchestrator
      stream = this.orchestrator.streamMessage(content, sendOptions);

      // Yield all chunks from the orchestrator
      for await (const chunk of stream) {
        yield chunk;
      }

      // Stream completed normally
      streamCompleted = true;
    } catch (error) {
      // If abort signal was triggered, exit cleanly - this is expected during ESC
      if (options.abortSignal?.aborted) {
        return;
      }
      // Re-throw other errors with more context for debugging
      const errorMessage = error instanceof Error ? error.message : String(error);
      const enhancedError = new Error(`Stream error: ${errorMessage}`);
      (enhancedError as any).originalError = error;
      throw enhancedError;
    } finally {
      // If stream was interrupted (ESC pressed), try to clean up gracefully
      if (!streamCompleted && stream) {
        try {
          // Try to close the stream properly
          await stream.return(undefined);
        } catch {
          // Ignore cleanup errors - stream was already interrupted
        }
      }
    }
  }

  /**
   * Create a new session (server mode only)
   */
  private async createNewSession(): Promise<void> {
    if (this.mode !== 'server') {
      return;
    }

    const response = await fetch(`${this.serverUrl}/sessions/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelId: this.options.defaultModelId,
        projectPath: this.options.projectPath || OrchestratorClient.findProjectRoot(process.cwd())
      })
    });

    if (!response.ok) {
      throw new Error('Failed to create session');
    }

    const result = await response.json();

    if (this.options.debug) {
      console.log(` Session: ${result.sessionId}`);
      console.log(` Model: ${result.model.name}`);
    }
  }

  /**
   * Get current model
   */
  getCurrentModel(): any {
    if (this.mode === 'direct' && this.orchestrator) {
      return this.orchestrator.getCurrentModel();
    }
    return null;
  }

  /**
   * Switch model
   */
  async switchModel(modelId: string, reason?: string): Promise<void> {
    if (this.mode === 'direct' && this.orchestrator) {
      await this.orchestrator.switchModel(modelId, { reason });
    } else {
      const response = await fetch(`${this.serverUrl}/sessions/current/model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId, reason })
      });

      if (!response.ok) {
        throw new Error('Failed to switch model');
      }
    }
  }

  /**
   * Get cache metrics
   */
  async getCacheMetrics(): Promise<any> {
    if (this.mode === 'direct' && this.orchestrator) {
      const metrics = this.orchestrator.getCacheMetrics();
      const report = this.orchestrator.getCacheReport();
      const sessionId = this.orchestrator.getSessionId();

      return {
        sessionId: sessionId || 'unknown',
        metrics,
        report,
        timestamp: new Date().toISOString()
      };
    } else {
      // In server mode, get current session ID first
      const sessionId = await this.getSessionId();
      if (!sessionId) {
        throw new Error('No active session');
      }

      const response = await fetch(`${this.serverUrl}/sessions/${sessionId}/cache/metrics`);
      if (!response.ok) {
        throw new Error('Failed to fetch cache metrics');
      }
      return await response.json();
    }
  }

  /**
   * Get message history
   */
  getMessageHistory(): any[] {
    if (this.mode === 'direct' && this.orchestrator) {
      return this.orchestrator.getMessageHistory();
    }
    return [];
  }

  /**
   * Get session ID
   */
  getSessionId(): string | null {
    if (this.mode === 'direct' && this.orchestrator) {
      return this.orchestrator.getSessionId();
    }
    return null;
  }

  /**
   * Get approval mode
   */
  async getApprovalMode(): Promise<{ autoApproveActions: boolean }> {
    if (this.mode === 'direct' && this.orchestrator) {
      return this.orchestrator.getApprovalMode();
    } else {
      const response = await fetch(`${this.serverUrl}/approval/mode`);
      if (!response.ok) {
        throw new Error('Failed to get approval mode');
      }
      return await response.json();
    }
  }

  /**
   * Set approval mode
   */
  async setApprovalMode(autoApprove: boolean): Promise<{ success: boolean; message?: string }> {
    if (this.mode === 'direct' && this.orchestrator) {
      this.orchestrator.setApprovalMode({ autoApproveActions: autoApprove });
      return {
        success: true,
        message: `Auto-approve ${autoApprove ? 'enabled' : 'disabled'}`
      };
    } else {
      const response = await fetch(`${this.serverUrl}/approval/mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoApproveActions: autoApprove })
      });
      if (!response.ok) {
        throw new Error('Failed to set approval mode');
      }
      return await response.json();
    }
  }

  /**
   * Enable YOLO mode - auto-approve ALL operations (white/gray/blacklist)
   */
  async enableYoloMode(): Promise<void> {
    if (this.mode === 'direct' && this.orchestrator) {
      await this.orchestrator.enableYoloMode();
    } else {
      const response = await fetch(`${this.serverUrl}/approval/yolo/enable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!response.ok) {
        throw new Error('Failed to enable YOLO mode');
      }
    }
  }

  /**
   * Disable YOLO mode
   */
  async disableYoloMode(): Promise<void> {
    if (this.mode === 'direct' && this.orchestrator) {
      await this.orchestrator.disableYoloMode();
    } else {
      const response = await fetch(`${this.serverUrl}/approval/yolo/disable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!response.ok) {
        throw new Error('Failed to disable YOLO mode');
      }
    }
  }

  /**
   * Check if YOLO mode is active
   */
  isYoloModeActive(): boolean {
    if (this.mode === 'direct' && this.orchestrator) {
      return this.orchestrator.isYoloModeActive();
    }
    return false;
  }

  updateRuntimeConfig(updates: Record<string, unknown>): void {
    if (this.mode === 'direct' && this.orchestrator) {
      this.orchestrator.updateRuntimeConfig(updates as any);
    }
  }

  setDebug(enabled: boolean): void {
    this.updateRuntimeConfig({ debug: enabled });
  }

  isDebugActive(): boolean {
    if (this.mode === 'direct' && this.orchestrator) {
      return (this.orchestrator as any).config?.debug === true;
    }
    return process.env.DEBUG === 'true';
  }

  /**
   * Set a custom approval handler for tool permissions
   *
   * This allows UI frameworks (like React/Ink) to provide their own
   * approval dialog implementation instead of using the default CLI handler.
   *
   * @param handler - Custom ApprovalHandler implementation with requestApproval method
   */
  setApprovalHandler(handler: { requestApproval: (request: any) => Promise<boolean> }): void {
    if (this.mode === 'direct' && this.orchestrator) {
      this.orchestrator.setApprovalHandler(handler);
    }
  }

  /**
   * Set sub-agent event callback for real-time UI updates.
   * Call this to display sub-agent progress in the UI.
   *
   * @param callback - Function to receive sub-agent events
   */
  setSubAgentEventCallback(callback: SubAgentEventCallback): void {
    this.options.onSubAgentEvent = callback;
    if (this.mode === 'direct' && this.orchestrator) {
      this.orchestrator.setSubAgentEventCallback(callback);
    }
  }

  /**
   * Get all registered permission policies
   */
  async getPolicies(): Promise<any[]> {
    if (this.mode === 'direct' && this.orchestrator) {
      return this.orchestrator.getPolicies() as any[];
    } else {
      const response = await fetch(`${this.serverUrl}/permissions/policies`);
      if (!response.ok) {
        throw new Error('Failed to get policies');
      }
      const data = await response.json();
      return data.policies || [];
    }
  }

  /**
   * Get audit log for session
   */
  async getAuditLog(sessionId?: string): Promise<any[]> {
    if (this.mode === 'direct' && this.orchestrator) {
      return this.orchestrator.getAuditLog(sessionId);
    } else {
      const url = sessionId
        ? `${this.serverUrl}/permissions/audit/${sessionId}`
        : `${this.serverUrl}/permissions/audit`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to get audit log');
      }
      const data = await response.json();
      return data.entries || [];
    }
  }

  /**
   * Get audit statistics
   */
  async getAuditStatistics(): Promise<any> {
    if (this.mode === 'direct' && this.orchestrator) {
      return await this.orchestrator.getAuditStatistics();
    } else {
      const response = await fetch(`${this.serverUrl}/permissions/audit/statistics`);
      if (!response.ok) {
        throw new Error('Failed to get audit statistics');
      }
      return await response.json();
    }
  }

  /**
   * Get all denied operations
   */
  async getDeniedOperations(): Promise<any[]> {
    if (this.mode === 'direct' && this.orchestrator) {
      return await this.orchestrator.getAllDeniedOperations();
    } else {
      const response = await fetch(`${this.serverUrl}/permissions/denied`);
      if (!response.ok) {
        throw new Error('Failed to get denied operations');
      }
      const data = await response.json();
      return data.operations || [];
    }
  }

  /**
   * Grant permission to a tool (convenience method)
   * Creates a WhitelistPolicy for the specified tool
   */
  async grantToolPermission(toolName: string): Promise<void> {
    if (this.mode === 'direct' && this.orchestrator) {
      // Import WhitelistPolicy from core
      const { WhitelistPolicy } = await import('@nexus-cortex/core');
      const policy = new WhitelistPolicy([toolName], 40);
      this.orchestrator.registerPolicy(policy);
    } else {
      const response = await fetch(`${this.serverUrl}/permissions/tool/${toolName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'grant' })
      });
      if (!response.ok) {
        throw new Error('Failed to grant permission');
      }
    }
  }

  /**
   * Revoke permission from a tool (convenience method)
   * Creates a BlacklistPolicy for the specified tool
   */
  async revokeToolPermission(toolName: string): Promise<void> {
    if (this.mode === 'direct' && this.orchestrator) {
      // Import BlacklistPolicy from core
      const { BlacklistPolicy } = await import('@nexus-cortex/core');
      const policy = new BlacklistPolicy([toolName], 100);
      this.orchestrator.registerPolicy(policy);
    } else {
      const response = await fetch(`${this.serverUrl}/permissions/tool/${toolName}`, {
        method: 'DELETE'
      });
      if (!response.ok) {
        throw new Error('Failed to revoke permission');
      }
    }
  }

  /**
   * Register a custom permission policy
   */
  async registerPolicy(policy: any): Promise<void> {
    if (this.mode === 'direct' && this.orchestrator) {
      this.orchestrator.registerPolicy(policy);
    } else {
      const response = await fetch(`${this.serverUrl}/permissions/policies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy })
      });
      if (!response.ok) {
        throw new Error('Failed to register policy');
      }
    }
  }

  /**
   * Unregister a permission policy
   */
  async unregisterPolicy(policyName: string): Promise<boolean> {
    if (this.mode === 'direct' && this.orchestrator) {
      return this.orchestrator.unregisterPolicy(policyName);
    } else {
      const response = await fetch(`${this.serverUrl}/permissions/policies/${policyName}`, {
        method: 'DELETE'
      });
      if (!response.ok) {
        throw new Error('Failed to unregister policy');
      }
      const data = await response.json();
      return data.removed || false;
    }
  }

  /**
   * Create checkpoint
   */
  async createCheckpoint(name: string): Promise<any> {
    if (this.mode === 'direct' && this.orchestrator) {
      return await this.orchestrator.createCheckpoint({ description: name });
    } else {
      const response = await fetch(`${this.serverUrl}/checkpoints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      return await response.json();
    }
  }

  /**
   * List checkpoints
   */
  async listCheckpoints(): Promise<any[]> {
    if (this.mode === 'direct' && this.orchestrator) {
      return this.orchestrator.listCheckpoints();
    } else {
      const response = await fetch(`${this.serverUrl}/checkpoints`);
      const result = await response.json();
      return result.checkpoints || [];
    }
  }

  /**
   * Get cache report
   */
  getCacheReport(): string {
    if (this.mode === 'direct' && this.orchestrator) {
      return this.orchestrator.getCacheReport();
    }
    return 'Cache report not available in server mode';
  }

  /**
   * Get client mode
   */
  getMode(): ClientMode {
    return this.mode;
  }

  /**
   * Get server URL (if in server mode)
   */
  getServerUrl(): string | undefined {
    return this.serverUrl;
  }

  /**
   * List all available models
   *
   * Uses core library's listAvailableModels method in direct mode.
   * In server mode, makes HTTP request to server.
   *
   * Transforms ModelConfig format to CLI-expected format
   */
  async listModels(): Promise<any[]> {
    if (this.mode === 'direct' && this.orchestrator) {
      // [OK] Use core library method and transform to CLI format
      const models = this.orchestrator.listAvailableModels();

      // Transform ModelConfig to CLI-expected format
      return models.map(model => ({
        id: model.id,
        owned_by: model.provider,
        displayName: model.displayName,
        contextWindow: model.limits.contextWindow,
        outputTokens: model.limits.outputTokens,
        inputCostPer1M: model.cost?.inputPerMillion || 0,
        outputCostPer1M: model.cost?.outputPerMillion || 0,
        supportsTools: model.tools.supported,
        supportsStreaming: model.streaming.supported,
        reasoning: model.reasoning
      }));
    } else {
      // Server mode - HTTP API call
      const response = await fetch(`${this.serverUrl}/models`);
      if (!response.ok) {
        throw new Error('Failed to fetch models');
      }
      const result = await response.json();
      return result.data || [];
    }
  }

  /**
   * List MCP servers
   */
  async listMcpServers(): Promise<{ enabled: boolean; servers: any[] }> {
    if (this.mode === 'direct' && this.orchestrator) {
      const mcpEnabled = this.orchestrator.isMcpEnabled();

      if (!mcpEnabled) {
        return { enabled: false, servers: [] };
      }

      const serverInfo = this.orchestrator.getMcpServerInfo();
      return { enabled: true, servers: serverInfo };
    } else {
      const response = await fetch(`${this.serverUrl}/mcp/servers`);
      if (!response.ok) {
        throw new Error('Failed to fetch MCP servers');
      }
      return await response.json();
    }
  }

  /**
   * List all sessions
   */
  async listSessions(): Promise<{ sessions: any[] }> {
    if (this.mode === 'direct' && this.orchestrator) {
      // In direct mode, we have a single session
      // Get session metadata from the orchestrator
      const sessionId = this.orchestrator.getSessionId();
      const messageHistory = this.orchestrator.getMessageHistory();

      if (!sessionId) {
        return { sessions: [] };
      }

      // Calculate basic session info
      const session = {
        sessionId,
        messageCount: messageHistory.length,
        metadata: {
          startTime: new Date().toISOString(),
          model: this.orchestrator.getCurrentModel().id
        },
        fileSize: 0 // Not applicable in direct mode
      };

      return { sessions: [session] };
    } else {
      const response = await fetch(`${this.serverUrl}/sessions`);
      if (!response.ok) {
        throw new Error('Failed to fetch sessions');
      }
      return await response.json();
    }
  }

  /**
   * List all available tools
   */
  async listTools(grouped?: boolean): Promise<any> {
    if (this.mode === 'direct' && this.orchestrator) {
      // Get tool definitions from orchestrator
      const toolDefs = (this.orchestrator as any).getToolDefinitions?.() ?? [];

      if (grouped) {
        // Group tools by category
        const groupedTools: Record<string, any[]> = {};

        for (const tool of toolDefs) {
          const category = tool.category || 'general';
          if (!groupedTools[category]) {
            groupedTools[category] = [];
          }
          groupedTools[category].push(tool);
        }

        return {
          totalCount: toolDefs.length,
          grouped: groupedTools
        };
      }

      return {
        totalCount: toolDefs.length,
        tools: toolDefs
      };
    } else {
      const queryParams = grouped ? '?grouped=true' : '';
      const response = await fetch(`${this.serverUrl}/tools${queryParams}`);
      if (!response.ok) {
        throw new Error('Failed to fetch tools');
      }
      return await response.json();
    }
  }

  /**
   * Get detailed information about a specific tool
   */
  async getToolInfo(toolName: string): Promise<any> {
    if (this.mode === 'direct' && this.orchestrator) {
      // Get all tool definitions and find the requested one
      const toolDefs = (this.orchestrator as any).getToolDefinitions?.() ?? [];
      const tool = toolDefs.find((t: any) => t.name === toolName);

      if (!tool) {
        throw new Error(`Tool '${toolName}' not found`);
      }

      return tool;
    } else {
      const response = await fetch(`${this.serverUrl}/tools/${toolName}`);
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Tool '${toolName}' not found`);
        }
        throw new Error('Failed to fetch tool info');
      }
      return await response.json();
    }
  }

  /**
   * Get detailed model information
   *
   * Uses core library's listAvailableModels method in direct mode.
   * In server mode, makes HTTP request to server.
   */
  async getModelInfo(modelId: string): Promise<any> {
    if (this.mode === 'direct' && this.orchestrator) {
      // [OK] Use core library method
      const models = this.orchestrator.listAvailableModels();
      const model = models.find(m => m.id === modelId);
      if (!model) {
        throw new Error(`Model '${modelId}' not found`);
      }
      return model;
    } else {
      // Server mode - HTTP API call
      const response = await fetch(`${this.serverUrl}/models/${modelId}`);
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Model '${modelId}' not found`);
        }
        throw new Error('Failed to fetch model info');
      }
      return await response.json();
    }
  }

  /**
   * Enable an MCP server
   *
   * Uses EnableMcpServer tool executor with managers from orchestrator.
   * In server mode, makes HTTP request to server.
   */
  async enableMCPServer(serverName: string): Promise<void> {
    if (this.mode === 'direct' && this.orchestrator) {
      // Get managers from orchestrator
      const { EnableMcpServer } = await import('@nexus-cortex/core');
      const configManager = this.orchestrator.getMcpConfigManager();
      const registry = this.orchestrator.getMcpServerRegistry();
      const projectPath = this.options.projectPath || OrchestratorClient.findProjectRoot(process.cwd());

      // Call tool executor
      const result = await EnableMcpServer.execute(
        { server_name: serverName },
        registry,
        configManager,
        projectPath
      );

      if (result.status !== 'success' && result.status !== 'already_enabled') {
        throw new Error(result.message);
      }
    } else {
      // Server mode - HTTP API call
      const response = await fetch(`${this.serverUrl}/mcp/servers/${serverName}/enable`, {
        method: 'POST'
      });
      if (!response.ok) {
        throw new Error(`Failed to enable MCP server: ${serverName}`);
      }
    }
  }

  /**
   * Disable an MCP server
   *
   * Uses DisableMcpServer tool executor with managers from orchestrator.
   * In server mode, makes HTTP request to server.
   */
  async disableMCPServer(serverName: string): Promise<void> {
    if (this.mode === 'direct' && this.orchestrator) {
      // Get config manager from orchestrator
      const { DisableMcpServer } = await import('@nexus-cortex/core');
      const configManager = this.orchestrator.getMcpConfigManager();
      const projectPath = this.options.projectPath || OrchestratorClient.findProjectRoot(process.cwd());

      // Call tool executor (doesn't need registry, only configManager)
      const result = await DisableMcpServer.execute(
        { server_name: serverName },
        configManager,
        projectPath
      );

      if (result.status !== 'success') {
        throw new Error(result.message);
      }
    } else {
      // Server mode - HTTP API call
      const response = await fetch(`${this.serverUrl}/mcp/servers/${serverName}/disable`, {
        method: 'POST'
      });
      if (!response.ok) {
        throw new Error(`Failed to disable MCP server: ${serverName}`);
      }
    }
  }

  /**
   * Get configuration value
   *
   * Uses SettingsLoader from core library in direct mode.
   * In server mode, makes HTTP request to server.
   */
  async getConfig(key: string): Promise<string> {
    if (this.mode === 'direct' && this.orchestrator) {
      // Use SettingsLoader from core library
      const { SettingsLoader } = await import('@nexus-cortex/core');
      const projectPath = this.options.projectPath || OrchestratorClient.findProjectRoot(process.cwd());
      const loader = new SettingsLoader(projectPath);

      const value = loader.get(key as any);
      if (!value) {
        throw new Error(`Configuration key '${key}' not found`);
      }
      return value;
    } else {
      // Server mode - HTTP API call
      const response = await fetch(`${this.serverUrl}/config/${key}`);
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Configuration key '${key}' not found`);
        }
        throw new Error('Failed to get configuration');
      }
      const result = await response.json();
      return result.value;
    }
  }

  /**
   * Set configuration value
   *
   * Uses SettingsWriter from core library in direct mode.
   * In server mode, makes HTTP request to server.
   *
   * Note: Direct mode currently requires restart for changes to take effect.
   */
  async setConfig(key: string, value: string): Promise<void> {
    if (this.mode === 'direct' && this.orchestrator) {
      // Use SettingsWriter from core library
      const { SettingsWriter } = await import('@nexus-cortex/core');
      const projectPath = this.options.projectPath || OrchestratorClient.findProjectRoot(process.cwd());
      const writer = new SettingsWriter(projectPath);

      writer.update({ [key]: value } as any);

      // Apply to process.env so env-read-per-turn vars take immediate effect
      process.env[key] = value;
    } else {
      // Server mode - HTTP API call
      const response = await fetch(`${this.serverUrl}/config/${key}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ value })
      });
      if (!response.ok) {
        throw new Error('Failed to set configuration');
      }
    }
  }

  /**
   * Get all configuration settings with summary
   *
   * Uses SettingsLoader from core library in direct mode.
   */
  async getConfigSummary(): Promise<{
    providers: string[];
    defaultModel: string;
    helperModel: string;
    mentorshipEnabled: boolean;
    debugEnabled: boolean;
    allSettings: Record<string, string>;
  }> {
    if (this.mode === 'direct' && this.orchestrator) {
      const { SettingsLoader } = await import('@nexus-cortex/core');
      const projectPath = this.options.projectPath || OrchestratorClient.findProjectRoot(process.cwd());
      const loader = new SettingsLoader(projectPath);

      const summary = loader.getSummary();
      const allSettings = loader.getEnvironment();

      // Filter out sensitive API keys for display
      const safeSettings: Record<string, string> = {};
      for (const [key, value] of Object.entries(allSettings)) {
        if (key.includes('API_KEY')) {
          safeSettings[key] = value ? '***configured***' : '(not set)';
        } else {
          safeSettings[key] = value;
        }
      }

      return {
        ...summary,
        allSettings: safeSettings
      };
    } else {
      const response = await fetch(`${this.serverUrl}/config`);
      if (!response.ok) {
        throw new Error('Failed to get configuration');
      }
      return await response.json();
    }
  }

  /**
   * List available configuration keys
   */
  async listConfigKeys(): Promise<string[]> {
    if (this.mode === 'direct') {
      const { SETTINGS_METADATA } = await import('@nexus-cortex/core');
      return SETTINGS_METADATA.map((s: any) => s.key);
    } else {
      const response = await fetch(`${this.serverUrl}/config/keys`);
      if (!response.ok) {
        throw new Error('Failed to list config keys');
      }
      const result = await response.json();
      return result.keys || [];
    }
  }

  /**
   * List system messages
   *
   * Returns list of system message files in .cortex/system-messages/
   */
  async listSystemMessages(): Promise<Array<{ filename: string; priority: number; path: string }>> {
    if (this.mode === 'direct') {
      const { existsSync, readdirSync } = await import('fs');
      const { join } = await import('path');

      const projectPath = this.options.projectPath || OrchestratorClient.findProjectRoot(process.cwd());
      const messagesDir = join(projectPath, '.cortex', 'system-messages');

      if (!existsSync(messagesDir)) {
        return [];
      }

      const files = readdirSync(messagesDir)
        .filter(f => f.endsWith('.md'))
        .sort();

      return files.map(filename => {
        // Extract priority from filename (e.g., "01-base.md" -> 1)
        const match = filename.match(/^(\d+)-/);
        const priority = match && match[1] ? parseInt(match[1], 10) : 99;

        return {
          filename,
          priority,
          path: join(messagesDir, filename)
        };
      });
    } else {
      const response = await fetch(`${this.serverUrl}/system-messages`);
      if (!response.ok) {
        throw new Error('Failed to list system messages');
      }
      const result = await response.json();
      return result.messages || [];
    }
  }

  /**
   * Get system message content
   */
  async getSystemMessageContent(filename: string): Promise<string> {
    if (this.mode === 'direct') {
      const { existsSync, readFileSync } = await import('fs');
      const { join } = await import('path');

      const projectPath = this.options.projectPath || OrchestratorClient.findProjectRoot(process.cwd());
      const messagePath = join(projectPath, '.cortex', 'system-messages', filename);

      if (!existsSync(messagePath)) {
        throw new Error(`System message not found: ${filename}`);
      }

      return readFileSync(messagePath, 'utf-8');
    } else {
      const response = await fetch(`${this.serverUrl}/system-messages/${filename}`);
      if (!response.ok) {
        throw new Error(`Failed to get system message: ${filename}`);
      }
      const result = await response.json();
      return result.content;
    }
  }
}
