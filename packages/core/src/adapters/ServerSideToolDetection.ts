/**
 * Server-Side Tool Detection and Routing
 *
 * Determines whether to use server-side (agentic) tool execution vs client-side.
 * Handles endpoint switching between Messages API and Responses API for XAI models.
 *
 * Architecture:
 * - Detection is model-level + environment-driven
 * - XAI: Messages API (/v1/messages) for client-side OR Responses API (/v1/responses) for server-side
 * - XAI supports mixing client-side and server-side tools (server tools auto-execute, client tools pause)
 * - Server-side tools require ENABLE_SERVER_SIDE_TOOLS=true
 *
 * Based on:
 * - XAI API documentation (research/api-docs/xai_api_reference/)
 * - HANDOFF_SESSION_REGISTRY_REFACTORING.md
 * - ModelConfig.serverSideTools configuration
 */

import { ModelConfig } from '../models/ModelConfig.interface.js';
import { CanonicalTool } from './FormatAdapter.interface.js';
import { isServerSideTool, separateTools } from '../tools/ServerSideTools.js';

/**
 * Detection Result
 *
 * Indicates whether to use server-side tools and which endpoint
 */
export interface ServerSideToolDetectionResult {
  /** Whether server-side tools should be used */
  useServerSideTools: boolean;

  /** API endpoint to use */
  endpoint: string;

  /** API pattern to use */
  apiPattern: 'messages' | 'responses';

  /** Tools to send (filtered for client or server) */
  tools: CanonicalTool[];

  /** Reason for decision (for debugging) */
  reason: string;
}

/**
 * Check if server-side tools are enabled via environment variable
 *
 * @returns true if ENABLE_SERVER_SIDE_TOOLS is set to 'true' or '1'
 */
export function isServerSideToolsEnabled(): boolean {
  const envVar = process.env.ENABLE_SERVER_SIDE_TOOLS;
  return envVar === 'true' || envVar === '1';
}

/**
 * Detect if model supports server-side tools
 *
 * @param modelConfig - Model configuration
 * @returns true if model has serverSideTools.supported = true
 */
export function modelSupportsServerSideTools(modelConfig: ModelConfig): boolean {
  return modelConfig.serverSideTools?.supported === true;
}

/**
 * Check if tools contain any server-side tools for this provider
 *
 * @param provider - Provider name
 * @param tools - Array of canonical tools
 * @returns true if any tools are server-side for this provider
 */
export function containsServerSideTools(provider: string, tools: CanonicalTool[]): boolean {
  return tools.some(tool => isServerSideTool(provider, tool.name));
}

/**
 * Main detection logic: Should we use server-side tools?
 *
 * Decision criteria (ALL must be true):
 * 1. ENABLE_SERVER_SIDE_TOOLS environment variable is set to 'true' or '1'
 * 2. Model supports server-side tools (ModelConfig.serverSideTools.supported = true)
 * 3. Tools array contains at least one server-side tool for this provider
 * 4. Provider supports server-side tools (currently only XAI)
 *
 * @param modelConfig - Model configuration
 * @param tools - Array of canonical tools to use
 * @returns Detection result with endpoint and tool filtering
 */
export function shouldUseServerSideTools(
  modelConfig: ModelConfig,
  tools: CanonicalTool[]
): ServerSideToolDetectionResult {
  const provider = modelConfig.provider;

  // Step 1: Check environment variable
  if (!isServerSideToolsEnabled()) {
    // Filter out server-side tools since they can't be used with client-side APIs
    const clientTools = tools.filter(tool => !isServerSideTool(provider, tool.name));

    if (clientTools.length < tools.length) {
      console.warn(`[ServerSideToolDetection] ENABLE_SERVER_SIDE_TOOLS is disabled. Filtered out ${tools.length - clientTools.length} server-side tools.`);
    }

    return {
      useServerSideTools: false,
      endpoint: modelConfig.api.endpoint,
      apiPattern: modelConfig.api.pattern as 'messages' | 'responses',
      tools: clientTools,  // Return only client-side tools
      reason: 'ENABLE_SERVER_SIDE_TOOLS environment variable not set'
    };
  }

  // Step 2: Check model support
  if (!modelSupportsServerSideTools(modelConfig)) {
    return {
      useServerSideTools: false,
      endpoint: modelConfig.api.endpoint,
      apiPattern: modelConfig.api.pattern as 'messages' | 'responses',
      tools,
      reason: 'Model does not support server-side tools'
    };
  }

  // Step 3: Check if tools contain server-side tools
  if (!containsServerSideTools(provider, tools)) {
    return {
      useServerSideTools: false,
      endpoint: modelConfig.api.endpoint,
      apiPattern: modelConfig.api.pattern as 'messages' | 'responses',
      tools,
      reason: 'No server-side tools in request'
    };
  }

  // Step 4: Separate tools and validate (cannot mix client and server)
  const { clientTools, serverTools } = separateTools(provider, tools);

  if (clientTools.length > 0 && serverTools.length > 0) {
    // XAI supports hybrid mode: server-side tools auto-execute, client-side tools pause and return
    // Per xAI advanced usage docs: "You can combine server-side agentic tools with custom client-side tools"
    if (process.env.DEBUG === 'true') {
      console.log(
        `[ServerSideToolDetection] Hybrid mode: ${serverTools.length} server-side + ${clientTools.length} client-side tools for ${provider}. ` +
        `Server tools: ${serverTools.map(t => t.name).join(', ')}. ` +
        `Client tools: ${clientTools.map(t => t.name).slice(0, 5).join(', ')}${clientTools.length > 5 ? ` (+${clientTools.length - 5} more)` : ''}`
      );
    }

    // Use ALL tools (both server-side and client-side) via Responses API
    const responsesEndpoint = getResponsesAPIEndpoint(modelConfig);

    return {
      useServerSideTools: true,
      endpoint: responsesEndpoint,
      apiPattern: 'responses',
      tools: [...serverTools, ...clientTools], // ALL tools — hybrid mode
      reason: 'Hybrid mode: server-side + client-side tools via Responses API'
    };
  }

  if (serverTools.length === 0) {
    // No server-side tools present
    return {
      useServerSideTools: false,
      endpoint: modelConfig.api.endpoint,
      apiPattern: modelConfig.api.pattern as 'messages' | 'responses',
      tools,
      reason: 'No server-side tools in request'
    };
  }

  // All criteria met - use server-side tools
  // Switch to Responses API endpoint
  const responsesEndpoint = getResponsesAPIEndpoint(modelConfig);

  return {
    useServerSideTools: true,
    endpoint: responsesEndpoint,
    apiPattern: 'responses',
    tools: serverTools,
    reason: 'All criteria met - using server-side agentic tools via Responses API'
  };
}

/**
 * Get Responses API endpoint for a model
 *
 * Switches from Messages API to Responses API endpoint.
 *
 * @param modelConfig - Model configuration
 * @returns Responses API endpoint URL
 */
export function getResponsesAPIEndpoint(modelConfig: ModelConfig): string {
  // For XAI: derive the responses endpoint idempotently. The configured
  // endpoint may be /v1/messages (XAI_API_MODE=messages) OR already
  // /v1/responses (XAI_API_MODE=responses) — strip both so we never produce
  // a doubled .../v1/responses/v1/responses path (R27: 404 "No handler found
  // on route"). Mirrors the openai branch below.
  if (modelConfig.provider === 'xai') {
    const baseUrl = modelConfig.api.endpoint
      .replace('/v1/messages', '')
      .replace('/v1/responses', '');
    return `${baseUrl}/v1/responses`;
  }

  // R20: OpenAI dynamic switch — /v1/chat/completions → /v1/responses
  if (modelConfig.provider === 'openai') {
    const baseUrl = modelConfig.api.endpoint
      .replace('/v1/chat/completions', '')
      .replace('/v1/responses', '');
    return `${baseUrl}/v1/responses`;
  }

  // For other providers (future): use supportedEndpoints config
  const responsesSupported = modelConfig.serverSideTools?.supportedEndpoints?.includes('responses');
  if (responsesSupported) {
    // Generic endpoint switching logic
    const baseUrl = modelConfig.api.endpoint.replace(/\/(v1\/)?[^/]+$/, '');
    return `${baseUrl}/v1/responses`;
  }

  // Fallback: use original endpoint (shouldn't reach here if detection is correct)
  console.warn(
    `[ServerSideToolDetection] WARNING: No Responses API endpoint configured for ${modelConfig.provider}. ` +
    `Using original endpoint: ${modelConfig.api.endpoint}`
  );
  return modelConfig.api.endpoint;
}

/**
 * Get Messages API endpoint for a model (reverse of getResponsesAPIEndpoint)
 *
 * Useful for switching back from Responses API to Messages API.
 *
 * @param modelConfig - Model configuration
 * @returns Messages API endpoint URL
 */
export function getMessagesAPIEndpoint(modelConfig: ModelConfig): string {
  // This is typically the default endpoint in ModelConfig
  return modelConfig.api.endpoint;
}

/**
 * Validate that tools are compatible with server-side execution
 *
 * XAI Requirements:
 * - Cannot mix client-side and server-side tools
 * - Only specific models support server-side tools (grok-4, grok-4-fast, grok-4-fast-non-reasoning)
 *
 * @param modelConfig - Model configuration
 * @param tools - Array of canonical tools
 * @returns Validation result with errors if invalid
 */
export function validateServerSideToolRequest(
  modelConfig: ModelConfig,
  tools: CanonicalTool[]
): { valid: boolean; errors?: string[] } {
  const errors: string[] = [];
  const provider = modelConfig.provider;

  // Check model support
  if (!modelSupportsServerSideTools(modelConfig)) {
    errors.push(`Model ${modelConfig.id} does not support server-side tools`);
  }

  // Check tools composition (hybrid mode supported for XAI and OpenAI Responses API)
  const { clientTools, serverTools } = separateTools(provider, tools);

  // R20: OpenAI Responses API supports hybrid mode just like XAI — hosted tools
  // (web_search, code_interpreter, etc.) execute server-side while function
  // tools pause and return for client execution.
  if (clientTools.length > 0 && serverTools.length > 0 && provider !== 'xai' && provider !== 'openai') {
    errors.push(
      `Cannot mix client-side and server-side tools for provider ${provider}. ` +
      `Client tools: ${clientTools.map(t => t.name).join(', ')}. ` +
      `Server tools: ${serverTools.map(t => t.name).join(', ')}`
    );
  }

  // R20: OpenAI server-side tool availability check (mirrors the XAI branch
  // below). Tools must be in the model's `serverSideTools.availableTools` list.
  if (provider === 'openai' && serverTools.length > 0) {
    const availableTools = modelConfig.serverSideTools?.availableTools || [];
    const unavailableTools = serverTools.filter(
      tool => !availableTools.includes(tool.name)
    );

    if (unavailableTools.length > 0) {
      errors.push(
        `Tools not available for ${modelConfig.id}: ${unavailableTools.map(t => t.name).join(', ')}. ` +
        `Available tools: ${availableTools.join(', ')}`
      );
    }
  }

  // XAI-specific validations
  if (provider === 'xai') {
    // Check model compatibility
    const compatibleModels = ['grok-4', 'grok-4-fast', 'grok-4-fast-non-reasoning', 'grok-4-0709', 'grok-code-fast-1'];
    const isCompatible = compatibleModels.some(model => modelConfig.id.includes(model));

    if (!isCompatible) {
      errors.push(
        `Model ${modelConfig.id} may not support server-side tools. ` +
        `Recommended models: grok-4, grok-4-fast, grok-4-fast-non-reasoning`
      );
    }

    // Validate available tools
    const availableTools = modelConfig.serverSideTools?.availableTools || [];
    const unavailableTools = serverTools.filter(
      tool => !availableTools.includes(tool.name)
    );

    if (unavailableTools.length > 0) {
      errors.push(
        `Tools not available for ${modelConfig.id}: ${unavailableTools.map(t => t.name).join(', ')}. ` +
        `Available tools: ${availableTools.join(', ')}`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined
  };
}
