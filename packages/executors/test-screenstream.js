/**
 * Test ScreenStream
 */

import { VisualFeedbackBridge } from './dist/implementations/addon/VisualFeedbackBridge.js';
import { ScreenStream } from './dist/implementations/addon/ScreenStream.js';

const CHROMIUM_PATH = '/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium';

async function testScreenStream() {
  console.log('=== Testing ScreenStream ===\n');

  const bridge = new VisualFeedbackBridge();

  try {
    // Initialize browser
    await bridge.initialize({
      headless: true,
      executablePath: CHROMIUM_PATH
    });
    console.log('✓ Browser initialized');

    await bridge.navigate('https://example.com');
    console.log('✓ Navigated to example.com');

    // Get the page object
    const page = bridge.getPage();
    if (!page) {
      throw new Error('Page not available');
    }

    // Create stream
    const stream = new ScreenStream(page, {
      fps: 2,
      format: 'jpeg',
      quality: 80
    });
    console.log('✓ ScreenStream created (2 FPS, JPEG quality 80)');

    let frameCount = 0;

    stream.on('start', (info) => {
      console.log(`✓ Stream started at ${info.fps} FPS`);
    });

    stream.on('frame', (frame) => {
      frameCount++;
      console.log(`✓ Frame ${frame.frameNumber} captured (${(frame.screenshot.length / 1024).toFixed(2)} KB)`);
    });

    stream.on('error', (error) => {
      console.error('✗ Stream error:', error.message);
    });

    // Start streaming
    stream.start();

    // Stream for 5 seconds
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Stop streaming
    stream.stop();
    console.log(`✓ Stream stopped. Total frames: ${frameCount}`);

    // Get state
    const state = stream.getState();
    console.log(`✓ Final state: isRunning=${state.isRunning}, frames=${state.frameNumber}`);

    // Cleanup
    stream.destroy();
    await bridge.close();
    console.log('✓ Cleaned up');

    console.log('\n✅ ScreenStream test PASSED');
  } catch (error) {
    console.error('❌ Test FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testScreenStream();
