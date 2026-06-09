/**
 * ListSessions Tool
 *
 * Lists all available sessions with metadata for discovery and navigation.
 * Allows filtering and sorting to find specific sessions.
 */

import type { ListSessionsInput, SessionSummary } from '@nexus-cortex/types';
import { JSONLHistoryStore } from '../../session/JSONLHistoryStore.js';

/**
 * Tool for listing available sessions
 */
export class ListSessionsTool {
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
      name: 'ListSessions',
      description: 'List all available conversation sessions with metadata for discovery',
      input_schema: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of sessions to return',
            default: 50
          },
          minAgeDays: {
            type: 'number',
            description: 'Filter sessions older than N days'
          },
          maxAgeDays: {
            type: 'number',
            description: 'Filter sessions newer than N days'
          },
          sortBy: {
            type: 'string',
            enum: ['newest', 'oldest'],
            description: 'Sort order',
            default: 'newest'
          }
        }
      }
    };
  }

  /**
   * Execute the session listing
   */
  async execute(input: ListSessionsInput): Promise<SessionSummary[]> {
    // Get all sessions from storage
    const sessionInfos = await this.historyStore.listSessions();

    // Calculate age for each session
    const now = new Date();
    const sessionsWithAge = sessionInfos.map(info => {
      const ageMs = now.getTime() - info.lastModified.getTime();
      const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

      return {
        sessionId: info.sessionId,
        createdAt: info.metadata.startTime,
        lastModified: info.lastModified.toISOString(),
        messageCount: info.messageCount,
        fileSize: info.fileSize,
        compactionCount: info.metadata.compactionCount,
        ageDays,
        title: info.metadata.title,
      };
    });

    // Apply filters
    let filteredSessions = sessionsWithAge;

    if (input.minAgeDays !== undefined) {
      filteredSessions = filteredSessions.filter(s => s.ageDays >= input.minAgeDays!);
    }

    if (input.maxAgeDays !== undefined) {
      filteredSessions = filteredSessions.filter(s => s.ageDays <= input.maxAgeDays!);
    }

    // Apply sorting
    const sortBy = input.sortBy || 'newest';
    filteredSessions.sort((a, b) => {
      const dateA = new Date(a.lastModified).getTime();
      const dateB = new Date(b.lastModified).getTime();
      return sortBy === 'newest' ? dateB - dateA : dateA - dateB;
    });

    // Apply limit
    const limit = input.limit || 50;
    return filteredSessions.slice(0, limit);
  }
}
