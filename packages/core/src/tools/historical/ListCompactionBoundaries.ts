/**
 * ListCompactionBoundaries Tool
 *
 * Lists all compaction boundaries (conversation summaries) with metadata.
 * Provides an overview of the compaction history for the session.
 *
 * Phase 1.5: Week 3 Implementation
 * Based on: CORTEX_V4_PHASE_1.5_ARCHITECTURE.md, Part 4
 */

import { StoredCompactionManager } from '../../conversation/StoredCompactionManager.js';

/**
 * Input schema for ListCompactionBoundaries tool
 */
export interface ListCompactionBoundariesInput {
  /** Include detailed metadata in response */
  includeMetadata?: boolean;
}

/**
 * Compaction boundary information
 */
export interface CompactionBoundary {
  /** Unique identifier for the compaction */
  id: string;

  /** Timestamp when compaction occurred */
  timestamp: Date;

  /** Turn range that was compacted */
  turnRange: {
    start: number;
    end: number;
  };

  /** Token counts */
  tokens: {
    /** Original token count before compaction */
    original: number;

    /** Compressed token count after compaction */
    compressed: number;

    /** Tokens saved by compaction */
    saved: number;
  };

  /** Type of compaction */
  type: 'auto' | 'manual' | 'helper-fallback';

  /** Optional metadata if requested */
  metadata?: {
    /** Topics covered in this segment */
    topics: string[];

    /** Decisions made in this segment */
    decisions: string[];

    /** Tools used in this segment */
    toolsUsed: string[];

    /** Files modified in this segment */
    filesModified: string[];

    /** Models involved in this segment */
    modelsInvolved: string[];

    /** Helper model used for compaction */
    helperModel: string;

    /** Cost of compaction */
    cost: number;

    /** Brief summary */
    summary: string;
  };
}

/**
 * Tool for listing compaction boundaries
 */
export class ListCompactionBoundariesTool {
  private compactionManager: StoredCompactionManager;

  constructor(workspaceRoot?: string) {
    this.compactionManager = new StoredCompactionManager(workspaceRoot);
  }

  /**
   * Tool definition for registration
   */
  static get definition() {
    return {
      name: 'ListCompactionBoundaries',
      description: 'List all compaction boundaries (conversation summaries) with IDs',
      input_schema: {
        type: 'object',
        properties: {
          includeMetadata: {
            type: 'boolean',
            description: 'Include detailed metadata in response',
            default: true
          }
        }
      }
    };
  }

  /**
   * Execute the boundary listing
   */
  async execute(
    input: ListCompactionBoundariesInput,
    sessionId: string
  ): Promise<CompactionBoundary[]> {
    const includeMetadata = input.includeMetadata !== false;

    // Query all active compactions for this session
    const compactions = await this.compactionManager.queryCompactions({
      sessionId,
      status: 'active'
    });

    // Transform to boundary format
    const boundaries: CompactionBoundary[] = compactions.map(compaction => {
      const boundary: CompactionBoundary = {
        id: compaction.id,
        timestamp: new Date(compaction.timestamp),
        turnRange: compaction.timeline.turnRange,
        tokens: {
          original: compaction.compaction.originalTokens,
          compressed: compaction.compaction.compressedTokens,
          saved: compaction.compaction.originalTokens - compaction.compaction.compressedTokens
        },
        type: compaction.type
      };

      // Add metadata if requested
      if (includeMetadata) {
        boundary.metadata = {
          topics: compaction.summaries.metadata.topics,
          decisions: compaction.summaries.metadata.decisions,
          toolsUsed: compaction.summaries.metadata.toolsUsed,
          filesModified: compaction.summaries.metadata.filesModified,
          modelsInvolved: compaction.summaries.metadata.modelsInvolved,
          helperModel: compaction.processing.helperModelId,
          cost: compaction.processing.cost,
          summary: compaction.summaries.compressed
        };
      }

      return boundary;
    });

    // Sort by turn range start (chronological order)
    boundaries.sort((a, b) => a.turnRange.start - b.turnRange.start);

    return boundaries;
  }

  /**
   * Get summary statistics about compactions
   */
  async getSummaryStatistics(sessionId: string): Promise<{
    totalCompactions: number;
    totalTokensSaved: number;
    totalCost: number;
    averageCompressionRatio: number;
    mostUsedHelperModel: string;
    largestCompaction: { id: string; tokens: number };
  }> {
    const compactions = await this.compactionManager.queryCompactions({
      sessionId,
      status: 'active'
    });

    if (compactions.length === 0) {
      return {
        totalCompactions: 0,
        totalTokensSaved: 0,
        totalCost: 0,
        averageCompressionRatio: 0,
        mostUsedHelperModel: 'none',
        largestCompaction: { id: '', tokens: 0 }
      };
    }

    // Calculate statistics
    let totalTokensSaved = 0;
    let totalCost = 0;
    let totalCompressionRatio = 0;
    const helperModelCounts = new Map<string, number>();
    let largestCompaction = { id: '', tokens: 0 };

    for (const compaction of compactions) {
      const saved = compaction.compaction.originalTokens - compaction.compaction.compressedTokens;
      totalTokensSaved += saved;
      totalCost += compaction.processing.cost;
      totalCompressionRatio += compaction.compaction.compressionRatio;

      // Track helper model usage
      const model = compaction.processing.helperModelId;
      helperModelCounts.set(model, (helperModelCounts.get(model) || 0) + 1);

      // Track largest compaction
      if (compaction.compaction.originalTokens > largestCompaction.tokens) {
        largestCompaction = {
          id: compaction.id,
          tokens: compaction.compaction.originalTokens
        };
      }
    }

    // Find most used helper model
    let mostUsedHelperModel = 'none';
    let maxCount = 0;
    for (const [model, count] of helperModelCounts) {
      if (count > maxCount) {
        maxCount = count;
        mostUsedHelperModel = model;
      }
    }

    return {
      totalCompactions: compactions.length,
      totalTokensSaved,
      totalCost,
      averageCompressionRatio: totalCompressionRatio / compactions.length,
      mostUsedHelperModel,
      largestCompaction
    };
  }

  /**
   * Find compaction by turn number
   */
  async findCompactionByTurn(
    sessionId: string,
    turnNumber: number
  ): Promise<CompactionBoundary | null> {
    const compactions = await this.compactionManager.queryCompactions({
      sessionId,
      status: 'active'
    });

    // Find compaction that contains this turn
    const compaction = compactions.find(c =>
      turnNumber >= c.timeline.turnRange.start &&
      turnNumber <= c.timeline.turnRange.end
    );

    if (!compaction) {
      return null;
    }

    return {
      id: compaction.id,
      timestamp: new Date(compaction.timestamp),
      turnRange: compaction.timeline.turnRange,
      tokens: {
        original: compaction.compaction.originalTokens,
        compressed: compaction.compaction.compressedTokens,
        saved: compaction.compaction.originalTokens - compaction.compaction.compressedTokens
      },
      type: compaction.type,
      metadata: {
        topics: compaction.summaries.metadata.topics,
        decisions: compaction.summaries.metadata.decisions,
        toolsUsed: compaction.summaries.metadata.toolsUsed,
        filesModified: compaction.summaries.metadata.filesModified,
        modelsInvolved: compaction.summaries.metadata.modelsInvolved,
        helperModel: compaction.processing.helperModelId,
        cost: compaction.processing.cost,
        summary: compaction.summaries.compressed
      }
    };
  }
}