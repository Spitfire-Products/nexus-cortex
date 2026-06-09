# Browser Sandbox Vision - Visual Development Environment

## User's Vision

A sandbox where the **browser is the primary interface** and the model can:

1. **Launch headed Chromium** - User sees browser window
2. **Navigate anywhere** - TradingView, YouTube, custom UIs
3. **Interact with sites** - Click, type, login, navigate
4. **Build UIs live** - Vite React apps with hot reload
5. **Get visual feedback** - Screenshots for iteration
6. **User watches everything** - Sees what model sees

---

## Example Use Cases

### Use Case 1: Building Live Market Chart

**User Request**: "Create a live market line chart for $AAPL with a custom indicator"

**Model Flow**:
```typescript
1. Call CreateAddonTool with browser mode
   → Launches Vite React app
   → Opens headed Chromium to localhost:5173
   → User sees browser window popup
   → Model gets screenshot

2. Model writes initial React component
   → Hot reload updates browser
   → User sees chart appear
   → Model gets screenshot, analyzes

3. User: "Add RSI indicator"
   → Model edits code
   → Hot reload updates
   → User sees indicator appear
   → Model gets screenshot

4. Model: "How does it look?"
   → User: "Make it bigger"
   → Model tweaks CSS
   → Hot reload updates
   → User approves

5. Done! Chart stays open, user can interact
```

### Use Case 2: TradingView PineScript

**User Request**: "Help me create a PineScript indicator on TradingView"

**Model Flow**:
```typescript
1. Call CreateAddonTool with browser mode
   → Launches headed Chromium
   → Navigates to tradingview.com
   → User sees TradingView site
   → Model gets screenshot

2. Model: "Please log in"
   → User logs in manually
   → Model waits, monitors

3. User: "I'm logged in, open PowerChart"
   → Model clicks menus to open PowerChart
   → Model opens PineScript editor
   → User sees editor open

4. Model writes PineScript code
   → Copies to clipboard
   → Pastes into editor
   → User sees code appear

5. Model clicks "Add to Chart"
   → Gets screenshot
   → User sees indicator on chart

6. User: "Adjust the threshold"
   → Model edits script
   → Updates in editor
   → User sees changes live

7. User approves → Done!
```

### Use Case 3: YouTube Video Summarizer

**User Request**: "Go to YouTube, find video about React hooks, summarize it"

**Model Flow**:
```typescript
1. Call CreateAddonTool with browser mode
   → Launches headed Chromium
   → Navigates to youtube.com
   → User sees YouTube homepage

2. Model searches "React hooks tutorial"
   → Types in search box
   → Clicks search
   → User sees results

3. Model clicks first video
   → Video starts playing
   → User watches along with model

4. Model captures screenshots every 10s
   → Analyzes visual content
   → Reads video title, description
   → Gets transcript if available

5. Model: "Based on the video, here's a summary..."
   → User sees both video and summary
```

---

## What's Already Built (95% There!)

### ✅ VisualFeedbackBridge (Playwright Integration)

**Location**: `src/implementations/addon/VisualFeedbackBridge.ts`

**Already supports**:
```typescript
// Initialize browser
await visualBridge.initialize();

// Navigate to ANY website
await visualBridge.captureSnapshot('https://tradingview.com');

// Interact with page
await visualBridge.interact({
  type: 'click',
  selector: '#login-button'
});

// Get visual feedback
const snapshot = await visualBridge.captureSnapshot(url);
// Returns: screenshot, DOM, console logs, network requests
```

### ✅ InteractWithSandboxTool

**Already supports**:
```typescript
await interactWithSandbox({
  sandboxId: 'abc-123',
  actions: [
    { type: 'navigate', value: 'https://youtube.com' },
    { type: 'type', selector: '#search', value: 'React tutorial' },
    { type: 'click', selector: '#search-button' },
    { type: 'wait', duration: 2000 },
    { type: 'click', selector: '.video-thumbnail:first-child' }
  ],
  captureAfterEachAction: true
});
```

### ✅ CreateAddonToolEnhanced

**Already supports**:
```typescript
await createAddon({
  name: "market-chart",
  implementation: {
    language: "javascript",
    code: `/* Vite React app code */`
  },
  mode: "dev",
  devConfig: {
    hotReload: true,
    openBrowser: true  // ← Opens browser automatically
  },
  enableVisualFeedback: true
});
```

---

## What's MISSING (5%)

### ❌ Headed Mode (Currently Headless)

**Current**: Playwright runs in headless mode
```typescript
// In VisualFeedbackBridge.ts
this.browser = await chromium.launch({
  headless: true  // ← Currently headless
});
```

**Needed**: Add headed mode option
```typescript
this.browser = await chromium.launch({
  headless: false,  // ← User sees browser window
  slowMo: 50        // ← Slow down for visibility
});
```

### ❌ Pre-configured Browser Sandbox Mode

**Current**: CreateAddonTool creates code sandboxes
**Needed**: Add "browser" mode that skips code execution

```typescript
await createAddon({
  name: "tradingview-session",
  mode: "browser",  // ← NEW MODE
  browserConfig: {
    initialUrl: "https://tradingview.com",
    headed: true,
    userDataDir: "./browser-profiles/tradingview"  // Persist cookies/login
  }
});
```

---

## Implementation Plan

### Phase 1: Add Headed Mode (15 minutes)

**File**: `VisualFeedbackBridge.ts`

```typescript
export interface VisualBridgeConfig {
  headless?: boolean;
  slowMo?: number;
  userDataDir?: string;
}

class VisualFeedbackBridge {
  async initialize(config: VisualBridgeConfig = {}) {
    this.browser = await chromium.launch({
      headless: config.headless ?? true,
      slowMo: config.slowMo ?? 0,
      args: config.userDataDir ? [
        `--user-data-dir=${config.userDataDir}`
      ] : []
    });
  }
}
```

### Phase 2: Add Browser Mode to CreateAddonTool (30 minutes)

```typescript
export interface CreateAddonToolParamsEnhanced {
  // ... existing params

  mode?: 'oneshot' | 'dev' | 'persistent' | 'browser';  // ← Add browser

  browserConfig?: {
    initialUrl?: string;
    headed?: boolean;
    slowMo?: number;
    persistSession?: boolean;
    userDataDir?: string;
  };
}
```

**Implementation**:
```typescript
async execute(params: CreateAddonToolParamsEnhanced, signal: AbortSignal) {
  if (params.mode === 'browser') {
    return await this.launchBrowserSandbox(params, signal);
  }
  // ... existing logic
}

private async launchBrowserSandbox(
  params: CreateAddonToolParamsEnhanced,
  signal: AbortSignal
): Promise<ToolResult> {
  const sandboxId = randomUUID();

  // Initialize browser in headed mode
  await visualBridge.initialize({
    headless: params.browserConfig?.headed === false,
    slowMo: params.browserConfig?.slowMo ?? 50,
    userDataDir: params.browserConfig?.persistSession
      ? join(this.sandboxDir, sandboxId, 'browser-profile')
      : undefined
  });

  // Navigate to initial URL
  const initialUrl = params.browserConfig?.initialUrl || 'about:blank';
  const snapshot = await visualBridge.captureSnapshot(initialUrl);

  // Create session
  const session: SandboxSession = {
    id: sandboxId,
    name: params.name,
    url: initialUrl,
    mode: 'browser',
    startTime: new Date(),
    lastActivity: new Date(),
    visualSnapshot: snapshot
  };

  activeSandboxes.set(sandboxId, session);

  // Emit events
  broadcaster.emitSandboxEvent({
    type: 'sandbox-created',
    sandboxId,
    timestamp: Date.now(),
    data: {
      name: params.name,
      url: initialUrl,
      mode: 'browser',
      headed: params.browserConfig?.headed !== false
    }
  });

  // Return to user
  return {
    ...this.createSuccessResult(`
# 🌐 Browser Sandbox Created: ${params.name}

**Sandbox ID**: ${sandboxId}
**Current URL**: ${initialUrl}
**Mode**: Browser (${params.browserConfig?.headed === false ? 'headless' : 'headed'})

## Browser Window
${params.browserConfig?.headed === false ? 'Running in headless mode' : '✅ Browser window is open and visible'}

## Controls
Use InteractWithSandbox to:
- Navigate to websites
- Click buttons/links
- Type into forms
- Scroll, hover, select
- Take screenshots

## Visual Feedback
Current screenshot available in visualSnapshot.

**View Dashboard**: ${viewServer.getViewUrl(sandboxId)}
    `),
    metadata: {
      sandboxId,
      url: initialUrl,
      mode: 'browser',
      headed: params.browserConfig?.headed !== false
    }
  };
}
```

### Phase 3: Add Navigate Action (Already Supported!)

The `InteractWithSandboxTool` already has navigate:
```typescript
{ type: 'navigate', value: 'https://tradingview.com' }
```

---

## Complete Example: Market Chart Builder

```typescript
// Step 1: Create Vite React app sandbox
const createResult = await createAddon({
  name: "aapl-chart",
  description: "Live AAPL market chart with custom indicator",
  parameters: {},

  implementation: {
    language: "javascript",
    code: `
      import { defineConfig } from 'vite'
      import react from '@vitejs/plugin-react'

      export default defineConfig({
        plugins: [react()],
      })
    `,
    dependencies: ["vite", "react", "react-dom", "@vitejs/plugin-react", "recharts"],
    packageManager: "npm"
  },

  mode: "dev",
  devConfig: {
    hotReload: true,
    openBrowser: false  // We'll open via VisualFeedbackBridge
  },
  enableVisualFeedback: true
});

const sandboxId = createResult.metadata.sandboxId;
const appUrl = createResult.metadata.url;  // http://localhost:5173

// Step 2: Open browser to the app
await visualBridge.initialize({
  headless: false,  // User sees browser window
  slowMo: 50
});

await visualBridge.captureSnapshot(appUrl);
// Browser window pops up showing the app!

// Step 3: Write initial chart component
await modifySandbox({
  sandboxId,
  file: "src/App.jsx",
  content: `
    import React from 'react';
    import { LineChart, Line, XAxis, YAxis } from 'recharts';

    export default function App() {
      const [data, setData] = React.useState([]);

      React.useEffect(() => {
        // Fetch AAPL data
        fetch('https://api.example.com/aapl')
          .then(r => r.json())
          .then(setData);
      }, []);

      return (
        <div style={{ padding: 20 }}>
          <h1>AAPL Live Chart</h1>
          <LineChart width={800} height={400} data={data}>
            <XAxis dataKey="time" />
            <YAxis />
            <Line type="monotone" dataKey="price" stroke="#8884d8" />
          </LineChart>
        </div>
      );
    }
  `,
  waitForReload: true,
  captureAfterReload: true
});

// Hot reload happens → Browser updates → Model sees screenshot
// User also sees browser window update in real-time!

// Step 4: User requests RSI indicator
// Model adds RSI calculation and line to chart
await modifySandbox({
  sandboxId,
  file: "src/App.jsx",
  content: `/* ... code with RSI indicator added ... */`,
  waitForReload: true,
  captureAfterReload: true
});

// Browser updates again → Both see the indicator

// Step 5: User: "Make it bigger"
await modifySandbox({
  sandboxId,
  file: "src/App.jsx",
  content: `/* ... same code but width={1200} height={600} ... */`,
  waitForReload: true,
  captureAfterReload: true
});

// User sees bigger chart → Approves!
```

---

## Complete Example: TradingView Automation

```typescript
// Step 1: Launch browser sandbox
const browserResult = await createAddon({
  name: "tradingview-session",
  description: "TradingView PineScript development",
  parameters: {},

  mode: "browser",  // ← Browser mode (no code execution)
  browserConfig: {
    initialUrl: "https://tradingview.com",
    headed: true,  // User sees browser
    persistSession: true  // Save cookies/login
  },
  enableVisualFeedback: true
});

const sandboxId = browserResult.metadata.sandboxId;

// Browser window opens showing TradingView!
// User sees it, model sees screenshot

// Step 2: Wait for user to log in
// (Model can't auto-login due to 2FA, CAPTCHA, etc.)
// Model monitors via screenshots

// Step 3: Once logged in, navigate to PowerChart
await interactWithSandbox({
  sandboxId,
  actions: [
    { type: 'click', selector: '#header-toolbar-chart' },  // Chart button
    { type: 'wait', duration: 2000 },
    { type: 'click', selector: '[data-name="pine-editor"]' },  // Pine Editor
    { type: 'wait', duration: 1000 }
  ],
  captureAfterEachAction: true
});

// Step 4: Write PineScript code
const pineScript = `
//@version=5
indicator("Custom RSI", overlay=false)
rsiValue = ta.rsi(close, 14)
plot(rsiValue, color=color.blue)
hline(70, "Overbought", color=color.red)
hline(30, "Oversold", color=color.green)
`;

// Step 5: Paste into editor
await interactWithSandbox({
  sandboxId,
  actions: [
    { type: 'click', selector: '.monaco-editor textarea' },  // Click editor
    { type: 'type', selector: '.monaco-editor textarea', value: pineScript },
    { type: 'wait', duration: 1000 }
  ],
  captureAfterEachAction: true
});

// Step 6: Add to chart
await interactWithSandbox({
  sandboxId,
  actions: [
    { type: 'click', selector: '[data-name="add-to-chart"]' },
    { type: 'wait', duration: 2000 }
  ],
  returnFinalSnapshot: true
});

// User sees indicator appear on chart!
// Model gets screenshot showing the result
```

---

## Key Differences From Current Implementation

| Feature | Current System | User's Vision | Status |
|---------|---------------|---------------|--------|
| **Event Broadcasting** | ✅ Complete | ✅ Needed | Done |
| **WebSocket Dashboard** | ✅ Complete | ✅ Needed | Done |
| **Headless Browser** | ✅ Playwright | ❌ Not visible | Easy fix |
| **Headed Browser** | ❌ Missing | ✅ Required | 5 min |
| **Navigate Websites** | ✅ Supported | ✅ Needed | Works |
| **UI Interactions** | ✅ Supported | ✅ Needed | Works |
| **Browser Mode** | ❌ Missing | ✅ Required | 30 min |
| **Hot Reload Dev** | ✅ Complete | ✅ Needed | Done |
| **Visual Feedback** | ✅ Screenshots | ✅ Screenshots | Done |
| **User Sees Browser** | ❌ Only dashboard | ✅ Browser window | Need headed mode |

**Summary**: We're 95% there! Just need to:
1. Enable headed mode (1 line change)
2. Add browser mode to CreateAddonTool (30 min)

---

## The Unified Vision

```
┌────────────────────────────────────────────────────────────────┐
│                     USER'S SCREEN                              │
│  ┌──────────────────────┐  ┌──────────────────────────────┐  │
│  │  Chromium Browser    │  │  View Dashboard              │  │
│  │  (Headed Mode)       │  │  http://localhost:4001       │  │
│  │                      │  │                               │  │
│  │  ┌────────────────┐ │  │  Console: "Navigating..."     │  │
│  │  │ TradingView.com│ │  │  Screenshots: [gallery]       │  │
│  │  │                │ │  │  Network: GET /api/...        │  │
│  │  │ [Live Chart]   │ │  │                               │  │
│  │  │                │ │  │                               │  │
│  │  │ User sees this!│ │  │  User sees events here!       │  │
│  │  └────────────────┘ │  │                               │  │
│  └──────────────────────┘  └──────────────────────────────┘  │
│                                                                │
│  User controls both:                                          │
│  - Browser window (can click, type manually if needed)        │
│  - Dashboard (monitors what model is doing)                   │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│                     MODEL'S VIEW                               │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  VisualFeedbackBridge                                     │ │
│  │  - Screenshots every action                               │ │
│  │  - DOM structure                                          │ │
│  │  - Console logs                                           │ │
│  │  - Network requests                                       │ │
│  │                                                            │ │
│  │  Model can:                                               │ │
│  │  - Navigate to any URL                                    │ │
│  │  - Click any element                                      │ │
│  │  - Type into forms                                        │ │
│  │  - Read page content                                      │ │
│  │  - Get visual feedback                                    │ │
│  │  - Iterate based on screenshots                           │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  Model sees same browser as user via screenshots!             │
└────────────────────────────────────────────────────────────────┘
```

---

## Next Steps to Achieve Vision

### Quick Fix (5 minutes)
```typescript
// In VisualFeedbackBridge.ts, change line ~50:
this.browser = await chromium.launch({
  headless: false,  // ← Change to false
  slowMo: 50        // ← Add this for visibility
});
```

Now when CreateAddonTool uses visual feedback, browser window appears!

### Full Implementation (30 minutes)
1. Add `headless` config to VisualFeedbackBridge
2. Add `browser` mode to CreateAddonTool
3. Add `browserConfig` parameters
4. Update output messages

### Ready to Use (Immediately!)
The interaction and navigation features **already work**:
```typescript
await interactWithSandbox({
  sandboxId: 'abc-123',
  actions: [
    { type: 'navigate', value: 'https://youtube.com' },
    { type: 'type', selector: '#search', value: 'React' },
    { type: 'click', selector: '#search-button' }
  ]
});
```

---

## Conclusion

Your vision is **absolutely achievable** with the current system + 2 small additions:

1. **Headed mode** (5 min) - Let user see browser
2. **Browser mode** (30 min) - Skip code execution, just launch browser

Everything else is **already built**:
- ✅ Browser automation (Playwright)
- ✅ Visual feedback (screenshots)
- ✅ Website navigation
- ✅ UI interactions
- ✅ Hot reload dev servers
- ✅ Event broadcasting
- ✅ Real-time dashboard

The sandbox IS pre-wired to do anything - we just need to make the browser visible and add a "browser-only" mode!

Would you like me to implement these two additions now?
