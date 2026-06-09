/**
 * LoadSession Tool
 *
 * Loads messages from a specific session to bring past conversation context
 * into the current conversation.
 */

import type { LoadSessionInput, SessionLoadResult } from '@nexus-cortex/types';
import { JSONLHistoryStore } from '../../session/JSONLHistoryStore.js';
import { isSystemMessage } from '../../session/MessageTypes.js';

/**
 * Tool for loading session messages
 */
export class LoadSessionTool {
  private historyStore: JSONLHistoryStore;

  constructor(storageDir: string) {
    this.historyStore = new JSONLHistoryStore({
      baseDir: storageDir
    });
  }

  /**
   * Tool definition for registration
   */
  static get definition() {
    return {
      name: 'LoadSession',
      description: 'Load messages from a specific previous session to access full conversation context',
      input_schema: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: 'Session ID to load (from ListSessions or SearchConversationHistory results)'
          },
          limit: {
            type: 'number',
            description: 'Maximum number of messages to return',
            default: 100
          },
          offset: {
            type: 'number',
            description: 'Start from message offset (for pagination)',
            default: 0
          },
          includeSystemMessages: {
            type: 'boolean',
            description: 'Include system messages in results',
            default: false
          }
        },
        required: ['sessionId']
      }
    };
  }

  /**
   * Execute the session load
   */
  async execute(input: LoadSessionInput): Promise<SessionLoadResult> {
    // Get session info for metadata
    const sessionInfo = await this.historyStore.getSessionInfo(input.sessionId);

    if (!sessionInfo) {
      throw new Error(`Session not found: ${input.sessionId}`);
    }

    // Load all messages from session
    const allMessages = await this.historyStore.loadSession(input.sessionId);

    // Filter messages
    let filteredMessages = allMessages;

    // Optionally exclude system messages
    if (!input.includeSystemMessages) {
      filteredMessages = filteredMessages.filter(msg => !isSystemMessage(msg));
    }

    const totalCount = filteredMessages.length;

    // Apply pagination
    const offset = input.offset || 0;
    const limit = input.limit || 100;
    const paginatedMessages = filteredMessages.slice(offset, offset + limit);

    return {
      sessionId: input.sessionId,
      messages: paginatedMessages,
      totalMessageCount: totalCount,
      returnedMessageCount: paginatedMessages.length,
      hasMore: (offset + paginatedMessages.length) < totalCount,
      metadata: {
        createdAt: sessionInfo.metadata.startTime,
        lastModified: sessionInfo.lastModified.toISOString(),
        compactionCount: sessionInfo.metadata.compactionCount
      }
    };
  }
}
