/**
 * SessionTimeline Tests
 * Week 2 Phase 1.5
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SessionTimeline, Conversation, Checkpoint } from '../SessionTimeline.js';

describe('SessionTimeline', () => {
  let timeline: SessionTimeline;
  const sessionId = 'test-session-123';
  const modelId = 'claude-sonnet-4-5-20250929';

  beforeEach(() => {
    timeline = new SessionTimeline(sessionId, modelId);
  });

  describe('Initialization', () => {
    it('should create timeline with session ID and initial model', () => {
      expect(timeline.sessionId).toBe(sessionId);
      expect(timeline.current.modelId).toBe(modelId);
      expect(timeline.current.turnNumber).toBe(0);
    });

    it('should create initial conversation', () => {
      const conversation = timeline.getCurrentConversation();
      expect(conversation).toBeDefined();
      expect(conversation?.modelId).toBe(modelId);
      expect(conversation?.turnCount).toBe(0);
      expect(conversation?.isActive).toBe(true);
    });

    it('should record conversation start event', () => {
      const events = timeline.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('conversation_start');
    });
  });

  describe('Message Recording', () => {
    it('should record user message', () => {
      const messageEvent = timeline.recordMessage('msg-1', 'user');

      expect(messageEvent.type).toBe('message');
      expect(messageEvent.messageId).toBe('msg-1');
      expect(messageEvent.metadata.role).toBe('user');
    });

    it('should increment turn number on user message', () => {
      timeline.recordMessage('msg-1', 'user');
      expect(timeline.current.turnNumber).toBe(1);

      timeline.recordMessage('msg-2', 'assistant');
      expect(timeline.current.turnNumber).toBe(1); // Doesn't increment for assistant

      timeline.recordMessage('msg-3', 'user');
      expect(timeline.current.turnNumber).toBe(2);
    });

    it('should add message IDs to conversation', () => {
      timeline.recordMessage('msg-1', 'user');
      timeline.recordMessage('msg-2', 'assistant');

      const conversation = timeline.getCurrentConversation();
      expect(conversation?.messageIds).toContain('msg-1');
      expect(conversation?.messageIds).toContain('msg-2');
    });
  });

  describe('Checkpoint Creation', () => {
    beforeEach(() => {
      // Add some messages
      timeline.recordMessage('msg-1', 'user');
      timeline.recordMessage('msg-2', 'assistant');
      timeline.recordMessage('msg-3', 'user');
    });

    it('should create checkpoint', () => {
      const checkpoint = timeline.createCheckpoint('Test checkpoint');

      expect(checkpoint.id).toBeDefined();
      expect(checkpoint.description).toBe('Test checkpoint');
      expect(checkpoint.turnNumber).toBe(2);
      expect(checkpoint.resumable).toBe(true);
      expect(checkpoint.resumeCount).toBe(0);
    });

    it('should include message IDs in checkpoint snapshot', () => {
      const checkpoint = timeline.createCheckpoint();

      expect(checkpoint.snapshot.messageIds).toHaveLength(3);
      expect(checkpoint.snapshot.messageIds).toContain('msg-1');
      expect(checkpoint.snapshot.messageIds).toContain('msg-2');
      expect(checkpoint.snapshot.messageIds).toContain('msg-3');
    });

    it('should record checkpoint event', () => {
      timeline.createCheckpoint('Test checkpoint');

      const checkpointEvents = timeline.getEventsByType('checkpoint');
      expect(checkpointEvents).toHaveLength(1);
      expect(checkpointEvents[0].metadata.description).toBe('Test checkpoint');
    });

    it('should store checkpoint in timeline', () => {
      const checkpoint = timeline.createCheckpoint();
      const retrieved = timeline.getCheckpoint(checkpoint.id);

      expect(retrieved).toEqual(checkpoint);
    });
  });

  describe('Checkpoint Resume', () => {
    let checkpoint: Checkpoint;

    beforeEach(() => {
      timeline.recordMessage('msg-1', 'user');
      timeline.recordMessage('msg-2', 'assistant');
      checkpoint = timeline.createCheckpoint('Before branch');
    });

    it('should resume from checkpoint', () => {
      const result = timeline.resumeFromCheckpoint(checkpoint.id);

      expect(result.conversation).toBeDefined();
      expect(result.checkpoint).toBeDefined();
      expect(result.checkpoint.id).toBe(checkpoint.id);
    });

    it('should create new conversation branch', () => {
      const beforeCount = timeline.getAllConversations().length;

      timeline.resumeFromCheckpoint(checkpoint.id);

      const afterCount = timeline.getAllConversations().length;
      expect(afterCount).toBe(beforeCount + 1);
    });

    it('should link branch to parent conversation', () => {
      const originalConvId = timeline.current.conversationId;

      const { conversation } = timeline.resumeFromCheckpoint(checkpoint.id);

      expect(conversation.parentConversationId).toBe(originalConvId);
      expect(conversation.branchPoint).toBe(checkpoint.turnNumber);
    });

    it('should allow model switch on resume', () => {
      const newModelId = 'gpt-4';

      const { conversation } = timeline.resumeFromCheckpoint(checkpoint.id, newModelId);

      expect(conversation.modelId).toBe(newModelId);
      expect(timeline.current.modelId).toBe(newModelId);
    });

    it('should increment resume count', () => {
      expect(checkpoint.resumeCount).toBe(0);

      timeline.resumeFromCheckpoint(checkpoint.id);
      expect(checkpoint.resumeCount).toBe(1);

      timeline.resumeFromCheckpoint(checkpoint.id);
      expect(checkpoint.resumeCount).toBe(2);
    });

    it('should record resume event', () => {
      timeline.resumeFromCheckpoint(checkpoint.id, 'gpt-4');

      const resumeEvents = timeline.getEventsByType('resume');
      expect(resumeEvents).toHaveLength(1);
      expect(resumeEvents[0].metadata.checkpointId).toBe(checkpoint.id);
      expect(resumeEvents[0].metadata.resumedModel).toBe('gpt-4');
    });

    it('should deactivate current conversation', () => {
      const originalConv = timeline.getCurrentConversation();

      timeline.resumeFromCheckpoint(checkpoint.id);

      expect(originalConv?.isActive).toBe(false);
    });
  });

  describe('Model Switching', () => {
    it('should record model switch', () => {
      const modelSwitch = timeline.recordModelSwitch(
        'claude-sonnet-4-5-20250929',
        'gpt-4',
        'User requested'
      );

      expect(modelSwitch.fromModel).toBe('claude-sonnet-4-5-20250929');
      expect(modelSwitch.toModel).toBe('gpt-4');
      expect(modelSwitch.reason).toBe('User requested');
    });

    it('should update current model', () => {
      timeline.recordModelSwitch('claude-sonnet-4-5-20250929', 'gpt-4');

      expect(timeline.current.modelId).toBe('gpt-4');
    });

    it('should update conversation model', () => {
      timeline.recordModelSwitch('claude-sonnet-4-5-20250929', 'gpt-4');

      const conversation = timeline.getCurrentConversation();
      expect(conversation?.modelId).toBe('gpt-4');
    });

    it('should record model switch event', () => {
      timeline.recordModelSwitch('claude-sonnet-4-5-20250929', 'gpt-4');

      const switchEvents = timeline.getEventsByType('model_switch');
      expect(switchEvents).toHaveLength(1);
    });
  });

  describe('Compaction Recording', () => {
    it('should record compaction', () => {
      const compaction = timeline.recordCompaction(
        'compact-1',
        1,
        50,
        50,
        100000,
        10000,
        'auto',
        'claude-haiku-4-5'
      );

      expect(compaction.id).toBe('compact-1');
      expect(compaction.range.startTurn).toBe(1);
      expect(compaction.range.endTurn).toBe(50);
      expect(compaction.tokens.original).toBe(100000);
      expect(compaction.tokens.compressed).toBe(10000);
      expect(compaction.tokens.savings).toBe(90000);
    });

    it('should record compaction event', () => {
      timeline.recordCompaction(
        'compact-1',
        1,
        50,
        50,
        100000,
        10000,
        'helper-fallback',
        'gpt-3.5-turbo'
      );

      const compactionEvents = timeline.getEventsByType('compaction');
      expect(compactionEvents).toHaveLength(1);
      expect(compactionEvents[0].metadata.trigger).toBe('helper-fallback');
      expect(compactionEvents[0].metadata.helperModel).toBe('gpt-3.5-turbo');
    });
  });

  describe('Token Count Tracking', () => {
    it('should update token count', () => {
      timeline.updateTokenCount(50000);

      expect(timeline.current.tokenCount).toBe(50000);
    });

    it('should update conversation token count', () => {
      timeline.updateTokenCount(50000);

      const conversation = timeline.getCurrentConversation();
      expect(conversation?.tokenCount).toBe(50000);
    });
  });

  describe('Event Queries', () => {
    beforeEach(() => {
      timeline.recordMessage('msg-1', 'user');
      timeline.createCheckpoint('checkpoint-1');
      timeline.recordModelSwitch('claude-3-5-sonnet', 'gpt-4');
      timeline.recordCompaction('compact-1', 1, 10, 10, 10000, 2000, 'auto');
    });

    it('should get all events', () => {
      const events = timeline.getEvents();

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('conversation_start');
    });

    it('should filter events by type', () => {
      const messageEvents = timeline.getEventsByType('message');
      expect(messageEvents).toHaveLength(1);

      const checkpointEvents = timeline.getEventsByType('checkpoint');
      expect(checkpointEvents).toHaveLength(1);

      const switchEvents = timeline.getEventsByType('model_switch');
      expect(switchEvents).toHaveLength(1);

      const compactionEvents = timeline.getEventsByType('compaction');
      expect(compactionEvents).toHaveLength(1);
    });
  });

  describe('Serialization', () => {
    beforeEach(() => {
      timeline.recordMessage('msg-1', 'user');
      timeline.recordMessage('msg-2', 'assistant');
      timeline.createCheckpoint('Test checkpoint');
    });

    it('should serialize to JSON', () => {
      const json = timeline.toJSON();

      expect(json.sessionId).toBe(sessionId);
      expect(json.events).toBeDefined();
      expect(json.conversations).toBeDefined();
      expect(json.checkpoints).toBeDefined();
      expect(json.current).toBeDefined();
    });

    it('should deserialize from JSON', () => {
      const json = timeline.toJSON();
      const restored = SessionTimeline.fromJSON(json);

      expect(restored.sessionId).toBe(timeline.sessionId);
      expect(restored.current.conversationId).toBe(timeline.current.conversationId);
      expect(restored.getEvents().length).toBe(timeline.getEvents().length);
      expect(restored.getAllCheckpoints().length).toBe(timeline.getAllCheckpoints().length);
    });
  });
});
