/**
 * GetConversationSegment Tool
 *
 * Retrieves specific segments of conversation history at different detail levels.
 * Can retrieve by turn range or checkpoint ID.
 *
 * Phase 1.5: Week 3 Implementation
 * Based on: CORTEX_V4_PHASE_1.5_ARCHITECTURE.md, Part 4
 */

import type { Message, SystemMessage } from '../../session/MessageTypes.js';
import { isSystemMessage, isUserMessage, isAssistantMessage, isToolUseMessage } from '../../session/MessageTypes.js';
import { StoredCompactionManager, StoredCompaction } from '../../conversation/StoredCompactionManager.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Input schema for GetConversationSegment tool
 */
export interface GetConversationSegmentInput {
  /** Turn range to retrieve */
  turnRange?: {
    start: number;
    end: number;
  };

  /** Checkpoint ID to retrieve from */
  checkpointId?: string;

  /** Format of the returned segment */
  format?: 'full' | 'summary' | 'compressed';
}

/**
 * Conversation segment result
 */
export interface ConversationSegment {
  /** Messages in the segment (if full format) */
  messages?: Message[];

  /** Summary of the segment (if summary/compressed format) */
  summary?: string;

  /** Metadata about the segment */
  metadata: {
    /** Total estimated tokens in segment */
    totalTokens: number;

    /** Turn range of the segment */
    turnRange: {
      start: number;
      end: number;
    };

    /** Whether segment includes compacted messages */
    hasCompactions: boolean;

    /** Number of messages in segment */
    messageCount: number;
  };
}

/**
 * Tool for retrieving conversation segments
 */
export class GetConversationSegmentTool {
  private compactionManager: StoredCompactionManager;

  constructor(workspaceRoot?: string) {
    this.compactionManager = new StoredCompactionManager(workspaceRoot);
  }

  /**
   * Tool definition for registration
   */
  static get definition() {
    return {
      name: 'GetConversationSegment',
      description: 'Retrieve a specific segment of conversation history at different detail levels',
      input_schema: {
        type: 'object',
        properties: {
          turnRange: {
            type: 'object',
            properties: {
              start: {
                type: 'number',
                description: 'Starting turn number (1-based)'
              },
              end: {
                type: 'number',
                description: 'Ending turn number (inclusive)'
              }
            },
            description: 'Turn range to retrieve'
          },
          checkpointId: {
            type: 'string',
            description: 'Checkpoint ID to retrieve from'
          },
          format: {
            type: 'string',
            enum: ['full', 'summary', 'compressed'],
            description: 'Format of the returned segment',
            default: 'summary'
          }
        }
      }
    };
  }

  /**
   * Execute the segment retrieval
   */
  async execute(
    input: GetConversationSegmentInput,
    sessionId: string,
    allMessages: Message[]
  ): Promise<ConversationSegment> {
    const format = input.format || 'summary';

    // Determine turn range
    let startTurn = 1;
    let endTurn = allMessages.length;

    if (input.turnRange) {
      startTurn = Math.max(1, input.turnRange.start);
      endTurn = Math.min(allMessages.length, input.turnRange.end);
    } else if (input.checkpointId) {
      // Find checkpoint in messages (simplified - real implementation would use SessionTimeline)
      const checkpointIndex = allMessages.findIndex(
        msg => msg.timeline?.checkpointId === input.checkpointId
      );
      if (checkpointIndex >= 0) {
        startTurn = checkpointIndex + 1;
      }
    }

    // Get messages in range
    const segmentMessages = allMessages.slice(startTurn - 1, endTurn);

    // Check for compactions in this range
    const compactions = await this.findCompactionsInRange(
      sessionId,
      startTurn,
      endTurn
    );

    // Build segment based on format
    const segment = await this.buildSegment(
      segmentMessages,
      compactions,
      format,
      startTurn,
      endTurn
    );

    return segment;
  }

  /**
   * Find compactions within a turn range
   */
  private async findCompactionsInRange(
    sessionId: string,
    startTurn: number,
    endTurn: number
  ): Promise<StoredCompaction[]> {
    const allCompactions = await this.compactionManager.queryCompactions({
      sessionId,
      status: 'active'
    });

    return allCompactions.filter(c => {
      const range = c.timeline.turnRange;
      return (
        (range.start >= startTurn && range.start <= endTurn) ||
        (range.end >= startTurn && range.end <= endTurn) ||
        (range.start <= startTurn && range.end >= endTurn)
      );
    });
  }

  /**
   * Build segment based on format
   */
  private async buildSegment(
    messages: Message[],
    compactions: StoredCompaction[],
    format: 'full' | 'summary' | 'compressed',
    startTurn: number,
    endTurn: number
  ): Promise<ConversationSegment> {
    const hasCompactions = compactions.length > 0;
    const totalTokens = this.estimateTokens(messages);

    const metadata = {
      totalTokens,
      turnRange: { start: startTurn, end: endTurn },
      hasCompactions,
      messageCount: messages.length
    };

    switch (format) {
      case 'full':
        // Return full messages with compaction boundaries marked
        return {
          messages: await this.expandWithCompactions(messages, compactions),
          metadata
        };

      case 'compressed':
        // Return very brief summary
        return {
          summary: await this.generateCompressedSummary(messages, compactions),
          metadata
        };

      case 'summary':
      default:
        // Return standard summary
        return {
          summary: await this.generateStandardSummary(messages, compactions),
          metadata
        };
    }
  }

  /**
   * Expand messages with compaction details
   */
  private async expandWithCompactions(
    messages: Message[],
    compactions: StoredCompaction[]
  ): Promise<Message[]> {
    if (compactions.length === 0) {
      return messages;
    }

    const expanded: Message[] = [];

    for (const msg of messages) {
      // Check if this message is within a compacted range
      const compaction = compactions.find(c => {
        const msgIndex = messages.indexOf(msg) + 1;
        return msgIndex >= c.timeline.turnRange.start &&
               msgIndex <= c.timeline.turnRange.end;
      });

      if (compaction) {
        // Add compaction marker instead of original message
        const compactionMarker: SystemMessage = {
          type: 'system',
          subtype: 'compact_boundary',
          uuid: uuidv4(),
          timestamp: msg.timestamp,
          content: `[COMPACTED: Turns ${compaction.timeline.turnRange.start}-${compaction.timeline.turnRange.end}]\n${compaction.summaries.standard}`,
          compactMetadata: {
            trigger: compaction.type === 'auto' ? 'auto' : 'manual',
            preTokens: compaction.compaction.originalTokens,
            timestamp: compaction.timestamp,
            summaryUuid: compaction.id
          },
          timeline: msg.timeline
        };
        expanded.push(compactionMarker);
      } else {
        expanded.push(msg);
      }
    }

    return expanded;
  }

  /**
   * Generate compressed summary (100-200 tokens)
   */
  private async generateCompressedSummary(
    messages: Message[],
    compactions: StoredCompaction[]
  ): Promise<string> {
    if (compactions.length > 0) {
      // Use existing compaction summaries
      const summaries = compactions.map(c => c.summaries.compressed);
      return summaries.join('\n\n');
    }

    // Generate brief summary from messages
    const topics = this.extractTopics(messages);
    const decisions = this.extractDecisions(messages);

    return `Conversation segment (${messages.length} messages): ${topics.slice(0, 3).join(', ')}. Key decisions: ${decisions.slice(0, 2).join('; ')}.`;
  }

  /**
   * Generate standard summary (500-1000 tokens)
   */
  private async generateStandardSummary(
    messages: Message[],
    compactions: StoredCompaction[]
  ): Promise<string> {
    const sections: string[] = [];

    // Add compaction summaries
    if (compactions.length > 0) {
      sections.push('## Compacted Sections\n');
      for (const compaction of compactions) {
        sections.push(
          `Turns ${compaction.timeline.turnRange.start}-${compaction.timeline.turnRange.end}:\n${compaction.summaries.standard}\n`
        );
      }
    }

    // Add summary of non-compacted messages
    const nonCompactedMessages = messages.filter(msg => {
      const msgIndex = messages.indexOf(msg) + 1;
      return !compactions.some(c =>
        msgIndex >= c.timeline.turnRange.start &&
        msgIndex <= c.timeline.turnRange.end
      );
    });

    if (nonCompactedMessages.length > 0) {
      sections.push('## Recent Activity\n');

      const topics = this.extractTopics(nonCompactedMessages);
      const decisions = this.extractDecisions(nonCompactedMessages);
      const tools = this.extractToolUsage(nonCompactedMessages);

      if (topics.length > 0) {
        sections.push(`Topics discussed: ${topics.join(', ')}\n`);
      }

      if (decisions.length > 0) {
        sections.push(`Decisions made: ${decisions.join('; ')}\n`);
      }

      if (tools.length > 0) {
        sections.push(`Tools used: ${tools.join(', ')}\n`);
      }
    }

    return sections.join('\n');
  }

  /**
   * Extract topics from messages (simplified)
   */
  private extractTopics(messages: Message[]): string[] {
    const topics = new Set<string>();

    for (const msg of messages) {
      // Simple topic extraction based on content patterns from user messages
      if (isUserMessage(msg)) {
        const content = typeof msg.message.content === 'string'
          ? msg.message.content
          : JSON.stringify(msg.message.content);
        // Extract key phrases (simplified)
        const words = content.split(/\s+/).filter((w: string) => w.length > 5);
        words.slice(0, 3).forEach((w: string) => topics.add(w));
      }
    }

    return Array.from(topics);
  }

  /**
   * Extract decisions from messages (simplified)
   */
  private extractDecisions(messages: Message[]): string[] {
    const decisions: string[] = [];

    for (const msg of messages) {
      if (isAssistantMessage(msg)) {
        const content = typeof msg.message.content === 'string'
          ? msg.message.content
          : JSON.stringify(msg.message.content);
        // Look for decision patterns
        if (content.includes('I will') ||
            content.includes('Let me') ||
            content.includes('I\'ll')) {
          // Extract first sentence as decision (simplified)
          const firstSentence = content.split(/[.!?]/)[0];
          if (firstSentence && firstSentence.length < 100) {
            decisions.push(firstSentence.trim());
          }
        }
      }
    }

    return decisions.slice(0, 5); // Limit to 5 decisions
  }

  /**
   * Extract tool usage from messages
   */
  private extractToolUsage(messages: Message[]): string[] {
    const tools = new Set<string>();

    for (const msg of messages) {
      if (isToolUseMessage(msg)) {
        // ToolUseMessage has message.content which is an array of tool_use objects
        for (const tool of msg.message.content) {
          if (tool.name) {
            tools.add(tool.name);
          }
        }
      }
    }

    return Array.from(tools);
  }

  /**
   * Estimate token count for messages
   */
  private estimateTokens(messages: Message[]): number {
    let charCount = 0;

    for (const msg of messages) {
      // System messages have direct content
      if (isSystemMessage(msg)) {
        charCount += msg.content.length;
      }
      // Other message types have message.content
      else if ('message' in msg && msg.message.content) {
        if (typeof msg.message.content === 'string') {
          charCount += msg.message.content.length;
        } else {
          // Content is an array of blocks
          charCount += JSON.stringify(msg.message.content).length;
        }
      }
    }

    return Math.ceil(charCount / 4); // ~4 chars per token
  }
}