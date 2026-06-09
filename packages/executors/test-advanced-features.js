/**
 * Test advanced Visual Workspace features
 */

import { VisualFeedbackBridge } from './dist/implementations/addon/VisualFeedbackBridge.js';

const CHROMIUM_PATH = '/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium';

async function testAdvancedFeatures() {
  console.log('=== Testing Advanced VisualFeedbackBridge Features ===\n');

  const bridge = new VisualFeedbackBridge();

  try {
    // Initialize
    await bridge.initialize({
      headless: true,
      executablePath: CHROMIUM_PATH
    });
    console.log('✓ Bridge initialized');

    // Navigate
    await bridge.navigate('https://example.com');
    console.log('✓ Navigated to example.com');

    // Test JavaScript execution
    const title = await bridge.executeJS(() => document.title);
    console.log('✓ Executed JavaScript, title:', title);

    // Test page state extraction
    const pageState = await bridge.getPageState();
    console.log('✓ Got page state:');
    console.log(`  - Buttons: ${pageState.buttons.length}`);
    console.log(`  - Inputs: ${pageState.inputs.length}`);
    console.log(`  - Links: ${pageState.links.length}`);
    console.log(`  - Forms: ${pageState.forms.length}`);

    // Test screenshot
    const screenshot = await bridge.captureScreenshot();
    console.log(`✓ Captured screenshot: ${(screenshot.length / 1024).toFixed(2)} KB`);

    // Test keyboard shortcuts
    await bridge.keyPress('Ctrl+A');
    console.log('✓ Keyboard shortcut (Ctrl+A) executed');

    // Test scroll
    await bridge.scroll({ deltaY: 100 });
    console.log('✓ Scrolled down 100px');

    // Test zoom
    await bridge.zoom(1.5);
    console.log('✓ Zoomed to 150%');

    // Test clipboard
    await bridge.copyToClipboard('Test text');
    console.log('✓ Copied text to clipboard');

    // Close
    await bridge.close();
    console.log('✓ Browser closed');

    console.log('\n✅ All advanced tests PASSED');
  } catch (error) {
    console.error('❌ Test FAILED:', error.message);
    process.exit(1);
  }
}

testAdvancedFeatures();
