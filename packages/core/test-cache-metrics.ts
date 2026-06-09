/**
 * E2E Test: Cache Metrics Integration
 * Tests cache token tracking with real API calls
 */

import { createOrchestrator } from './src/orchestrator/OrchestratorFactory.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testCacheMetrics() {
  console.log('\n🧪 Testing Cache Metrics Integration with Real API\n');

  // Setup
  const storageDir = path.join(__dirname, 'test-sessions');
  const projectPath = process.cwd();

  // Ensure storage directory exists
  await fs.mkdir(storageDir, { recursive: true });

  // Create orchestrator using factory
  const orchestrator = createOrchestrator({
    defaultModelId: 'claude-3-5-sonnet-20241022',
    projectPath,
    storageDir,
    debug: true,
    enableMcp: false,
    useHelperModels: false
  });

  try {
    // Create session
    console.log('📦 Creating session...');
    const session = await orchestrator.createSession(projectPath, 'claude-3-5-sonnet-20241022');
    console.log(`✅ Session created: ${session.sessionId}\n`);

    // Send first message (cache write)
    console.log('💬 Message 1: Sending with system messages (cache write)...');
    const response1 = await orchestrator.sendMessage(
      'Hello! Please respond with just "Hi there!"',
      {
        parameters: {
          maxTokens: 50
        }
      }
    );

    console.log('\n📊 Response 1 Usage:');
    console.log(JSON.stringify(response1.usage, null, 2));

    if (response1.usage.cache) {
      console.log('\n✅ Cache metrics detected in response 1!');
    } else {
      console.log('\n⚠️  No cache metrics in response 1 (expected for first message)');
    }

    // Send second message (should trigger cache read)
    console.log('\n💬 Message 2: Sending follow-up (cache read expected)...');
    const response2 = await orchestrator.sendMessage(
      'What is 2 + 2? Answer with just the number.',
      {
        parameters: {
          maxTokens: 50
        }
      }
    );

    console.log('\n📊 Response 2 Usage:');
    console.log(JSON.stringify(response2.usage, null, 2));

    if (response2.usage.cache) {
      console.log('\n✅ Cache metrics detected in response 2!');
      console.log(`   Cache reads: ${response2.usage.cache.cacheReadTokens} tokens`);
      console.log(`   Hit rate: ${(response2.usage.cache.cacheHitRate * 100).toFixed(1)}%`);
      console.log(`   Cost savings: ${(response2.usage.cache.costSavingsRatio * 100).toFixed(1)}%`);
    } else {
      console.log('\n⚠️  No cache metrics in response 2');
    }

    // Send third message for more data
    console.log('\n💬 Message 3: Sending another follow-up...');
    const response3 = await orchestrator.sendMessage(
      'What is 5 + 5? Answer with just the number.',
      {
        parameters: {
          maxTokens: 50
        }
      }
    );

    console.log('\n📊 Response 3 Usage:');
    console.log(JSON.stringify(response3.usage, null, 2));

    // Get accumulated cache metrics
    console.log('\n📈 Accumulated Session Cache Metrics:\n');
    const metrics = orchestrator.getCacheMetrics();
    console.log(JSON.stringify(metrics, null, 2));

    console.log('\n📋 Cache Performance Report:\n');
    console.log(orchestrator.getCacheReport());

    console.log('\n✅ E2E Test completed successfully!\n');
    console.log('Key findings:');
    console.log(`- Total requests: ${metrics.requestCount}`);
    console.log(`- Requests with cache hits: ${metrics.requestsWithCacheHits}`);
    console.log(`- Total cache reads: ${metrics.totalCacheReadTokens} tokens`);
    console.log(`- Overall cache hit rate: ${(metrics.overallCacheHitRate * 100).toFixed(1)}%`);
    console.log(`- Overall cost savings: ${(metrics.overallCostSavingsRatio * 100).toFixed(1)}%`);

  } finally {
    // Cleanup
    console.log('\n🧹 Cleaning up test session...');
    await orchestrator.cleanup();
    await fs.rm(storageDir, { recursive: true, force: true });
  }
}

// Run test
testCacheMetrics().catch((error) => {
  console.error('\n❌ Test failed:', error);
  console.error(error.stack);
  process.exit(1);
});
