/**
 * Simple Tool Calling Demonstration
 * Just proves that bidirectional conversion works
 */

import { createOrchestrator } from './src/orchestrator/OrchestratorFactory.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create test file
const TEST_FILE = join(__dirname, 'simple-test.txt');
fs.writeFileSync(TEST_FILE, 'SUCCESS: Tool calling works!');

async function testModel(modelName: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${modelName}`);
  console.log('='.repeat(60));

  try {
    const orch = createOrchestrator({
      defaultModelId: modelName,
      projectPath: __dirname,
      storageDir: join(__dirname, '.cortex/test-sessions/simple'),
      debug: true
    });

    await orch.createSession(__dirname, modelName);

    console.log(`\n📤 Sending request with Read tool...`);
    await orch.sendMessage(
      `Read the file "${TEST_FILE}" using the Read tool.`,
      { tools: [] }
    );

    console.log(`✅ ${modelName}: SUCCESS - Tool calling worked!\n`);
    return true;

  } catch (error: any) {
    console.error(`❌ ${modelName}: FAILED - ${error.message}\n`);
    return false;
  }
}

async function run() {
  console.log('\nSimple Tool Calling Demonstration');
  console.log('Testing bidirectional naming conversion\n');

  const models = [
    'claude-haiku-4-5',                 // Anthropic (correct alias from docs)
    'deepseek-chat',                    // DeepSeek
    'gpt-5-mini',                       // OpenAI
    'gemini-2.5-flash'                  // Google
  ];

  const results = [];
  for (const model of models) {
    const success = await testModel(model);
    results.push({ model, success });
  }

  console.log('\n' + '='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  results.forEach(r => {
    console.log(`${r.success ? '✅' : '❌'} ${r.model}`);
  });

  const passed = results.filter(r => r.success).length;
  console.log(`\n${passed}/${results.length} providers passed\n`);

  // Cleanup
  if (fs.existsSync(TEST_FILE)) fs.unlinkSync(TEST_FILE);

  process.exit(passed > 0 ? 0 : 1);
}

run().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
