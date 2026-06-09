/**
 * Node.js HistoryStore Adapter
 *
 * Wraps JSONLHistoryStore behind the HistoryStore interface.
 * Strips optional workspacePath parameters and handles type mapping.
 *
 * @module adapters/node/NodeHistoryStoreAdapter
 */

import type { HistoryStore, SessionInfo } from '../../interfaces/HistoryStore.js';
import type { JSONLHistoryStore } from '../../session/JSONLHistoryStore.js';
import type { CanonicalMessage, SessionMetadata } from '@nexus-cortex/types';

export class NodeHistoryStoreAdapter implements HistoryStore {
  constructor(private store: JSONLHistoryStore) {}

  async loadSession(sessionId: string): Promise<CanonicalMessage[]> {
    // JSONLHistoryStore.loadSession returns Message[] which is structurally compatible
    return this.store.loadSession(sessionId) as unknown as Promise<CanonicalMessage[]>;
  }

  async appendMessage(sessionId: string, message: CanonicalMessage): Promise<void> {
    return this.store.appendMessage(sessionId, message as any);
  }

  async appendMessages(sessionId: string, messages: CanonicalMessage[]): Promise<void> {
    return this.store.appendMessages(sessionId, messages as any);
  }

  async saveSession(sessionId: string, messages: CanonicalMessage[]): Promise<void> {
    return this.store.saveSession(sessionId, messages as any);
  }

  async listSessions(): Promise<SessionInfo[]> {
    // JSONLHistoryStore.listSessions returns SessionInfo[] with filePath/fileSize extras
    const sessions = await this.store.listSessions();
    return sessions.map(s => ({
      sessionId: s.sessionId,
      metadata: s.metadata,
      messageCount: s.messageCount,
      lastModified: s.lastModified,
    }));
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    return this.store.deleteSession(sessionId);
  }

  async sessionExists(sessionId: string): Promise<boolean> {
    return this.store.sessionExists(sessionId);
  }

  async saveMetadata(sessionId: string, metadata: SessionMetadata): Promise<void> {
    return this.store.saveMetadata(sessionId, metadata);
  }

  async loadMetadata(sessionId: string): Promise<SessionMetadata | null> {
    return this.store.loadMetadata(sessionId);
  }

  async getSessionInfo(sessionId: string): Promise<SessionInfo | null> {
    const info = await this.store.getSessionInfo(sessionId);
    if (!info) return null;
    return {
      sessionId: info.sessionId,
      metadata: info.metadata,
      messageCount: info.messageCount,
      lastModified: info.lastModified,
    };
  }
}
