/**
 * Test WindowManager
 */

import { WindowManager } from './dist/implementations/addon/WindowManager.js';

const CHROMIUM_PATH = '/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium';

async function testWindowManager() {
  console.log('=== Testing WindowManager ===\n');

  const manager = new WindowManager();

  try {
    // Initialize
    await manager.initialize(CHROMIUM_PATH);
    console.log('✓ WindowManager initialized');

    // Create browser window
    await manager.createWindow({
      type: 'browser',
      id: 'test-browser',
      url: 'https://example.com'
    });
    console.log('✓ Created browser window');

    // Get window count
    const count = manager.getWindowCount();
    const ids = manager.getWindowIds();
    console.log(`✓ Window count: ${count}`);
    console.log(`✓ Window IDs: ${ids.join(', ')}`);

    // Get window
    const window = manager.getWindow('test-browser');
    console.log(`✓ Retrieved window: ${window?.type}`);

    // Capture window
    const screenshot = await manager.captureWindow('test-browser');
    console.log(`✓ Captured screenshot: ${(screenshot.length / 1024).toFixed(2)} KB`);

    // Focus window
    await manager.focusWindow('test-browser');
    console.log('✓ Focused window');

    // Start streaming
    const stream = manager.startStreaming('test-browser', 2);
    if (stream) {
      console.log('✓ Started streaming at 2 FPS');

      let frameCount = 0;
      stream.on('frame', () => frameCount++);

      // Stream for 3 seconds
      await new Promise(resolve => setTimeout(resolve, 3000));

      manager.stopStreaming('test-browser');
      console.log(`✓ Stopped streaming. Frames captured: ${frameCount}`);
    }

    // Close window
    await manager.closeWindow('test-browser');
    console.log('✓ Closed window');

    // Cleanup
    await manager.close();
    console.log('✓ WindowManager closed');

    console.log('\n✅ WindowManager test PASSED');
  } catch (error) {
    console.error('❌ Test FAILED:', error.message);
    console.error(error.stack);
    try {
      await manager.close();
    } catch (e) {
      // Ignore
    }
    process.exit(1);
  }
}

testWindowManager();
