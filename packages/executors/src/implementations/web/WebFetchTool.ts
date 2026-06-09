/**
 * WebFetch Tool Executor
 *
 * Processes content from URLs embedded in a prompt using Gemini API's built-in urlContext tool.
 * Includes fallback to local fetch + html-to-text for private IPs and failed requests.
 *
 * Based on Gemini CLI web-fetch.ts implementation
 * Uses FREE Gemini API built-in tools with automatic fallback
 */

import { GoogleGenAI } from '@google/genai';
import { convert } from 'html-to-text';
import { BaseTool, type ToolResult } from '../../base/index.js';
import { SchemaValidator } from '../../utils/SchemaValidator.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';
import {
  resolveProvider,
  anthropicFetch,
  xaiFetch,
  openaiFetch,
  type BackendResult,
} from './webBackends.js';
import { browseEscalationDirective } from './escalateDirective.js';
import { buildBrowserFetchInit } from './webFetchRequestInit.js';

// Selected web tools model — read at call time so /set updates apply live.
// Empty string means "no provider configured" → direct-fetch fallback.
const getWebToolsModel = () => process.env.WEB_TOOLS_MODEL?.trim() || '';

// Fetch configuration
const URL_FETCH_TIMEOUT_MS = 30000; // 30s — gov/county sites are often slow
const MAX_CONTENT_LENGTH = 100000; // 100,000 characters

/**
 * Grounding metadata structures from Gemini API
 */
interface GroundingChunkItem {
  web?: {
    uri?: string;
    title?: string;
  };
}

interface GroundingSupportItem {
  segment?: {
    startIndex: number; // UTF-8 byte position
    endIndex: number; // UTF-8 byte position
    text?: string;
  };
  groundingChunkIndices?: number[];
  confidenceScores?: number[];
}

interface GroundingMetadata {
  groundingChunks?: GroundingChunkItem[];
  groundingSupports?: GroundingSupportItem[];
}

interface URLMetadata {
  url: string;
  urlRetrievalStatus: 'URL_RETRIEVAL_STATUS_SUCCESS' | 'URL_RETRIEVAL_STATUS_FAILED';
}

interface URLContextMetadata {
  urlMetadata?: URLMetadata[];
}

/**
 * Parameters for the WebFetch tool
 */
export interface WebFetchToolParams {
  /**
   * Comprehensive prompt with URL(s) and processing instructions
   */
  prompt: string;
}

/**
 * Extended result with grounding metadata
 */
export interface WebFetchToolResult extends ToolResult {
  sources?: GroundingChunkItem[];
}

/**
 * WebFetch Tool Executor
 *
 * Features:
 * - Uses Gemini API urlContext built-in tool (FREE)
 * - Automatic grounding metadata with source attribution
 * - UTF-8 byte-accurate citation insertion
 * - Fallback to local fetch + html-to-text for:
 *   - Private IPs (localhost, 192.168.x.x, etc.)
 *   - Failed URL retrievals
 * - GitHub blob URL → raw URL conversion
 * - HTML to text conversion
 */
export class WebFetchTool extends BaseTool<WebFetchToolParams, WebFetchToolResult> {
  private genAI: GoogleGenAI | null = null;

  constructor(private config: ExecutorConfig) {
    super(
      'WebFetch',
      'WebFetch',
      `Processes content from URL(s), including local and private network addresses (e.g., localhost), embedded in a prompt.

Include up to 20 URLs and instructions directly in the 'prompt' parameter. The tool fetches and processes the content, returning structured information with citations.`,
      {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description:
              'A comprehensive prompt that includes the URL(s) (up to 20) to fetch and specific instructions on how to process their content (e.g., "Summarize https://example.com/article and extract key points from https://another.com/data"). All URLs must be valid and complete, starting with "http://" or "https://".',
          },
        },
        required: ['prompt'],
      },
    );
  }

  /**
   * Initialize Gemini API client
   */
  private getGeminiClient(): GoogleGenAI {
    if (!this.genAI) {
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (!apiKey) {
        throw new Error(
          'Google API key not found. Please set GEMINI_API_KEY or GOOGLE_API_KEY environment variable.',
        );
      }
      this.genAI = new GoogleGenAI({ apiKey });
    }
    return this.genAI;
  }

  validateToolParams(params: WebFetchToolParams): string | null {
    // Models frequently send { url: "...", prompt: "instructions" } instead of
    // embedding the URL in the prompt string. Merge url into prompt so
    // downstream parsing and provider dispatch see it.
    const extra = (params as any).url;
    if (typeof extra === 'string' && extra.trim()) {
      const trimmed = extra.trim();
      if (!params.prompt.includes(trimmed)) {
        params.prompt = `${trimmed} ${params.prompt}`;
      }
    }

    // Schema validation
    const schemaError = SchemaValidator.validate(this.parameterSchema, params);
    if (schemaError) {
      return schemaError;
    }

    // Empty prompt check
    if (!params.prompt || params.prompt.trim() === '') {
      return "The 'prompt' parameter cannot be empty and must contain URL(s) and instructions.";
    }

    // Parse and validate URLs
    const { validUrls, errors } = this.parsePrompt(params.prompt);

    if (errors.length > 0) {
      return `Error(s) in prompt URLs:\n- ${errors.join('\n- ')}`;
    }

    if (validUrls.length === 0) {
      return "The 'prompt' must contain at least one valid URL (starting with http:// or https://).";
    }

    return null;
  }

  getDescription(params: WebFetchToolParams): string {
    const displayPrompt =
      params.prompt.length > 100 ? params.prompt.substring(0, 97) + '...' : params.prompt;
    return `Processing URLs and instructions from prompt: "${displayPrompt}"`;
  }

  async execute(
    params: WebFetchToolParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<WebFetchToolResult> {
    const startTime = Date.now();

    try {
      // Validate parameters
      const validationError = this.validateToolParams(params);
      if (validationError) {
        return {
          ...this.createErrorResult(validationError),
          metadata: {
            executionTime: Date.now() - startTime,
          },
        };
      }

      // Parse URLs from prompt
      const { validUrls: urls } = this.parsePrompt(params.prompt);

      // Should not happen due to validation, but check anyway
      if (urls.length === 0) {
        return {
          ...this.createErrorResult('No valid URLs found in prompt'),
          metadata: { executionTime: Date.now() - startTime },
        };
      }

      const url = urls[0]!; // Primary URL (guaranteed by validation check above)

      // Check for private IP - use direct-fetch fallback immediately (any provider's
      // hosted web tool will refuse to fetch private IPs anyway).
      if (this.isPrivateIp(url)) {
        return await this.executeFallback(params, url, signal, startTime);
      }

      // Provider-native dispatch: Anthropic + XAI go through their server-side
      // web tools. Google Gemini and the no-provider case fall through to the
      // existing urlContext pipeline (with direct-fetch fallback).
      const modelId = getWebToolsModel();
      const provider = resolveProvider(modelId);

      if (provider === 'anthropic' && process.env.ANTHROPIC_API_KEY) {
        try {
          const r = await anthropicFetch(params.prompt, modelId);
          return this.formatBackendResult(r, urls, startTime);
        } catch (err: any) {
          console.warn(`[web-tools] anthropic fetch failed: ${err.message}`);
          return await this.executeFallback(params, url, signal, startTime);
        }
      }

      if (provider === 'xai' && process.env.XAI_API_KEY) {
        try {
          const r = await xaiFetch(params.prompt, modelId);
          return this.formatBackendResult(r, urls, startTime);
        } catch (err: any) {
          console.warn(`[web-tools] xai fetch failed: ${err.message}`);
          return await this.executeFallback(params, url, signal, startTime);
        }
      }

      if (provider === 'openai' && process.env.OPENAI_API_KEY) {
        try {
          const r = await openaiFetch(params.prompt, modelId);
          return this.formatBackendResult(r, urls, startTime);
        } catch (err: any) {
          console.warn(`[web-tools] openai fetch failed: ${err.message}`);
          return await this.executeFallback(params, url, signal, startTime);
        }
      }

      // No Gemini key + no other provider key → skip Gemini SDK call, go to fallback.
      const hasGeminiKey = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
      if (!hasGeminiKey) {
        return await this.executeFallback(params, url, signal, startTime);
      }

      // Try primary execution with urlContext (Gemini)
      return await this.executePrimary(params, urls, signal, startTime);
    } catch (error: any) {
      // Check for abort
      if (signal.aborted) {
        return {
          ...this.createErrorResult('Fetch operation was cancelled'),
          metadata: {
            executionTime: Date.now() - startTime,
          },
        };
      }

      // Handle API errors - try fallback
      const { validUrls: urls } = this.parsePrompt(params.prompt);
      if (urls.length > 0 && urls[0]) {
        try {
          return await this.executeFallback(params, urls[0], signal, startTime);
        } catch (fallbackError: any) {
          const errorMessage = fallbackError.message || String(fallbackError);
          return {
            ...this.createErrorResult(
              `Error processing web content: ${errorMessage}\n\n` +
                browseEscalationDirective(urls[0]),
            ),
            metadata: {
              executionTime: Date.now() - startTime,
              error: errorMessage,
            },
          };
        }
      }

      const errorMessage = error.message || String(error);
      const { validUrls: failedUrls } = this.parsePrompt(params.prompt);
      return {
        ...this.createErrorResult(
          `Error processing web content: ${errorMessage}\n\n` +
            browseEscalationDirective(failedUrls[0]),
        ),
        metadata: {
          executionTime: Date.now() - startTime,
          error: errorMessage,
        },
      };
    }
  }

  /**
   * Format a provider-native backend result into the WebFetch tool result shape.
   */
  private formatBackendResult(
    r: BackendResult,
    urls: string[],
    startTime: number,
  ): WebFetchToolResult {
    let body = r.text;
    if (r.sources.length > 0) {
      const list = r.sources
        .map((s, i) => `[${i + 1}] ${s.title ?? 'Untitled'} (${s.url})`)
        .join('\n');
      body += `\n\nSources:\n${list}`;
    }
    return {
      ...this.createSuccessResult(body),
      sources: r.sources.map((s) => ({ web: { title: s.title, uri: s.url } })),
      metadata: {
        executionTime: Date.now() - startTime,
        urls,
        sourceCount: r.sources.length,
        method: 'primary',
        backend: r.backend,
      },
    };
  }

  /**
   * Primary execution using Gemini API urlContext
   */
  private async executePrimary(
    params: WebFetchToolParams,
    urls: string[],
    signal: AbortSignal,
    startTime: number,
  ): Promise<WebFetchToolResult> {
    // Get Gemini client
    const genAI = this.getGeminiClient();

    // Make request with urlContext tool enabled
    const result = await genAI.models.generateContent({
      model: getWebToolsModel(),
      contents: params.prompt,
      config: {
        tools: [{ urlContext: {} }],
      },
    });

    // Extract response and metadata
    let responseText = result.text || '';
    const candidate = result.candidates?.[0];
    const urlContextMeta = (candidate as any)?.urlContextMetadata as
      | URLContextMetadata
      | undefined;
    const groundingMetadata = (candidate as any)?.groundingMetadata as
      | GroundingMetadata
      | undefined;
    const sources = groundingMetadata?.groundingChunks as GroundingChunkItem[] | undefined;
    const groundingSupports = groundingMetadata?.groundingSupports as
      | GroundingSupportItem[]
      | undefined;

    // Check for processing errors
    let processingError = false;

    if (urlContextMeta?.urlMetadata && urlContextMeta.urlMetadata.length > 0) {
      const allStatuses = urlContextMeta.urlMetadata.map((m) => m.urlRetrievalStatus);
      if (allStatuses.every((s) => s !== 'URL_RETRIEVAL_STATUS_SUCCESS')) {
        processingError = true;
      }
    } else if (!responseText.trim() && !sources?.length) {
      processingError = true;
    }

    if (!processingError && !responseText.trim() && (!sources || sources.length === 0)) {
      processingError = true;
    }

    // Fallback if primary failed
    if (processingError) {
      return await this.executeFallback(params, urls[0]!, signal, startTime);
    }

    // Insert citations (UTF-8 byte-accurate)
    if (groundingSupports && groundingSupports.length > 0) {
      responseText = this.insertCitationsUTF8(responseText, groundingSupports);
    }

    // Append source list
    if (sources && sources.length > 0) {
      const sourceList = sources
        .map((source, index) => {
          const title = source.web?.title || 'Untitled';
          const uri = source.web?.uri || 'Unknown URI';
          return `[${index + 1}] ${title} (${uri})`;
        })
        .join('\n');

      responseText += `\n\nSources:\n${sourceList}`;
    }

    return {
      ...this.createSuccessResult(responseText),
      sources,
      metadata: {
        executionTime: Date.now() - startTime,
        urls,
        sourceCount: sources?.length || 0,
        method: 'primary',
      },
    };
  }

  /**
   * Fallback execution using local fetch + html-to-text
   */
  private async executeFallback(
    params: WebFetchToolParams,
    url: string,
    signal: AbortSignal,
    startTime: number,
  ): Promise<WebFetchToolResult> {
    // Convert GitHub blob URL to raw URL
    if (url.includes('github.com') && url.includes('/blob/')) {
      url = url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
    }

    // Fetch with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), URL_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, buildBrowserFetchInit(controller.signal));

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(
          `Request failed with status code ${response.status} ${response.statusText}`,
        );
      }

      const rawContent = await response.text();
      const contentType = response.headers.get('content-type') || '';
      let textContent: string;

      // Use html-to-text for HTML content
      if (contentType.toLowerCase().includes('text/html') || contentType === '') {
        textContent = convert(rawContent, {
          wordwrap: false,
          selectors: [
            { selector: 'a', options: { ignoreHref: true } },
            { selector: 'img', format: 'skip' },
          ],
        });
      } else {
        // For other content types (text/plain, JSON, etc.), use raw text
        textContent = rawContent;
      }

      // Truncate to max length
      textContent = textContent.substring(0, MAX_CONTENT_LENGTH);

      // Send to Gemini Flash for processing
      const genAI = this.getGeminiClient();

      const fallbackPrompt = `The user requested the following: "${params.prompt}".

I was unable to access the URL directly. Instead, I have fetched the raw content of the page. Please use the following content to answer the request. Do not attempt to access the URL again.

---
${textContent}
---
`;

      const result = await genAI.models.generateContent({
        model: getWebToolsModel(),
        contents: fallbackPrompt,
      });

      const resultText = result.text || '';

      return {
        ...this.createSuccessResult(resultText),
        metadata: {
          executionTime: Date.now() - startTime,
          url,
          fallback: true,
          method: 'fallback',
        },
      };
    } catch (error: any) {
      clearTimeout(timeout);
      throw new Error(`Error during fallback fetch for ${url}: ${error.message}`);
    }
  }

  /**
   * Parse URLs from prompt text
   */
  private parsePrompt(text: string): {
    validUrls: string[];
    errors: string[];
  } {
    const tokens = text.split(/\s+/);
    const validUrls: string[] = [];
    const errors: string[] = [];

    for (const token of tokens) {
      if (!token) continue;

      // Heuristic: check for :// in token
      if (token.includes('://')) {
        try {
          const url = new URL(token);

          // Allow only http/https
          if (['http:', 'https:'].includes(url.protocol)) {
            validUrls.push(url.href);
          } else {
            errors.push(
              `Unsupported protocol in URL: "${token}". Only http and https are supported.`,
            );
          }
        } catch {
          errors.push(`Malformed URL detected: "${token}".`);
        }
      }
    }

    return { validUrls, errors };
  }

  /**
   * Check if URL points to a private IP address
   */
  private isPrivateIp(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      const hostname = parsedUrl.hostname;

      // Check for localhost
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
        return true;
      }

      // Check for private IP ranges
      const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
      const match = hostname.match(ipv4Regex);
      if (match) {
        const parts = match.slice(1).map(Number); // Extract octets
        const [a, b, c, d] = parts;

        // 10.0.0.0/8
        if (a === 10) return true;

        // 172.16.0.0/12
        if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;

        // 192.168.0.0/16
        if (a === 192 && b === 168) return true;

        // 169.254.0.0/16 (link-local)
        if (a === 169 && b === 254) return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Insert citations at UTF-8 byte-accurate positions
   *
   * Gemini API returns byte positions (not character positions) for grounding metadata.
   * This method handles multi-byte UTF-8 characters correctly.
   *
   * @param responseText The response text to insert citations into
   * @param groundingSupports Array of grounding support items with byte positions
   * @returns Text with citations inserted
   */
  private insertCitationsUTF8(
    responseText: string,
    groundingSupports: GroundingSupportItem[],
  ): string {
    if (!groundingSupports || groundingSupports.length === 0) {
      return responseText;
    }

    // Collect insertion points
    const insertions: Array<{ index: number; marker: string }> = [];

    for (const support of groundingSupports) {
      if (support.segment && support.groundingChunkIndices) {
        const citationMarker = support.groundingChunkIndices
          .map((chunkIndex) => `[${chunkIndex + 1}]`)
          .join('');
        insertions.push({
          index: support.segment.endIndex,
          marker: citationMarker,
        });
      }
    }

    // Sort in descending order to avoid index shifting
    insertions.sort((a, b) => b.index - a.index);

    // Use TextEncoder/TextDecoder for UTF-8 byte manipulation
    const encoder = new TextEncoder();
    const responseBytes = encoder.encode(responseText);
    const parts: Uint8Array[] = [];
    let lastIndex = responseBytes.length;

    for (const ins of insertions) {
      const pos = Math.min(ins.index, lastIndex);
      parts.unshift(responseBytes.subarray(pos, lastIndex)); // Content after marker
      parts.unshift(encoder.encode(ins.marker)); // Marker
      lastIndex = pos;
    }
    parts.unshift(responseBytes.subarray(0, lastIndex)); // Content before first marker

    // Concatenate byte arrays
    const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
    const finalBytes = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
      finalBytes.set(part, offset);
      offset += part.length;
    }

    // Decode back to string
    return new TextDecoder().decode(finalBytes);
  }
}
