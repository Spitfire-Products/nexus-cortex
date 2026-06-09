/**
 * PROVIDER NAMING CONVENTION AUDIT
 *
 * This test actually calls each provider's API to verify
 * what naming convention they accept/require
 */

import { createOrchestrator } from './src/orchestrator/OrchestratorFactory.js';

const PROVIDERS_TO_TEST = [
  { name: 'Anthropic Claude', modelId: 'claude-3-5-sonnet-20241022' },
  { name: 'XAI Grok', modelId: 'grok-code-fast-1' },
  { name: 'OpenAI GPT', modelId: 'gpt-4o-mini' },
  { name: 'Google Gemini', modelId: 'gemini-2.0-flash-exp' }
];

async function testNamingConvention(
  providerName: string,
  modelId: string
) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${providerName} (${modelId})`);
  console.log('='.repeat(60));

  const orchestrator = createOrchestrator({
    defaultModelId: modelId,
    projectPath: '/test/naming-audit',
    storageDir: `.cortex/test-sessions/naming-audit-${modelId}`,
    debug: false
  });

  const session = await orchestrator.createSession(
    '/test/naming-audit',
    modelId
  );

  // Test with a simple calculation tool
  // We'll define it with BOTH naming styles to see which one the provider calls
  const testTools = [
    {
      name: 'calculate_sum',  // snake_case
      description: 'Adds two numbers together',
      input_schema: {
        type: 'object',
        properties: {
          a: { type: 'number', description: 'First number' },
          b: { type: 'number', description: 'Second number' }
        },
        required: ['a', 'b']
      }
    }
  ];

  try {
    const response = await orchestrator.sendMessage(
      'Calculate 5 + 3 using the calculate_sum tool',
      {
        tools: testTools as any,
        maxTokens: 500
      }
    );

    // Check the history to see what tool name was actually called
    const history = orchestrator.getMessageHistory();
    const toolCalls = history
      .filter(m => m.role === 'assistant')
      .flatMap(m => m.content)
      .filter((c: any) => c.type === 'tool_use')
      .map((c: any) => c.toolUse?.name);

    if (toolCalls.length > 0) {
      console.log(`✅ SUCCESS: Tool called`);
      console.log(`   Tool name returned: "${toolCalls[0]}"`);

      if (toolCalls[0] === 'calculate_sum') {
        console.log(`   ✅ Uses snake_case`);
      } else if (toolCalls[0] === 'CalculateSum' || toolCalls[0] === 'calculateSum') {
        console.log(`   ✅ Uses PascalCase/camelCase`);
      } else {
        console.log(`   ⚠️  Unknown format: ${toolCalls[0]}`);
      }
    } else {
      console.log(`❌ FAILED: No tool calls detected`);
      console.log(`   Response: ${JSON.stringify(response.content).substring(0, 200)}`);
    }

  } catch (error: any) {
    console.log(`❌ ERROR: ${error.message}`);
    if (error.message.includes('not found') || error.message.includes('Unknown')) {
      console.log(`   This might indicate naming convention mismatch`);
    }
  }
}

async function runFullAudit() {
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║  PROVIDER TOOL NAMING CONVENTION AUDIT                   ║');
  console.log('║  Testing actual API behavior (not just documentation)    ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');

  for (const provider of PROVIDERS_TO_TEST) {
    try {
      await testNamingConvention(provider.name, provider.modelId);
    } catch (error: any) {
      console.log(`\n❌ Could not test ${provider.name}: ${error.message}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('AUDIT COMPLETE');
  console.log('='.repeat(60) + '\n');
}

runFullAudit().catch(console.error);
