#!/usr/bin/env node
/**
 * Quick Demo - Real-Time Viewing System
 *
 * This creates a minimal example showing the event broadcasting system
 */

import { broadcaster, viewServer } from '../dist/implementations/addon/index.js';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function quickDemo() {
  console.log('\n🎬 Real-Time Viewing System - Quick Demo\n');
  console.log('='.repeat(70));
  console.log('\n');

  // Start the view server
  console.log('📺 Starting view server...\n');
  await viewServer.start(4001);
  console.log('✅ View server running on http://localhost:4001\n');
  console.log('='.repeat(70));
  console.log('\n');

  // Simulate a sandbox
  const sandboxId = 'demo-sandbox-123';
  const sandboxUrl = 'http://localhost:3000';

  console.log('📦 Simulating sandbox operations for: ' + sandboxId);
  console.log('🌐 View dashboard: http://localhost:4001/sandbox/' + sandboxId);
  console.log('\n');
  console.log('📡 Broadcasting events...\n');

  // Emit sandbox created event
  broadcaster.emitSandboxEvent({
    type: 'sandbox-created',
    sandboxId,
    timestamp: Date.now(),
    data: {
      name: 'demo-app',
      url: sandboxUrl,
      mode: 'dev',
      port: 3000
    }
  });
  console.log('  ✓ sandbox-created');
  await sleep(1000);

  // Emit console logs
  broadcaster.emitConsoleLog(sandboxId, 'log', 'Server starting...');
  console.log('  ✓ console-log: "Server starting..."');
  await sleep(500);

  broadcaster.emitConsoleLog(sandboxId, 'log', 'Installing dependencies...');
  console.log('  ✓ console-log: "Installing dependencies..."');
  await sleep(1000);

  broadcaster.emitConsoleLog(sandboxId, 'log', '✅ Server running on port 3000');
  console.log('  ✓ console-log: "Server running on port 3000"');
  await sleep(1000);

  // Emit file change
  broadcaster.emitFileChange(sandboxId, 'index.js', 'modified');
  console.log('  ✓ file-changed: index.js modified');
  await sleep(500);

  // Emit hot reload
  broadcaster.emitHotReload(sandboxId, 'index.js');
  console.log('  ✓ hot-reload-triggered');
  await sleep(500);

  // Emit process restart
  broadcaster.emitProcessRestart(sandboxId, 'Hot reload triggered');
  console.log('  ✓ process-restarted');
  await sleep(1000);

  broadcaster.emitConsoleLog(sandboxId, 'log', '🔄 Server reloaded');
  console.log('  ✓ console-log: "Server reloaded"');
  await sleep(1000);

  // Emit screenshot (fake base64)
  const fakeScreenshot = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  broadcaster.emitScreenshot(sandboxId, fakeScreenshot, sandboxUrl);
  console.log('  ✓ screenshot-captured');
  await sleep(1000);

  // Emit interactions
  broadcaster.emitInteraction(sandboxId, 'click', '#submit-button', true);
  console.log('  ✓ interaction-executed: click #submit-button');
  await sleep(500);

  broadcaster.emitInteraction(sandboxId, 'type', '#username', true);
  console.log('  ✓ interaction-executed: type #username');
  await sleep(1000);

  // Emit network requests
  broadcaster.emitNetworkRequest(sandboxId, 'GET', '/api/users');
  console.log('  ✓ network-request: GET /api/users');
  await sleep(300);

  broadcaster.emitNetworkRequest(sandboxId, 'GET', '/api/users', 200);
  console.log('  ✓ network-response: GET /api/users (200)');
  await sleep(1000);

  console.log('\n='.repeat(70));
  console.log('\n');

  // Show statistics
  const stats = broadcaster.getStats();
  console.log('📊 Event Statistics:\n');
  console.log('  Active Sandboxes:', stats.activeSandboxes);
  console.log('  Total Events:', stats.totalEvents);
  console.log('\n  Events by Type:');
  Object.entries(stats.eventsByType)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log(`    ${type.padEnd(25)} ${count}`);
    });

  console.log('\n');
  console.log('='.repeat(70));
  console.log('\n');

  // Show event history
  const history = broadcaster.getHistory(sandboxId);
  console.log(`📜 Event History (${history.length} events):\n`);
  history.forEach((event, i) => {
    const time = new Date(event.timestamp).toLocaleTimeString();
    const dataStr = JSON.stringify(event.data).substring(0, 50);
    console.log(`  ${i + 1}. [${time}] ${event.type.padEnd(25)} ${dataStr}...`);
  });

  console.log('\n');
  console.log('='.repeat(70));
  console.log('\n');

  console.log('✅ Demo Complete!\n');
  console.log('🌐 View Dashboard: http://localhost:4001/sandbox/' + sandboxId);
  console.log('🌐 Multi-Sandbox Dashboard: http://localhost:4001/\n');
  console.log('The server will stay running. Press Ctrl+C to stop.\n');

  // Keep server alive
  console.log('💓 Server running... (sending heartbeat every 10s)\n');
  setInterval(() => {
    broadcaster.emitConsoleLog(sandboxId, 'log', `💓 Heartbeat - ${new Date().toLocaleTimeString()}`);
  }, 10000);
}

// Run demo
quickDemo().catch(console.error);
