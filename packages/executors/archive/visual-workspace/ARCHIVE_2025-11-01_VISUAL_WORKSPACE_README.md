# Visual Workspace Sandbox System

**Status**: Phase 1 Complete ✅
**Last Updated**: 2025-11-04
**Quick Start**: See examples below

---

## Quick Start

### Launch Headed Browser (Visible Window)
```typescript
import { visualBridge } from './src/implementations/addon/VisualFeedbackBridge.js';

// Initialize with visible browser
await visualBridge.initialize({ headless: false });

// Navigate and capture
await visualBridge.captureSnapshot('https://example.com');
```

### Paste Code Workflow
```typescript
// 1. Write code on client
const code = `function hello() { console.log("Hi!"); }`;

// 2. Copy to clipboard
await visualBridge.copyToClipboard(code);

// 3. Click target element
await visualBridge.interact({
  type: 'click',
  selector: '#code-editor'
});

// 4. Paste with Ctrl+V
await visualBridge.keyPress('Ctrl+V');

// OR use combined paste method
await visualBridge.paste(code);  // Does copy + Ctrl+V
```

### Visual Navigation
```typescript
// Zoom in
await visualBridge.zoom(1.5);  // 150%

// Scroll down
await visualBridge.scroll({ deltaY: 500 });

// Scroll right
await visualBridge.scroll({ deltaX: 200 });
```

### Use via InteractWithSandbox Tool
```typescript
await interactWithSandbox({
  sandboxId: "my-sandbox",
  actions: [
    { type: "click", selector: "#editor" },
    { type: "keypress", key: "Ctrl+V" },
    { type: "keypress", key: "Ctrl+S" },
    { type: "zoom", zoomLevel: 1.5 },
    { type: "scroll", deltaY: 300 }
  ]
});
```

---

## Available Features

### ✅ Headed Browser Mode
- Browser window visible to model and user
- SlowMo option for debugging
- Persistent profiles support

### ✅ Keyboard Shortcuts
- Ctrl+V (paste)
- Ctrl+S (save)
- Ctrl+A (select all)
- Ctrl+C (copy)
- Any key combination

### ✅ Clipboard Operations
- `copyToClipboard(text)` - Write to clipboard
- `getClipboard()` - Read from clipboard
- `paste(text)` - Combined copy + Ctrl+V

### ✅ Visual Navigation
- `scroll({ deltaX, deltaY })` - Scroll page
- `zoom(level)` - Zoom (1.0 = 100%, 1.5 = 150%)

### ✅ All Previous Features
- Click (selector or coordinates)
- Type text
- Navigate URLs
- Hover
- Select dropdowns
- Wait for elements
- Screenshot capture
- DOM extraction
- Console monitoring
- Network tracking

---

## Real-World Examples

### Example 1: TradingView PineScript
```typescript
// Create sandbox with headed browser
const sandbox = await createSandbox({
  name: "tradingview",
  mode: "persistent",
  visualConfig: { headless: false }
});

// Navigate
await interactWithSandbox({
  sandboxId: sandbox.id,
  actions: [
    { type: "navigate", value: "https://tradingview.com" }
  ]
});

// User logs in manually (model watches)

// Open PineScript editor
await interactWithSandbox({
  sandboxId: sandbox.id,
  actions: [
    { type: "click", selector: "#pine-editor" }
  ]
});

// Model writes code externally
const pineScript = `
//@version=5
indicator("My RSI", overlay=false)
rsi = ta.rsi(close, 14)
plot(rsi)
`;

// Paste into editor
await visualBridge.copyToClipboard(pineScript);
await visualBridge.keyPress('Ctrl+V');
```

### Example 2: Live Chart Development
```typescript
// Create Vite dev server with visible browser
const sandbox = await createSandbox({
  name: "chart",
  packageManager: "npm",
  dependencies: ["react", "chart.js"],
  entryPoint: "npm run dev",
  mode: "dev",
  visualConfig: { headless: false, slowMo: 50 }
});

// Model writes chart code
const chartCode = `
import { Line } from 'react-chartjs-2';

export default function StockChart({ data }) {
  return <Line data={data} />;
}
`;

// Paste and watch hot reload
await visualBridge.paste(chartCode);

// Inspect visually
await visualBridge.zoom(1.5);
await visualBridge.scroll({ deltaY: 200 });
```

### Example 3: YouTube Video Analysis
```typescript
// Launch headed browser
await visualBridge.initialize({ headless: false });

// Navigate to YouTube
await visualBridge.captureSnapshot('https://youtube.com');

// Search for video
await visualBridge.interact({ type: 'click', selector: '#search' });
await visualBridge.interact({ type: 'type', value: 'AI coding tutorial' });
await visualBridge.keyPress('Enter');

// Click first video
await visualBridge.interact({
  type: 'click',
  selector: 'ytd-video-renderer:first-child a'
});

// Model can now watch and analyze
await new Promise(r => setTimeout(r, 30000));  // Watch 30 seconds
const snapshot = await visualBridge.captureSnapshot(visualBridge.page.url());
```

---

## API Reference

### VisualFeedbackBridge

#### `initialize(config?: VisualBridgeConfig): Promise<void>`
Initialize browser with optional configuration.

```typescript
interface VisualBridgeConfig {
  headless?: boolean;      // Default: true
  slowMo?: number;        // Default: 0
  userDataDir?: string;   // Optional profile directory
}
```

#### `keyPress(key: string, modifiers?: string[]): Promise<void>`
Press keyboard key or combination.

```typescript
await visualBridge.keyPress('Ctrl+V');
await visualBridge.keyPress('V', ['Control']);
await visualBridge.keyPress('Enter');
```

#### `scroll(delta: { deltaX?: number; deltaY?: number }): Promise<void>`
Scroll the page.

```typescript
await visualBridge.scroll({ deltaY: 500 });  // Down 500px
await visualBridge.scroll({ deltaX: -200 }); // Left 200px
```

#### `zoom(level: number): Promise<void>`
Zoom the page.

```typescript
await visualBridge.zoom(1.5);   // 150%
await visualBridge.zoom(0.75);  // 75%
await visualBridge.zoom(1.0);   // 100% (reset)
```

#### `copyToClipboard(text: string): Promise<void>`
Write text to clipboard.

#### `getClipboard(): Promise<string>`
Read text from clipboard.

#### `paste(text: string): Promise<void>`
Combined copy + Ctrl+V operation.

---

## InteractWithSandbox Action Types

### New in Phase 1

#### `keypress`
```typescript
{
  type: "keypress",
  key: "Ctrl+V"  // or "Enter", "Escape", etc.
}

{
  type: "keypress",
  key: "V",
  modifiers: ["Control"]
}
```

#### `zoom`
```typescript
{
  type: "zoom",
  zoomLevel: 1.5  // 150%
}
```

#### `scroll` (enhanced)
```typescript
{
  type: "scroll",
  deltaX: 200,   // Right 200px
  deltaY: -300   // Up 300px
}
```

---

## Configuration

### Environment Variables
```bash
# None required - all configuration via code
```

### Default Behavior
- Headless: `true` (for backward compatibility)
- SlowMo: `0` (full speed)
- Zoom: `1.0` (100%)

### Changing Defaults
```typescript
// Global singleton
import { visualBridge } from './VisualFeedbackBridge.js';

// Or create new instance
import { VisualFeedbackBridge } from './VisualFeedbackBridge.js';
const bridge = new VisualFeedbackBridge();
await bridge.initialize({ headless: false });
```

---

## Demo

Run the Phase 1 demonstration:

```bash
cd /home/runner/workspace/omniclaude-v4/packages/executors
npm run build
node demo/phase1-demo.js
```

This will:
1. Launch visible browser window
2. Navigate to test pages
3. Demonstrate zoom (1.5x → 1.0x)
4. Demonstrate scroll (500px down)
5. Demonstrate clipboard operations
6. Demonstrate keyboard shortcuts
7. Capture screenshots

---

## Documentation

- **PHASE_1_COMPLETE.md** - Full implementation details
- **PHASE_1_SUMMARY.md** - Executive summary
- **VISUAL_WORKSPACE_IMPLEMENTATION_PLAN.md** - Original plan
- **CURRENT_SYSTEM_STATE.md** - System state and architecture
- **POST_COMPACTION_HANDOFF.md** - Continuation guide

---

## Next Phases (Optional)

### Phase 2: Terminal Sandbox (2 hours)
xterm.js visual terminal emulation

### Phase 3: Screen Streaming (1 hour)
Continuous screenshots at 2 FPS

### Phase 4: Multi-Window (1.5 hours)
Hybrid terminal+browser modes

### Phase 5: Final Polish (30 min)
Tool updates and refinements

---

## Support

### Build
```bash
npm run build
```

### Test
```bash
npm test
```

### Demo
```bash
node demo/phase1-demo.js
```

---

**Phase 1 Status**: ✅ Complete and Production-Ready

All features tested, documented, and ready for use!
