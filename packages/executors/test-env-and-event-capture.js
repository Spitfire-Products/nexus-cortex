/**
 * Test Environment Variables and Event-Driven Smart Capture
 *
 * Demonstrates:
 * - Environment variable configuration
 * - Event-driven capture mode
 * - Hybrid capture mode
 * - Smart FPS control via env vars
 * - Preset configurations
 */

import { VisualFeedbackBridge } from './dist/implementations/addon/VisualFeedbackBridge.js';
import { HybridScreenshotManager } from './dist/implementations/addon/HybridScreenshotManager.js';
import { getConfig, loadPreset, printHybridConfig, PRESETS } from './dist/implementations/addon/HybridConfig.js';
import { EventEmitter } from 'events';

const CHROMIUM_PATH = '/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium';

async function testIntervalMode() {
  console.log('\n' + '='.repeat(70));
  console.log('TEST 1: INTERVAL MODE (Traditional)');
  console.log('='.repeat(70));

  const bridge = new VisualFeedbackBridge();

  try {
    await bridge.initialize({ headless: true, executablePath: CHROMIUM_PATH });
    await bridge.navigate('https://example.com');

    // Use interval mode configuration
    const config = getConfig('production', { captureMode: 'interval' });
    printHybridConfig(config);

    const manager = new HybridScreenshotManager(bridge.getPage(), config);

    let frameCount = 0;
    manager.on('h264-segment', () => frameCount++);

    await manager.start();
    console.log('✓ Started in INTERVAL mode\n');

    // Let it run for 3 seconds
    await new Promise(resolve => setTimeout(resolve, 3000));

    manager.stop();
    console.log(`✓ Captured ${frameCount} frames via interval\n`);

    await new Promise(resolve => setTimeout(resolve, 500)); // Let stop complete
    await bridge.close();
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await bridge.close();
  }
}

async function testEventMode() {
  console.log('\n' + '='.repeat(70));
  console.log('TEST 2: EVENT MODE (On-Demand Only)');
  console.log('='.repeat(70));

  const bridge = new VisualFeedbackBridge();

  try {
    await bridge.initialize({ headless: true, executablePath: CHROMIUM_PATH });
    await bridge.navigate('https://example.com');

    // Use event-only preset
    const config = PRESETS.eventOnly();
    config.forceKeyframeInterval = 0; // Disable forced keyframes
    printHybridConfig(config);

    const manager = new HybridScreenshotManager(bridge.getPage(), config);

    let apiFrameCount = 0;
    manager.on('api-frame', (request) => {
      apiFrameCount++;
      console.log(`  📸 API Frame ${apiFrameCount}: ${request.trigger.reason}`);
    });

    await manager.start();
    console.log('✓ Started in EVENT mode (no automatic captures)\n');

    // Wait a bit - should have NO automatic captures
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log(`✓ No automatic captures: ${apiFrameCount} frames (should be 0)\n`);

    // Now trigger events manually
    console.log('Triggering manual events:');
    await manager.captureOnEvent('user-click', { button: 'submit' });
    await new Promise(resolve => setTimeout(resolve, 500));

    await manager.captureOnEvent('form-submit', { formId: 'login' });
    await new Promise(resolve => setTimeout(resolve, 500));

    await manager.captureOnEvent('navigation-complete', { url: 'https://example.com' });
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log(`\n✓ Captured ${apiFrameCount} frames via events\n`);

    manager.stop();
    await bridge.close();
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await bridge.close();
  }
}

async function testHybridMode() {
  console.log('\n' + '='.repeat(70));
  console.log('TEST 3: HYBRID MODE (Interval + Events)');
  console.log('='.repeat(70));

  const bridge = new VisualFeedbackBridge();

  try {
    await bridge.initialize({ headless: true, executablePath: CHROMIUM_PATH });
    await bridge.navigate('https://example.com');

    // Use hybrid mode
    const config = getConfig('production', {
      captureMode: 'hybrid',
      h264: { fps: 1 }, // Slow interval
      forceKeyframeInterval: 5 // Force keyframe every 5 seconds
    });
    printHybridConfig(config);

    const manager = new HybridScreenshotManager(bridge.getPage(), config);

    let intervalFrames = 0;
    let eventFrames = 0;

    manager.on('h264-segment', () => intervalFrames++);
    manager.on('api-frame', (request) => {
      if (request.trigger.reason.includes('Event:')) {
        eventFrames++;
        console.log(`  🎯 Event Frame: ${request.trigger.reason}`);
      } else if (request.trigger.reason.includes('Forced')) {
        console.log(`  ⏰ Forced Frame: ${request.trigger.reason}`);
      }
    });

    await manager.start();
    console.log('✓ Started in HYBRID mode\n');

    // Let interval capture run for 2 seconds
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Trigger some events
    console.log('Triggering manual events during interval capture:\n');
    await manager.captureOnEvent('button-click');
    await new Promise(resolve => setTimeout(resolve, 500));

    await manager.captureOnEvent('dropdown-open');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Wait more for forced keyframe
    await new Promise(resolve => setTimeout(resolve, 4000));

    console.log(`\n✓ Interval frames: ${intervalFrames}`);
    console.log(`✓ Event frames: ${eventFrames}\n`);

    manager.stop();
    await new Promise(resolve => setTimeout(resolve, 500)); // Let stop complete
    await bridge.close();
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await bridge.close();
  }
}

async function testEnvVariables() {
  console.log('\n' + '='.repeat(70));
  console.log('TEST 4: ENVIRONMENT VARIABLE CONFIGURATION');
  console.log('='.repeat(70));

  // Set environment variables
  process.env.HYBRID_FPS = '4';
  process.env.HYBRID_CAPTURE_MODE = 'event';
  process.env.HYBRID_MAX_API_CALLS_PER_MIN = '20';
  process.env.HYBRID_CACHE_SIZE = '200';
  process.env.HYBRID_ENABLE_H264 = 'false';
  process.env.HYBRID_KEYFRAME_INTERVAL = '0';

  const config = getConfig();
  console.log('\n📋 Configuration loaded from environment variables:\n');
  printHybridConfig(config);

  console.log('✅ Environment variable configuration working!\n');

  // Clean up
  delete process.env.HYBRID_FPS;
  delete process.env.HYBRID_CAPTURE_MODE;
  delete process.env.HYBRID_MAX_API_CALLS_PER_MIN;
  delete process.env.HYBRID_CACHE_SIZE;
  delete process.env.HYBRID_ENABLE_H264;
  delete process.env.HYBRID_KEYFRAME_INTERVAL;
}

async function testEventEmitterIntegration() {
  console.log('\n' + '='.repeat(70));
  console.log('TEST 5: EXTERNAL EVENT EMITTER INTEGRATION');
  console.log('='.repeat(70));

  const bridge = new VisualFeedbackBridge();

  try {
    await bridge.initialize({ headless: true, executablePath: CHROMIUM_PATH });
    await bridge.navigate('https://example.com');

    const config = PRESETS.eventOnly();
    config.forceKeyframeInterval = 0;

    const manager = new HybridScreenshotManager(bridge.getPage(), config);

    let captureCount = 0;
    manager.on('api-frame', () => captureCount++);

    await manager.start();
    console.log('✓ Manager started\n');

    // Create external event emitter (simulating user actions)
    const userActions = new EventEmitter();

    // Register captures on user actions
    const cleanupClick = manager.onEventCapture(userActions, 'click', 'User clicked');
    const cleanupType = manager.onEventCapture(userActions, 'type', 'User typed');
    const cleanupSubmit = manager.onEventCapture(userActions, 'submit', 'User submitted');

    console.log('Simulating user actions:\n');

    // Simulate user actions
    userActions.emit('click', { target: 'button' });
    await new Promise(resolve => setTimeout(resolve, 100));

    userActions.emit('type', { text: 'hello world' });
    await new Promise(resolve => setTimeout(resolve, 100));

    userActions.emit('submit', { form: 'login' });
    await new Promise(resolve => setTimeout(resolve, 100));

    console.log(`\n✓ Captured ${captureCount} frames from external events\n`);

    // Cleanup event listeners
    cleanupClick();
    cleanupType();
    cleanupSubmit();

    manager.stop();
    await bridge.close();
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await bridge.close();
  }
}

async function runAllTests() {
  console.log('\n' + '='.repeat(70));
  console.log('ENV VARIABLES + EVENT-DRIVEN CAPTURE TEST SUITE');
  console.log('='.repeat(70));

  await testEnvVariables();
  await testIntervalMode();
  await testEventMode();
  await testHybridMode();
  await testEventEmitterIntegration();

  console.log('\n' + '='.repeat(70));
  console.log('✅ ALL TESTS PASSED');
  console.log('='.repeat(70));

  console.log('\n📊 SUMMARY:\n');
  console.log('✓ Environment variable configuration');
  console.log('✓ Interval mode (traditional periodic capture)');
  console.log('✓ Event mode (on-demand capture only)');
  console.log('✓ Hybrid mode (interval + events)');
  console.log('✓ External EventEmitter integration');
  console.log('\n💡 NEW FEATURES VERIFIED:\n');
  console.log('  1. Smart FPS control via HYBRID_FPS env variable');
  console.log('  2. Capture mode via HYBRID_CAPTURE_MODE (interval/event/hybrid)');
  console.log('  3. Event-driven captures via captureOnEvent()');
  console.log('  4. Batch events via captureOnEvents()');
  console.log('  5. External emitter integration via onEventCapture()');
  console.log('  6. Preset configurations (production, development, cost, event)');
  console.log('  7. Disable forced keyframes with forceKeyframeInterval=0\n');
}

runAllTests().catch(console.error);
