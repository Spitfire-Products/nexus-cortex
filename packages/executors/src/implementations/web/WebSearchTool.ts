/**
 * WebSearch Tool Executor — multi-provider.
 *
 * Backends (selected by WEB_TOOLS_MODEL env var):
 *   - Anthropic Claude   → web_search_20250305 server tool
 *   - XAI Grok           → Responses API web_search server tool
 *   - Google Gemini      → googleSearch grounding (UTF-8 byte-accurate citations)
 *   - DuckDuckGo HTML    → fallback when no provider key is available
 *
 * nexus-browser is intentionally not a backend here. It is exposed as a
 * gated MCP server and reached only via the MCP transport.
 */

import { GoogleGenAI } from '@google/genai';
import { BaseTool, type ToolResult } from '../../base/index.js';
import { SchemaValidator } from '../../utils/SchemaValidator.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';
import {
  getWebToolsModel,
  resolveProvider,
  runWebSearch,
} from './webBackends.js';
import { buildBrowseSubagentDispatch } from './BrowseTool.js';

interface GroundingChunkItem {
  web?: { uri?: string; title?: string };
}

interface GroundingSupportItem {
  segment?: { startIndex: number; endIndex: number; text?: string };
  groundingChunkIndices?: number[];
  confidenceScores?: number[];
}

interface GroundingMetadata {
  groundingChunks?: GroundingChunkItem[];
  groundingSupports?: GroundingSupportItem[];
}

export interface WebSearchToolParams {
  /** The search query to find information on the web */
  query: string;
  /**
   * 'fast' (default) → provider-native search via runWebSearch.
   * 'interactive' → dispatch a nexus-browser subagent to search and interact
   * with results pages. Useful when provider-native search misses JS-rendered
   * SPAs or behind-login content.
   */
  mode?: 'fast' | 'interactive';
}

export interface WebSearchToolResult extends ToolResult {
  sources?: GroundingChunkItem[];
}

export class WebSearchTool extends BaseTool<WebSearchToolParams, WebSearchToolResult> {
  private genAI: GoogleGenAI | null = null;

  constructor(private config: ExecutorConfig) {
    super(
      'WebSearch',
      'WebSearch',
      `Performs a web search and returns results with citations.

Backend is selected automatically based on the WEB_TOOLS_MODEL setting and available API keys:
- Anthropic Claude models use the Claude web_search server tool
- XAI Grok models use the XAI Responses API web_search server tool
- OpenAI GPT/o-series models use the Responses API web_search_preview server tool
- Google Gemini models use Google Search grounding via the Gemini API
- A DuckDuckGo HTML fallback is used when no provider is configured

Use this tool to find current information, facts, news, and data from the internet. Results include source attribution.`,
      {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'The search query to find information on the web. Can be a question or keywords.',
          },
          mode: {
            type: 'string',
            enum: ['fast', 'interactive'],
            description:
              "Default 'fast' uses the provider's native search. Set to 'interactive' to dispatch a nexus-browser subagent for JS-rendered SPAs, auth-gated pages, or anything that needs interaction.",
          },
        },
        required: ['query'],
      },
    );
  }

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

  validateToolParams(params: WebSearchToolParams): string | null {
    const schemaError = SchemaValidator.validate(this.parameterSchema, params);
    if (schemaError) return schemaError;
    if (!params.query || params.query.trim() === '') {
      return "The 'query' parameter cannot be empty.";
    }
    return null;
  }

  getDescription(params: WebSearchToolParams): string {
    return `Searching the web for: "${params.query}"`;
  }

  async execute(
    params: WebSearchToolParams,
    signal: AbortSignal,
  ): Promise<WebSearchToolResult> {
    const startTime = Date.now();

    try {
      const validationError = this.validateToolParams(params);
      if (validationError) {
        return {
          ...this.createErrorResult(validationError),
          metadata: { executionTime: Date.now() - startTime },
        };
      }

      // Interactive mode: hand off to nexus-browser subagent. Same dispatch
      // contract as the Browse tool — orchestrator handles the rest.
      if (params.mode === 'interactive') {
        // Recursion guard: inside a subagent, fall through to the fast path
        // instead of trying to spawn another subagent.
        if ((process.env.CORTEX_AGENT_MODE) === 'true') {
          console.warn('[WebSearch] mode=interactive ignored inside subagent (recursion guard) — using fast path');
        } else {
          return buildBrowseSubagentDispatch(
            `Search the web for: ${params.query}\n\n` +
            `Use the nexus-browser tools to navigate search engines if needed, click into results, ` +
            `and extract the most relevant content. Return a concise summary with sources.`,
            undefined,
            `Web search (interactive): ${params.query.slice(0, 80)}`,
            startTime,
          );
        }
      }

      const modelId = getWebToolsModel();
      const provider = resolveProvider(modelId);

      // Gemini path uses the @google/genai SDK directly for byte-accurate citation insertion.
      const useGeminiSdk =
        provider === 'google' &&
        !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);

      if (useGeminiSdk) {
        return await this.runGeminiSearch(params.query, modelId, startTime);
      }

      // Anthropic / XAI / DuckDuckGo fallback.
      const result = await runWebSearch(params.query);
      const formatted = this.formatBackendOutput(result.text, result.sources);

      return {
        ...this.createSuccessResult(formatted),
        sources: result.sources.map((s) => ({ web: { title: s.title, uri: s.url } })),
        metadata: {
          executionTime: Date.now() - startTime,
          query: params.query,
          sourceCount: result.sources.length,
          backend: result.backend,
        },
      };
    } catch (error: any) {
      if (signal.aborted) {
        return {
          ...this.createErrorResult('Search operation was cancelled'),
          metadata: { executionTime: Date.now() - startTime },
        };
      }
      const errorMessage = error?.message ?? String(error);
      return {
        ...this.createErrorResult(`Error performing web search: ${errorMessage}`),
        metadata: { executionTime: Date.now() - startTime, error: errorMessage },
      };
    }
  }

  private formatBackendOutput(
    text: string,
    sources: Array<{ title?: string; url: string }>,
  ): string {
    if (sources.length === 0) return text;
    const list = sources
      .map((s, i) => `[${i + 1}] ${s.title ?? 'Untitled'} (${s.url})`)
      .join('\n');
    return `${text}\n\nSources:\n${list}`;
  }

  private async runGeminiSearch(
    query: string,
    modelId: string,
    startTime: number,
  ): Promise<WebSearchToolResult> {
    const genAI = this.getGeminiClient();

    const result = await genAI.models.generateContent({
      model: modelId,
      contents: query,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    let responseText = result.text || '';

    const candidate = result.candidates?.[0];
    const groundingMetadata = (candidate as any)?.groundingMetadata as
      | GroundingMetadata
      | undefined;
    const sources = groundingMetadata?.groundingChunks as GroundingChunkItem[] | undefined;
    const groundingSupports = groundingMetadata?.groundingSupports as
      | GroundingSupportItem[]
      | undefined;

    if (!responseText || !responseText.trim()) {
      return {
        ...this.createSuccessResult(
          `No search results or information found for query: "${query}"`,
        ),
        sources: [],
        metadata: {
          executionTime: Date.now() - startTime,
          query,
          sourceCount: 0,
          backend: 'gemini-googleSearch',
        },
      };
    }

    if (groundingSupports && groundingSupports.length > 0) {
      responseText = this.insertCitationsUTF8(responseText, groundingSupports);
    }

    if (sources && sources.length > 0) {
      const sourceList = sources
        .map((source, index) => {
          const title = source.web?.title || 'Untitled';
          const uri = source.web?.uri || 'No URI';
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
        query,
        sourceCount: sources?.length ?? 0,
        backend: 'gemini-googleSearch',
      },
    };
  }

  /**
   * Insert citations at UTF-8 byte-accurate positions. Gemini grounding
   * metadata uses byte offsets (not character indices), so multi-byte UTF-8
   * characters must be handled via TextEncoder/TextDecoder.
   */
  private insertCitationsUTF8(
    responseText: string,
    groundingSupports: GroundingSupportItem[],
  ): string {
    if (!groundingSupports || groundingSupports.length === 0) return responseText;

    const insertions: Array<{ index: number; marker: string }> = [];
    for (const support of groundingSupports) {
      if (support.segment && support.groundingChunkIndices) {
        const marker = support.groundingChunkIndices
          .map((i) => `[${i + 1}]`)
          .join('');
        insertions.push({ index: support.segment.endIndex, marker });
      }
    }
    insertions.sort((a, b) => b.index - a.index);

    const encoder = new TextEncoder();
    const responseBytes = encoder.encode(responseText);
    const parts: Uint8Array[] = [];
    let lastIndex = responseBytes.length;

    for (const ins of insertions) {
      const pos = Math.min(ins.index, lastIndex);
      parts.unshift(responseBytes.subarray(pos, lastIndex));
      parts.unshift(encoder.encode(ins.marker));
      lastIndex = pos;
    }
    parts.unshift(responseBytes.subarray(0, lastIndex));

    const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
    const finalBytes = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
      finalBytes.set(part, offset);
      offset += part.length;
    }
    return new TextDecoder().decode(finalBytes);
  }
}
