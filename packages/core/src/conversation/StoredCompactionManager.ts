/**
 * Stored Compaction System
 *
 * Manages persistent storage of compaction records with timeline integration.
 * Stores multi-level summaries and tracks helper model usage.
 *
 * Phase 1.5: Week 3 Implementation
 * Based on: CORTEX_V4_PHASE_1.5_ARCHITECTURE.md, Part 6.3
 */

import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { Message } from '../session/MessageTypes.js';
import { isSystemMessage } from '../session/MessageTypes.js';

/**
 * Compaction semantic metadata for search and retrieval
 * (Renamed from CompactionMetadata to avoid collision with MessageTypes.CompactionMetadata)
 */
export interface CompactionSemanticMetadata {
  /** Main topics discussed */
  topics: string[];

  /** Key decisions made */
  decisions: string[];

  /** Tools that were used */
  toolsUsed: string[];

  /** Files that were modified */
  filesModified: string[];

  /** Models involved in the conversation */
  modelsInvolved: string[];

  /** Key moments in the conversation */
  keyMoments: Array<{
    turn: number;
    description: string;
    importance: 'high' | 'medium' | 'low';
  }>;
}

/**
 * Multi-level summaries for different use cases
 */
export interface CompactionSummaries {
  /** Very brief summary (100-200 tokens) for in-context use */
  compressed: string;

  /** Standard summary (500-1000 tokens) for retrieval */
  standard: string;

  /** Detailed summary (2000-3000 tokens) for on-demand access */
  detailed: string;

  /** Structured metadata for semantic search */
  metadata: CompactionSemanticMetadata;
}

/**
 * Timeline integration fields
 */
export interface TimelineReference {
  /** Session ID this compaction belongs to */
  sessionId: string;

  /** Conversation ID within the session */
  conversationId: string;

  /** Timeline event ID that triggered this compaction */
  eventId: string;

  /** Range of turns that were compacted */
  turnRange: {
    start: number;
    end: number;
  };

  /** Message ID that triggered compaction (if any) */
  triggeredByMessageId?: string;
}

/**
 * Compaction processing details
 */
export interface CompactionProcessing {
  /** Helper model used for compaction */
  helperModelId: string;

  /** Provider of the helper model */
  helperProvider: string;

  /** Processing time in milliseconds */
  processingTime: number;

  /** Estimated cost in dollars */
  cost: number;

  /** Token usage */
  tokens: {
    input: number;
    output: number;
  };
}

/**
 * Complete stored compaction record
 */
export interface StoredCompaction {
  // Identity
  id: string;
  type: 'auto' | 'manual' | 'helper-fallback';
  timestamp: string;

  // Timeline integration
  timeline: TimelineReference;

  // Compaction details
  compaction: {
    originalTokens: number;
    compressedTokens: number;
    messageCount: number;
    compressionRatio: number;
  };

  // Processing details
  processing: CompactionProcessing;

  // Content
  summaries: CompactionSummaries;

  // Original messages reference (file path or ID)
  originalMessagesRef: string;

  // Status
  status: 'active' | 'superseded' | 'archived';

  // Version for schema migrations
  version: number;
}

/**
 * Options for creating a stored compaction
 */
export interface CreateCompactionOptions {
  type: 'auto' | 'manual' | 'helper-fallback';
  timeline: TimelineReference;
  originalMessages: Message[];
  summaries: CompactionSummaries;
  processing: CompactionProcessing;
}

/**
 * Options for querying stored compactions
 */
export interface CompactionQuery {
  sessionId?: string;
  conversationId?: string;
  status?: 'active' | 'superseded' | 'archived';
  type?: 'auto' | 'manual' | 'helper-fallback';
  fromTimestamp?: string;
  toTimestamp?: string;
  limit?: number;
}

/**
 * Manages storage and retrieval of compaction records
 */
export class StoredCompactionManager {
  private static readonly COMPACTIONS_DIR = '.cortex/compactions';
  private static readonly CURRENT_VERSION = 1;
  private baseDir: string;

  constructor(workspaceRoot: string = process.cwd()) {
    this.baseDir = path.join(workspaceRoot, StoredCompactionManager.COMPACTIONS_DIR);
  }

  /**
   * Initialize storage directory structure
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  /**
   * Create and store a new compaction record
   */
  async createCompaction(options: CreateCompactionOptions): Promise<StoredCompaction> {
    const id = uuidv4();
    const timestamp = new Date().toISOString();

    // Calculate compaction metrics
    const originalTokens = this.calculateTokens(options.originalMessages);
    const compressedTokens = this.estimateCompressedTokens(options.summaries);
    const compressionRatio = originalTokens / compressedTokens;

    // Store original messages
    const originalMessagesRef = await this.storeOriginalMessages(
      id,
      options.originalMessages
    );

    // Create compaction record
    const compaction: StoredCompaction = {
      id,
      type: options.type,
      timestamp,
      timeline: options.timeline,
      compaction: {
        originalTokens,
        compressedTokens,
        messageCount: options.originalMessages.length,
        compressionRatio
      },
      processing: options.processing,
      summaries: options.summaries,
      originalMessagesRef,
      status: 'active',
      version: StoredCompactionManager.CURRENT_VERSION
    };

    // Store compaction record
    await this.storeCompaction(compaction);

    // Update index for the session
    await this.updateSessionIndex(options.timeline.sessionId, id);

    return compaction;
  }

  /**
   * Retrieve a compaction by ID
   */
  async getCompaction(id: string): Promise<StoredCompaction | null> {
    const filePath = this.getCompactionFilePath(id);

    try {
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data) as StoredCompaction;
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Query compactions based on criteria
   */
  async queryCompactions(query: CompactionQuery): Promise<StoredCompaction[]> {
    const results: StoredCompaction[] = [];

    // Get relevant session IDs
    const sessionIds = query.sessionId
      ? [query.sessionId]
      : await this.getAllSessionIds();

    for (const sessionId of sessionIds) {
      const index = await this.loadSessionIndex(sessionId);

      for (const compactionId of index.compactionIds) {
        const compaction = await this.getCompaction(compactionId);

        if (compaction && this.matchesQuery(compaction, query)) {
          results.push(compaction);
        }
      }
    }

    // Sort by timestamp (newest first) and apply limit
    results.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    if (query.limit) {
      return results.slice(0, query.limit);
    }

    return results;
  }

  /**
   * Get all compaction boundaries for a session
   */
  async getCompactionBoundaries(
    sessionId: string
  ): Promise<Array<{ id: string; timestamp: string; turnRange: { start: number; end: number } }>> {
    const compactions = await this.queryCompactions({
      sessionId,
      status: 'active'
    });

    return compactions.map(c => ({
      id: c.id,
      timestamp: c.timestamp,
      turnRange: c.timeline.turnRange
    }));
  }

  /**
   * Update compaction status
   */
  async updateStatus(
    id: string,
    status: 'active' | 'superseded' | 'archived'
  ): Promise<void> {
    const compaction = await this.getCompaction(id);

    if (!compaction) {
      throw new Error(`Compaction ${id} not found`);
    }

    compaction.status = status;
    await this.storeCompaction(compaction);
  }

  /**
   * Get original messages for a compaction
   */
  async getOriginalMessages(compactionId: string): Promise<Message[]> {
    const compaction = await this.getCompaction(compactionId);

    if (!compaction) {
      throw new Error(`Compaction ${compactionId} not found`);
    }

    const data = await fs.readFile(compaction.originalMessagesRef, 'utf-8');
    return JSON.parse(data) as Message[];
  }

  /**
   * Search compactions by content
   */
  async searchCompactions(
    query: string,
    sessionId?: string
  ): Promise<StoredCompaction[]> {
    const compactions = await this.queryCompactions({
      sessionId,
      status: 'active'
    });

    const results: Array<{ compaction: StoredCompaction; score: number }> = [];
    const queryLower = query.toLowerCase();

    for (const compaction of compactions) {
      let score = 0;

      // Search in summaries
      if (compaction.summaries.compressed.toLowerCase().includes(queryLower)) {
        score += 1;
      }
      if (compaction.summaries.standard.toLowerCase().includes(queryLower)) {
        score += 2;
      }
      if (compaction.summaries.detailed.toLowerCase().includes(queryLower)) {
        score += 3;
      }

      // Search in metadata
      const metadata = compaction.summaries.metadata;
      if (metadata.topics.some(t => t.toLowerCase().includes(queryLower))) {
        score += 5;
      }
      if (metadata.decisions.some(d => d.toLowerCase().includes(queryLower))) {
        score += 4;
      }
      if (metadata.filesModified.some(f => f.toLowerCase().includes(queryLower))) {
        score += 3;
      }

      if (score > 0) {
        results.push({ compaction, score });
      }
    }

    // Sort by score (highest first)
    results.sort((a, b) => b.score - a.score);

    return results.map(r => r.compaction);
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  /**
   * Get file path for a compaction
   */
  private getCompactionFilePath(id: string): string {
    // Use first 2 chars of ID for directory sharding
    const shard = id.substring(0, 2);
    return path.join(this.baseDir, shard, `${id}.json`);
  }

  /**
   * Store a compaction record
   */
  private async storeCompaction(compaction: StoredCompaction): Promise<void> {
    const filePath = this.getCompactionFilePath(compaction.id);
    const dir = path.dirname(filePath);

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(compaction, null, 2));
  }

  /**
   * Store original messages
   */
  private async storeOriginalMessages(
    compactionId: string,
    messages: Message[]
  ): Promise<string> {
    const filePath = path.join(
      this.baseDir,
      'originals',
      `${compactionId}.json`
    );

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(messages, null, 2));

    return filePath;
  }

  /**
   * Load session index
   */
  private async loadSessionIndex(
    sessionId: string
  ): Promise<{ sessionId: string; compactionIds: string[] }> {
    const indexPath = path.join(this.baseDir, 'index', `${sessionId}.json`);

    try {
      const data = await fs.readFile(indexPath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return { sessionId, compactionIds: [] };
      }
      throw error;
    }
  }

  /**
   * Update session index
   */
  private async updateSessionIndex(
    sessionId: string,
    compactionId: string
  ): Promise<void> {
    const index = await this.loadSessionIndex(sessionId);

    if (!index.compactionIds.includes(compactionId)) {
      index.compactionIds.push(compactionId);

      const indexPath = path.join(this.baseDir, 'index', `${sessionId}.json`);
      await fs.mkdir(path.dirname(indexPath), { recursive: true });
      await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
    }
  }

  /**
   * Get all session IDs from index
   */
  private async getAllSessionIds(): Promise<string[]> {
    const indexDir = path.join(this.baseDir, 'index');

    try {
      const files = await fs.readdir(indexDir);
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Check if compaction matches query
   */
  private matchesQuery(compaction: StoredCompaction, query: CompactionQuery): boolean {
    if (query.conversationId && compaction.timeline.conversationId !== query.conversationId) {
      return false;
    }

    if (query.status && compaction.status !== query.status) {
      return false;
    }

    if (query.type && compaction.type !== query.type) {
      return false;
    }

    if (query.fromTimestamp && compaction.timestamp < query.fromTimestamp) {
      return false;
    }

    if (query.toTimestamp && compaction.timestamp > query.toTimestamp) {
      return false;
    }

    return true;
  }

  /**
   * Calculate token count for messages
   */
  private calculateTokens(messages: Message[]): number {
    // Simple estimation: ~4 characters per token
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

    return Math.ceil(charCount / 4);
  }

  /**
   * Estimate compressed token count
   */
  private estimateCompressedTokens(summaries: CompactionSummaries): number {
    const totalChars =
      summaries.compressed.length +
      summaries.standard.length +
      summaries.detailed.length;

    return Math.ceil(totalChars / 4);
  }
}