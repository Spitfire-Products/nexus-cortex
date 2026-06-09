# xAI Server-Side Tools Integration with Sandbox Toolkit

**Date**: 2025-11-03
**Status**: DESIGN SPECIFICATION
**Priority**: HIGH

---

## Overview

**xAI's server-side tools** (available through Grok models) provide powerful capabilities that can enhance the sandbox toolkit when combined with **ResponsesAPI** for stateful sessions. This document outlines the integration architecture.

---

## What Are xAI Server-Side Tools?

xAI (X.AI) provides server-side execution capabilities with their Grok models:

### Available Server-Side Tools

1. **Web Search** - Real-time web search powered by X/Twitter
2. **Web Scraping** - Extract data from websites
3. **Code Execution** - Server-side code execution environment
4. **File Operations** - Read/write files on server
5. **API Calls** - Make HTTP requests to external APIs
6. **Data Analysis** - Process and analyze data server-side

### Key Advantages

- **Server-side execution** - No client-side sandbox needed for some operations
- **X/Twitter integration** - Access to real-time social data
- **Scalability** - X.AI infrastructure handles heavy lifting
- **State persistence** - Can maintain state across requests

---

## Integration Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    MODEL (Claude)                        │
│                                                          │
│  Main orchestrator - delegates to specialized models     │
└────────────────┬─────────────────────────────────────────┘
                 │
                 ├─────────────────────┬──────────────────┐
                 │                     │                  │
                 ▼                     ▼                  ▼
┌────────────────────────┐  ┌─────────────────┐  ┌──────────────┐
│   LOCAL SANDBOX        │  │  xAI GROK       │  │  OTHER       │
│   (Playwright)         │  │  (Server-Side)  │  │  MODELS      │
│                        │  │                 │  │              │
│  • Visual feedback     │  │  • Web search   │  │  • Vision    │
│  • UI interaction      │  │  • Scraping     │  │  • Computer  │
│  • Hot reload          │  │  • Code exec    │  │  • Reasoning │
└────────────────────────┘  └─────────────────┘  └──────────────┘
```

---

## Use Case 1: Sandbox with Live Data

### Problem

Model creates a dashboard that needs **real-time data** from the web:
- Stock prices
- Twitter sentiment
- News feeds
- API data

### Solution: Hybrid Local + xAI

```typescript
// 1. Model creates local sandbox
const sandboxResult = await createAddonToolEnhanced.execute({
  name: 'stock-dashboard',
  mode: 'dev',
  enableVisualFeedback: true,
  implementation: {
    language: 'javascript',
    code: `
      const express = require('express');
      const app = express();

      // API endpoint that will receive data from xAI
      app.post('/update-data', (req, res) => {
        console.log('Received data from xAI:', req.body);
        // Update dashboard with real-time data
        res.json({ success: true });
      });

      app.listen(3000);
    `
  }
}, signal);

const sandboxId = sandboxResult.metadata.sandboxId;

// 2. Start ResponsesAPI session with xAI
const xaiSession = await responsesAPI.createSession({
  provider: 'xai',
  model: 'grok-beta',
  systemPrompt: `
    You have access to server-side tools and a local sandbox.

    Sandbox URL: http://localhost:3000

    Your task: Fetch real-time stock data and push to sandbox.
  `,
  serverSideTools: ['web_search', 'api_call'],
  context: {
    sandboxId,
    sandboxUrl: 'http://localhost:3000'
  }
});

// 3. xAI model fetches data and pushes to sandbox
await responsesAPI.sendMessage(xaiSession,
  "Search for Tesla stock price and sentiment, then push to sandbox"
);

// xAI executes:
// - web_search: "Tesla stock price"
// - web_search: "Tesla sentiment Twitter"
// - api_call: POST http://localhost:3000/update-data { stock: "TSLA", price: 245.67, sentiment: 0.8 }

// 4. Main model inspects result
const state = await inspectSandbox.execute({ sandboxId }, signal);
// Model sees: Dashboard now shows live Tesla data!
```

### Benefits

- **Real-time data** - xAI fetches live info
- **No API keys needed** - xAI handles external calls
- **Scalable** - Server-side execution for heavy operations
- **Integrated** - Data flows directly to local sandbox

---

## Use Case 2: Code Generation + Validation

### Problem

Model needs to generate code with **external validation**:
- Check against documentation
- Verify API compatibility
- Test with real endpoints

### Solution: xAI for Research, Local for Execution

```typescript
// 1. Main model delegates research to xAI
const researchSession = await responsesAPI.createSession({
  provider: 'xai',
  model: 'grok-beta',
  systemPrompt: `
    Research how to use Stripe API for payment processing.
    Find latest documentation and code examples.
  `,
  serverSideTools: ['web_search', 'web_scrape']
});

const research = await responsesAPI.sendMessage(researchSession,
  "Find Stripe payment intent API documentation and examples"
);

// xAI returns:
// {
//   api_endpoint: "https://api.stripe.com/v1/payment_intents",
//   example_code: "...",
//   authentication: "Bearer sk_test_...",
//   parameters: { ... }
// }

// 2. Main model generates code based on research
const code = generateStripeIntegration(research);

// 3. Create sandbox with generated code
const sandboxResult = await createAddonToolEnhanced.execute({
  name: 'payment-processor',
  implementation: {
    language: 'javascript',
    code,
    dependencies: ['express', 'stripe']
  }
}, signal);

// 4. xAI validates with real API
const validationSession = await responsesAPI.createSession({
  provider: 'xai',
  model: 'grok-beta',
  systemPrompt: `
    Test the payment API endpoint.
    Sandbox URL: http://localhost:3000
  `,
  serverSideTools: ['api_call']
});

await responsesAPI.sendMessage(validationSession,
  "Test the /create-payment endpoint with Stripe test key"
);

// xAI makes real API call to sandbox
// Reports back: "Payment intent created successfully"

// 5. Main model verifies
const state = await inspectSandbox.execute({
  sandboxId: sandboxResult.metadata.sandboxId
}, signal);
```

### Benefits

- **Accurate documentation** - xAI finds latest info
- **Real validation** - Server-side API testing
- **No mock data** - Test with real endpoints
- **Comprehensive** - Research → Generate → Test → Verify

---

## Use Case 3: Multi-Sandbox Orchestration

### Problem

User wants to build a **microservices architecture**:
- Auth service (local sandbox 1)
- API gateway (local sandbox 2)
- Database service (xAI server-side)
- Frontend (local sandbox 3)

### Solution: xAI Coordinates Multiple Sandboxes

```typescript
// 1. Create multiple local sandboxes
const authSandbox = await createAddonToolEnhanced.execute({
  name: 'auth-service',
  implementation: { /* ... */ }
}, signal);

const apiSandbox = await createAddonToolEnhanced.execute({
  name: 'api-gateway',
  implementation: { /* ... */ }
}, signal);

const frontendSandbox = await createAddonToolEnhanced.execute({
  name: 'frontend',
  implementation: { /* ... */ }
}, signal);

// 2. xAI coordinates and manages data flow
const orchestratorSession = await responsesAPI.createSession({
  provider: 'xai',
  model: 'grok-beta',
  systemPrompt: `
    You are orchestrating a microservices architecture.

    Services:
    - Auth: http://localhost:3001
    - API: http://localhost:3002
    - Frontend: http://localhost:3000

    You have a server-side database. Coordinate data flow.
  `,
  serverSideTools: ['api_call', 'code_execution', 'file_operations'],
  context: {
    authSandboxId: authSandbox.metadata.sandboxId,
    apiSandboxId: apiSandbox.metadata.sandboxId,
    frontendSandboxId: frontendSandbox.metadata.sandboxId
  }
});

// 3. xAI manages inter-service communication
await responsesAPI.sendMessage(orchestratorSession, `
  1. Create user in database
  2. Call auth service to generate token
  3. Call API to create resource
  4. Update frontend with result
`);

// xAI executes:
// - code_execution: Create user in server-side DB
// - api_call: POST http://localhost:3001/auth/token
// - api_call: POST http://localhost:3002/api/resources (with token)
// - api_call: POST http://localhost:3000/update (with data)

// 4. Main model verifies end-to-end
const frontendState = await inspectSandbox.execute({
  sandboxId: frontendSandbox.metadata.sandboxId
}, signal);
// Model sees: "User created, resource saved, frontend updated!"
```

### Benefits

- **Centralized coordination** - xAI manages orchestration
- **Persistent state** - Server-side database
- **Complex flows** - Multi-step, multi-service interactions
- **Scalable** - xAI handles heavy lifting

---

## Use Case 4: Real-Time Data Pipeline

### Problem

Dashboard needs **continuous data updates**:
- Twitter sentiment every 30s
- Stock prices every 1min
- News feed every 5min

### Solution: xAI + ResponsesAPI Stateful Session

```typescript
// 1. Create dashboard sandbox
const dashboardResult = await createAddonToolEnhanced.execute({
  name: 'realtime-dashboard',
  mode: 'persistent',
  enableVisualFeedback: true,
  implementation: {
    language: 'javascript',
    code: `
      const express = require('express');
      const socketio = require('socket.io');

      const app = express();
      const server = require('http').createServer(app);
      const io = socketio(server);

      // Expose endpoint for xAI to push updates
      app.post('/push-update', (req, res) => {
        io.emit('data-update', req.body);
        res.json({ received: true });
      });

      server.listen(3000);
    `
  }
}, signal);

// 2. Start stateful xAI session
const dataSession = await responsesAPI.createSession({
  provider: 'xai',
  model: 'grok-beta',
  systemPrompt: `
    You are a real-time data provider.

    Every 30s: Fetch Twitter sentiment for Tesla
    Every 1min: Fetch Tesla stock price
    Every 5min: Fetch Tesla news

    Push updates to: http://localhost:3000/push-update

    Continue indefinitely until told to stop.
  `,
  serverSideTools: ['web_search', 'api_call'],
  stateful: true  // CRITICAL: Maintain state
});

// 3. Start continuous data flow
await responsesAPI.sendMessage(dataSession, "Start data pipeline");

// xAI continuously executes (in background):
// - Every 30s: web_search → api_call (POST /push-update)
// - Every 1min: web_search → api_call (POST /push-update)
// - Every 5min: web_search → api_call (POST /push-update)

// 4. Main model monitors periodically
setInterval(async () => {
  const state = await inspectSandbox.execute({
    sandboxId: dashboardResult.metadata.sandboxId
  }, signal);

  console.log('Dashboard state:', state.metadata.visualSnapshot.console);
}, 60000); // Check every minute

// 5. Stop when done
await responsesAPI.sendMessage(dataSession, "Stop data pipeline");
```

### Benefits

- **Continuous updates** - xAI runs in background
- **Stateful** - Maintains connection and context
- **Scalable** - Server-side handles scheduling
- **Real-time** - Data flows immediately to sandbox

---

## ResponsesAPI + xAI Integration Pattern

### Architecture

```typescript
interface ResponsesAPIxAIAdapter {
  // Create stateful session with xAI
  createxAISession(config: {
    sandboxId: string;
    sandboxUrl: string;
    serverSideTools: string[];
    mode: 'one-shot' | 'continuous' | 'interactive';
  }): Promise<string>;

  // Send message to xAI in context of sandbox
  sendMessage(
    sessionId: string,
    message: string,
    options?: {
      allowToolCalls: boolean;
      returnFormat: 'json' | 'text';
      timeout: number;
    }
  ): Promise<any>;

  // xAI pushes update to sandbox
  pushToSandbox(
    sandboxId: string,
    data: any
  ): Promise<void>;

  // xAI pulls data from sandbox
  pullFromSandbox(
    sandboxId: string,
    endpoint: string
  ): Promise<any>;

  // Close session
  closeSession(sessionId: string): Promise<void>;
}
```

### Implementation Outline

```typescript
// packages/core/src/adapters/ResponsesAPIxAIAdapter.ts

export class ResponsesAPIxAIAdapter {
  private responsesAPI: ResponsesAPIAdapter;
  private activeSessions: Map<string, {
    xaiSessionId: string;
    sandboxId: string;
    sandboxUrl: string;
  }>;

  async createxAISession(config: {
    sandboxId: string;
    sandboxUrl: string;
    serverSideTools: string[];
    mode: 'one-shot' | 'continuous' | 'interactive';
  }): Promise<string> {
    // Create ResponsesAPI session with xAI provider
    const sessionId = await this.responsesAPI.createSession({
      provider: 'xai',
      model: 'grok-beta',
      systemPrompt: `
        You have access to a local sandbox and server-side tools.

        Sandbox ID: ${config.sandboxId}
        Sandbox URL: ${config.sandboxUrl}
        Mode: ${config.mode}

        Available tools: ${config.serverSideTools.join(', ')}

        ${config.mode === 'continuous'
          ? 'Run continuously in background until stopped.'
          : 'Execute tasks as requested.'}
      `,
      tools: config.serverSideTools,
      stateful: config.mode !== 'one-shot'
    });

    // Register session
    this.activeSessions.set(sessionId, {
      xaiSessionId: sessionId,
      sandboxId: config.sandboxId,
      sandboxUrl: config.sandboxUrl
    });

    return sessionId;
  }

  async pushToSandbox(sandboxId: string, data: any): Promise<void> {
    const session = this.findSessionBySandboxId(sandboxId);
    if (!session) {
      throw new Error(`No xAI session for sandbox: ${sandboxId}`);
    }

    // xAI makes API call to sandbox
    await this.responsesAPI.sendMessage(session.xaiSessionId, `
      Push this data to sandbox: ${JSON.stringify(data)}

      POST ${session.sandboxUrl}/push-update
      Body: ${JSON.stringify(data)}
    `);
  }

  async pullFromSandbox(sandboxId: string, endpoint: string): Promise<any> {
    const session = this.findSessionBySandboxId(sandboxId);
    if (!session) {
      throw new Error(`No xAI session for sandbox: ${sandboxId}`);
    }

    // xAI makes API call to sandbox and returns data
    const response = await this.responsesAPI.sendMessage(session.xaiSessionId, `
      Get data from sandbox endpoint: ${endpoint}

      GET ${session.sandboxUrl}${endpoint}

      Return the response data as JSON.
    `);

    return JSON.parse(response.content);
  }

  private findSessionBySandboxId(sandboxId: string) {
    for (const [_, session] of this.activeSessions) {
      if (session.sandboxId === sandboxId) {
        return session;
      }
    }
    return null;
  }
}
```

---

## Advantages of xAI + Sandbox Integration

### 1. **Offload Heavy Operations**
- Web scraping → xAI server-side
- Data processing → xAI code execution
- External API calls → xAI handles

### 2. **Real-Time Data**
- X/Twitter integration for social data
- Live web search
- Continuous monitoring

### 3. **Stateful Sessions**
- xAI maintains context across requests
- Background execution
- Event-driven updates

### 4. **Scalability**
- X.AI infrastructure handles load
- Multiple parallel sessions
- No local resource limits

### 5. **Coordination**
- Orchestrate multiple sandboxes
- Manage data flow between services
- Centralized state management

---

## Implementation Priority

### Phase 1: Basic Integration (2-3 hours)
- ✅ Create ResponsesAPIxAIAdapter class
- ✅ Implement createxAISession, sendMessage
- ✅ Test basic push/pull to sandbox
- ✅ Document usage patterns

### Phase 2: Continuous Mode (3-4 hours)
- ⬜ Implement background execution
- ⬜ Add webhook support for xAI → sandbox
- ⬜ Implement event streaming
- ⬜ Add session monitoring

### Phase 3: Multi-Sandbox Orchestration (4-6 hours)
- ⬜ Implement multi-sandbox coordination
- ⬜ Add service mesh capabilities
- ⬜ Implement data routing
- ⬜ Add load balancing

---

## Example: Complete Workflow

```typescript
// 1. User requests: "Build a Tesla sentiment dashboard"

// 2. Main model creates sandbox
const dashboard = await createAddonToolEnhanced.execute({
  name: 'tesla-sentiment',
  enableVisualFeedback: true,
  mode: 'persistent'
}, signal);

// 3. Main model starts xAI continuous data session
const xaiAdapter = new ResponsesAPIxAIAdapter();
const xaiSession = await xaiAdapter.createxAISession({
  sandboxId: dashboard.metadata.sandboxId,
  sandboxUrl: 'http://localhost:3000',
  serverSideTools: ['web_search', 'api_call'],
  mode: 'continuous'
});

await xaiAdapter.sendMessage(xaiSession,
  "Fetch Tesla sentiment every 30s from Twitter, push to sandbox"
);

// 4. Main model inspects and iterates
while (!satisfied) {
  const state = await inspectSandbox.execute({
    sandboxId: dashboard.metadata.sandboxId
  }, signal);

  if (needsImprovement) {
    await modifySandbox.execute({
      sandboxId: dashboard.metadata.sandboxId,
      file: 'index.js',
      content: improvedCode
    }, signal);
  }

  await sleep(60000); // Check every minute
}

// 5. Done!
await xaiAdapter.closeSession(xaiSession);
await stopSandbox.execute({
  sandboxId: dashboard.metadata.sandboxId
}, signal);
```

---

## Status

**Design**: Complete
**Implementation**: Ready to build
**Priority**: HIGH (adds significant value)
**Est. Time**: 8-12 hours for full implementation

---

**This integration transforms the sandbox toolkit into a HYBRID system:**
- **Local sandboxes** for UI/visual programming
- **xAI server-side** for data, APIs, coordination
- **ResponsesAPI** for stateful orchestration

**The model becomes a DISTRIBUTED SYSTEMS ARCHITECT!** 🚀
