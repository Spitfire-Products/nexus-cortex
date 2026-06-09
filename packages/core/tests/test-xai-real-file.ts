/**
 * XAI Tool Call Test with Real File
 *
 * Tests XAI tool calling with an actual file that exists
 */

import { createOrchestrator } from './src/orchestrator/OrchestratorFactory.js';

async function testXAIWithRealFile() {
  console.log('\n=== XAI Tool Call Test (Real File) ===\n');

  const orchestrator = createOrchestrator({
    defaultModelId: 'grok-code-fast-1',
    projectPath: '/home/runner/workspace/nexus-cortex/packages/core',
    storageDir: '.cortex/test-sessions/xai-real-file',
    debug: true
  });

  const session = await orchestrator.createSession(
    '/home/runner/workspace/nexus-cortex/packages/core',
    'grok-code-fast-1'
  );

  console.log(`Session: ${session.sessionId}\n`);

  // Ask XAI to read package.json (which definitely exists)
  const response = await orchestrator.sendMessage(
    'Use the Read tool to read the file at path "/home/runner/workspace/nexus-cortex/packages/core/package.json". Return the first 100 characters of the content.',
    { tools: [] }  // Include all tools
  );

  console.log('\n=== Response ===');
  console.log(response.content);

  // Check if tool was called
  const history = orchestrator.getMessageHistory();
  const toolCalls = history.filter(m =>
    m.role === 'assistant' &&
    m.content &&
    m.content.some((c: any) => c.type === 'tool_use')
  );

  console.log('\n=== Summary ===');
  if (toolCalls.length > 0) {
    console.log('✅ SUCCESS: XAI called tools!');
    console.log(`   Tool calls made: ${toolCalls.length}`);

    // Extract actual tool names called
    const toolNames = toolCalls.flatMap(m =>
      m.content
        .filter((c: any) => c.type === 'tool_use')
        .map((c: any) => c.toolUse?.name)
    );
    console.log(`   Tools called: ${toolNames.join(', ')}`);
  } else {
    console.log('❌ FAIL: No tool calls detected');
  }
}

testXAIWithRealFile().catch(console.error);
