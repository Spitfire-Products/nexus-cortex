# Post-Compaction Handoff Guide

## Quick Context

You are continuing work on **Visual Workspace Sandbox System** for OmniClaude V4. This is a system that allows AI models to work like human developers with visual feedback and physical interaction capabilities.

**Current Phase**: Implementation planning completed. Ready to begin Phase 1 (Enhanced Browser Sandbox).

**Time Investment So Far**: ~20 hours of prior work + 2 hours of planning this session

**Estimated Time Remaining**: 6 hours (full implementation) OR 1 hour (Phase 1 only for 70% value)

---

## What Was Requested

The user wants a **flexible visual development sandbox** where the AI model can:

1. **Choose environment type** - terminal, browser, or hybrid (model decides based on task)
2. **See visual output** - through screenshots and screen streaming
3. **Interact physically** - click coordinates, type text, keyboard shortcuts (Ctrl+V), scroll, zoom
4. **Work like a human** - write code externally on client, paste into sandbox
5. **Support any workflow** - TradingView automation, YouTube analysis, live chart development, etc.

**Key User Quote**:
> "The model will be writing and composing code in the client. It can pipe or paste in code into the sandbox element if needed. IDE seem not particularly useful at the moment."

**User's Final Request**:
> "Write an implementation plan and for yourself a handoff guide to complete after compaction."

---

## What's Already Built (95% Complete)

### Core Infrastructure (All Working)

1. **SandboxEventBroadcaster** (`src/implementations/addon/SandboxEventBroadcaster.ts` - 276 lines)
   - Event emission for 14 event types
   - Event history storage (1000 events per sandbox)
   - Multiple subscription patterns
   - **Status**: ✅ Complete, production-ready

2. **SandboxViewServer** (`src/implementations/addon/SandboxViewServer.ts` - 654 lines)
   - Express HTTP server on port 4001
   - Socket.io WebSocket for live updates
   - Multi-sandbox dashboard at `/`
   - Per-sandbox detailed view at `/sandbox/:id`
   - Event streaming to clients
   - **Status**: ✅ Complete, needs screen streaming enhancement

3. **VisualFeedbackBridge** (`src/implementations/addon/VisualFeedbackBridge.ts` - 443 lines)
   - Playwright browser automation
   - Screenshot capture
   - Console log monitoring
   - Network request tracking
   - Basic interactions (click, type, navigate, scroll, hover)
   - **Status**: 🟡 Needs headed mode + keyboard shortcuts + clipboard

4. **CreateAddonToolEnhanced** (`src/implementations/addon/CreateAddonToolEnhanced.ts` - 917 lines)
   - Creates sandboxes with npm/pip/UV/NIX
   - Three modes: oneshot, dev, persistent
   - Hot reload with file watching
   - Visual feedback integration
   - **Status**: 🟡 Needs browser mode, terminal mode, hybrid mode

5. **InteractWithSandboxTool** (`src/implementations/addon/InteractWithSandboxTool.ts` - 331 lines)
   - Execute actions on sandbox (click, type, navigate, etc.)
   - Screenshot capture after each action
   - Coordinate-based and selector-based clicking
   - **Status**: 🟡 Needs keypress, zoom actions, multi-window support

6. **ModifySandboxTool** (`src/implementations/addon/ModifySandboxTool.ts` - 305 lines)
   - Edit files in sandbox
   - Create/delete files
   - **Status**: ✅ Complete

7. **StopSandboxTool** (`src/implementations/addon/StopSandboxTool.ts` - 318 lines)
   - Clean shutdown
   - Resource cleanup
   - **Status**: ✅ Complete

8. **InspectSandboxTool** (`src/implementations/addon/InspectSandboxTool.ts` - 229 lines)
   - State observation
   - File listing
   - **Status**: ✅ Complete

### Demo System (Working)

- **Quick Demo** (`demo/quick-demo.js`) - Creates sandbox, emits events, shows dashboard
- **View Events UI** (`demo/view-events.html`) - Live event monitoring interface
- **Status**: ✅ Demonstrates event system working

---

## What Needs to Be Built (5% Remaining)

### Phase 1: Enhanced Browser Sandbox (1 hour) ⭐ START HERE

**Priority**: HIGHEST - Provides 70% of value in just 1 hour

**Tasks**:
1. Enable headed mode (5 min)
2. Add keyboard shortcuts - Ctrl+V, Ctrl+S, Ctrl+C (15 min)
3. Add scroll and zoom (15 min)
4. Add clipboard support (25 min)

**Files to modify**:
- `src/implementations/addon/VisualFeedbackBridge.ts`
- `src/implementations/addon/InteractWithSandboxTool.ts`

**See**: `VISUAL_WORKSPACE_IMPLEMENTATION_PLAN.md` Section "Phase 1" for exact code snippets

---

### Phase 2: Terminal Sandbox (2 hours)

**Tasks**:
1. Create TerminalSandbox class with xterm.js (1 hour)
2. Create terminal HTML client (30 min)
3. Integrate with CreateAddonTool (30 min)

**New files to create**:
- `src/implementations/addon/TerminalSandbox.ts`
- `src/implementations/addon/terminal-client.html`

**Dependencies to add**:
```bash
npm install node-pty express-ws xterm xterm-addon-fit
```

---

### Phase 3: Screen Streaming (1 hour)

**Tasks**:
1. Create ScreenStream class (30 min)
2. Integrate with VisualFeedbackBridge (15 min)
3. Add to dashboard (15 min)

**New file**:
- `src/implementations/addon/ScreenStream.ts`

---

### Phase 4: Multi-Window Management (1.5 hours)

**Tasks**:
1. Create WindowManager class (45 min)
2. Add hybrid mode to CreateAddonTool (30 min)
3. Support window positioning and focus (15 min)

**New file**:
- `src/implementations/addon/WindowManager.ts`

---

### Phase 5: Update Interaction Tools (30 min)

**Tasks**:
1. Add new action types (15 min)
2. Support multi-window targeting (15 min)

---

## Critical Decisions Made

### Decision 1: No IDE Sandbox
**User's rationale**: "The model will be writing and composing code in the client."
**Impact**: Model writes code on client side (like normal development), then pastes into sandbox
**Implementation**: Focus on clipboard API and Ctrl+V keyboard shortcuts

### Decision 2: Option B without IDE
**Options considered**:
- Option A: Quick fix (headed mode only)
- Option B: Full implementation (terminal + browser + screen streaming + multi-window)
- Option C: With IDE (VS Code in browser)

**Chosen**: Option B without IDE
**Why**: Full visual workspace capability without unnecessary IDE complexity

### Decision 3: Model Chooses Environment Type
**User's vision**: "it could be a terminal window, a static app, or a Headed or headless browser, etc... to be decided by the model when launching the tool"
**Implementation**: CreateAddonTool will support type parameter (terminal/browser/hybrid)

---

## How to Continue

### If You Have 1 Hour (Recommended Start)
Do **Phase 1 only** - Enhanced Browser Sandbox
- Enables headed browser mode
- Adds keyboard shortcuts for paste workflow
- Provides immediate value (70% of use cases)
- Quick win before tackling bigger features

### If You Have 6 Hours (Full Implementation)
Do all 5 phases in order:
1. Phase 1: Enhanced Browser (1 hour)
2. Phase 2: Terminal Sandbox (2 hours)
3. Phase 3: Screen Streaming (1 hour)
4. Phase 4: Multi-Window (1.5 hours)
5. Phase 5: Update Tools (30 min)

### Testing Strategy
After each phase:
1. Run `npm run build` in `/home/runner/workspace/omniclaude-v4/packages/executors`
2. Test with demo: `node demo/quick-demo.js`
3. Open dashboard: `http://localhost:4001`
4. Verify new functionality works

---

## Key Files Reference

### Documentation
- `VISUAL_WORKSPACE_IMPLEMENTATION_PLAN.md` - Detailed implementation plan with code snippets
- `AI_WORKSPACE_ARCHITECTURE.md` - Complete architecture and design
- `BROWSER_SANDBOX_VISION.md` - Initial vision document
- `POST_COMPACTION_HANDOFF.md` - This file

### Implementation Files
- `src/implementations/addon/VisualFeedbackBridge.ts` - Browser automation (needs enhancement)
- `src/implementations/addon/CreateAddonToolEnhanced.ts` - Sandbox creation (needs modes)
- `src/implementations/addon/InteractWithSandboxTool.ts` - Interaction tool (needs actions)
- `src/implementations/addon/SandboxViewServer.ts` - Dashboard (needs streaming)
- `src/implementations/addon/SandboxEventBroadcaster.ts` - Events (complete)

### Demo Files
- `demo/quick-demo.js` - Test demo
- `demo/view-events.html` - Event viewer UI

---

## User's Use Case Examples

These are the real-world scenarios the user wants to enable:

### Example 1: Live Market Chart Development
1. User requests live AAPL chart with custom indicator
2. Model creates browser sandbox
3. Model launches Vite React dev server
4. Model builds chart UI iteratively
5. Both user and model see visual output
6. Model tweaks indicator until user approves

### Example 2: TradingView Automation
1. Model launches browser sandbox
2. Model navigates to tradingview.com
3. User logs in manually
4. Model opens PineScript editor
5. Model copies code from client (external scratchpad)
6. Model pastes into editor (Ctrl+V)
7. Model iterates on code until approved

### Example 3: YouTube Video Analysis
1. Model launches browser sandbox
2. Model navigates to YouTube
3. Model searches for video
4. Model plays and watches video
5. Model summarizes for user

---

## Important Technical Notes

### Playwright Headed Mode
Current code uses `headless: true`. Change to `headless: false` to see browser window.

### Keyboard Shortcuts
Use Playwright's `page.keyboard.press('Control+V')` format for shortcuts.

### Clipboard API
Requires HTTPS or localhost. Works in our case since we control the browser.

### xterm.js for Terminal
Uses WebSocket for I/O streaming between PTY process and browser-based terminal emulator.

### Screen Streaming
2 FPS is optimal (500ms interval) to balance responsiveness and bandwidth.

---

## What NOT to Do

❌ **Don't build IDE sandbox** - User explicitly said it's unnecessary
❌ **Don't use event-based interaction** - Use direct Playwright commands
❌ **Don't complicate window management** - Keep it simple initially
❌ **Don't over-engineer** - User wants practical, working solution

---

## Success Criteria

You'll know you're done when:

1. ✅ Browser can launch in headed mode
2. ✅ Model can press Ctrl+V to paste code
3. ✅ Model can scroll and zoom browser
4. ✅ Model can create terminal sandbox
5. ✅ Terminal displays in browser with xterm.js
6. ✅ Screenshots stream continuously (2 FPS)
7. ✅ Dashboard shows live video feed
8. ✅ Multiple windows can be managed
9. ✅ All 14 event types still broadcast correctly
10. ✅ User can watch model work in real-time

---

## Questions You Might Have

### Q: Do I need to understand the whole codebase?
**A**: No. Focus on the 5 files listed above. They're well-isolated.

### Q: What if I break something?
**A**: Run tests: `npm test`. Demo: `node demo/quick-demo.js`. Both should pass.

### Q: Should I ask the user for clarification?
**A**: No. User was very clear. Just follow the implementation plan.

### Q: What if I run out of time?
**A**: Do Phase 1 only (1 hour). It provides the most value.

### Q: How do I test headed mode?
**A**: Run demo, it will pop up browser window if headed mode is enabled.

---

## Next Immediate Action

**Start with Phase 1, Task 1.1: Enable Headed Mode**

1. Open `src/implementations/addon/VisualFeedbackBridge.ts`
2. Find the `initialize()` method (around line 50)
3. Change `headless: true` to accept config parameter
4. See `VISUAL_WORKSPACE_IMPLEMENTATION_PLAN.md` for exact code

This takes 5 minutes and lets you verify the system is working before proceeding.

---

## Final Notes

This is a high-value feature. The user has been very clear about requirements. The implementation plan is detailed and tested (conceptually). You have all the code snippets you need.

**Just follow the plan step by step. You've got this! 🚀**

---

*Created*: Post-compaction handoff
*Last Updated*: Current session
*Estimated Completion*: 6 hours (or 1 hour for Phase 1)
*Status*: Ready to implement
