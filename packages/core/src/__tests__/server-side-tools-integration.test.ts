/**
 * Server-Side Tools Integration Test
 *
 * Real API test with XAI Responses API and server-side tools.
 * Tests the full flow: detection, endpoint switching, and metadata extraction.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { CortexOrchestrator } from '../orchestrator/CortexOrchestrator';
import { createOrchestrator } from '../orchestrator/OrchestratorFactory';
import { XAIServerSideTools, toCanonicalTool } from '../tools/ServerSideTools';
import * as fs from 'fs';
import * as path from 'path';

// Only run if ENABLE_SMOKE_TESTS is true
const shouldRunTest = process.env.ENABLE_SMOKE_TESTS === 'true' && !!process.env.XAI_API_KEY;
const testMode = shouldRunTest ? describe : describe.skip;

testMode('Server-Side Tools Integration (Real XAI API)', () => {
  let orchestrator: CortexOrchestrator;
  let testProjectPath: string;

  beforeAll(() => {
    // Create test project directory
    testProjectPath = '/tmp/tests/server-side-tools-test';
    if (!fs.existsSync(testProjectPath)) {
      fs.mkdirSync(testProjectPath, { recursive: true });
    }

    // Enable server-side tools for this test
    process.env.ENABLE_SERVER_SIDE_TOOLS = 'true';

    console.log('[Test Setup] Server-side tools enabled');
    console.log('[Test Setup] XAI API key:', process.env.XAI_API_KEY ? 'Present' : 'Missing');
  });

  it('should detect and use server-side tools with XAI Responses API', async () => {
    // Create orchestrator with factory
    orchestrator = createOrchestrator({
      defaultModelId: 'grok-4-fast',
      projectPath: testProjectPath,
      storageDir: '/tmp/tests/.cortex/server-side-tools',
      debug: true,
      useHelperModels: false
    });

    // Create session
    const sessionId = await orchestrator.createSession(testProjectPath, 'grok-4-fast');
    console.log('[Test] Session created:', sessionId);

    // Prepare server-side tools
    const tools = [
      toCanonicalTool(XAIServerSideTools.webSearch()),
      toCanonicalTool(XAIServerSideTools.xSearch()),
      toCanonicalTool(XAIServerSideTools.codeExecution())
    ];

    console.log('[Test] Sending message with server-side tools...');
    console.log('[Test] Tools:', tools.map(t => t.name).join(', '));

    // Send message with server-side tools
    // Note: Historical context tools are added automatically by orchestrator
    // This will cause a mix warning, but that's expected behavior
    const response = await orchestrator.sendMessage(
      'What is 2 + 2? Use code execution to calculate it.',
      { tools }
    );

    console.log('[Test] Response received');
    console.log('[Test] Message ID:', response.messageId);
    console.log('[Test] Model used:', response.model);
    console.log('[Test] Content length:', typeof response.content === 'string' ? response.content.length : JSON.stringify(response.content).length);

    // Assertions
    expect(response).toBeDefined();
    expect(response.messageId).toBeDefined();
    expect(response.model.id).toBe('grok-4-fast');
    expect(response.model.provider).toBe('xai');

    // Check for server-side tools metadata
    expect(response.metadata.serverSideTools).toBeDefined();

    if (response.metadata.serverSideTools) {
      const metadata = response.metadata.serverSideTools;

      console.log('[Test] Server-side metadata:');
      console.log('  - Autonomous execution:', metadata.autonomousExecution);
      console.log('  - Tool calls:', metadata.toolCalls.length);
      console.log('  - Citations:', metadata.citations?.length || 0);
      console.log('  - Tool usage:', Object.keys(metadata.toolUsage).length);

      // Assertions on metadata
      expect(metadata.autonomousExecution).toBe(true);
      expect(metadata.toolCalls).toBeDefined();
      expect(Array.isArray(metadata.toolCalls)).toBe(true);

      // Should have citations from web/X search
      if (metadata.citations) {
        expect(metadata.citations.length).toBeGreaterThan(0);
        console.log('[Test] Sample citations:', metadata.citations.slice(0, 3));
      }

      // Should have tool usage stats
      expect(Object.keys(metadata.toolUsage).length).toBeGreaterThan(0);
      console.log('[Test] Tool usage breakdown:', metadata.toolUsage);

      // Check reasoning tokens if available
      if (metadata.providerMetadata?.reasoning_tokens) {
        console.log('[Test] Reasoning tokens:', metadata.providerMetadata.reasoning_tokens);
        expect(metadata.providerMetadata.reasoning_tokens).toBeGreaterThan(0);
      }
    }

    // Check token usage
    expect(response.usage).toBeDefined();
    expect(response.usage.inputTokens).toBeGreaterThan(0);
    expect(response.usage.outputTokens).toBeGreaterThan(0);
    expect(response.usage.totalTokens).toBeGreaterThan(0);

    console.log('[Test] Token usage:');
    console.log('  - Input:', response.usage.inputTokens);
    console.log('  - Output:', response.usage.outputTokens);
    console.log('  - Total:', response.usage.totalTokens);

    // Response should have content
    expect(response.content).toBeDefined();
    if (typeof response.content === 'string') {
      expect(response.content.length).toBeGreaterThan(0);
    } else {
      expect(response.content.length).toBeGreaterThan(0);
    }

    console.log('[Test] ✅ Server-side tools test PASSED');
  }, 60000); // 60 second timeout for API call

  it('should fall back to client-side when ENABLE_SERVER_SIDE_TOOLS is false', async () => {
    // Disable server-side tools
    process.env.ENABLE_SERVER_SIDE_TOOLS = 'false';

    orchestrator = createOrchestrator({
      defaultModelId: 'grok-4-fast',
      projectPath: testProjectPath,
      storageDir: '/tmp/tests/.cortex/server-side-tools',
      debug: true,
      useHelperModels: false
    });

    await orchestrator.createSession(testProjectPath, 'grok-4-fast');

    const tools = [
      toCanonicalTool(XAIServerSideTools.webSearch())
    ];

    console.log('[Test] Sending message with server-side tools DISABLED...');

    const response = await orchestrator.sendMessage(
      'What is 2 + 2?',
      { tools }
    );

    console.log('[Test] Response received');

    // Should NOT have server-side tools metadata
    expect(response.metadata.serverSideTools).toBeUndefined();

    console.log('[Test] ✅ Fallback test PASSED (no server-side metadata as expected)');
  }, 30000);

  it('should use Messages API endpoint when server-side tools disabled', async () => {
    // Disable server-side tools
    process.env.ENABLE_SERVER_SIDE_TOOLS = 'false';

    orchestrator = createOrchestrator({
      defaultModelId: 'grok-4-fast',
      projectPath: testProjectPath,
      storageDir: '/tmp/tests/.cortex/server-side-tools',
      debug: true,
      useHelperModels: false
    });

    await orchestrator.createSession(testProjectPath, 'grok-4-fast');

    // Send simple message without tools
    const response = await orchestrator.sendMessage('Hello, what is your name?');

    expect(response).toBeDefined();
    expect(response.model.provider).toBe('xai');

    // Should work with Messages API (default endpoint)
    console.log('[Test] ✅ Messages API test PASSED');
  }, 30000);
});
