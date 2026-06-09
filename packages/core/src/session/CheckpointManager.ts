/**
 * Checkpoint Manager
 * Based on: CORTEX_V4_PHASE_1.5_ARCHITECTURE.md Part 3
 *
 * Manages user-created checkpoints with resume capability
 * Supports cross-provider resume and conversation branching
 */

import { SessionTimeline, Checkpoint, Conversation } from './SessionTimeline.js';
import { Message } from './MessageTypes.js';
import { JSONLHistoryStore } from './JSONLHistoryStore.js';
import { FileCheckpointManager } from '../file-tracking/FileCheckpointManager.js';

/**
 * Checkpoint creation options
 */
export interface CheckpointOptions {
  description?: string;
  includeFileStates?: boolean;
  metadata?: Record<string, any>;
}

/**
 * Resume options
 */
export interface ResumeOptions {
  modelId?: string;
  preserveHistory?: boolean;
}

/**
 * Checkpoint with file states
 */
export interface CheckpointWithFiles extends Checkpoint {
  fileStates?: Record<string, {
    path: string;
    hash: string;
    version: number;
    timestamp: string;
  }>;
}

/**
 * Checkpoint Manager
 *
 * Handles checkpoint creation, storage, and resume operations
 */
export class CheckpointManager {
  private timeline: SessionTimeline;
  private historyStore: JSONLHistoryStore;
  private workspacePath?: string;
  private fileCheckpointManager?: FileCheckpointManager;

  constructor(
    timeline: SessionTimeline,
    historyStore: JSONLHistoryStore,
    workspacePath?: string,
    fileCheckpointManager?: FileCheckpointManager
  ) {
    this.timeline = timeline;
    this.historyStore = historyStore;
    this.workspacePath = workspacePath;
    this.fileCheckpointManager = fileCheckpointManager;
  }

  /**
   * Create a checkpoint at the current position
   *
   * Usage: /checkpoint [description]
   */
  async createCheckpoint(options: CheckpointOptions = {}): Promise<Checkpoint> {
    const { description, includeFileStates, metadata } = options;

    // Get current conversation
    const conversation = this.timeline.getCurrentConversation();
    if (!conversation) {
      throw new Error('No active conversation to checkpoint');
    }

    // Get all messages up to this point
    const messages = await this.historyStore.loadSession(
      this.timeline.sessionId,
      this.workspacePath
    );
    const messageIds = messages.map(m => m.uuid);

    // Create checkpoint in timeline
    const checkpoint = this.timeline.createCheckpoint(description, messageIds);

    // Add file states if requested
    if (includeFileStates && this.fileCheckpointManager) {
      try {
        const snapshot = await this.fileCheckpointManager.createSnapshot(checkpoint.id);

        // Transform FileBackupInfo to CheckpointWithFiles format
        const fileStates: Record<string, {
          path: string;
          hash: string;
          version: number;
          timestamp: string;
        }> = {};

        for (const [filePath, backupInfo] of Object.entries(snapshot.snapshotMessage.snapshot.trackedFileBackups)) {
          fileStates[filePath] = {
            path: filePath,
            hash: backupInfo.backupFileName || '',
            version: backupInfo.version,
            timestamp: backupInfo.backupTime
          };
        }

        (checkpoint as CheckpointWithFiles).fileStates = fileStates;
      } catch (error) {
        console.warn('[CheckpointManager] Failed to capture file states:', error);
        // Continue without file states rather than failing the checkpoint
      }
    }

    // Add custom metadata if provided
    if (metadata) {
      (checkpoint as any).customMetadata = metadata;
    }

    return checkpoint;
  }

  /**
   * Resume from a checkpoint
   *
   * Usage: /resume <checkpoint-id> [--model <model-id>]
   */
  async resumeFromCheckpoint(
    checkpointId: string,
    options: ResumeOptions = {}
  ): Promise<{ conversation: Conversation; checkpoint: Checkpoint; messages: Message[] }> {
    const { modelId, preserveHistory } = options;

    // Get checkpoint
    const checkpoint = this.timeline.getCheckpoint(checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint ${checkpointId} not found`);
    }

    // Resume in timeline (creates new conversation branch)
    const { conversation, checkpoint: updatedCheckpoint } =
      this.timeline.resumeFromCheckpoint(checkpointId, modelId);

    // Load messages from checkpoint
    const messages = await this.loadCheckpointMessages(checkpoint);

    // Update history store with resumed conversation
    if (!preserveHistory) {
      // Replace current history with checkpoint messages
      const updatedMessages = messages.map(message => ({
        ...message,
        // Add timeline tracking to messages
        timeline: message.timeline || {
          sessionId: this.timeline.sessionId,
          conversationId: conversation.id,
          turnNumber: checkpoint.turnNumber,
          resumePoint: true,
        },
      }));

      await this.historyStore.saveSession(
        this.timeline.sessionId,
        updatedMessages,
        this.workspacePath
      );
    }

    return {
      conversation,
      checkpoint: updatedCheckpoint,
      messages,
    };
  }

  /**
   * List all checkpoints
   *
   * Usage: /checkpoints
   */
  listCheckpoints(): Checkpoint[] {
    return this.timeline.getAllCheckpoints();
  }

  /**
   * Get checkpoint details
   */
  getCheckpoint(checkpointId: string): Checkpoint | undefined {
    return this.timeline.getCheckpoint(checkpointId);
  }

  /**
   * Delete a checkpoint
   */
  deleteCheckpoint(checkpointId: string): boolean {
    const checkpoint = this.timeline.getCheckpoint(checkpointId);
    if (!checkpoint) {
      return false;
    }

    // Mark as not resumable (soft delete)
    checkpoint.resumable = false;
    return true;
  }

  /**
   * Get checkpoint history (all resumes from this checkpoint)
   */
  getCheckpointHistory(checkpointId: string): Array<{
    resumeTime: string;
    modelId: string;
    conversationId: string;
  }> {
    const resumeEvents = this.timeline.getResumePoints();
    return resumeEvents
      .filter(rp => rp.checkpointId === checkpointId)
      .map(rp => ({
        resumeTime: rp.timestamp,
        modelId: rp.resumedModel,
        conversationId: rp.conversationId,
      }));
  }

  // Reserved for future use - will integrate with token counting service
  // private async _calculateContextMetadata(messages: Message[]): Promise<{
  //   totalTokens: number;
  //   criticalTokens: number;
  //   compactableTokens: number;
  // }> {
  //   const estimatedTokensPerMessage = 100;
  //   const totalTokens = messages.length * estimatedTokensPerMessage;
  //   const criticalMessageCount = Math.min(messages.length, 10);
  //   const criticalTokens = criticalMessageCount * estimatedTokensPerMessage;
  //   const compactableTokens = totalTokens - criticalTokens;
  //   return {
  //     totalTokens,
  //     criticalTokens,
  //     compactableTokens,
  //   };
  // }

  /**
   * Load messages from checkpoint
   */
  private async loadCheckpointMessages(checkpoint: Checkpoint): Promise<Message[]> {
    const allMessages = await this.historyStore.loadSession(
      this.timeline.sessionId,
      this.workspacePath
    );
    const checkpointMessageIds = new Set(checkpoint.snapshot.messageIds);

    return allMessages.filter(m => checkpointMessageIds.has(m.uuid));
  }

  /**
   * Precompute message selection for target model
   *
   * This allows fast resume by pre-selecting messages that fit in target model's context
   */
  async precomputeSelectionForModel(
    checkpointId: string,
    targetModelId: string,
    _targetContextWindow: number,
    strategy: 'sliding-window' | 'preserve-critical' | 'compact-and-fit' = 'preserve-critical'
  ): Promise<void> {
    const checkpoint = this.timeline.getCheckpoint(checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint ${checkpointId} not found`);
    }

    // Load messages
    const messages = await this.loadCheckpointMessages(checkpoint);

    // TODO: Implement intelligent message selection based on strategy
    // For now, simple selection: take last N messages that fit
    const selectedMessages = messages.slice(-50).map(m => m.uuid);
    const estimatedTokens = selectedMessages.length * 100; // Rough estimate

    // Store precomputed selection
    if (!checkpoint.snapshot.contextMetadata.precomputedSelections) {
      checkpoint.snapshot.contextMetadata.precomputedSelections = {};
    }

    checkpoint.snapshot.contextMetadata.precomputedSelections[targetModelId] = {
      selectedMessages,
      estimatedTokens,
      strategy,
    };
  }

  /**
   * Export checkpoint to JSON
   */
  async exportCheckpoint(checkpointId: string): Promise<string> {
    const checkpoint = this.timeline.getCheckpoint(checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint ${checkpointId} not found`);
    }

    const messages = await this.loadCheckpointMessages(checkpoint);

    return JSON.stringify({
      checkpoint,
      messages,
      exportedAt: new Date().toISOString(),
    }, null, 2);
  }

  /**
   * Import checkpoint from JSON
   */
  async importCheckpoint(checkpointJson: string): Promise<Checkpoint> {
    const data = JSON.parse(checkpointJson);
    const { checkpoint } = data;
    // Note: messages field available in data.messages for future use

    // TODO: Validate checkpoint structure
    // TODO: Add messages to history store
    // TODO: Register checkpoint in timeline

    return checkpoint;
  }
}
