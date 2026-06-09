#!/usr/bin/env node
/**
 * Real-Time Viewing System Demo
 *
 * This demo creates a live sandbox and demonstrates:
 * 1. Auto-starting the view server
 * 2. Creating a sandbox with hot reload
 * 3. Broadcasting events in real-time
 * 4. Modifying code with live updates
 * 5. Interacting with the UI
 *
 * Run this demo, then open the view URL in your browser to watch!
 */

import { CreateAddonToolExecutorEnhanced } from '../dist/implementations/addon/CreateAddonToolEnhanced.js';
import { ModifySandboxExecutor } from '../dist/implementations/addon/ModifySandboxTool.js';
import { InteractWithSandboxExecutor } from '../dist/implementations/addon/InteractWithSandboxTool.js';
import { broadcaster, viewServer } from '../dist/implementations/addon/index.js';

// Mock config
const config = {
  workingDirectory: process.cwd()
};

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function demo() {
  console.log('🎬 Real-Time Viewing System Demo\n');
  console.log('='.repeat(60));
  console.log('\n');

  // Step 1: Create the CreateAddonTool executor
  console.log('📦 Step 1: Creating tool executors...\n');
  const createTool = new CreateAddonToolExecutorEnhanced(config);
  const modifyTool = new ModifySandboxExecutor(config);
  const interactTool = new InteractWithSandboxExecutor(config);

  // Step 2: Create a simple web server sandbox
  console.log('🚀 Step 2: Creating a live sandbox with hot reload...\n');

  const createResult = await createTool.execute({
    name: "demo-counter-app",
    description: "A simple counter app to demonstrate real-time viewing",
    parameters: {},

    implementation: {
      language: "javascript",
      code: `
const express = require('express');
const app = express();

let counter = 0;

app.get('/', (req, res) => {
  res.send(\`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Counter Demo</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          margin: 0;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
        }
        .container {
          text-align: center;
          background: rgba(255, 255, 255, 0.1);
          padding: 40px;
          border-radius: 20px;
          backdrop-filter: blur(10px);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        }
        h1 { font-size: 3em; margin: 0 0 20px 0; }
        .counter { font-size: 5em; margin: 20px 0; font-weight: bold; }
        button {
          font-size: 1.5em;
          padding: 15px 30px;
          margin: 10px;
          border: none;
          border-radius: 10px;
          background: white;
          color: #667eea;
          cursor: pointer;
          transition: transform 0.2s;
        }
        button:hover { transform: scale(1.1); }
        button:active { transform: scale(0.95); }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🎯 Counter Demo</h1>
        <div class="counter" id="counter">\${counter}</div>
        <div>
          <button onclick="increment()">➕ Increment</button>
          <button onclick="decrement()">➖ Decrement</button>
          <button onclick="reset()">🔄 Reset</button>
        </div>
      </div>
      <script>
        function increment() {
          fetch('/increment').then(() => location.reload());
        }
        function decrement() {
          fetch('/decrement').then(() => location.reload());
        }
        function reset() {
          fetch('/reset').then(() => location.reload());
        }
      </script>
    </body>
    </html>
  \`);
});

app.get('/increment', (req, res) => {
  counter++;
  console.log('✅ Counter incremented to:', counter);
  res.json({ counter });
});

app.get('/decrement', (req, res) => {
  counter--;
  console.log('✅ Counter decremented to:', counter);
  res.json({ counter });
});

app.get('/reset', (req, res) => {
  counter = 0;
  console.log('🔄 Counter reset to 0');
  res.json({ counter });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(\`🎉 Counter app running on http://localhost:\${PORT}\`);
  console.log('👆 Click the buttons to see live updates!');
});
      `,
      dependencies: ["express"],
      packageManager: "npm"
    },

    mode: "dev",
    devConfig: {
      hotReload: true,
      openBrowser: false
    },
    enableVisualFeedback: true
  }, new AbortController().signal);

  if (!createResult.isSuccess) {
    console.error('❌ Failed to create sandbox:', createResult.llmContent);
    return;
  }

  // Extract sandbox ID from metadata
  const sandboxId = createResult.metadata?.sandboxId as string;
  const sandboxUrl = createResult.metadata?.url as string;
  const viewUrl = viewServer.getViewUrl(sandboxId);

  console.log('\n✅ Sandbox created successfully!\n');
  console.log('📊 Sandbox Details:');
  console.log(`   ID: ${sandboxId}`);
  console.log(`   URL: ${sandboxUrl}`);
  console.log(`   View Dashboard: ${viewUrl}`);
  console.log('\n');
  console.log('🌐 OPEN THE DASHBOARD URL IN YOUR BROWSER NOW!');
  console.log('   👉 ' + viewUrl);
  console.log('\n');
  console.log('='.repeat(60));
  console.log('\n');

  // Wait for user to open browser
  console.log('⏳ Waiting 10 seconds for you to open the dashboard...\n');
  await sleep(10000);

  // Step 3: Demonstrate live event broadcasting
  console.log('📡 Step 3: Broadcasting live events...\n');

  broadcaster.emitConsoleLog(sandboxId, 'log', '🎬 Demo starting - watch the dashboard!');
  await sleep(2000);

  broadcaster.emitConsoleLog(sandboxId, 'log', '📝 About to modify the code...');
  await sleep(2000);

  // Step 4: Modify the code to change colors
  console.log('✏️  Step 4: Modifying code (changing colors)...\n');

  const modifyResult = await modifyTool.execute({
    sandboxId,
    file: "index.cjs",
    content: `
const express = require('express');
const app = express();

let counter = 0;

app.get('/', (req, res) => {
  res.send(\`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Counter Demo - Updated!</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          margin: 0;
          background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
          color: white;
        }
        .container {
          text-align: center;
          background: rgba(255, 255, 255, 0.1);
          padding: 40px;
          border-radius: 20px;
          backdrop-filter: blur(10px);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        }
        h1 { font-size: 3em; margin: 0 0 20px 0; }
        .counter { font-size: 5em; margin: 20px 0; font-weight: bold; }
        .subtitle { font-size: 1.2em; opacity: 0.9; margin-bottom: 20px; }
        button {
          font-size: 1.5em;
          padding: 15px 30px;
          margin: 10px;
          border: none;
          border-radius: 10px;
          background: white;
          color: #f5576c;
          cursor: pointer;
          transition: transform 0.2s;
        }
        button:hover { transform: scale(1.1); }
        button:active { transform: scale(0.95); }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🎯 Counter Demo</h1>
        <div class="subtitle">✨ Now with updated colors!</div>
        <div class="counter" id="counter">\${counter}</div>
        <div>
          <button onclick="increment()">➕ Increment</button>
          <button onclick="decrement()">➖ Decrement</button>
          <button onclick="reset()">🔄 Reset</button>
        </div>
      </div>
      <script>
        function increment() {
          fetch('/increment').then(() => location.reload());
        }
        function decrement() {
          fetch('/decrement').then(() => location.reload());
        }
        function reset() {
          fetch('/reset').then(() => location.reload());
        }
      </script>
    </body>
    </html>
  \`);
});

app.get('/increment', (req, res) => {
  counter++;
  console.log('✅ Counter incremented to:', counter);
  res.json({ counter });
});

app.get('/decrement', (req, res) => {
  counter--;
  console.log('✅ Counter decremented to:', counter);
  res.json({ counter });
});

app.get('/reset', (req, res) => {
  counter = 0;
  console.log('🔄 Counter reset to 0');
  res.json({ counter });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(\`🎉 Counter app running on http://localhost:\${PORT}\`);
  console.log('👆 Click the buttons to see live updates!');
  console.log('🌈 Now with PINK gradient background!');
});
    `,
    waitForReload: true,
    captureAfterReload: true
  }, new AbortController().signal);

  console.log('✅ Code modified! Watch the dashboard for:');
  console.log('   - File changed notification');
  console.log('   - Hot reload trigger');
  console.log('   - Process restart');
  console.log('   - New screenshot with pink gradient');
  console.log('\n');

  await sleep(5000);

  // Step 5: Demonstrate UI interactions
  console.log('🎮 Step 5: Testing UI interactions...\n');

  broadcaster.emitConsoleLog(sandboxId, 'log', '🎮 Testing button clicks...');
  await sleep(2000);

  const interactResult = await interactTool.execute({
    sandboxId,
    actions: [
      { type: 'click', selector: 'button:nth-child(1)' }, // Increment
      { type: 'wait', duration: 1000 },
      { type: 'click', selector: 'button:nth-child(1)' }, // Increment again
      { type: 'wait', duration: 1000 },
      { type: 'click', selector: 'button:nth-child(1)' }, // Increment again
      { type: 'wait', duration: 1000 },
      { type: 'click', selector: 'button:nth-child(2)' }, // Decrement
    ],
    captureAfterEachAction: true,
    returnFinalSnapshot: true
  }, new AbortController().signal);

  console.log('✅ UI interactions complete! Watch the dashboard for:');
  console.log('   - Interaction events (4 clicks)');
  console.log('   - Screenshots after each click');
  console.log('   - Console logs from the app');
  console.log('\n');

  await sleep(3000);

  // Step 6: Show event statistics
  console.log('📊 Step 6: Event Statistics\n');

  const stats = broadcaster.getStats();
  console.log('Total Events:', stats.totalEvents);
  console.log('Active Sandboxes:', stats.activeSandboxes);
  console.log('\nEvents by Type:');
  Object.entries(stats.eventsByType).forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`);
  });
  console.log('\n');

  const history = broadcaster.getHistory(sandboxId);
  console.log(`Event History for sandbox (last ${history.length} events):`);
  history.slice(-10).forEach((event, i) => {
    const timestamp = new Date(event.timestamp).toLocaleTimeString();
    console.log(`  [${timestamp}] ${event.type}`);
  });
  console.log('\n');

  // Final message
  console.log('='.repeat(60));
  console.log('\n');
  console.log('🎉 Demo Complete!\n');
  console.log('The sandbox is still running. You can:');
  console.log('  - Keep watching the dashboard');
  console.log('  - Click buttons in the app');
  console.log('  - See live console logs');
  console.log('  - View screenshots');
  console.log('\n');
  console.log('📍 Dashboard URL: ' + viewUrl);
  console.log('📍 Sandbox URL: ' + sandboxUrl);
  console.log('\n');
  console.log('Press Ctrl+C to stop the sandbox and exit.');
  console.log('\n');

  // Keep alive
  setInterval(() => {
    // Emit heartbeat to show system is alive
    broadcaster.emitConsoleLog(sandboxId, 'log', `💓 Heartbeat - ${new Date().toLocaleTimeString()}`);
  }, 30000);
}

// Run demo
demo().catch(console.error);
