/**
 * Phase 1 Demo - Enhanced Browser Sandbox
 *
 * Demonstrates:
 * - Headed browser mode (visible window)
 * - Keyboard shortcuts (Ctrl+V, Ctrl+S)
 * - Clipboard operations
 * - Scroll and zoom
 */

import { visualBridge } from '../dist/implementations/addon/VisualFeedbackBridge.js';

async function runPhase1Demo() {
  console.log('🚀 Phase 1 Demo - Enhanced Browser Sandbox\n');

  try {
    // 1. Initialize browser in HEADED mode
    console.log('1️⃣  Initializing browser in HEADED mode...');
    await visualBridge.initialize({
      headless: false,  // Browser window will appear!
      slowMo: 100       // Slow down for visibility
    });
    console.log('   ✅ Browser launched (you should see a window!)\n');

    // 2. Navigate to a test page
    console.log('2️⃣  Navigating to example page...');
    await visualBridge.captureSnapshot('https://example.com');
    console.log('   ✅ Navigated to example.com\n');

    // Wait a bit so user can see
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 3. Test zoom
    console.log('3️⃣  Testing zoom to 150%...');
    await visualBridge.zoom(1.5);
    console.log('   ✅ Zoomed to 150%\n');

    await new Promise(resolve => setTimeout(resolve, 2000));

    // 4. Test zoom back to normal
    console.log('4️⃣  Zooming back to 100%...');
    await visualBridge.zoom(1.0);
    console.log('   ✅ Zoomed to 100%\n');

    await new Promise(resolve => setTimeout(resolve, 1000));

    // 5. Test scroll
    console.log('5️⃣  Scrolling down 500px...');
    await visualBridge.scroll({ deltaY: 500 });
    console.log('   ✅ Scrolled down\n');

    await new Promise(resolve => setTimeout(resolve, 2000));

    // 6. Test keyboard shortcut (navigate to a page with input)
    console.log('6️⃣  Navigating to page with text input...');
    await visualBridge.captureSnapshot('https://www.google.com');
    console.log('   ✅ Navigated to Google\n');

    await new Promise(resolve => setTimeout(resolve, 2000));

    // 7. Test clipboard and paste
    console.log('7️⃣  Testing clipboard operations...');
    const testCode = 'Hello from Phase 1! This text was pasted via Ctrl+V';

    // Copy to clipboard
    await visualBridge.copyToClipboard(testCode);
    console.log('   ✅ Copied to clipboard');

    // Click on search box
    await visualBridge.interact({
      type: 'click',
      selector: 'textarea[name="q"]'
    });
    console.log('   ✅ Clicked search box');

    // Paste using Ctrl+V
    await visualBridge.keyPress('Ctrl+V');
    console.log('   ✅ Pasted text with Ctrl+V\n');

    await new Promise(resolve => setTimeout(resolve, 3000));

    // 8. Test other keyboard shortcuts
    console.log('8️⃣  Testing keyboard shortcuts...');

    // Select all
    await visualBridge.keyPress('Ctrl+A');
    console.log('   ✅ Ctrl+A (Select All)');

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Press Escape
    await visualBridge.keyPress('Escape');
    console.log('   ✅ Escape key pressed\n');

    // 9. Final screenshot
    console.log('9️⃣  Capturing final screenshot...');
    const snapshot = await visualBridge.captureSnapshot('https://example.com');
    console.log('   ✅ Screenshot captured');
    console.log(`   📸 Screenshot size: ${(snapshot.screenshot.length / 1024).toFixed(2)} KB\n`);

    await new Promise(resolve => setTimeout(resolve, 2000));

    // 10. Cleanup
    console.log('🧹 Cleaning up...');
    await visualBridge.close();
    console.log('   ✅ Browser closed\n');

    console.log('✨ Phase 1 Demo Complete! ✨\n');
    console.log('Summary of new features demonstrated:');
    console.log('  ✅ Headed browser mode (visible window)');
    console.log('  ✅ Zoom (1.5x and back to 1.0x)');
    console.log('  ✅ Scroll (500px down)');
    console.log('  ✅ Clipboard operations (copy/paste)');
    console.log('  ✅ Keyboard shortcuts (Ctrl+V, Ctrl+A, Escape)');
    console.log('  ✅ Screenshot capture\n');

  } catch (error) {
    console.error('❌ Error during demo:', error);
    await visualBridge.close();
    process.exit(1);
  }
}

// Run the demo
runPhase1Demo().catch(console.error);
