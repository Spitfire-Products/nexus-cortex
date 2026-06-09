/**
 * Visual Workspace Demo
 *
 * Demonstrates all features from Phases 1-4:
 * - Enhanced browser sandbox with keyboard shortcuts, clipboard, zoom
 * - JavaScript execution and Chrome DevTools Protocol access
 * - Terminal sandbox with xterm.js
 * - Screen streaming at configurable FPS
 * - Multi-window management (browser + terminal hybrid)
 *
 * This example shows a complete hybrid workflow where the model:
 * 1. Opens TradingView in a browser window
 * 2. Opens a terminal for PineScript development
 * 3. Streams both windows for real-time monitoring
 * 4. Executes JavaScript to extract chart data
 * 5. Uses keyboard shortcuts to interact
 */

import {
  VisualFeedbackBridge,
  TerminalSandbox,
  ScreenStream,
  WindowManager
} from '../src/implementations/addon/index.js';

// ============================================================================
// Example 1: Enhanced Browser Sandbox
// ============================================================================

async function demoEnhancedBrowser() {
  console.log('=== Example 1: Enhanced Browser Sandbox ===\n');

  const bridge = new VisualFeedbackBridge();

  // Initialize with headed mode (visible window)
  await bridge.initialize({
    headless: false,
    slowMo: 100
  });

  console.log('✓ Browser initialized (headed mode)');

  // Navigate to TradingView
  await bridge.navigate('https://tradingview.com');
  console.log('✓ Navigated to TradingView');

  // Execute JavaScript to extract page data
  const pageTitle = await bridge.executeJS(() => document.title);
  console.log('✓ Page title:', pageTitle);

  // Get comprehensive page state
  const pageState = await bridge.getPageState();
  console.log('✓ Found', pageState.buttons.length, 'buttons');
  console.log('✓ Found', pageState.inputs.length, 'input fields');
  console.log('✓ Found', pageState.links.length, 'links');

  // Zoom in to 150%
  await bridge.zoom(1.5);
  console.log('✓ Zoomed to 150%');

  // Scroll down
  await bridge.scroll({ deltaY: 500 });
  console.log('✓ Scrolled down 500px');

  // Use keyboard shortcuts
  await bridge.keyPress('Ctrl+F'); // Open find dialog
  console.log('✓ Pressed Ctrl+F');

  // Copy text to clipboard
  await bridge.copyToClipboard('AAPL');
  console.log('✓ Copied "AAPL" to clipboard');

  // Paste from clipboard
  await bridge.paste('AAPL');
  console.log('✓ Pasted from clipboard');

  // Comprehensive analysis (parallel)
  const snapshot = await bridge.comprehensiveAnalysis();
  console.log('✓ Comprehensive snapshot captured:');
  console.log('  - URL:', snapshot.url);
  console.log('  - Viewport:', snapshot.visual.viewport.width, 'x', snapshot.visual.viewport.height);
  console.log('  - DOM nodes:', snapshot.structural.pageState.meta.title);
  console.log('  - Console logs:', snapshot.runtime.console.length);
  console.log('  - Network requests:', snapshot.runtime.network.length);

  await bridge.close();
  console.log('✓ Browser closed\n');
}

// ============================================================================
// Example 2: Chrome DevTools Protocol Access
// ============================================================================

async function demoChromeDevTools() {
  console.log('=== Example 2: Chrome DevTools Protocol ===\n');

  const bridge = new VisualFeedbackBridge();
  await bridge.initialize({ headless: false });

  await bridge.navigate('https://tradingview.com');
  console.log('✓ Navigated to TradingView');

  // Enable DevTools Protocol
  const cdpClient = await bridge.enableDevTools();
  console.log('✓ DevTools Protocol enabled');

  // Get detailed performance metrics
  const perfMetrics = await bridge.getDetailedPerformanceMetrics();
  console.log('✓ Performance Metrics:');
  console.log('  - Script duration:', perfMetrics.scriptDuration.toFixed(2), 'ms');
  console.log('  - Layout duration:', perfMetrics.layoutDuration.toFixed(2), 'ms');
  console.log('  - JS heap used:', (perfMetrics.jsHeapUsedSize / 1024 / 1024).toFixed(2), 'MB');
  console.log('  - DOM nodes:', perfMetrics.domNodes);

  // Get JavaScript errors
  const jsErrors = await bridge.getJavaScriptErrors();
  console.log('✓ JavaScript errors:', jsErrors.length);

  await bridge.close();
  console.log('✓ Browser closed\n');
}

// ============================================================================
// Example 3: Terminal Sandbox
// ============================================================================

async function demoTerminalSandbox() {
  console.log('=== Example 3: Terminal Sandbox ===\n');

  const terminal = new TerminalSandbox({
    shell: '/bin/bash',
    headed: true,
    rows: 30,
    cols: 120
  });

  await terminal.initialize();
  console.log('✓ Terminal initialized');

  // Execute commands
  await terminal.executeCommand('echo "Hello from terminal sandbox!"');
  console.log('✓ Executed echo command');

  await terminal.executeCommand('ls -la');
  console.log('✓ Executed ls command');

  await terminal.executeCommand('pwd');
  console.log('✓ Executed pwd command');

  // Wait a bit for output
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Capture snapshot
  const snapshot = await terminal.captureSnapshot();
  console.log('✓ Terminal snapshot captured:');
  console.log('  - Output length:', snapshot.output.length, 'characters');
  console.log('  - Screenshot size:', snapshot.screenshot.length, 'bytes (base64)');
  console.log('  - Working directory:', snapshot.cwd);

  // Get screenshot
  const screenshot = await terminal.getScreenshot();
  console.log('✓ Screenshot captured:', screenshot.length, 'bytes');

  await terminal.close();
  console.log('✓ Terminal closed\n');
}

// ============================================================================
// Example 4: Screen Streaming
// ============================================================================

async function demoScreenStreaming() {
  console.log('=== Example 4: Screen Streaming ===\n');

  const bridge = new VisualFeedbackBridge();
  await bridge.initialize({ headless: false });
  await bridge.navigate('https://tradingview.com');

  const page = (bridge as any).page; // Access internal page

  // Create stream at 2 FPS
  const stream = new ScreenStream(page, {
    fps: 2,
    format: 'jpeg',
    quality: 80
  });

  console.log('✓ Stream created (2 FPS, JPEG quality 80)');

  let frameCount = 0;

  stream.on('start', (info) => {
    console.log('✓ Stream started at', info.fps, 'FPS');
  });

  stream.on('frame', (frame) => {
    frameCount++;
    console.log(`✓ Frame ${frame.frameNumber} captured at ${new Date(frame.timestamp).toISOString()}`);
    console.log(`  Screenshot size: ${(frame.screenshot.length / 1024).toFixed(2)} KB`);
  });

  stream.on('error', (error) => {
    console.error('✗ Stream error:', error);
  });

  // Start streaming
  stream.start();

  // Stream for 10 seconds
  await new Promise(resolve => setTimeout(resolve, 10000));

  // Stop streaming
  stream.stop();
  console.log('✓ Stream stopped. Total frames:', frameCount);

  // Get state
  const state = stream.getState();
  console.log('✓ Final state:', state);

  await bridge.close();
  console.log('✓ Browser closed\n');
}

// ============================================================================
// Example 5: Multi-Window Management
// ============================================================================

async function demoWindowManager() {
  console.log('=== Example 5: Multi-Window Management ===\n');

  const manager = new WindowManager();
  await manager.initialize();
  console.log('✓ WindowManager initialized');

  // Create browser window for TradingView
  await manager.createWindow({
    type: 'browser',
    id: 'tradingview',
    url: 'https://tradingview.com',
    position: { x: 0, y: 0, width: 1280, height: 720 }
  });
  console.log('✓ Created TradingView browser window');

  // Create browser window for documentation
  await manager.createWindow({
    type: 'browser',
    id: 'docs',
    url: 'https://www.tradingview.com/pine-script-docs/',
    position: { x: 1280, y: 0, width: 640, height: 720 }
  });
  console.log('✓ Created documentation browser window');

  // Create terminal window
  await manager.createWindow({
    type: 'terminal',
    id: 'dev-terminal',
    shell: '/bin/bash'
  });
  console.log('✓ Created terminal window');

  // Get window count
  const count = manager.getWindowCount();
  const ids = manager.getWindowIds();
  console.log('✓ Total windows:', count);
  console.log('✓ Window IDs:', ids);

  // Focus on TradingView
  await manager.focusWindow('tradingview');
  console.log('✓ Focused on TradingView window');

  // Capture single window
  const tvScreenshot = await manager.captureWindow('tradingview');
  console.log('✓ Captured TradingView screenshot:', tvScreenshot.length, 'bytes');

  // Capture all windows
  const allScreenshots = await manager.captureAllWindows();
  console.log('✓ Captured all windows:');
  for (const [id, screenshot] of allScreenshots) {
    console.log(`  - ${id}: ${(screenshot.length / 1024).toFixed(2)} KB`);
  }

  // Start streaming browser window
  const stream = manager.startStreaming('tradingview', 2);
  if (stream) {
    console.log('✓ Started streaming TradingView at 2 FPS');

    let frameCount = 0;
    stream.on('frame', () => {
      frameCount++;
    });

    // Stream for 5 seconds
    await new Promise(resolve => setTimeout(resolve, 5000));

    manager.stopStreaming('tradingview');
    console.log('✓ Stopped streaming. Captured', frameCount, 'frames');
  }

  // Tile windows side-by-side
  await manager.tileWindows(['tradingview', 'docs']);
  console.log('✓ Tiled browser windows');

  // Close all windows
  await manager.closeAll();
  console.log('✓ Closed all windows');

  await manager.close();
  console.log('✓ WindowManager closed\n');
}

// ============================================================================
// Example 6: Complete Hybrid Workflow
// ============================================================================

async function demoCompleteWorkflow() {
  console.log('=== Example 6: Complete Hybrid Workflow ===\n');
  console.log('Scenario: Developing a TradingView PineScript indicator\n');

  const manager = new WindowManager();
  await manager.initialize();

  // Step 1: Create TradingView browser window
  console.log('[Step 1] Opening TradingView chart...');
  await manager.createWindow({
    type: 'browser',
    id: 'chart',
    url: 'https://tradingview.com/chart'
  });

  // Step 2: Create terminal for code editing
  console.log('[Step 2] Opening terminal for development...');
  await manager.createWindow({
    type: 'terminal',
    id: 'editor',
    shell: '/bin/bash'
  });

  // Step 3: Arrange windows side-by-side
  console.log('[Step 3] Arranging windows...');
  await manager.tileWindows(['chart', 'editor']);

  // Step 4: Get references to windows
  const chartWindow = manager.getWindow('chart');
  const editorWindow = manager.getWindow('editor');

  // Step 5: Execute commands in terminal
  if (editorWindow?.terminal) {
    console.log('[Step 4] Creating PineScript file...');
    await editorWindow.terminal.executeCommand('echo "//@version=5" > my_indicator.pine');
    await editorWindow.terminal.executeCommand('echo "indicator(\\"My Indicator\\")" >> my_indicator.pine');
    await editorWindow.terminal.executeCommand('cat my_indicator.pine');

    // Wait for commands to execute
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Step 6: Interact with browser using VisualFeedbackBridge
  if (chartWindow?.page) {
    console.log('[Step 5] Analyzing chart page...');
    const bridge = new VisualFeedbackBridge();
    (bridge as any).page = chartWindow.page; // Use existing page
    (bridge as any).browser = (manager as any).browser;

    // Get page state
    const pageState = await bridge.getPageState();
    console.log('  - Found', pageState.buttons.length, 'buttons on chart page');

    // Execute JavaScript to get chart info
    const chartData = await bridge.executeJS(() => {
      return {
        symbol: document.title,
        url: window.location.href,
        screenSize: { width: window.innerWidth, height: window.innerHeight }
      };
    });
    console.log('  - Chart data:', chartData);
  }

  // Step 7: Start streaming both windows
  console.log('[Step 6] Starting screen streaming...');
  const chartStream = manager.startStreaming('chart', 2);
  const editorStream = manager.startStreaming('editor', 1);

  if (chartStream && editorStream) {
    console.log('  - Chart streaming at 2 FPS');
    console.log('  - Editor streaming at 1 FPS');

    let chartFrames = 0;
    let editorFrames = 0;

    chartStream.on('frame', () => chartFrames++);
    editorStream.on('frame', () => editorFrames++);

    // Monitor for 10 seconds
    console.log('[Step 7] Monitoring for 10 seconds...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    manager.stopStreaming('chart');
    manager.stopStreaming('editor');

    console.log('✓ Streaming complete:');
    console.log('  - Chart frames:', chartFrames);
    console.log('  - Editor frames:', editorFrames);
  }

  // Step 8: Capture final state
  console.log('[Step 8] Capturing final state...');
  const screenshots = await manager.captureAllWindows();
  console.log('✓ Final screenshots captured:');
  for (const [id, buffer] of screenshots) {
    console.log(`  - ${id}: ${(buffer.length / 1024).toFixed(2)} KB`);
  }

  // Cleanup
  await manager.close();
  console.log('\n✓ Complete workflow finished!\n');
}

// ============================================================================
// Run All Demos
// ============================================================================

async function runAllDemos() {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║        Visual Workspace Demo - All Features               ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('\n');

  try {
    await demoEnhancedBrowser();
    await demoChromeDevTools();
    await demoTerminalSandbox();
    await demoScreenStreaming();
    await demoWindowManager();
    await demoCompleteWorkflow();

    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                   All Demos Complete!                      ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
  } catch (error) {
    console.error('Demo error:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllDemos();
}

export {
  demoEnhancedBrowser,
  demoChromeDevTools,
  demoTerminalSandbox,
  demoScreenStreaming,
  demoWindowManager,
  demoCompleteWorkflow
};
