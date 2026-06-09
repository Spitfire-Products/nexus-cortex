/**
 * Simple XAI Tool Call Test
 *
 * Tests if XAI/grok-code-fast-1 will actually call tools
 */

import { createOrchestrator } from './src/orchestrator/OrchestratorFactory.js';

async function testXAIToolCall() {
  console.log('\n=== XAI Tool Call Test ===\n');

  const orchestrator = createOrchestrator({
    defaultModelId: 'grok-code-fast-1',
    projectPath: '/test/xai-tool-call',
    storageDir: '.cortex/test-sessions/xai-tool-test',
    debug: true
  });

  const session = await orchestrator.createSession(
    '/test/xai-tool-call',
    'grok-code-fast-1'
  );

  console.log(`Session: ${session.sessionId}\n`);

  // Very explicit prompt that should trigger tool usage
  // IMPORTANT: Pass tools: [] to include all registered factory tools!
  const response = await orchestrator.sendMessage(
    'Use the Read tool to read the file at path "./package.json". I need you to actually call the Read tool, not just tell me what you would do.',
    { tools: [] }  // Empty array = include all factory/MCP tools
  );

  console.log('\n=== Response ===');
  console.log(response.content);
  console.log('\n=== Message History ===');

  const history = orchestrator.getMessageHistory();
  history.forEach((msg, idx) => {
    console.log(`\n[${idx}] ${msg.role}:`);
    msg.content.forEach((block, blockIdx) => {
      console.log(`  [${blockIdx}] ${block.type}`);
      if (block.type === 'tool_use' && block.toolUse) {
        console.log(`      Tool: ${block.toolUse.name}`);
        console.log(`      Input:`, JSON.stringify(block.toolUse.input, null, 2));
      } else if (block.type === 'tool_result' && block.toolResult) {
        console.log(`      For tool: ${block.toolResult.tool_use_id}`);
        console.log(`      Result:`, block.toolResult.content.substring(0, 200));
      } else if (block.type === 'text' && block.text) {
        console.log(`      Text:`, block.text.substring(0, 200));
      }
    });
  });

  console.log('\n=== Summary ===');
  const toolUses = history.filter(m =>
    m.role === 'assistant' && m.content.some(c => c.type === 'tool_use')
  );
  const toolResults = history.filter(m =>
    m.role === 'user' && m.content.some(c => c.type === 'tool_result')
  );

  console.log(`Tool calls made: ${toolUses.length}`);
  console.log(`Tool results: ${toolResults.length}`);

  if (toolUses.length === 0) {
    console.log('\n❌ XAI did NOT call any tools!');
    console.log('The model just responded with text instead.');
  } else {
    console.log('\n✅ XAI called tools!');
  }
}

testXAIToolCall().catch(console.error);
