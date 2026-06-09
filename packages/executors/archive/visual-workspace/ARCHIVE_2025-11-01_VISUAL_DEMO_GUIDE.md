# Visual Demo Guide - Real-Time Viewing System

## What Just Happened

The demo you saw created a **real-time event broadcasting system** and simulated a sandbox with 13 different events. All these events are now stored in memory and available through:

1. **View Server** running on `http://localhost:4001`
2. **WebSocket connections** ready to stream live updates
3. **Event history** stored for the sandbox `demo-sandbox-123`

---

## What You Would See in Your Browser

### 1. Multi-Sandbox Dashboard (`http://localhost:4001/`)

```
┌─────────────────────────────────────────────────────────────┐
│                                                               │
│  📦 OmniClaude Sandbox Dashboard                            │
│  Real-time monitoring of active sandboxes                    │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  📦 demo-app                                         │   │
│  │  http://localhost:3000                               │   │
│  │                                                       │   │
│  │  ● running    Mode: dev                             │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
│  Click on a sandbox to view details →                       │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### 2. Detailed Sandbox View (`http://localhost:4001/sandbox/demo-sandbox-123`)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  📦 demo-app                                        ● RUNNING                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                    │                                         │
│  ┌──────────────────────────────┐ │  ┌────────────────────────────────┐   │
│  │                              │ │  │  Console  Screenshots  Network  │   │
│  │   [EMBEDDED IFRAME]          │ │  ├────────────────────────────────┤   │
│  │                              │ │  │                                 │   │
│  │   Sandbox UI displays here  │ │  │  [11:14:22] Server starting...  │   │
│  │   (http://localhost:3000)    │ │  │                                 │   │
│  │                              │ │  │  [11:14:23] Installing          │   │
│  │                              │ │  │             dependencies...     │   │
│  │                              │ │  │                                 │   │
│  │                              │ │  │  [11:14:23] ✅ Server running  │   │
│  │                              │ │  │             on port 3000        │   │
│  │                              │ │  │                                 │   │
│  │                              │ │  │  [11:14:24] 🔄 Server reloaded │   │
│  │                              │ │  │                                 │   │
│  │                              │ │  │  💓 Heartbeat 1 - 11:14:27     │   │
│  │                              │ │  │                                 │   │
│  │                              │ │  │  💓 Heartbeat 2 - 11:14:30     │   │
│  │                              │ │  │                                 │   │
│  │                              │ │  │  ↓ Scrollable...                │   │
│  └──────────────────────────────┘ │  └────────────────────────────────┘   │
│                                    │                                         │
│  Left: Live preview of sandbox     │  Right: Real-time console logs         │
│                                    │                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3. Screenshots Tab View

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  📦 demo-app                                        ● RUNNING                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                    │                                         │
│  ┌──────────────────────────────┐ │  ┌────────────────────────────────┐   │
│  │                              │ │  │  Console  Screenshots  Network  │   │
│  │   [EMBEDDED IFRAME]          │ │  ├────────────────────────────────┤   │
│  │                              │ │  │                                 │   │
│  │   Sandbox UI                 │ │  │  ┌──────────────────────────┐ │   │
│  │                              │ │  │  │ [Screenshot Thumbnail]    │ │   │
│  │                              │ │  │  │                           │ │   │
│  │                              │ │  │  │ 11:14:25 PM               │ │   │
│  │                              │ │  │  └──────────────────────────┘ │   │
│  │                              │ │  │                                 │   │
│  │                              │ │  │  ┌──────────────────────────┐ │   │
│  │                              │ │  │  │ [Screenshot Thumbnail]    │ │   │
│  │                              │ │  │  │                           │ │   │
│  │                              │ │  │  │ 11:14:20 PM               │ │   │
│  │                              │ │  │  └──────────────────────────┘ │   │
│  │                              │ │  │                                 │   │
│  │                              │ │  │  ↓ More screenshots...          │   │
│  └──────────────────────────────┘ │  └────────────────────────────────┘   │
│                                    │                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4. Network Tab View

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  📦 demo-app                                        ● RUNNING                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                    │                                         │
│  ┌──────────────────────────────┐ │  ┌────────────────────────────────┐   │
│  │                              │ │  │  Console  Screenshots  Network  │   │
│  │   [EMBEDDED IFRAME]          │ │  ├────────────────────────────────┤   │
│  │                              │ │  │                                 │   │
│  │   Sandbox UI                 │ │  │  GET  /api/users         200   │   │
│  │                              │ │  │                                 │   │
│  │                              │ │  │  POST /api/auth          201   │   │
│  │                              │ │  │                                 │   │
│  │                              │ │  │  GET  /assets/style.css  200   │   │
│  │                              │ │  │                                 │   │
│  │                              │ │  │  ↓ More requests...              │   │
│  │                              │ │  │                                 │   │
│  └──────────────────────────────┘ │  └────────────────────────────────┘   │
│                                    │                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Live Updates Demo Flow

### What You'd See When Code Changes

**1. Before modification:**
```
Console Tab Shows:
  [11:14:23] ✅ Server running on port 3000
  [11:14:27] 💓 Heartbeat 1
```

**2. Model edits code (via ModifySandboxTool):**
```
┌─────────────────────────────────┐
│  🔄 Reloading...                │  ← Notification appears
└─────────────────────────────────┘
```

**3. Console updates in real-time:**
```
Console Tab Shows:
  [11:14:23] ✅ Server running on port 3000
  [11:14:27] 💓 Heartbeat 1
  [11:15:01] 🔄 File changed, reloading...  ← NEW
  [11:15:02] ✅ Server reloaded              ← NEW
```

**4. Iframe auto-refreshes (after 1 second)**
- Left panel shows updated UI
- New screenshot appears in Screenshots tab

**5. Notification slides up and disappears**

---

## Live Interaction Demo Flow

### What You'd See When Model Tests UI

**Model calls InteractWithSandboxTool:**
```typescript
{
  actions: [
    { type: 'type', selector: '#username', value: 'alice' },
    { type: 'click', selector: '#submit' }
  ],
  captureAfterEachAction: true
}
```

**You see:**

**1. Console updates:**
```
  [11:16:01] ✅ Action 1: type #username
  [11:16:02] ✅ Action 2: click #submit
```

**2. Screenshots tab gets 2 new images:**
```
┌──────────────────────────┐
│ After typing "alice"     │
│ [Screenshot]             │
│ 11:16:01 PM              │
└──────────────────────────┘

┌──────────────────────────┐
│ After clicking submit    │
│ [Screenshot]             │
│ 11:16:02 PM              │
└──────────────────────────┘
```

**3. Iframe shows the visual result of interactions**

---

## Event Types You'd See

The demo broadcasted **13 events** across **9 different types**:

| Event Type | Count | Visual Indicator |
|------------|-------|------------------|
| `console-log` | 4 | Appears in Console tab |
| `sandbox-created` | 1 | Shows sandbox card |
| `file-changed` | 1 | Triggers reload notification |
| `hot-reload-triggered` | 1 | Shows reload icon |
| `process-restarted` | 1 | Console message |
| `screenshot-captured` | 1 | New image in Screenshots tab |
| `interaction-executed` | 2 | Console log + highlight |
| `network-request` | 1 | Appears in Network tab |
| `network-response` | 1 | Updates Network tab with status |

---

## Color Scheme (Dark Theme)

```
Background:     #0d1117 (Dark gray)
Cards:          #161b22 (Slightly lighter)
Borders:        #30363d (Subtle borders)
Text:           #c9d1d9 (Light gray)
Accent:         #58a6ff (Blue for links/status)
Success:        #3fb950 (Green for success indicators)
Error:          #f85149 (Red for errors)
```

---

## WebSocket Activity

When viewing in browser, the WebSocket connection is **always active**:

```
Browser Console Shows:
> Connected to WebSocket server
> Subscribed to sandbox: demo-sandbox-123
> Received event history: 13 events
> Listening for live events...

[Live] console-log: "💓 Heartbeat 1 - 11:14:27"
[Live] console-log: "💓 Heartbeat 2 - 11:14:30"
[Live] console-log: "💓 Heartbeat 3 - 11:14:33"
```

Every event appears **instantly** (5-20ms latency) in the dashboard!

---

## API Endpoints Available

You can also query the data programmatically:

### Get All Sandboxes
```bash
curl http://localhost:4001/api/sandboxes
```

**Response:**
```json
{
  "sandboxes": [
    {
      "id": "demo-sandbox-123",
      "name": "demo-app",
      "url": "http://localhost:3000",
      "mode": "dev",
      "status": "running",
      "createdAt": "2025-11-03T23:14:22.000Z",
      "lastActivity": "2025-11-03T23:14:27.000Z"
    }
  ]
}
```

### Get Event History
```bash
curl "http://localhost:4001/api/sandbox/demo-sandbox-123/events?limit=5"
```

**Response:**
```json
{
  "events": [
    {
      "type": "console-log",
      "sandboxId": "demo-sandbox-123",
      "timestamp": 1730675662000,
      "data": { "level": "log", "message": "Server starting..." }
    },
    // ... more events
  ]
}
```

---

## Try It Yourself!

### Step 1: Start the Demo
```bash
cd packages/executors
npm run demo
```

### Step 2: Open Your Browser
Navigate to:
```
http://localhost:4001/sandbox/demo-sandbox-123
```

### Step 3: Watch Live Updates
- Console logs appear in real-time
- Heartbeat messages every 3 seconds
- All events are WebSocket-streamed

### Step 4: Explore the API
```bash
# Get sandbox list
curl http://localhost:4001/api/sandboxes | jq

# Get event history
curl http://localhost:4001/api/sandbox/demo-sandbox-123/events | jq

# Check server health
curl http://localhost:4001/health | jq
```

---

## Real-World Usage

In a real scenario with CreateAddonTool:

```typescript
// Model creates a web app
const result = await createAddon({
  name: "my-app",
  implementation: { /* ... */ },
  mode: "dev",
  devConfig: { hotReload: true },
  enableVisualFeedback: true
});

// Output includes:
// **View Dashboard**: http://localhost:4001/sandbox/abc-123

// User opens URL and sees:
// - Live preview of the app
// - Real-time console logs
// - Screenshots as model iterates
// - All interactions visible
```

**Benefits:**
- ✅ **Full transparency** - User sees exactly what AI is building
- ✅ **Real-time feedback** - No refresh needed
- ✅ **Visual confirmation** - Screenshots prove changes worked
- ✅ **Debugging aid** - Console logs help understand issues
- ✅ **Confidence builder** - User trusts the AI more

---

## Summary

The demonstration showed:

1. **View server starts** on port 4001
2. **13 events broadcast** simulating real sandbox operations
3. **Event statistics** showing all events by type
4. **Event history** with timestamps and data
5. **WebSocket ready** to stream live updates to browsers
6. **Heartbeat system** keeping dashboard alive

**All of this happens automatically** when you use the CreateAddonTool with `mode: "dev"` - the user just opens a URL and watches the AI work in real-time! 🎉
