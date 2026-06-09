/**
 * Test TerminalSandbox
 */

import { TerminalSandbox } from './dist/implementations/addon/TerminalSandbox.js';

async function testTerminalSandbox() {
  console.log('=== Testing TerminalSandbox ===\n');

  const terminal = new TerminalSandbox({
    shell: '/bin/bash',
    headed: false, // Headless for testing
    rows: 24,
    cols: 80,
    executablePath: '/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium'
  });

  try {
    console.log('Initializing terminal...');
    await terminal.initialize();
    console.log('✓ Terminal initialized');

    // Execute a simple command
    console.log('Executing: echo "Hello from terminal"');
    await terminal.executeCommand('echo "Hello from terminal"');

    // Wait for output
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get output
    const output = terminal.getOutput();
    console.log('✓ Terminal output:', output.substring(0, 100));

    // Capture screenshot
    const screenshot = await terminal.getScreenshot();
    console.log(`✓ Screenshot captured: ${(screenshot.length / 1024).toFixed(2)} KB`);

    // Close
    await terminal.close();
    console.log('✓ Terminal closed');

    console.log('\n✅ TerminalSandbox test PASSED');
  } catch (error) {
    console.error('❌ Test FAILED:', error.message);
    console.error(error.stack);
    try {
      await terminal.close();
    } catch (e) {
      // Ignore
    }
    process.exit(1);
  }
}

testTerminalSandbox();
