/**
 * Session Timeline System
 * Based on: CORTEX_V4_PHASE_1.5_ARCHITECTURE.md Part 3
 *
 * Provides:
 * - Timeline event tracking
 * - Conversation management with branching
 * - Checkpoint creation and resume
 * - Model switch tracking
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * Timeline Event Types
 */
export type TimelineEventType =
  | 'message'
  | 'checkpoint'
  | 'compaction'
  | 'model_switch'
  | 'resume'
  | 'branch_create'
  | 'conversation_start';

/**
 * Base Timeline Event
 */
export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  timestamp: string;
  conversationId: string;
  turnNumber: number;
  metadata: Record<string, any>;
}

/**
 * Message Timeline Event
 */
export interface MessageEvent extends TimelineEvent {
  type: 'message';
  messageId: string;
  metadata: {
    role: string;
    hasToolCalls?: boolean;
    modelId?: string;
  };
}

/**
 * Checkpoint Timeline Event
 */
export interface CheckpointEvent extends TimelineEvent {
  type: 'checkpoint';
  metadata: {
    checkpointId: string;
    description?: string;
    messageCount: number;
    tokenCount: number;
    modelId: string;
  };
}

/**
 * Compaction Timeline Event
 */
export interface CompactionEvent extends TimelineEvent {
  type: 'compaction';
  metadata: {
    compactionId: string;
    trigger: 'auto' | 'manual' | 'helper-fallback';
    originalTokens: number;
    compressedTokens: number;
    tokensSaved: number;
    mainModel?: string;
    helperModel?: string;
  };
}

/**
 * Model Switch Timeline Event
 */
export interface ModelSwitchEvent extends TimelineEvent {
  type: 'model_switch';
  metadata: {
    fromModel: string;
    toModel: string;
    reason?: string;
  };
}

/**
 * Resume Timeline Event
 */
export interface ResumeEvent extends TimelineEvent {
  type: 'resume';
  metadata: {
    checkpointId: string;
    resumedModel: string;
    originalModel?: string;
  };
}

/**
 * Branch Create Timeline Event
 */
export interface BranchEvent extends TimelineEvent {
  type: 'branch_create';
  metadata: {
    branchId: string;
    parentConversationId: string;
    branchPoint: number;
    description?: string;
  };
}

/**
 * Conversation Start Timeline Event
 */
export interface ConversationStartEvent extends TimelineEvent {
  type: 'conversation_start';
  metadata: {
    modelId: string;
    isResume?: boolean;
    resumedFromCheckpoint?: string;
  };
}

/**
 * Union type for all timeline events
 */
export type AnyTimelineEvent =
  | MessageEvent
  | CheckpointEvent
  | CompactionEvent
  | ModelSwitchEvent
  | ResumeEvent
  | BranchEvent
  | ConversationStartEvent;

/**
 * Conversation represents a linear sequence of messages
 */
export interface Conversation {
  id: string;
  startTime: string;
  lastActiveTime: string;
  turnCount: number;
  messageIds: string[];

  // Branching info
  parentConversationId?: string;
  branchPoint?: number;

  // State
  modelId: string;
  tokenCount: number;
  isActive: boolean;
}

/**
 * Checkpoint represents a saved state in the timeline
 */
export interface Checkpoint {
  id: string;
  conversationId: string;
  turnNumber: number;
  timestamp: string;
  description?: string;

  // Snapshot data
  snapshot: {
    messageIds: string[];
    tokenCount: number;
    modelId: string;

    // Context window metadata
    contextMetadata: {
      totalTokens: number;
      criticalTokens: number;
      compactableTokens: number;

      // Pre-computed selections for common target models
      precomputedSelections?: Record<string, {
        selectedMessages: string[];
        estimatedTokens: number;
        strategy: 'sliding-window' | 'preserve-critical' | 'compact-and-fit';
      }>;
    };
  };

  resumable: boolean;
  resumeCount: number;
}

/**
 * Compaction Point represents a conversation compaction in the timeline
 */
export interface CompactionPoint {
  id: string;
  conversationId: string;
  timestamp: string;

  range: {
    startTurn: number;
    endTurn: number;
    messageCount: number;
  };

  tokens: {
    original: number;
    compressed: number;
    savings: number;
  };

  trigger: 'auto' | 'manual' | 'helper-fallback';
}

/**
 * Model Switch represents a model change in the timeline
 */
export interface ModelSwitch {
  id: string;
  conversationId: string;
  timestamp: string;
  turnNumber: number;

  fromModel: string;
  toModel: string;
  reason?: string;
}

/**
 * Resume Point represents a checkpoint resume in the timeline
 */
export interface ResumePoint {
  id: string;
  conversationId: string;
  timestamp: string;
  turnNumber: number;

  checkpointId: string;
  resumedModel: string;
  originalModel?: string;
}

/**
 * Session Timeline - Main timeline management class
 */
export class SessionTimeline {
  sessionId: string;
  createdAt: string;
  lastActiveAt: string;

  // Timeline events (chronological)
  private events: AnyTimelineEvent[] = [];

  // Conversations
  private conversations: Map<string, Conversation> = new Map();

  // Markers (indexed for fast lookup)
  private checkpoints: Map<string, Checkpoint> = new Map();
  private compactionPoints: Map<string, CompactionPoint> = new Map();
  private modelSwitches: ModelSwitch[] = [];
  private resumePoints: ResumePoint[] = [];

  // Current state
  current: {
    conversationId: string;
    modelId: string;
    turnNumber: number;
    tokenCount: number;
  };

  constructor(sessionId: string, initialModelId: string) {
    this.sessionId = sessionId;
    this.createdAt = new Date().toISOString();
    this.lastActiveAt = this.createdAt;

    // Create initial conversation
    const conversationId = uuidv4();
    const conversation: Conversation = {
      id: conversationId,
      startTime: this.createdAt,
      lastActiveTime: this.createdAt,
      turnCount: 0,
      messageIds: [],
      modelId: initialModelId,
      tokenCount: 0,
      isActive: true,
    };

    this.conversations.set(conversationId, conversation);

    this.current = {
      conversationId,
      modelId: initialModelId,
      turnNumber: 0,
      tokenCount: 0,
    };

    // Record conversation start event
    this.addEvent({
      id: uuidv4(),
      type: 'conversation_start',
      timestamp: this.createdAt,
      conversationId,
      turnNumber: 0,
      metadata: {
        modelId: initialModelId,
      },
    });
  }

  /**
   * Add a timeline event
   */
  addEvent(event: AnyTimelineEvent): void {
    this.events.push(event);
    this.lastActiveAt = event.timestamp;

    // Update conversation
    const conversation = this.conversations.get(event.conversationId);
    if (conversation) {
      conversation.lastActiveTime = event.timestamp;
    }
  }

  /**
   * Record a message in the timeline
   */
  recordMessage(messageId: string, role: string, conversationId?: string): MessageEvent {
    const convId = conversationId || this.current.conversationId;
    const conversation = this.conversations.get(convId);

    if (!conversation) {
      throw new Error(`Conversation ${convId} not found`);
    }

    // Increment turn number for user messages
    if (role === 'user') {
      this.current.turnNumber++;
      conversation.turnCount++;
    }

    conversation.messageIds.push(messageId);

    const event: MessageEvent = {
      id: uuidv4(),
      type: 'message',
      timestamp: new Date().toISOString(),
      conversationId: convId,
      turnNumber: this.current.turnNumber,
      messageId,
      metadata: {
        role,
      },
    };

    this.addEvent(event);
    return event;
  }

  /**
   * Create a checkpoint
   */
  createCheckpoint(
    description?: string,
    messageIds?: string[]
  ): Checkpoint {
    const conversation = this.conversations.get(this.current.conversationId);
    if (!conversation) {
      throw new Error(`Current conversation ${this.current.conversationId} not found`);
    }

    const checkpointId = uuidv4();
    const checkpoint: Checkpoint = {
      id: checkpointId,
      conversationId: this.current.conversationId,
      turnNumber: this.current.turnNumber,
      timestamp: new Date().toISOString(),
      description,
      snapshot: {
        messageIds: messageIds || [...conversation.messageIds],
        tokenCount: this.current.tokenCount,
        modelId: this.current.modelId,
        contextMetadata: {
          totalTokens: this.current.tokenCount,
          criticalTokens: 0, // TODO: Calculate
          compactableTokens: 0, // TODO: Calculate
        },
      },
      resumable: true,
      resumeCount: 0,
    };

    this.checkpoints.set(checkpointId, checkpoint);

    // Record checkpoint event
    this.addEvent({
      id: uuidv4(),
      type: 'checkpoint',
      timestamp: checkpoint.timestamp,
      conversationId: this.current.conversationId,
      turnNumber: this.current.turnNumber,
      metadata: {
        checkpointId,
        description,
        messageCount: checkpoint.snapshot.messageIds.length,
        tokenCount: checkpoint.snapshot.tokenCount,
        modelId: checkpoint.snapshot.modelId,
      },
    });

    return checkpoint;
  }

  /**
   * Resume from a checkpoint
   */
  resumeFromCheckpoint(
    checkpointId: string,
    newModelId?: string
  ): { conversation: Conversation; checkpoint: Checkpoint } {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint ${checkpointId} not found`);
    }

    if (!checkpoint.resumable) {
      throw new Error(`Checkpoint ${checkpointId} is not resumable`);
    }

    // Create new conversation as a branch
    const newConversationId = uuidv4();
    const modelId = newModelId || checkpoint.snapshot.modelId;

    const conversation: Conversation = {
      id: newConversationId,
      startTime: new Date().toISOString(),
      lastActiveTime: new Date().toISOString(),
      turnCount: checkpoint.turnNumber,
      messageIds: [...checkpoint.snapshot.messageIds],
      parentConversationId: checkpoint.conversationId,
      branchPoint: checkpoint.turnNumber,
      modelId,
      tokenCount: checkpoint.snapshot.tokenCount,
      isActive: true,
    };

    // Deactivate current conversation
    const currentConv = this.conversations.get(this.current.conversationId);
    if (currentConv) {
      currentConv.isActive = false;
    }

    this.conversations.set(newConversationId, conversation);

    // Update current state
    this.current = {
      conversationId: newConversationId,
      modelId,
      turnNumber: checkpoint.turnNumber,
      tokenCount: checkpoint.snapshot.tokenCount,
    };

    // Increment resume count
    checkpoint.resumeCount++;

    // Record resume event
    this.addEvent({
      id: uuidv4(),
      type: 'resume',
      timestamp: conversation.startTime,
      conversationId: newConversationId,
      turnNumber: checkpoint.turnNumber,
      metadata: {
        checkpointId,
        resumedModel: modelId,
        originalModel: checkpoint.snapshot.modelId,
      },
    });

    return { conversation, checkpoint };
  }

  /**
   * Record a model switch
   */
  recordModelSwitch(fromModel: string, toModel: string, reason?: string): ModelSwitch {
    const modelSwitch: ModelSwitch = {
      id: uuidv4(),
      conversationId: this.current.conversationId,
      timestamp: new Date().toISOString(),
      turnNumber: this.current.turnNumber,
      fromModel,
      toModel,
      reason,
    };

    this.modelSwitches.push(modelSwitch);
    this.current.modelId = toModel;

    // Update conversation model
    const conversation = this.conversations.get(this.current.conversationId);
    if (conversation) {
      conversation.modelId = toModel;
    }

    // Record model switch event
    this.addEvent({
      id: uuidv4(),
      type: 'model_switch',
      timestamp: modelSwitch.timestamp,
      conversationId: this.current.conversationId,
      turnNumber: this.current.turnNumber,
      metadata: {
        fromModel,
        toModel,
        reason,
      },
    });

    return modelSwitch;
  }

  /**
   * Record a compaction
   */
  recordCompaction(
    compactionId: string,
    startTurn: number,
    endTurn: number,
    messageCount: number,
    originalTokens: number,
    compressedTokens: number,
    trigger: 'auto' | 'manual' | 'helper-fallback',
    helperModel?: string
  ): CompactionPoint {
    const compactionPoint: CompactionPoint = {
      id: compactionId,
      conversationId: this.current.conversationId,
      timestamp: new Date().toISOString(),
      range: {
        startTurn,
        endTurn,
        messageCount,
      },
      tokens: {
        original: originalTokens,
        compressed: compressedTokens,
        savings: originalTokens - compressedTokens,
      },
      trigger,
    };

    this.compactionPoints.set(compactionId, compactionPoint);

    // Record compaction event
    this.addEvent({
      id: uuidv4(),
      type: 'compaction',
      timestamp: compactionPoint.timestamp,
      conversationId: this.current.conversationId,
      turnNumber: this.current.turnNumber,
      metadata: {
        compactionId,
        trigger,
        originalTokens,
        compressedTokens,
        tokensSaved: compactionPoint.tokens.savings,
        mainModel: this.current.modelId,
        helperModel,
      },
    });

    return compactionPoint;
  }

  /**
   * Update token count
   */
  updateTokenCount(tokenCount: number): void {
    this.current.tokenCount = tokenCount;

    const conversation = this.conversations.get(this.current.conversationId);
    if (conversation) {
      conversation.tokenCount = tokenCount;
    }
  }

  /**
   * Get all events
   */
  getEvents(): AnyTimelineEvent[] {
    return [...this.events];
  }

  /**
   * Get events by type
   */
  getEventsByType<T extends AnyTimelineEvent>(type: TimelineEventType): T[] {
    return this.events.filter(e => e.type === type) as T[];
  }

  /**
   * Get current conversation
   */
  getCurrentConversation(): Conversation | undefined {
    return this.conversations.get(this.current.conversationId);
  }

  /**
   * Get conversation by ID
   */
  getConversation(conversationId: string): Conversation | undefined {
    return this.conversations.get(conversationId);
  }

  /**
   * Get all conversations
   */
  getAllConversations(): Conversation[] {
    return Array.from(this.conversations.values());
  }

  /**
   * Get checkpoint by ID
   */
  getCheckpoint(checkpointId: string): Checkpoint | undefined {
    return this.checkpoints.get(checkpointId);
  }

  /**
   * Get all checkpoints
   */
  getAllCheckpoints(): Checkpoint[] {
    return Array.from(this.checkpoints.values());
  }

  /**
   * Get compaction point by ID
   */
  getCompactionPoint(compactionId: string): CompactionPoint | undefined {
    return this.compactionPoints.get(compactionId);
  }

  /**
   * Get all compaction points
   */
  getAllCompactionPoints(): CompactionPoint[] {
    return Array.from(this.compactionPoints.values());
  }

  /**
   * Get all model switches
   */
  getModelSwitches(): ModelSwitch[] {
    return [...this.modelSwitches];
  }

  /**
   * Get all resume points
   */
  getResumePoints(): ResumePoint[] {
    return [...this.resumePoints];
  }

  /**
   * Serialize to JSON for storage
   */
  toJSON(): any {
    return {
      sessionId: this.sessionId,
      createdAt: this.createdAt,
      lastActiveAt: this.lastActiveAt,
      events: this.events,
      conversations: Array.from(this.conversations.entries()),
      checkpoints: Array.from(this.checkpoints.entries()),
      compactionPoints: Array.from(this.compactionPoints.entries()),
      modelSwitches: this.modelSwitches,
      resumePoints: this.resumePoints,
      current: this.current,
    };
  }

  /**
   * Deserialize from JSON
   */
  static fromJSON(data: any): SessionTimeline {
    const timeline = Object.create(SessionTimeline.prototype);
    Object.assign(timeline, {
      sessionId: data.sessionId,
      createdAt: data.createdAt,
      lastActiveAt: data.lastActiveAt,
      events: data.events || [],
      conversations: new Map(data.conversations || []),
      checkpoints: new Map(data.checkpoints || []),
      compactionPoints: new Map(data.compactionPoints || []),
      modelSwitches: data.modelSwitches || [],
      resumePoints: data.resumePoints || [],
      current: data.current,
    });
    return timeline;
  }
}
