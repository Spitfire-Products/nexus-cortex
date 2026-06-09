# Visual Programming for the Model

## The Self-Modifying AI Loop

When the model creates a tool with CreateAddonTool, it enters a **visual programming loop**:

```
1. CREATE   → Model writes code, tool spins up
2. SEE      → Visual bridge captures screenshot + DOM
3. ANALYZE  → Model sees what it built
4. DECIDE   → Model either:
              - Edits code directly (hot reload)
              - Spawns sub-agent to interact
              - Declares done
5. REPEAT   → Loop until satisfied
```

---

## Example 1: Model Builds Dashboard, Then Sees It

### Iteration 1: Create

**Model thinking**: "User wants TradeStation proxy. Let me create it."

```typescript
// Model calls CreateAddonTool
{
  name: 'tradestation-proxy',
  mode: 'dev',
  enableVisualFeedback: true,  // NEW: Enables visual bridge
  implementation: {
    language: 'javascript',
    code: `/* Initial implementation */`
  }
}
```

**Tool Response includes**:
```json
{
  "status": "running",
  "url": "http://localhost:3000",
  "sandboxId": "abc-123",
  "visualSnapshot": {
    "screenshot": "data:image/png;base64,iVBORw0KG...",
    "dom": "<html><body><h1>Dashboard</h1>...",
    "accessibility": {
      "roles": ["button", "navigation", "main"],
      "labels": ["Start Proxy", "Stop", "Clear"]
    },
    "console": [
      "[log] Server started on port 3000"
    ]
  }
}
```

### Iteration 2: Model Sees Output

**Model receives visual snapshot** and thinks:

"I can see:
- Screenshot shows basic dashboard
- Console says server started
- Accessibility tree has buttons: Start, Stop, Clear
- But I notice: No traffic display area!
- Decision: Edit code to add traffic monitor"

### Iteration 3: Model Edits

**Model calls Write tool** to update code:

```typescript
// Model edits the file in sandbox
await writeTool.execute({
  file_path: '/sandbox/abc-123/index.js',
  content: `/* Updated code with traffic display */`
});

// Hot reload triggers automatically
// Visual bridge captures new snapshot
```

### Iteration 4: Model Sees Update

**New visual snapshot shows**:
- Traffic display area added ✅
- Real-time updates working ✅
- But network graph is broken ❌

**Model thinks**: "Graph is broken. Let me spawn a sub-agent to debug interactively."

### Iteration 5: Delegate to Sub-Agent

```typescript
// Model calls Task tool
await taskTool.execute({
  subagent_type: 'browser-debugger',
  description: 'Debug network graph',
  prompt: `
The network graph at http://localhost:3000 isn't rendering.

Visual snapshot shows:
- Console error: "Cannot read property 'data' of undefined"
- DOM has <canvas id="network-graph"> but it's blank

Your task:
1. Use Playwright to inspect the canvas
2. Check browser dev tools console
3. Identify the issue
4. Report back with fix

You have full browser automation via InteractWithSandbox tool.
  `
});
```

**Sub-agent interacts** via VisualFeedbackBridge:
```typescript
// Sub-agent clicks around, inspects elements
await bridge.interact({ type: 'click', selector: '#debug-mode' });
await bridge.interact({ type: 'open-devtools' });

// Captures what it sees
const snapshot = await bridge.captureSnapshot('http://localhost:3000');

// Sub-agent reports: "Data array is empty, need to initialize"
```

### Iteration 6: Model Applies Fix

**Model updates code** based on sub-agent findings, sees it works, **declares done**.

---

## Example 2: Iterative Landing Page Design

### User Request
"Create a modern landing page for my SaaS product"

### Model's Internal Loop

**Iteration 1**: Create basic structure
```typescript
createAddonTool({
  name: 'landing-page',
  mode: 'dev',
  enableVisualFeedback: true
});

// Sees: Basic structure but colors are bland
```

**Iteration 2**: Update styling
```typescript
// Model edits CSS directly
// Sees: Better colors but CTA button too small
```

**Iteration 3**: Refine CTA
```typescript
// Model increases button size, adds animation
// Sees: Good! But hero image missing
```

**Iteration 4**: Add hero image
```typescript
// Model adds gradient background
// Sees: Perfect! Check accessibility
```

**Iteration 5**: Accessibility check
```typescript
// Model spawns accessibility-checker sub-agent
// Sub-agent uses visual bridge to test keyboard nav
// Reports: "All good, AAA compliant"
```

**Model**: "Done! Landing page is production-ready."

---

## Example 3: Complex Multi-Step Workflow

### User: "Build a data visualization dashboard"

### Model's Approach

**Step 1**: Scaffold app
```typescript
createAddonTool({
  name: 'data-viz-dashboard',
  mode: 'dev',
  enableVisualFeedback: true,
  uiConfig: { framework: 'express' }
});

// Visual feedback: Blank page with "Upload CSV" button
```

**Step 2**: Test upload flow
```typescript
// Model spawns interaction agent
taskTool.execute({
  subagent_type: 'ui-tester',
  prompt: `
Test the CSV upload flow:
1. Click "Upload CSV" button
2. Upload sample.csv
3. Verify data loads
4. Capture screenshot showing data table
  `
});

// Agent reports: "Upload works, table shows data ✅"
```

**Step 3**: Add chart
```typescript
// Model edits to add Chart.js
// Visual feedback: Chart renders but wrong type (bar instead of line)
```

**Step 4**: Fix chart type
```typescript
// Model changes chart config
// Visual feedback: Line chart perfect! ✅
```

**Step 5**: Add interactivity
```typescript
// Model adds filters
// Spawns agent to test clicking filters
// Agent reports: "Filters work, chart updates correctly ✅"
```

**Model**: "Dashboard complete and tested!"

---

## Architecture: Visual Feedback Integration

### Enhanced CreateAddonTool Flow

```typescript
async function createAddonTool(params) {
  // 1. Create tool as before
  const sandbox = await launchSandbox(params);

  // 2. If enableVisualFeedback, initialize bridge
  if (params.enableVisualFeedback) {
    await visualBridge.initialize();

    // 3. Capture initial snapshot
    const snapshot = await visualBridge.captureSnapshot(sandbox.url);

    // 4. Set up file watcher for auto-capture on changes
    watchFiles(sandbox.path, async () => {
      // Hot reload happens
      await sleep(2000); // Wait for reload

      // Capture new snapshot
      const newSnapshot = await visualBridge.captureSnapshot(sandbox.url);

      // Compute diff
      const diff = await visualBridge.compareSnapshots(
        currentSnapshot,
        newSnapshot
      );

      // Model receives diff notification
      emitToModel('snapshot-updated', {
        snapshot: newSnapshot,
        diff
      });
    });
  }

  // 5. Return with visual data
  return {
    status: 'running',
    url: sandbox.url,
    sandboxId: sandbox.id,
    visualSnapshot: snapshot,  // Model can SEE
    interactionAPI: {           // Model can INTERACT
      methods: [
        'interact(command)',
        'extractData(selector)',
        'captureSnapshot()',
        'spawnInteractionAgent()'
      ]
    }
  };
}
```

---

## New Tools for Model Self-Interaction

### 1. InteractWithSandbox

```typescript
{
  name: 'InteractWithSandbox',
  description: 'Interact with a running sandbox via Playwright',
  parameters: {
    sandboxId: string,
    actions: InteractionCommand[]
  }
}

// Model can now:
await interactWithSandbox.execute({
  sandboxId: 'abc-123',
  actions: [
    { type: 'click', selector: '#upload-btn' },
    { type: 'type', selector: '#search', value: 'test' },
    { type: 'navigate', value: '/dashboard' }
  ]
});

// Returns new visual snapshot after interactions
```

### 2. InspectSandbox

```typescript
{
  name: 'InspectSandbox',
  description: 'Get current state of sandbox',
  parameters: {
    sandboxId: string,
    includeScreenshot: boolean
  }
}

// Model uses to check current state
const state = await inspectSandbox.execute({
  sandboxId: 'abc-123',
  includeScreenshot: true
});

// Returns:
// - Screenshot (for vision model)
// - DOM structure
// - Console logs
// - Network requests
// - Accessibility tree
```

### 3. ModifySandbox

```typescript
{
  name: 'ModifySandbox',
  description: 'Edit code in running sandbox (triggers hot reload)',
  parameters: {
    sandboxId: string,
    file: string,
    content: string
  }
}

// Model edits code
await modifySandbox.execute({
  sandboxId: 'abc-123',
  file: 'index.js',
  content: '/* updated code */'
});

// Returns visual snapshot after hot reload
```

---

## Model + Sub-Agent Collaboration

### Scenario: Complex UI Testing

**Main Model** creates dashboard:
```typescript
const sandbox = await createAddonTool({
  name: 'analytics-dashboard',
  mode: 'dev',
  enableVisualFeedback: true
});

// Model sees initial state
console.log(sandbox.visualSnapshot);
// "Dashboard has 3 charts, 2 filters, 1 table"
```

**Model spawns UI tester sub-agent**:
```typescript
const testResult = await taskTool.execute({
  subagent_type: 'ui-tester',
  prompt: `
You have access to InteractWithSandbox tool.

Sandbox ID: ${sandbox.sandboxId}
URL: ${sandbox.url}

Your mission:
1. Test all 3 charts (click, hover, check tooltips)
2. Test both filters (verify charts update)
3. Test table sorting (click column headers)
4. Capture screenshots of each state
5. Report any bugs found

You can see the UI via screenshots.
  `
});

// Sub-agent autonomously:
// - Clicks around
// - Captures screenshots
// - Reports findings
```

**Main model receives report**:
```typescript
{
  bugs: [
    "Chart 2 tooltip doesn't show on hover",
    "Table sort icon missing"
  ],
  screenshots: [
    "data:image/png;base64,...",
    "data:image/png;base64,..."
  ],
  suggestions: [
    "Add tooltip event listener to Chart 2",
    "Add sort icon CSS"
  ]
}
```

**Model applies fixes**:
```typescript
// Model edits code based on sub-agent report
await modifySandbox({
  sandboxId: sandbox.sandboxId,
  file: 'index.js',
  content: '/* Fixed code */'
});

// Spawns sub-agent again to verify
const retest = await taskTool.execute({
  subagent_type: 'ui-tester',
  prompt: 'Retest the issues from previous run'
});

// Sub-agent reports: "All bugs fixed! ✅"
```

---

## Model's Perspective (Internal Monologue)

```
User: "Create a trading dashboard"

Model: "I'll create it step by step, seeing my work as I go."

[Creates tool]
Model: "I see a blank page. Let me add the basic structure."

[Edits code]
Model: "Now I see a navbar and sidebar. Good. But the charts area is empty."

[Adds chart component]
Model: "Chart renders! But it's showing wrong data. Let me debug."

[Spawns debugger sub-agent]
Sub-agent: "Found it! Data format is wrong, should be array not object."

Model: "Thanks! Let me fix that."

[Edits code]
Model: "Perfect! Now the chart shows correct data. Let me add interactivity."

[Adds click handlers]
Model: "I'll test it myself using InteractWithSandbox."

[Clicks around via Playwright]
Model: "Clicks work! Filters update chart correctly. Let me add polish."

[Adds animations and styling]
Model: "Looking great! Let me do a final check."

[Captures final snapshot]
Model: "Dashboard is professional, functional, and tested. Done!"
```

---

## Key Insight

**This transforms the model from "code generator" to "visual programmer".**

The model can now:
- ✅ **SEE** what it creates (not just imagine it)
- ✅ **ITERATE** rapidly (hot reload + visual feedback)
- ✅ **DELEGATE** complex tasks (spawn interaction agents)
- ✅ **TEST** its own work (Playwright automation)
- ✅ **REFINE** until perfect (visual diff loop)

This is **exponentially more powerful** than blind code generation because the model has **visual confirmation at every step**.

---

## Implementation Priority

1. ✅ Visual Feedback Bridge (Playwright integration)
2. ⏳ Add to CreateAddonTool (automatic snapshot capture)
3. ⏳ InteractWithSandbox tool (model can click/type)
4. ⏳ InspectSandbox tool (get current state)
5. ⏳ ModifySandbox tool (hot reload editing)
6. ⏳ Sub-agent coordination (browser-debugger, ui-tester agents)

This enables **true visual programming** where the model iterates on UIs like a human developer with hot reload and visual inspection!
