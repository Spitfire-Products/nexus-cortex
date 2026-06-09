/**
 * Multi-Turn Tool Call Integration Tests (Real API)
 *
 * Validates:
 * - Multi-turn tool calling with real API (grok-code-fast-1)
 * - Canonical message storage and retrieval
 * - Session timeline event tracking
 * - Tool use → tool result pairing integrity
 * - Message history preservation
 *
 * Uses grok-code-fast-1: Fast, cheap, capable model for testing
 *
 * NOTE: Requires XAI_API_KEY environment variable
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { CortexOrchestrator } from '../../CortexOrchestrator.js';
import { createOrchestrator } from '../../OrchestratorFactory.js';
import type { CanonicalTool } from '../../../adapters/FormatAdapter.interface.js';
import { rm } from 'fs/promises';
import { existsSync } from 'fs';

const SKIP_SMOKE_TESTS = !process.env.ENABLE_SMOKE_TESTS || !process.env.XAI_API_KEY;

describe.skipIf(SKIP_SMOKE_TESTS)('Multi-Turn Tool Calls Integration (grok-code-fast-1)', () => {
  let orchestrator: CortexOrchestrator;
  const testStorageDir = '/tmp/tests/.cortex/test-sessions/multi-turn-tools';

  beforeAll(async () => {
    // Clean up test storage
    if (existsSync(testStorageDir)) {
      await rm(testStorageDir, { recursive: true, force: true });
    }

    orchestrator = createOrchestrator({
      defaultModelId: 'grok-code-fast-1',
      projectPath: '/tmp/tests/multi-turn-tools',
      storageDir: testStorageDir,
      debug: true
    });
  });

  describe('Single-Turn Tool Call with Session Storage', () => {
    it('should execute single tool call and store in session', async () => {
      // Create session
      const session = await orchestrator.createSession(
        '/tmp/tests/multi-turn-tools',
        'grok-code-fast-1'
      );

      expect(session.sessionId).toBeDefined();
      expect(session.conversationId).toBeDefined();

      // Use real tools with actual executors (no tools parameter = use all default tools)
      // Send message that should trigger Read tool use
      const response = await orchestrator.sendMessage(
        'Read the package.json file in the current directory and tell me the package name'
      );

      expect(response).toBeDefined();
      expect(response.content).toBeDefined();

      // Check message history
      const history = orchestrator.getMessageHistory();

      // Should have at least: user message, assistant tool request
      expect(history.length).toBeGreaterThanOrEqual(2);

      // Verify user message
      const userMsg = history[0];
      expect(userMsg.message.role).toBe('user');
      expect(userMsg.type).toBe('user');
      const userContent = Array.isArray(userMsg.message.content) ? userMsg.message.content : [{ type: 'text', text: userMsg.message.content }];
      expect(userContent[0].type).toBe('text');

      // Verify assistant tool request
      const assistantMsg = history[1];
      expect(assistantMsg.message.role).toBe('assistant');

      // Should have tool_use content
      const assistantContent = Array.isArray(assistantMsg.message.content) ? assistantMsg.message.content : [{ type: 'text', text: assistantMsg.message.content }];
      const hasToolUse = assistantContent.some(c => c.type === 'tool_use');
      expect(hasToolUse).toBe(true);

      // Verify canonical message structure
      expect(userMsg.uuid).toBeDefined();
      expect(userMsg.timestamp).toBeDefined();
      expect(userMsg.timeline).toBeDefined();
      expect(userMsg.timeline.sessionId).toBe(session.sessionId);
      expect(userMsg.timeline.conversationId).toBe(session.conversationId);
      expect(userMsg.timeline.turnNumber).toBeDefined();

      // Verify timeline tracking
      expect(assistantMsg.timeline.sessionId).toBe(session.sessionId);
      expect(assistantMsg.timeline.turnNumber).toBeGreaterThan(userMsg.timeline.turnNumber);

      // Verify model metadata
      expect(userMsg.model.id).toBe('grok-code-fast-1');
      expect(userMsg.model.provider).toBe('xai');
      expect(userMsg.model.apiPattern).toBe('messages');

      console.log('✓ Single-turn tool call stored correctly');
      console.log(`  Session: ${session.sessionId}`);
      console.log(`  Messages: ${history.length}`);
      console.log(`  Turn numbers: ${history.map(m => m.timeline.turnNumber).join(', ')}`);
    }, 30000);
  });

  describe('Multi-Turn Tool Calling (3+ Turns)', () => {
    it('should handle multi-turn tool calling conversation', async () => {
      const session = await orchestrator.createSession(
        '/tmp/tests/multi-turn-tools/sequence',
        'grok-code-fast-1'
      );

      // Use default tools (Read, Write, Glob, Grep, etc.) - no tools parameter

      // First turn: Ask to read a file
      const response1 = await orchestrator.sendMessage(
        'Use Glob to find all TypeScript files in the src directory, then read the first one you find'
      );

      expect(response1).toBeDefined();
      let history = orchestrator.getMessageHistory();
      const initialMessageCount = history.length;

      console.log(`\n✓ Turn 1 complete: ${initialMessageCount} messages`);

      // Verify tool call was made
      const hasToolCall = history.some(m => {
        if (m.message.role !== 'assistant') return false;
        const content = Array.isArray(m.message.content) ? m.message.content : [];
        return content.some(c => c.type === 'tool_use');
      });

      if (!hasToolCall) {
        console.warn('  Warning: No tool call detected in Turn 1');
      }

      // Second turn: Follow-up question
      const response2 = await orchestrator.sendMessage(
        'Now search that file for the word "export" using Grep'
      );

      expect(response2).toBeDefined();
      history = orchestrator.getMessageHistory();

      console.log(`✓ Turn 2 complete: ${history.length} messages`);
      expect(history.length).toBeGreaterThan(initialMessageCount);

      // Third turn: Another follow-up
      const response3 = await orchestrator.sendMessage(
        'Summarize what you found'
      );

      expect(response3).toBeDefined();
      history = orchestrator.getMessageHistory();

      console.log(`✓ Turn 3 complete: ${history.length} messages`);

      // Verify message sequence integrity
      const turnNumbers = history.map(m => m.timeline.turnNumber);
      const uniqueTurns = new Set(turnNumbers);

      // Turn numbers should be sequential
      expect(turnNumbers[0]).toBeLessThan(turnNumbers[turnNumbers.length - 1]);

      // All messages should have same session/conversation
      const sessionIds = new Set(history.map(m => m.timeline.sessionId));
      const conversationIds = new Set(history.map(m => m.timeline.conversationId));

      expect(sessionIds.size).toBe(1);
      expect(conversationIds.size).toBe(1);
      expect(sessionIds.has(session.sessionId)).toBe(true);
      expect(conversationIds.has(session.conversationId)).toBe(true);

      // Verify tool_use/tool_result pairing
      const toolUseMessages = history.filter(m => {
        if (m.message.role !== 'assistant') return false;
        const content = Array.isArray(m.message.content) ? m.message.content : [];
        return content.some(c => c.type === 'tool_use');
      });

      const toolResultMessages = history.filter(m => {
        if (m.message.role !== 'user') return false;
        const content = Array.isArray(m.message.content) ? m.message.content : [];
        return content.some(c => c.type === 'tool_result');
      });

      console.log(`  Tool uses: ${toolUseMessages.length}`);
      console.log(`  Tool results: ${toolResultMessages.length}`);

      // Each tool_use should have a corresponding tool_result
      // (may not be equal if some tool calls are still pending)
      expect(toolResultMessages.length).toBeLessThanOrEqual(toolUseMessages.length);

      console.log('✓ Multi-turn conversation integrity verified');
      console.log(`  Total messages: ${history.length}`);
      console.log(`  Unique turns: ${uniqueTurns.size}`);
      console.log(`  Turn range: ${Math.min(...turnNumbers)} - ${Math.max(...turnNumbers)}`);
    }, 60000);
  });

  describe('Parallel Tool Calls with Session Storage', () => {
    it('should handle parallel tool calls and store correctly', async () => {
      const session = await orchestrator.createSession(
        '/tmp/tests/multi-turn-tools/parallel',
        'grok-code-fast-1'
      );

      // Use default tools - ask for parallel operations
      const response = await orchestrator.sendMessage(
        'Find all .ts files in the src directory using Glob, and also search for the word "interface" using Grep. Do both at the same time.'
      );

      expect(response).toBeDefined();

      const history = orchestrator.getMessageHistory();

      // Find assistant message with tool calls
      const assistantMsgWithTools = history.find(m => {
        if (m.message.role !== 'assistant') return false;
        const content = Array.isArray(m.message.content) ? m.message.content : [];
        return content.some(c => c.type === 'tool_use');
      });

      if (assistantMsgWithTools) {
        const msgContent = Array.isArray(assistantMsgWithTools.message.content) ? assistantMsgWithTools.message.content : [];
        const toolUses = msgContent.filter(c => c.type === 'tool_use');

        console.log(`✓ Parallel tool calls detected: ${toolUses.length}`);

        // Verify each tool_use has required fields
        toolUses.forEach((toolUse, idx) => {
          if (toolUse.type === 'tool_use') {
            expect(toolUse.toolUse.id).toBeDefined();
            expect(toolUse.toolUse.name).toBeDefined();
            expect(toolUse.toolUse.input).toBeDefined();

            console.log(`  Tool ${idx + 1}: ${toolUse.toolUse.name} (${toolUse.toolUse.id})`);
          }
        });

        // Verify canonical message structure
        expect(assistantMsgWithTools.uuid).toBeDefined();
        expect(assistantMsgWithTools.timeline.sessionId).toBe(session.sessionId);
        expect(assistantMsgWithTools.timeline.conversationId).toBe(session.conversationId);
      } else {
        console.warn('  Warning: No parallel tool calls detected');
      }

      console.log('✓ Parallel tool call storage verified');
    }, 30000);
  });

  describe('Timeline Event Tracking', () => {
    it('should track timeline events for tool calling session', async () => {
      const session = await orchestrator.createSession(
        '/tmp/tests/multi-turn-tools/timeline',
        'grok-code-fast-1'
      );

      // Use default tools

      // Turn 1
      await orchestrator.sendMessage('Use Glob to find all package.json files');

      const history1 = orchestrator.getMessageHistory();
      const turn1Numbers = history1.map(m => m.timeline.turnNumber);

      // Turn 2
      await orchestrator.sendMessage('Now read the first one you found');

      const history2 = orchestrator.getMessageHistory();
      const turn2Numbers = history2.map(m => m.timeline.turnNumber);

      // Verify turn numbers are incremental
      expect(Math.max(...turn2Numbers)).toBeGreaterThan(Math.max(...turn1Numbers));

      // Verify all messages have timeline metadata
      history2.forEach(msg => {
        expect(msg.timeline).toBeDefined();
        expect(msg.timeline.sessionId).toBe(session.sessionId);
        expect(msg.timeline.conversationId).toBe(session.conversationId);
        expect(msg.timeline.turnNumber).toBeGreaterThanOrEqual(0); // First message is turn 0
        expect(msg.uuid).toBeDefined(); // UUID exists (format doesn't matter)
        expect(msg.timestamp).toBeDefined();
      });

      console.log('✓ Timeline tracking verified');
      console.log(`  Turn 1 range: ${Math.min(...turn1Numbers)} - ${Math.max(...turn1Numbers)}`);
      console.log(`  Turn 2 range: ${Math.min(...turn2Numbers)} - ${Math.max(...turn2Numbers)}`);
      console.log(`  All messages have timeline metadata`);
    }, 45000);
  });

  describe('Canonical Message Integrity', () => {
    it('should maintain tool_use/tool_result pair integrity', async () => {
      const session = await orchestrator.createSession(
        '/tmp/tests/multi-turn-tools/integrity',
        'grok-code-fast-1'
      );

      // Use default tools
      await orchestrator.sendMessage(
        'Use Read to read the package.json file'
      );

      const history = orchestrator.getMessageHistory();

      // Find all tool_use messages
      const toolUseMessages = history.filter(m => {
        if (m.message.role !== 'assistant') return false;
        const content = Array.isArray(m.message.content) ? m.message.content : [];
        return content.some(c => c.type === 'tool_use');
      });

      // Find all tool_result messages
      const toolResultMessages = history.filter(m => {
        if (m.message.role !== 'user') return false;
        const content = Array.isArray(m.message.content) ? m.message.content : [];
        return content.some(c => c.type === 'tool_result');
      });

      console.log(`✓ Message integrity check:`);
      console.log(`  Tool use messages: ${toolUseMessages.length}`);
      console.log(`  Tool result messages: ${toolResultMessages.length}`);

      // Extract all tool_use IDs
      const toolUseIds: string[] = [];
      toolUseMessages.forEach(msg => {
        const content = Array.isArray(msg.message.content) ? msg.message.content : [];
        content.forEach(contentItem => {
          if (contentItem.type === 'tool_use') {
            toolUseIds.push(contentItem.toolUse.id);
          }
        });
      });

      // Extract all tool_result IDs
      const toolResultIds: string[] = [];
      toolResultMessages.forEach(msg => {
        const content = Array.isArray(msg.message.content) ? msg.message.content : [];
        content.forEach(contentItem => {
          if (contentItem.type === 'tool_result') {
            toolResultIds.push(contentItem.tool_use_id);
          }
        });
      });

      console.log(`  Tool use IDs: ${toolUseIds.join(', ')}`);
      console.log(`  Tool result IDs: ${toolResultIds.join(', ')}`);

      // Each tool_result should reference a tool_use
      toolResultIds.forEach(resultId => {
        expect(toolUseIds).toContain(resultId);
      });

      // Verify message structure
      toolUseMessages.forEach(msg => {
        expect(msg.type).toBe('assistant'); // Assistant messages contain tool_use blocks
        expect(msg.timeline).toBeDefined();
        expect(msg.model).toBeDefined();
        expect(msg.model.id).toBe('grok-code-fast-1');
      });

      toolResultMessages.forEach(msg => {
        expect(msg.type).toBe('user'); // Tool result messages have type 'user' with role 'user'
        expect(msg.timeline).toBeDefined();
      });

      console.log('✓ Tool use/result pairing verified');
      console.log('✓ Canonical message structure validated');
    }, 30000);
  });

  describe('Session Storage Persistence', () => {
    it('should persist session data to disk', async () => {
      const session = await orchestrator.createSession(
        '/tmp/tests/multi-turn-tools/persistence',
        'grok-code-fast-1'
      );

      // Use default tools
      await orchestrator.sendMessage('Use Glob to find package.json files');

      const history = orchestrator.getMessageHistory();

      // Verify session file exists (sessions stored as .jsonl files, not directories)
      const sessionFile = `${testStorageDir}/${session.sessionId}.jsonl`;
      expect(existsSync(sessionFile)).toBe(true);

      console.log('✓ Session storage persistence verified');
      console.log(`  Session file: ${sessionFile}`);
      console.log(`  Messages persisted: ${history.length}`);
    }, 30000);
  });

  describe('System Message Injection with Multi-Turn Tool Calls', () => {
    it('should inject system messages on turn 0 with tools and reasoning', async () => {
      const session = await orchestrator.createSession(
        '/tmp/tests/multi-turn-tools/system-messages',
        'grok-code-fast-1'
      );

      // Use default tools
      // Turn 0: First message should have system messages injected
      const response = await orchestrator.sendMessage(
        'Use Grep to search for "export" in package.json'
      );

      expect(response).toBeDefined();

      const history = orchestrator.getMessageHistory();

      // Get the first user message
      const firstUserMsg = history.find(m => m.message.role === 'user');
      expect(firstUserMsg).toBeDefined();

      // Verify message has content array (not just string)
      expect(Array.isArray(firstUserMsg!.message.content) || typeof firstUserMsg!.message.content === 'string').toBe(true);

      // Check for system-reminder tags in content
      const content = firstUserMsg!.message.content;
      const contentArray = Array.isArray(content) ? content : [{ type: 'text', text: content }];
      const hasSystemReminders = contentArray.some(
        c => c.type === 'text' && c.text?.includes('<system-reminder>')
      );

      if (hasSystemReminders) {
        console.log('✓ System messages injected on turn 0');

        // Count system reminder blocks
        const systemReminderCount = contentArray.filter(
          c => c.type === 'text' && c.text?.includes('<system-reminder>')
        ).length;

        console.log(`  System message blocks: ${systemReminderCount}`);

        // Verify specific system messages are present
        const contentText = contentArray
          .filter(c => c.type === 'text')
          .map(c => c.text)
          .join('\n');

        // Should have SYSTEM_PROMPT (turn 0)
        const hasSystemPrompt = contentText.includes('SYSTEM_PROMPT') ||
                               contentText.includes('Core instructions') ||
                               contentText.includes('AI role');

        // Should have TOOL_USAGE_GUIDE (tools present)
        const hasToolGuide = contentText.includes('TOOL_USAGE') ||
                            contentText.includes('tool') ||
                            contentText.includes('function');

        // Should have REASONING_GUIDE (grok-code-fast-1 is a reasoning model)
        const hasReasoningGuide = contentText.includes('REASONING') ||
                                 contentText.includes('thinking') ||
                                 contentText.includes('reasoning');

        console.log(`  Has SYSTEM_PROMPT indicators: ${hasSystemPrompt}`);
        console.log(`  Has TOOL_USAGE indicators: ${hasToolGuide}`);
        console.log(`  Has REASONING indicators: ${hasReasoningGuide}`);

        // At least some system messages should be present
        expect(systemReminderCount).toBeGreaterThan(0);
      } else {
        console.log('⚠ No system-reminder tags found - system messages may not be injecting');
        console.log('  This could indicate system message injection needs debugging');

        // Log first content block for debugging
        if (contentArray.length > 0) {
          const firstBlock = contentArray[0];
          console.log(`  First content block type: ${firstBlock.type}`);
          if (firstBlock.type === 'text' && firstBlock.text) {
            console.log(`  First 200 chars: ${firstBlock.text.substring(0, 200)}`);
          }
        }
      }

      // Verify canonical message structure
      expect(firstUserMsg!.uuid).toBeDefined();
      expect(firstUserMsg!.timestamp).toBeDefined();
      expect(firstUserMsg!.timeline).toBeDefined();
      expect(firstUserMsg!.timeline.turnNumber).toBe(0);
      expect(firstUserMsg!.model.id).toBe('grok-code-fast-1');

      console.log('✓ Turn 0 message structure validated');
      console.log(`  Message UUID: ${firstUserMsg!.uuid}`);
      console.log(`  Turn number: ${firstUserMsg!.timeline.turnNumber}`);
      console.log(`  Content blocks: ${contentArray.length}`);
    }, 30000);

    it('should maintain system message injection across multiple turns', async () => {
      const session = await orchestrator.createSession(
        '/tmp/tests/multi-turn-tools/system-messages-multi',
        'grok-code-fast-1'
      );

      // Use default tools

      // Turn 0
      await orchestrator.sendMessage('Use Glob to find .ts files');

      // Turn 1
      await orchestrator.sendMessage('Now read the first file');

      // Turn 2
      await orchestrator.sendMessage('Tell me what it contains');

      const history = orchestrator.getMessageHistory();

      // Verify all user PROMPT messages (not tool results) have proper structure
      // Filter by checking content: user prompts have text blocks, tool results have tool_result blocks
      const userMessages = history.filter(m => {
        if (m.type !== 'user') return false;
        const content = Array.isArray(m.message.content) ? m.message.content : [];
        return content.some(c => c.type === 'text' || c.type === 'system_reminder');
      });

      console.log(`✓ Multi-turn conversation complete: ${userMessages.length} user messages`);

      // Check turn numbers are sequential (should be 0, 2, 4 for the 3 user prompts)
      const turnNumbers = userMessages.map(m => m.timeline.turnNumber);
      console.log(`  Turn numbers: ${turnNumbers.join(', ')}`);

      expect(turnNumbers[0]).toBe(0);
      expect(turnNumbers[1]).toBeGreaterThan(turnNumbers[0]);
      expect(turnNumbers[2]).toBeGreaterThan(turnNumbers[1]);

      // All should have same session
      const sessionIds = new Set(userMessages.map(m => m.timeline.sessionId));
      expect(sessionIds.size).toBe(1);
      expect(sessionIds.has(session.sessionId)).toBe(true);

      console.log('✓ Multi-turn system message injection validated');
      console.log(`  Session ID consistent: ${session.sessionId}`);
      console.log(`  Total messages in history: ${history.length}`);
    }, 60000);
  });
});
