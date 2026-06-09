/**
 * RequestHistoricalContext Tool
 *
 * Requests historical context using a cheap helper model (e.g., FREE Gemma).
 * Cost-effective way to access archived context outside the main model's window.
 *
 * Phase 1.5: Week 3 Implementation
 * Based on: CORTEX_V4_PHASE_1.5_ARCHITECTURE.md, Part 4
 */

import type { Message } from '../../session/MessageTypes.js';
import { isSystemMessage } from '../../session/MessageTypes.js';
import { StoredCompactionManager } from '../../conversation/StoredCompactionManager.js';
import type { HelperMiddlewareAdapter } from '../../middleware/helpers/HelperMiddlewareAdapter.interface.js';
import type { ModelConfig } from '../../models/ModelConfig.interface.js';

/**
 * Input schema for RequestHistoricalContext tool
 */
export interface RequestHistoricalContextInput {
  /** Query describing what historical context is needed */
  query: string;

  /** Detail level for the response */
  detailLevel?: 'brief' | 'standard' | 'detailed';

  /** Maximum tokens for the response */
  maxTokens?: number;

  /** Whether to use helper model (vs main model) */
  useHelperModel?: boolean;
}

/**
 * Historical context result
 */
export interface HistoricalContextResult {
  /** Generated context based on the query */
  context: string;

  /** Sources used to generate the context */
  sources: Array<{
    /** Turn number in conversation */
    turnNumber: number;

    /** Timestamp of the source */
    timestamp: Date;

    /** Whether source is from compacted section */
    isCompacted: boolean;

    /** Compaction ID if applicable */
    compactionId?: string;
  }>;

  /** Estimated tokens used */
  tokensUsed: number;

  /** Model used to generate context */
  modelUsed: string;

  /** Processing cost (usually $0 for Gemma) */
  cost: number;

  /** Processing time in milliseconds */
  processingTime: number;
}

/**
 * Tool for requesting historical context via helper models
 */
export class RequestHistoricalContextTool {
  private compactionManager: StoredCompactionManager;
  private helperAdapter?: HelperMiddlewareAdapter;
  private helperConfig?: ModelConfig;

  constructor(
    workspaceRoot?: string,
    helperAdapter?: HelperMiddlewareAdapter,
    helperConfig?: ModelConfig
  ) {
    this.compactionManager = new StoredCompactionManager(workspaceRoot);
    this.helperAdapter = helperAdapter;
    this.helperConfig = helperConfig;
  }

  /**
   * Tool definition for registration
   */
  static get definition() {
    return {
      name: 'RequestHistoricalContext',
      description: 'Request historical context using cheap helper model. Cost-effective for accessing archived context.',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Query describing what historical context is needed'
          },
          detailLevel: {
            type: 'string',
            enum: ['brief', 'standard', 'detailed'],
            description: 'Detail level for the response',
            default: 'standard'
          },
          maxTokens: {
            type: 'number',
            description: 'Maximum tokens for the response',
            default: 1000
          },
          useHelperModel: {
            type: 'boolean',
            description: 'Whether to use helper model (vs main model)',
            default: true
          }
        },
        required: ['query']
      }
    };
  }

  /**
   * Execute the historical context request
   */
  async execute(
    input: RequestHistoricalContextInput,
    sessionId: string,
    recentMessages: Message[]
  ): Promise<HistoricalContextResult> {
    const startTime = Date.now();
    const detailLevel = input.detailLevel || 'standard';
    const maxTokens = input.maxTokens || 1000;
    const useHelperModel = input.useHelperModel !== false;

    // Gather relevant historical data
    const relevantData = await this.gatherRelevantData(
      input.query,
      sessionId,
      recentMessages
    );

    // Generate context based on detail level
    let context: string;
    let modelUsed: string;
    let cost: number;

    if (useHelperModel && this.helperAdapter) {
      // Use FREE Gemma model
      const result = await this.generateContextWithGemma(
        relevantData,
        input.query,
        detailLevel,
        maxTokens
      );
      context = result.context;
      modelUsed = result.model;
      cost = 0; // Gemma is FREE!
    } else {
      // Fallback to simple extraction
      context = this.generateSimpleContext(
        relevantData,
        input.query,
        detailLevel,
        maxTokens
      );
      modelUsed = 'simple-extraction';
      cost = 0;
    }

    const processingTime = Date.now() - startTime;

    return {
      context,
      sources: relevantData.sources,
      tokensUsed: Math.ceil(context.length / 4), // Estimate
      modelUsed,
      cost,
      processingTime
    };
  }

  /**
   * Gather relevant data for the query
   */
  private async gatherRelevantData(
    query: string,
    sessionId: string,
    recentMessages: Message[]
  ): Promise<{
    content: string;
    sources: Array<{
      turnNumber: number;
      timestamp: Date;
      isCompacted: boolean;
      compactionId?: string;
    }>;
  }> {
    const sources: Array<{
      turnNumber: number;
      timestamp: Date;
      isCompacted: boolean;
      compactionId?: string;
    }> = [];

    const contentParts: string[] = [];

    // Search compactions for relevant content
    const compactions = await this.compactionManager.searchCompactions(query, sessionId);

    for (const compaction of compactions.slice(0, 3)) { // Limit to top 3
      contentParts.push(
        `[Compacted Section - Turns ${compaction.timeline.turnRange.start}-${compaction.timeline.turnRange.end}]\n` +
        `${compaction.summaries.standard}\n`
      );

      sources.push({
        turnNumber: compaction.timeline.turnRange.start,
        timestamp: new Date(compaction.timestamp),
        isCompacted: true,
        compactionId: compaction.id
      });
    }

    // Search recent messages
    const queryLower = query.toLowerCase();
    const relevantMessages = recentMessages.filter(msg => {
      const content = this.extractMessageContent(msg);
      return content.toLowerCase().includes(queryLower);
    }).slice(0, 5); // Limit to top 5

    for (const msg of relevantMessages) {
      const index = recentMessages.indexOf(msg);
      const content = this.extractMessageContent(msg);
      const role = this.getMessageRole(msg);
      contentParts.push(
        `[Turn ${index + 1}]\n` +
        `Role: ${role}\n` +
        `Content: ${this.truncateContent(content, 200)}\n`
      );

      sources.push({
        turnNumber: index + 1,
        timestamp: new Date(msg.timestamp),
        isCompacted: false
      });
    }

    return {
      content: contentParts.join('\n---\n'),
      sources
    };
  }

  /**
   * Generate context using configured helper model
   */
  private async generateContextWithGemma(
    relevantData: { content: string; sources: any[] },
    query: string,
    detailLevel: 'brief' | 'standard' | 'detailed',
    maxTokens: number
  ): Promise<{ context: string; model: string }> {
    if (!this.helperAdapter || !this.helperConfig) {
      throw new Error('Helper adapter not configured');
    }

    // Prepare prompt based on detail level
    let prompt: string;
    let targetTokens: number;

    switch (detailLevel) {
      case 'brief':
        targetTokens = Math.min(maxTokens, 200);
        prompt = `Based on the following historical conversation data, provide a BRIEF answer (max ${targetTokens} tokens) to this query: "${query}"

Historical Data:
${relevantData.content}

Provide only the essential information needed to answer the query.`;
        break;

      case 'detailed':
        targetTokens = Math.min(maxTokens, 2000);
        prompt = `Based on the following historical conversation data, provide a DETAILED answer (max ${targetTokens} tokens) to this query: "${query}"

Historical Data:
${relevantData.content}

Include all relevant details, context, and examples from the historical data.`;
        break;

      case 'standard':
      default:
        targetTokens = Math.min(maxTokens, 1000);
        prompt = `Based on the following historical conversation data, provide a clear answer (max ${targetTokens} tokens) to this query: "${query}"

Historical Data:
${relevantData.content}

Provide a comprehensive but concise response with key information.`;
        break;
    }

    // Use configured helper adapter to generate context
    const response = await this.helperAdapter.summarizeToolResult(
      prompt,
      this.helperConfig,
      targetTokens
    );

    return {
      context: response.summary,
      model: response.helperModelId
    };
  }

  /**
   * Generate simple context without helper model
   */
  private generateSimpleContext(
    relevantData: { content: string; sources: any[] },
    query: string,
    detailLevel: 'brief' | 'standard' | 'detailed',
    maxTokens: number
  ): string {
    const lines = relevantData.content.split('\n');
    let context = `Historical context for query: "${query}"\n\n`;

    switch (detailLevel) {
      case 'brief':
        // Take first few lines
        context += lines.slice(0, 10).join('\n');
        break;

      case 'detailed':
        // Take more content
        context += lines.slice(0, 50).join('\n');
        break;

      case 'standard':
      default:
        // Take moderate amount
        context += lines.slice(0, 25).join('\n');
        break;
    }

    // Truncate to max tokens
    const maxChars = maxTokens * 4; // ~4 chars per token
    if (context.length > maxChars) {
      context = context.substring(0, maxChars) + '...';
    }

    return context;
  }

  /**
   * Truncate content to specified length
   */
  private truncateContent(content: string, maxLength: number): string {
    if (content.length <= maxLength) {
      return content;
    }
    return content.substring(0, maxLength) + '...';
  }

  /**
   * Extract content from any message type
   */
  private extractMessageContent(msg: Message): string {
    if (isSystemMessage(msg)) {
      return msg.content;
    }
    if ('message' in msg && msg.message.content) {
      if (typeof msg.message.content === 'string') {
        return msg.message.content;
      }
      return JSON.stringify(msg.message.content);
    }
    return '';
  }

  /**
   * Get role from message
   */
  private getMessageRole(msg: Message): string {
    if (isSystemMessage(msg)) {
      return 'system';
    }
    if ('message' in msg) {
      return msg.message.role;
    }
    return msg.type;
  }

  // Reserved for future query optimization
  // private analyzeQuery(query: string): {
  //   keywords: string[];
  //   timeContext?: 'recent' | 'old' | 'all';
  //   searchType: 'specific' | 'broad' | 'summary';
  // } {
  //   const queryLower = query.toLowerCase();
  //   const keywords = queryLower
  //     .split(/\s+/)
  //     .filter(w => w.length > 3 && !['what', 'when', 'where', 'how', 'why', 'the', 'and', 'for'].includes(w));
  //   let timeContext: 'recent' | 'old' | 'all' | undefined;
  //   if (queryLower.includes('recent') || queryLower.includes('just') || queryLower.includes('latest')) {
  //     timeContext = 'recent';
  //   } else if (queryLower.includes('earlier') || queryLower.includes('before') || queryLower.includes('previous')) {
  //     timeContext = 'old';
  //   } else {
  //     timeContext = 'all';
  //   }
  //   let searchType: 'specific' | 'broad' | 'summary';
  //   if (queryLower.includes('summary') || queryLower.includes('overview') || queryLower.includes('general')) {
  //     searchType = 'summary';
  //   } else if (keywords.length <= 2) {
  //     searchType = 'specific';
  //   } else {
  //     searchType = 'broad';
  //   }
  //   return { keywords, timeContext, searchType };
  // }
}