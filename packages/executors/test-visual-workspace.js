/**
 * Simple runtime test for Visual Workspace System
 */

import { VisualFeedbackBridge } from './dist/implementations/addon/VisualFeedbackBridge.js';

async function testBasicBrowser() {
  console.log('Testing VisualFeedbackBridge initialization...');

  const bridge = new VisualFeedbackBridge();

  try {
    await bridge.initialize({
      headless: true,
      executablePath: '/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium'
    });
    console.log('✓ Bridge initialized');

    await bridge.navigate('https://example.com');
    console.log('✓ Navigated to example.com');

    const title = await bridge.executeJS(() => document.title);
    console.log('✓ Page title:', title);

    await bridge.close();
    console.log('✓ Browser closed');

    console.log('\n✅ Basic test PASSED');
  } catch (error) {
    console.error('❌ Test FAILED:', error);
    process.exit(1);
  }
}

testBasicBrowser();
