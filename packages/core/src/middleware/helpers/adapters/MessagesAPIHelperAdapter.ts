/**
 * Messages API Helper Adapter
 * Phase 1.5: Week 2 - Independent Helper Middleware
 *
 * Handles helper model communication using Messages API pattern (/v1/messages).
 * Used by Anthropic (Claude) and XAI (Grok) models.
 *
 * ARCHITECTURE:
 * - Self-contained: No dependency on main adapter system
 * - Makes real API calls using fetch
 * - Converts canonical format to Messages API format internally
 * - Handles compaction and tool result summarization
 */

import {
  BaseHelperAdapter,
  type HelperCanonicalMessage,
  type CompactionResult,
  type ToolSummaryResult
} from '../HelperMiddlewareAdapter.interface.js';
import type { ModelConfig } from '../../../models/ModelConfig.interface.js';
import {
  anthropicCredentialService,
  type AuthMethod,
  CredentialError
} from '../../../config/AnthropicCredentialService.js';

/**
 * Messages API format (simplified for helper use)
 */
interface MessagesAPIMessage {
  role: 'user' | 'assistant';
  content: string | Array<{
    type: 'text';
    text: string;
  }>;
}

interface MessagesAPIRequest {
  model: string;
  messages: MessagesAPIMessage[];
  max_tokens: number;
  temperature?: number;
  system?: string;
}

interface MessagesAPIResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{
    type: 'text';
    text: string;
  }>;
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Helper adapter for Messages API pattern
 *
 * Supports: Anthropic Claude, XAI Grok (any model using /v1/messages pattern)
 */
export class MessagesAPIHelperAdapter extends BaseHelperAdapter {
  readonly apiPattern = 'messages';
  readonly name = 'MessagesAPIHelperAdapter';

  /**
   * Compact conversation history via Messages API helper model
   */
  async compact(
    messages: HelperCanonicalMessage[],
    helperConfig: ModelConfig,
    targetTokens: number
  ): Promise<CompactionResult> {
    const startTime = Date.now();

    // Estimate original tokens
    const originalText = this.extractTextContent(messages);
    const originalTokens = this.estimateTokens(originalText);

    // Check if content needs chunking (smart chunking based on model's context limit)
    if (this.needsChunking(originalText, helperConfig, targetTokens)) {
      const contentTokens = this.estimateTokens(originalText);
      const contextInfo = this.getContextInfo(helperConfig);
      console.log(` ⚠  Content too large (${contentTokens} tokens) for ${contextInfo}, using smart chunking...`);

      return await this.compactWithChunking(messages, helperConfig, targetTokens, startTime);
    }

    // Create compaction prompt
    const prompt = this.createCompactionPrompt(messages, targetTokens);

    // Make real API call
    const response = await this.makeAPICall(
      helperConfig,
      [{ role: 'user', content: prompt }],
      targetTokens
    );

    // Extract summary from response
    const summary = response.content[0]?.text || '';
    const compressedTokens = response.usage.output_tokens;
    const tokensSaved = originalTokens - compressedTokens;

    // Create compacted messages (summary + keep most recent messages)
    const recentCount = Math.min(5, messages.length);
    const recentMessages = messages.slice(-recentCount);
    const compactedMessages: HelperCanonicalMessage[] = [
      {
        role: 'system',
        content: `[Compacted History]\n${summary}`
      },
      ...recentMessages
    ];

    const processingTime = Date.now() - startTime;
    const cost = this.calculateCost(
      response.usage.input_tokens,
      response.usage.output_tokens,
      helperConfig
    );

    return {
      summary,
      compactedMessages,
      originalTokens,
      compressedTokens,
      tokensSaved,
      helperModelId: helperConfig.id,
      processingTime,
      cost
    };
  }

  /**
   * Summarize tool result via Messages API helper model
   */
  async summarizeToolResult(
    toolResult: string,
    helperConfig: ModelConfig,
    maxTokens: number
  ): Promise<ToolSummaryResult> {
    const startTime = Date.now();

    // Estimate original tokens
    const originalTokens = this.estimateTokens(toolResult);

    // Create summarization prompt
    const prompt = this.createToolSummaryPrompt(toolResult, maxTokens);

    // Make real API call
    const response = await this.makeAPICall(
      helperConfig,
      [{ role: 'user', content: prompt }],
      maxTokens
    );

    // Extract summary from response
    const summary = response.content[0]?.text || '';
    const summaryTokens = response.usage.output_tokens;
    const tokensSaved = originalTokens - summaryTokens;

    const processingTime = Date.now() - startTime;
    const cost = this.calculateCost(
      response.usage.input_tokens,
      response.usage.output_tokens,
      helperConfig
    );

    return {
      summary,
      originalTokens,
      summaryTokens,
      tokensSaved,
      helperModelId: helperConfig.id,
      processingTime,
      cost
    };
  }

  /**
   * Compact with chunking for large content
   * Uses smart chunking from base adapter
   */
  private async compactWithChunking(
    messages: HelperCanonicalMessage[],
    helperConfig: ModelConfig,
    targetTokens: number,
    startTime: number
  ): Promise<CompactionResult> {
    const originalText = this.extractTextContent(messages);
    const originalTokens = this.estimateTokens(originalText);

    // Use base class smart chunking
    const chunks = this.chunkContent(originalText, helperConfig, targetTokens);
    const chunkSummaries: string[] = [];

    console.log(` Processing ${chunks.length} chunks (smart chunking for ${this.getContextInfo(helperConfig)})...`);

    // Compress each chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk) continue;

      console.log(` ⏳ Chunk ${i + 1}/${chunks.length} (${this.estimateTokens(chunk)} tokens)...`);

      try {
        const response = await this.makeAPICall(
          helperConfig,
          [{ role: 'user', content: `Summarize in ${Math.floor(targetTokens / chunks.length)} tokens:\n\n${chunk}` }],
          Math.floor(targetTokens / chunks.length)
        );

        chunkSummaries.push(response.content[0]?.text || '');
      } catch (error: any) {
        console.warn(` ⚠  Chunk ${i + 1} failed: ${error.message}`);
        chunkSummaries.push(`[Chunk ${i + 1} compression failed]`);
      }
    }

    // Combine and potentially do final pass
    const combinedSummary = chunkSummaries.join('\n\n---\n\n');
    const combinedTokens = this.estimateTokens(combinedSummary);

    if (combinedTokens > targetTokens) {
      console.log(` Final compression pass (${combinedTokens} → ${targetTokens} tokens)...`);
      const finalResponse = await this.makeAPICall(
        helperConfig,
        [{ role: 'user', content: `Combine these summaries into ${targetTokens} tokens:\n\n${combinedSummary}` }],
        targetTokens
      );

      const finalSummary = finalResponse.content[0]?.text || '';
      const compressedTokens = finalResponse.usage.output_tokens;

      const recentCount = Math.min(5, messages.length);
      const recentMessages = messages.slice(-recentCount);
      const compactedMessages: HelperCanonicalMessage[] = [
        { role: 'system', content: `[Compacted History]\n${finalSummary}` },
        ...recentMessages
      ];

      const processingTime = Date.now() - startTime;
      const cost = this.calculateCost(finalResponse.usage.input_tokens, compressedTokens, helperConfig);

      return {
        summary: finalSummary,
        compactedMessages,
        originalTokens,
        compressedTokens,
        tokensSaved: originalTokens - compressedTokens,
        helperModelId: helperConfig.id,
        processingTime,
        cost
      };
    }

    // Use combined summary
    const recentCount = Math.min(5, messages.length);
    const recentMessages = messages.slice(-recentCount);
    const compactedMessages: HelperCanonicalMessage[] = [
      { role: 'system', content: `[Compacted History]\n${combinedSummary}` },
      ...recentMessages
    ];

    const processingTime = Date.now() - startTime;
    const cost = this.calculateCost(originalTokens, combinedTokens, helperConfig);

    return {
      summary: combinedSummary,
      compactedMessages,
      originalTokens,
      compressedTokens: combinedTokens,
      tokensSaved: originalTokens - combinedTokens,
      helperModelId: helperConfig.id,
      processingTime,
      cost
    };
  }

  async generate(
    messages: HelperCanonicalMessage[],
    helperConfig: ModelConfig,
    maxTokens: number
  ): Promise<string> {
    const apiMessages: MessagesAPIMessage[] = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content : m.content.map((b: any) => b.text || '').join('\n'),
      }));
    const response = await this.makeAPICall(helperConfig, apiMessages, maxTokens);
    const content = response.content;
    if (Array.isArray(content)) {
      return content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    }
    return typeof content === 'string' ? content : '';
  }

  /**
   * Make real API call to Messages API endpoint
   *
   * CRITICAL: This makes REAL API calls, not mocks!
   */
  protected async makeAPICall(
    config: ModelConfig,
    messages: MessagesAPIMessage[],
    maxTokens: number,
    systemPrompt?: string
  ): Promise<MessagesAPIResponse> {
    // Get authentication token and type (supports OAuth for Anthropic, API keys for others)
    let apiKey: string;
    let isOAuth = false;

    if (config.provider === 'anthropic') {
      // Use OAuth-aware credential service for Anthropic (Claude)
      const authMethod = (process.env.ANTHROPIC_AUTH_METHOD || 'auto') as AuthMethod;
      try {
        const credential = anthropicCredentialService.loadCredential(authMethod);
        apiKey = credential.token;
        isOAuth = credential.type === 'oauth';

        if (process.env.DEBUG === 'true') {
          console.log(`[MessagesAPIHelper] Using Anthropic credential: ${anthropicCredentialService.getCredentialSummary(credential)}`);
        }
      } catch (error) {
        if (error instanceof CredentialError) {
          throw new Error(
            `MessagesAPIHelper: Anthropic authentication failed: ${error.message}`
          );
        }
        throw error;
      }
    } else {
      // Direct env var access for non-Anthropic providers
      const envKey = process.env[config.api.apiKeyEnvVar];
      if (!envKey) {
        throw new Error(
          `MessagesAPIHelper: API key not found in environment variable: ${config.api.apiKeyEnvVar}`
        );
      }
      apiKey = envKey;
    }

    // Get request URL (endpoint contains full URL)
    const url = config.api.endpoint;

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    // Add authentication header (OAuth uses Authorization: Bearer, API keys use x-api-key)
    if (config.provider === 'anthropic' && isOAuth) {
      // OAuth: Use Authorization: Bearer
      headers['Authorization'] = `Bearer ${apiKey}`;
    } else {
      // API Key or non-Anthropic: Use configured auth header
      const authPrefix = config.api.authPrefix ? `${config.api.authPrefix} ` : '';
      headers[config.api.authHeader] = `${authPrefix}${apiKey}`;
    }

    // Add version header if specified
    if (config.api.versionHeader) {
      headers[config.api.versionHeader.name] = config.api.versionHeader.value;
    }

    // Build request body
    const requestBody: MessagesAPIRequest = {
      model: config.id,
      messages,
      max_tokens: Math.min(maxTokens, config.limits.outputTokens),
      temperature: 0.7
    };

    // Add system prompt if provided
    if (systemPrompt) {
      requestBody.system = systemPrompt;
    }

    // Make real API call
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `MessagesAPIHelper: API call failed (${response.status}): ${errorText}`
      );
    }

    const data = await response.json() as MessagesAPIResponse;
    return data;
  }
}
