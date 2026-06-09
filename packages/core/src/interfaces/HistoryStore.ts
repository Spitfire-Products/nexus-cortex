/**
 * HistoryStore Interface
 *
 * Abstracts session persistence for conversation history.
 * The orchestrator uses this for message storage, session management,
 * and metadata tracking.
 *
 * Node.js impl: JSONLHistoryStore (append-only JSONL files via fs/promises)
 * Browser impl: IndexedDB or host-provided storage
 *
 * @module interfaces/HistoryStore
 */

import type { CanonicalMessage, SessionMetadata } from '@nexus-cortex/types';

/**
 * Session information — summary of a stored session.
 *
 * Note: `filePath` and `fileSize` from the Node.js SessionInfo are
 * implementation-specific (filesystem concepts) and excluded from
 * the interface. Each implementation handles storage location internally.
 */
export interface SessionInfo {
  /** Session UUID */
  sessionId: string;
  /** Session metadata */
  metadata: SessionMetadata;
  /** Total messages in session */
  messageCount: number;
  /** Last modified timestamp */
  lastModified: Date;
}

/**
 * History Store — session persistence abstraction.
 *
 * Provides CRUD operations for conversation sessions, plus metadata
 * management for session resume, model switching, and compaction tracking.
 */
export interface HistoryStore {
  // ============================
  // Core CRUD
  // ============================

  /**
   * Load all messages from a session.
   *
   * @param sessionId - Session UUID
   * @returns Array of canonical messages (empty if session doesn't exist)
   */
  loadSession(sessionId: string): Promise<CanonicalMessage[]>;

  /**
   * Append a single message to a session (append-only).
   *
   * @param sessionId - Session UUID
   * @param message - Message to append
   */
  appendMessage(sessionId: string, message: CanonicalMessage): Promise<void>;

  /**
   * Append multiple messages to a session atomically.
   *
   * @param sessionId - Session UUID
   * @param messages - Messages to append
   */
  appendMessages(sessionId: string, messages: CanonicalMessage[]): Promise<void>;

  /**
   * Overwrite entire session history (used by compaction).
   *
   * @param sessionId - Session UUID
   * @param messages - Complete message array to write
   */
  saveSession(sessionId: string, messages: CanonicalMessage[]): Promise<void>;

  /**
   * List all available sessions.
   *
   * @returns Array of session summaries sorted by lastModified (newest first)
   */
  listSessions(): Promise<SessionInfo[]>;

  /**
   * Delete a session and its metadata.
   *
   * @param sessionId - Session UUID
   * @returns true if session was deleted, false if it didn't exist
   */
  deleteSession(sessionId: string): Promise<boolean>;

  /**
   * Check if a session exists.
   *
   * @param sessionId - Session UUID
   * @returns true if session exists
   */
  sessionExists(sessionId: string): Promise<boolean>;

  // ============================
  // Metadata
  // ============================

  /**
   * Save session metadata (model switches, compaction history, cache metrics, etc.).
   *
   * @param sessionId - Session UUID
   * @param metadata - Metadata to persist
   */
  saveMetadata(sessionId: string, metadata: SessionMetadata): Promise<void>;

  /**
   * Load session metadata.
   *
   * @param sessionId - Session UUID
   * @returns Metadata or null if not found
   */
  loadMetadata(sessionId: string): Promise<SessionMetadata | null>;

  /**
   * Get session info (summary without loading full message history).
   *
   * @param sessionId - Session UUID
   * @returns Session info or null if not found
   */
  getSessionInfo(sessionId: string): Promise<SessionInfo | null>;
}
