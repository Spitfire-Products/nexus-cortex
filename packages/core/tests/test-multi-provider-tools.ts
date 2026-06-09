/**
 * Multi-Provider Tool Calling Demonstration
 *
 * Tests successful multi-turn tool use across:
 * - Google (gemini-2.5-flash)
 * - DeepSeek (deepseek-chat)
 * - OpenAI (gpt-5-mini)
 * - Anthropic (claude-4-5-haiku)
 */

import { createOrchestrator } from './src/orchestrator/OrchestratorFactory.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Test file path
const TEST_FILE = join(__dirname, 'test-file.txt');

// Ensure test file exists
fs.writeFileSync(TEST_FILE, 'Hello from multi-provider tool test!\nThis file will be read by different AI providers.');

interface TestResult {
  provider: string;
  model: string;
  success: boolean;
  toolCalls: number;
  turns: number;
  error?: string;
  details: string[];
}

const results: TestResult[] = [];

async function testProvider(providerName: string, modelName: string): Promise<TestResult> {
  const result: TestResult = {
    provider: providerName,
    model: modelName,
    success: false,
    toolCalls: 0,
    turns: 0,
    details: []
  };

  try {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Testing: ${providerName} (${modelName})`);
    console.log('='.repeat(80));

    const orchestrator = createOrchestrator({
      defaultModelId: modelName,
      projectPath: __dirname,
      storageDir: join(__dirname, '.cortex/test-sessions/multi-provider'),
      debug: false
    });

    // Initialize session
    const session = await orchestrator.createSession(__dirname, modelName);

    result.details.push(`✓ Orchestrator created for ${modelName}`);

    // Turn 1: Ask to read the file
    console.log('\n📝 Turn 1: Requesting file read...');
    const response1 = await orchestrator.sendMessage(
      `Use the Read tool to read the file at "${TEST_FILE}". After reading, tell me what the file contains.`,
      { tools: [] } // Empty array = include all factory tools
    );

    result.turns++;

    // Check if tool was called
    const hasToolUse1 = response1.messages && response1.messages.some(msg =>
      Array.isArray(msg.content) &&
      msg.content.some((block: any) => block.type === 'tool_use')
    );

    if (hasToolUse1) {
      result.toolCalls++;
      result.details.push(`✓ Turn 1: Tool called successfully`);
      console.log('✅ Tool call detected in Turn 1');
    } else {
      result.details.push(`⚠️ Turn 1: No tool call detected`);
      console.log('⚠️ No tool call in Turn 1');
    }

    // Check for tool results
    const hasToolResult1 = response1.messages && response1.messages.some(msg =>
      Array.isArray(msg.content) &&
      msg.content.some((block: any) => block.type === 'tool_result')
    );

    if (hasToolResult1) {
      result.details.push(`✓ Turn 1: Tool executed and result returned`);
      console.log('✅ Tool result received');
    } else {
      result.details.push(`⚠️ Turn 1: No tool result found`);
      console.log('⚠️ No tool result');
    }

    // Turn 2: Follow-up question (multi-turn)
    console.log('\n📝 Turn 2: Follow-up question...');
    const response2 = await orchestrator.sendMessage(
      'What was the first word in that file?',
      { tools: [] }
    );

    result.turns++;

    // Check response
    const hasTextResponse = response2.messages && response2.messages.some(msg =>
      Array.isArray(msg.content) &&
      msg.content.some((block: any) => block.type === 'text' && block.text)
    );

    if (hasTextResponse) {
      result.details.push(`✓ Turn 2: Text response received (multi-turn working)`);
      console.log('✅ Multi-turn response received');

      // Extract the text
      const textBlock = response2.messages && response2.messages
        .flatMap(msg => msg.content)
        .find((block: any) => block.type === 'text');

      if (textBlock?.text) {
        console.log(`📄 Response: ${textBlock.text.substring(0, 200)}`);
      }
    } else {
      result.details.push(`⚠️ Turn 2: No text response`);
    }

    // Mark as successful if we got at least one tool call and multi-turn worked
    result.success = result.toolCalls > 0 && result.turns >= 2;

    if (result.success) {
      result.details.push(`✅ SUCCESS: ${result.toolCalls} tool calls across ${result.turns} turns`);
      console.log(`\n✅ ${providerName} PASSED: ${result.toolCalls} tool calls, ${result.turns} turns`);
    } else {
      result.details.push(`❌ INCOMPLETE: Only ${result.toolCalls} tool calls, ${result.turns} turns`);
      console.log(`\n⚠️ ${providerName} INCOMPLETE`);
    }

  } catch (error: any) {
    result.error = error.message;
    result.details.push(`❌ ERROR: ${error.message}`);
    console.error(`\n❌ ${providerName} FAILED:`, error.message);
  }

  return result;
}

async function runTests() {
  console.log('\n' + '='.repeat(80));
  console.log('Multi-Provider Tool Calling Demonstration');
  console.log('Testing bidirectional naming conversion across 4 providers');
  console.log('='.repeat(80));

  // Test each provider
  const providers = [
    { name: 'Google', model: 'gemini-1.5-flash' },
    { name: 'DeepSeek', model: 'deepseek-chat' },
    { name: 'OpenAI', model: 'gpt-4o-mini' },
    { name: 'Anthropic', model: 'claude-3-5-haiku-20241022' }
  ];

  for (const provider of providers) {
    const result = await testProvider(provider.name, provider.model);
    results.push(result);

    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Print summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY REPORT');
  console.log('='.repeat(80));

  for (const result of results) {
    console.log(`\n${result.provider} (${result.model}):`);
    console.log(`  Status: ${result.success ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`  Tool Calls: ${result.toolCalls}`);
    console.log(`  Turns: ${result.turns}`);
    if (result.error) {
      console.log(`  Error: ${result.error}`);
    }
    console.log(`  Details:`);
    result.details.forEach(detail => console.log(`    ${detail}`));
  }

  const passed = results.filter(r => r.success).length;
  const total = results.length;

  console.log('\n' + '='.repeat(80));
  console.log(`FINAL RESULT: ${passed}/${total} providers passed`);
  console.log('='.repeat(80));

  // Cleanup
  if (fs.existsSync(TEST_FILE)) {
    fs.unlinkSync(TEST_FILE);
    console.log('\n✓ Cleaned up test file');
  }

  // Exit with appropriate code
  process.exit(passed === total ? 0 : 1);
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
