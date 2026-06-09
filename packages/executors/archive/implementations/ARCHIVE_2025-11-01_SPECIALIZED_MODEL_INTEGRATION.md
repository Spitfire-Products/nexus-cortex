# Specialized Model Integration for Sandbox Visual Programming

**Date**: 2025-11-03
**Status**: DESIGN SPECIFICATION

---

## Overview

The sandbox toolkit (CreateAddonTool + InspectSandbox + InteractWithSandbox + ModifySandbox + StopSandbox) can be dramatically enhanced by leveraging **specialized AI models** that excel at specific tasks:

1. **Vision Models** (Gemini Flash/Pro Vision, GPT-4 Vision) - Analyze screenshots
2. **Computer Use Models** (Claude 3.5 with computer use, GPT-4 with browsing) - Navigate UIs
3. **Code Models** (GPT-4 Turbo, Claude 3.5 Sonnet) - Analyze DOM/generate fixes
4. **Reasoning Models** (GPT-4o with extended thinking, Gemini 2.0) - Plan interactions

---

## Architecture: Multi-Model Orchestration

```
┌──────────────────────────────────────────────────────────┐
│              MAIN MODEL (Claude 3.5 Sonnet)              │
│                                                          │
│  "I need to create and test a dashboard"                │
│                                                          │
│  [Creates sandbox, sees initial state]                  │
│                                                          │
│  "Let me delegate visual analysis to vision model"      │
└────────────┬─────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────┐
│         SPECIALIZED MODELS (Via Orchestrator)            │
│                                                          │
│  ┌────────────────┐  ┌────────────────┐               │
│  │ Vision Model   │  │ Computer Use   │               │
│  │ (Gemini Flash) │  │ (Claude 3.5)   │               │
│  │                │  │                │               │
│  │ • Screenshot   │  │ • Click        │               │
│  │   analysis     │  │ • Type         │               │
│  │ • UI issues    │  │ • Navigate     │               │
│  │ • Color check  │  │ • Test flows   │               │
│  └────────────────┘  └────────────────┘               │
│                                                          │
│  ┌────────────────┐  ┌────────────────┐               │
│  │ Code Model     │  │ Reasoning      │               │
│  │ (GPT-4 Turbo)  │  │ (Gemini 2.0)   │               │
│  │                │  │                │               │
│  │ • DOM parsing  │  │ • Test plan    │               │
│  │ • Code gen     │  │ • Strategy     │               │
│  │ • Bug fix      │  │ • Debug        │               │
│  └────────────────┘  └────────────────┘               │
└────────────┬─────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────┐
│                    SANDBOX TOOLKIT                       │
│                                                          │
│  InspectSandbox → Returns screenshot + DOM              │
│  InteractWithSandbox → Executes interactions            │
│  ModifySandbox → Edits code                             │
└──────────────────────────────────────────────────────────┘
```

---

## Use Case 1: Vision Model for Screenshot Analysis

### Problem

Main model receives a screenshot but may not be optimized for visual analysis. Vision models (Gemini Flash Vision, GPT-4 Vision) are:
- Faster at image processing
- Better at detecting UI issues
- Cheaper for visual-only tasks

### Solution: Delegate to Vision Model

```typescript
// MAIN MODEL WORKFLOW:

// 1. Create sandbox
const createResult = await createAddonTool.execute({
  name: 'dashboard',
  enableVisualFeedback: true,
  mode: 'dev',
  implementation: { /* code */ }
});

// 2. Extract sandbox ID and screenshot
const sandboxId = createResult.metadata.sandboxId;
const screenshot = createResult.metadata.visualSnapshot.screenshot; // base64 PNG

// 3. Delegate visual analysis to Gemini Flash Vision
const visionAnalysis = await orchestrator.executeWithModel({
  modelId: 'gemini-2.0-flash-thinking-exp',  // Vision-optimized model
  prompt: `
    You are a UI expert. Analyze this screenshot of a dashboard:

    [Image: ${screenshot}]

    Your task:
    1. Identify visual issues (broken layout, misaligned elements, wrong colors)
    2. Suggest improvements (spacing, typography, color scheme)
    3. Check accessibility (contrast ratios, text size)
    4. Rate overall visual quality (1-10)

    Return JSON:
    {
      "issues": [...],
      "suggestions": [...],
      "accessibility": {...},
      "rating": 8
    }
  `,
  responseFormat: { type: 'json' }
});

// 4. Main model receives vision analysis
const analysis = JSON.parse(visionAnalysis.content);

if (analysis.rating < 7) {
  // Main model edits code based on suggestions
  await modifySandbox({
    sandboxId,
    file: 'styles.css',
    content: `/* Improved CSS based on vision model feedback */`
  });
}
```

### Benefits

- **Speed**: Vision models process images faster
- **Cost**: Gemini Flash Vision is 10x cheaper than Claude for vision tasks
- **Specialization**: Better at detecting UI issues
- **Parallel**: Main model can work on other tasks while vision model analyzes

---

## Use Case 2: Computer Use Model for UI Testing

### Problem

Testing complex UI flows (multi-step forms, navigation, interactions) is tedious for the main model. Computer Use models are optimized for:
- Sequential interactions
- Mouse/keyboard automation
- Visual verification

### Solution: Delegate to Computer Use Model

```typescript
// MAIN MODEL WORKFLOW:

// 1. Inspect sandbox to get current state
const inspectResult = await inspectSandbox({
  sandboxId: 'abc-123',
  captureScreenshot: true
});

// 2. Delegate testing to Claude 3.5 Computer Use
const testResult = await orchestrator.executeWithModel({
  modelId: 'claude-3-5-sonnet-20241022',  // Computer use enabled
  systemPrompt: `
    You are a QA engineer with computer use capabilities.

    Sandbox Information:
    - ID: abc-123
    - URL: http://localhost:3000
    - Tools available: InteractWithSandbox, InspectSandbox

    Test Plan:
    1. Fill out registration form (name, email, password)
    2. Click "Submit" button
    3. Verify success message appears
    4. Click "Dashboard" link
    5. Verify dashboard loads with user data

    For each step:
    - Use InteractWithSandbox to perform action
    - Use InspectSandbox to verify result
    - Capture screenshot
    - Report success/failure

    Return detailed test report.
  `,
  tools: [
    'InteractWithSandbox',
    'InspectSandbox'
  ],
  autonomy: 'full'  // Allow model to use tools autonomously
});

// 3. Main model receives test report
if (!testResult.allTestsPassed) {
  // Main model debugs based on failures
  await modifySandbox({
    sandboxId: 'abc-123',
    file: 'handlers.js',
    content: `/* Fix based on test failures */`
  });
}
```

### Benefits

- **Automation**: Computer use models handle multi-step flows automatically
- **Reliability**: Specialized for UI interactions
- **Screenshots**: Captures state at each step for debugging
- **Reporting**: Detailed test reports with visual proof

---

## Use Case 3: Code Model for DOM Analysis & Bug Fixing

### Problem

Main model may not be optimized for deep code analysis. Code models (GPT-4 Turbo, specialized fine-tunes) excel at:
- Parsing complex DOM structures
- Identifying code patterns
- Generating targeted fixes

### Solution: Delegate Code Analysis

```typescript
// MAIN MODEL WORKFLOW:

// 1. Inspect sandbox and extract DOM
const inspectResult = await inspectSandbox({
  sandboxId: 'abc-123',
  captureDOM: true,
  captureConsole: true
});

const dom = inspectResult.metadata.visualSnapshot.dom;
const consoleErrors = inspectResult.metadata.visualSnapshot.console.filter(
  log => log.includes('[error]')
);

// 2. Delegate code analysis to GPT-4 Turbo
const codeAnalysis = await orchestrator.executeWithModel({
  modelId: 'gpt-4-turbo-2024-04-09',  // Code-optimized
  prompt: `
    You are a senior JavaScript developer.

    I have a web app with console errors. Please analyze:

    **DOM Structure**:
    \`\`\`html
    ${dom}
    \`\`\`

    **Console Errors**:
    ${consoleErrors.join('\n')}

    Your task:
    1. Identify root cause of errors
    2. Find problematic code (line/function)
    3. Suggest fix with code snippet
    4. Explain why error occurred

    Return JSON with analysis and fix.
  `,
  responseFormat: { type: 'json' }
});

// 3. Main model applies fix
const fix = JSON.parse(codeAnalysis.content);

await modifySandbox({
  sandboxId: 'abc-123',
  file: fix.file,
  content: fix.fixedCode,
  waitForReload: true,
  captureAfterReload: true
});

// 4. Verify error is gone
const verifyResult = await inspectSandbox({
  sandboxId: 'abc-123',
  captureConsole: true
});

const stillHasErrors = verifyResult.metadata.visualSnapshot.console.some(
  log => log.includes('[error]')
);

if (!stillHasErrors) {
  console.log('✅ Bug fixed successfully');
}
```

### Benefits

- **Precision**: Code models better at parsing DOM/stack traces
- **Speed**: Faster code analysis than general models
- **Context**: Can analyze entire DOM structure efficiently

---

## Use Case 4: Reasoning Model for Test Strategy

### Problem

Planning complex test scenarios requires deep reasoning. Reasoning models (GPT-4o with extended thinking, Gemini 2.0 with thinking mode) excel at:
- Strategic planning
- Edge case identification
- Test coverage optimization

### Solution: Delegate Test Planning

```typescript
// MAIN MODEL WORKFLOW:

// 1. Get current sandbox state
const inspectResult = await inspectSandbox({
  sandboxId: 'abc-123',
  captureScreenshot: true,
  captureDOM: true,
  extractData: true
});

// 2. Delegate test planning to Gemini 2.0 Thinking
const testPlan = await orchestrator.executeWithModel({
  modelId: 'gemini-2.0-flash-thinking-exp',  // Thinking mode
  prompt: `
    You are a test strategist with deep reasoning capabilities.

    Application State:
    - ${inspectResult.metadata.extractedData.buttons.length} buttons
    - ${inspectResult.metadata.extractedData.inputs.length} input fields
    - ${inspectResult.metadata.extractedData.links.length} links

    DOM:
    ${inspectResult.metadata.visualSnapshot.dom}

    Your task (think step-by-step):
    1. Identify all user flows (registration, login, checkout, etc.)
    2. For each flow, list required interactions
    3. Identify edge cases (empty inputs, invalid data, network errors)
    4. Prioritize tests (critical path first)
    5. Generate test script using InteractWithSandbox

    Think deeply about:
    - What could go wrong?
    - What inputs are most likely to break the app?
    - What visual states should I verify?

    Return comprehensive test plan with interaction sequences.
  `,
  thinkingBudget: 'high'  // Allow extended thinking
});

// 3. Main model executes test plan
const plan = JSON.parse(testPlan.content);

for (const testCase of plan.testCases) {
  const result = await interactWithSandbox({
    sandboxId: 'abc-123',
    actions: testCase.actions,
    returnFinalSnapshot: true
  });

  // Analyze results
  console.log(`Test ${testCase.name}: ${result.success ? 'PASS' : 'FAIL'}`);
}
```

### Benefits

- **Thoroughness**: Thinking models identify edge cases better
- **Strategy**: Better test prioritization
- **Coverage**: More comprehensive test scenarios

---

## ResponsesAPI Integration for Stateful Sessions

### Problem

Current design: Each tool call is stateless
- Main model makes tool call → Orchestrator → Executor → Return
- No persistent connection to sandbox
- Visual bridge re-captures screenshots each time
- Inefficient for rapid iteration

### Solution: ResponsesAPI with Stateful Sessions

The **ResponsesAPIAdapter** and **ResponsesAPIHelperAdapter** can maintain stateful connections:

```typescript
// ARCHITECTURE WITH ResponsesAPI

┌─────────────────────────────────────────────────────┐
│              ResponsesAPI Session                   │
│                                                     │
│  Session ID: "resp_abc123"                         │
│  Duration: Persistent until manually closed        │
│                                                     │
│  ┌──────────────────────────────────────┐          │
│  │  Stateful Context                    │          │
│  │                                       │          │
│  │  - sandboxId: "abc-123"              │          │
│  │  - visualBridge: <Playwright>        │          │
│  │  - currentPage: <Page>               │          │
│  │  - lastSnapshot: <VisualSnapshot>    │          │
│  │  - conversationHistory: [...]        │          │
│  └──────────────────────────────────────┘          │
│                                                     │
│  Model sends messages within same session          │
│  → Context persists across messages                │
│  → Playwright browser stays open                   │
│  → Faster subsequent captures                      │
└─────────────────────────────────────────────────────┘
```

### Implementation

#### 1. Create Stateful Sandbox Session Handler

```typescript
// src/services/StatefulSandboxSessionHandler.ts

export class StatefulSandboxSessionHandler {
  private sandboxId: string;
  private session: SandboxSession;
  private visualBridgeInitialized: boolean = false;

  constructor(sandboxId: string) {
    this.sandboxId = sandboxId;
    this.session = CreateAddonToolExecutorEnhanced.getActiveSandbox(sandboxId)!;
  }

  /**
   * Initialize persistent visual bridge
   */
  async initialize(): Promise<void> {
    if (!this.visualBridgeInitialized) {
      await visualBridge.initialize();
      this.visualBridgeInitialized = true;
    }
  }

  /**
   * Fast inspect (reuses existing Playwright page)
   */
  async inspect(): Promise<VisualSnapshot> {
    await this.initialize();

    // Playwright page already on correct URL
    const snapshot = await visualBridge.captureSnapshot(this.session.url!);
    this.session.visualSnapshot = snapshot;

    return snapshot;
  }

  /**
   * Fast interact (no page reload needed)
   */
  async interact(actions: InteractionCommand[]): Promise<VisualSnapshot> {
    await this.initialize();

    for (const action of actions) {
      await visualBridge.interact(action);
    }

    // Capture after interactions
    const snapshot = await visualBridge.captureSnapshot(this.session.url!);
    this.session.visualSnapshot = snapshot;

    return snapshot;
  }

  /**
   * Modify code (wait for hot reload)
   */
  async modify(file: string, content: string): Promise<VisualSnapshot> {
    // Write file
    const sandboxPath = `/workspace/.addon-tools/${this.sandboxId}`;
    await fs.writeFile(join(sandboxPath, file), content);

    // Wait for hot reload
    await this.wait(3000);

    // Capture updated state
    return await this.inspect();
  }

  /**
   * Cleanup
   */
  async close(): Promise<void> {
    // Keep browser open if other sessions need it
    const activeSandboxes = CreateAddonToolExecutorEnhanced.listActiveSandboxes();
    if (activeSandboxes.length === 1) {
      await visualBridge.close();
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

#### 2. Integrate with ResponsesAPI

```typescript
// src/adapters/ResponsesAPISandboxAdapter.ts

import { ResponsesAPIAdapter } from '@omniclaude/core';
import { StatefulSandboxSessionHandler } from '../services/StatefulSandboxSessionHandler.js';

export class ResponsesAPISandboxAdapter extends ResponsesAPIAdapter {
  private sandboxHandlers: Map<string, StatefulSandboxSessionHandler> = new Map();

  /**
   * Start stateful sandbox session
   */
  async startSandboxSession(sandboxId: string): Promise<string> {
    const handler = new StatefulSandboxSessionHandler(sandboxId);
    await handler.initialize();

    // Create ResponsesAPI session
    const sessionId = await this.createSession({
      model: 'claude-3-5-sonnet-20241022',
      systemPrompt: `
        You are working with a live sandbox environment.

        Sandbox ID: ${sandboxId}
        Tools available: inspect, interact, modify

        Context persists across messages. Use tools efficiently.
      `,
      tools: ['inspect', 'interact', 'modify'],
      context: {
        sandboxId,
        sandboxHandler: handler
      }
    });

    this.sandboxHandlers.set(sessionId, handler);

    return sessionId;
  }

  /**
   * Send message to stateful session
   */
  async sendMessage(sessionId: string, message: string): Promise<any> {
    const handler = this.sandboxHandlers.get(sessionId);

    if (!handler) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Send message via ResponsesAPI
    // Handler tools are available in session context
    const response = await this.send(sessionId, message);

    return response;
  }

  /**
   * Close sandbox session
   */
  async closeSandboxSession(sessionId: string): Promise<void> {
    const handler = this.sandboxHandlers.get(sessionId);

    if (handler) {
      await handler.close();
      this.sandboxHandlers.delete(sessionId);
    }

    await this.endSession(sessionId);
  }
}
```

#### 3. Usage Example

```typescript
// MAIN MODEL WORKFLOW WITH RESPONSESAPI:

// 1. Create sandbox
const createResult = await createAddonTool.execute({
  name: 'dashboard',
  enableVisualFeedback: true,
  mode: 'dev',
  implementation: { /* code */ }
});

const sandboxId = createResult.metadata.sandboxId;

// 2. Start stateful session
const sessionAdapter = new ResponsesAPISandboxAdapter();
const sessionId = await sessionAdapter.startSandboxSession(sandboxId);

// 3. Iterative development with persistent context
await sessionAdapter.sendMessage(sessionId,
  "Inspect the current state and tell me what you see"
);
// → Fast inspect (Playwright already on page)

await sessionAdapter.sendMessage(sessionId,
  "The navbar looks misaligned. Fix the CSS."
);
// → Modify code, wait for reload, auto-inspect

await sessionAdapter.sendMessage(sessionId,
  "Click the 'Login' button and verify the form appears"
);
// → Interact (click), auto-capture

await sessionAdapter.sendMessage(sessionId,
  "Fill out the login form with test credentials"
);
// → Interact (type into inputs), auto-capture

await sessionAdapter.sendMessage(sessionId,
  "Submit the form and check for errors"
);
// → Interact (click submit), inspect console

// 4. Close session when done
await sessionAdapter.closeSandboxSession(sessionId);
```

### Benefits of ResponsesAPI Integration

1. **Performance**:
   - Playwright browser stays open
   - No page reload between tools
   - Screenshots captured faster (page already loaded)

2. **State Persistence**:
   - Conversation history maintained
   - Visual context preserved
   - No need to re-explain sandbox ID each time

3. **Efficiency**:
   - Model can iterate rapidly
   - Fewer redundant captures
   - Lower latency (50-200ms vs 2-3s for full capture)

4. **Better UX**:
   - More natural conversation flow
   - Model remembers previous interactions
   - Contextual responses

---

## Provider Selection Strategy

### Choose Model by Task

| Task | Best Model | Reason | Cost |
|------|-----------|---------|------|
| **Screenshot Analysis** | Gemini 2.0 Flash Vision | Fast, cheap, accurate | $$ |
| **UI Testing** | Claude 3.5 Sonnet | Computer use, tool use | $$$$ |
| **Code Analysis** | GPT-4 Turbo | Code-optimized, fast | $$$ |
| **Test Planning** | Gemini 2.0 Thinking | Deep reasoning | $$$ |
| **General Orchestration** | Claude 3.5 Sonnet | Best tool use | $$$$ |
| **Rapid Iteration** | Gemini Flash (via ResponsesAPI) | Fast, stateful | $$ |

### Cost Optimization

```
For 100 sandbox iterations:

WITHOUT specialized models (Claude 3.5 Sonnet only):
- 100 tool calls × $0.015 per call = $1.50
- Total: $1.50

WITH specialized models:
- 10 strategic planning (Gemini Thinking) × $0.005 = $0.05
- 50 screenshot analysis (Gemini Flash Vision) × $0.001 = $0.05
- 30 code analysis (GPT-4 Turbo) × $0.01 = $0.30
- 10 orchestration (Claude 3.5 Sonnet) × $0.015 = $0.15
- Total: $0.55

SAVINGS: 63% cheaper + faster execution
```

---

## Next Steps

1. ✅ **Sandbox toolkit complete** (CreateAddonTool, InspectSandbox, InteractWithSandbox, ModifySandbox, StopSandbox)
2. ❌ **Implement ResponsesAPISandboxAdapter** (stateful sessions)
3. ❌ **Add model selection to orchestrator** (route tasks to specialized models)
4. ❌ **Create example workflows** (dashboard creation, testing, debugging)
5. ❌ **Add telemetry** (track which models used for what tasks)

---

**Status**: Ready for implementation
**Est. Time**: 4-6 hours for full integration
**Priority**: HIGH (dramatically improves sandbox toolkit value)
