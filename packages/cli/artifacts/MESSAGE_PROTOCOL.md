# Artifact System Message Protocol Specification

## Overview

The message protocol enables bidirectional communication between the CLI, artifacts, and server using a structured JSON-based format over TCP sockets.

## Message Flow Architecture

```
┌──────────┐     ┌──────────────┐     ┌───────────┐     ┌──────────┐
│   CLI    │────▶│Message Bridge│────▶│  Artifact │────▶│  Server  │
│ (Client) │◀────│   (Router)   │◀────│ (Process) │◀────│   (SSE)  │
└──────────┘     └──────────────┘     └───────────┘     └──────────┘
      ↑                 │                     │                ↓
      └─────────────────┴─────────────────────┴────────────────┘
                        Event Loop
```

## Message Structure

### Base Message Format

```json
{
  "id": "msg-uuid-v4",
  "artifactId": "artifact-uuid-v4",
  "type": "data_update",
  "source": "cli",
  "target": "artifact",
  "timestamp": 1700000000000,
  "payload": {
    // Type-specific payload
  },
  "metadata": {
    "version": "1.0.0",
    "priority": "normal",
    "requiresAck": false,
    "timeout": 5000,
    "correlationId": "parent-msg-id"
  }
}
```

## Message Types and Payloads

### 1. Lifecycle Messages

#### CREATE
```json
{
  "type": "create",
  "payload": {
    "definition": {
      "type": "dashboard",
      "title": "System Metrics",
      "data": {},
      "layout": {
        "position": "right",
        "size": "40%"
      }
    }
  }
}
```

#### MOUNT
```json
{
  "type": "mount",
  "payload": {
    "paneId": "tmux-pane-123",
    "processId": 12345,
    "port": 9876
  }
}
```

#### READY
```json
{
  "type": "ready",
  "payload": {
    "capabilities": ["interaction", "realtime", "commands"],
    "version": "1.0.0",
    "componentInfo": {
      "name": "DashboardComponent",
      "props": ["data", "theme", "interactive"]
    }
  }
}
```

#### DESTROY
```json
{
  "type": "destroy",
  "payload": {
    "reason": "user_request",
    "cleanup": true
  }
}
```

### 2. Data Messages

#### DATA_UPDATE
```json
{
  "type": "data_update",
  "payload": {
    "path": "metrics.cpu",    // JSONPath for partial updates
    "value": {
      "usage": 45.2,
      "cores": 8,
      "processes": 234
    },
    "operation": "merge"      // merge | replace | append | remove
  }
}
```

#### DATA_REQUEST
```json
{
  "type": "data_request",
  "payload": {
    "query": {
      "path": "metrics.memory",
      "filter": {
        "timeRange": "1h"
      }
    },
    "options": {
      "cache": false,
      "format": "json"
    }
  }
}
```

#### DATA_RESPONSE
```json
{
  "type": "data_response",
  "payload": {
    "data": {
      "memory": {
        "used": 8192,
        "total": 16384,
        "free": 8192
      }
    },
    "metadata": {
      "source": "system",
      "timestamp": 1700000000000,
      "cached": false
    }
  },
  "metadata": {
    "correlationId": "request-msg-id"
  }
}
```

### 3. State Messages

#### STATE_CHANGE
```json
{
  "type": "state_change",
  "payload": {
    "previousState": "ready",
    "currentState": "updating",
    "reason": "data_refresh",
    "metadata": {
      "triggeredBy": "auto_refresh",
      "duration": 5000
    }
  }
}
```

### 4. Interaction Messages

#### USER_INPUT
```json
{
  "type": "user_input",
  "payload": {
    "inputType": "keyboard",
    "key": "enter",
    "value": "submit",
    "modifiers": {
      "ctrl": false,
      "alt": false,
      "shift": false
    },
    "context": {
      "selectedItem": 2,
      "formData": {}
    }
  }
}
```

#### COMMAND
```json
{
  "type": "command",
  "payload": {
    "command": "refresh",
    "args": ["--force", "--cache=false"],
    "options": {
      "timeout": 10000,
      "background": false
    }
  }
}
```

#### ACTION
```json
{
  "type": "action",
  "payload": {
    "action": "submit_form",
    "data": {
      "field1": "value1",
      "field2": "value2"
    },
    "validation": {
      "passed": true,
      "errors": []
    }
  }
}
```

### 5. Control Messages

#### RESIZE
```json
{
  "type": "resize",
  "payload": {
    "dimensions": {
      "width": 80,
      "height": 24,
      "cols": 80,
      "rows": 24
    },
    "trigger": "manual"
  }
}
```

#### FOCUS/BLUR
```json
{
  "type": "focus",
  "payload": {
    "hasFocus": true,
    "triggeredBy": "user_click",
    "previousFocus": "artifact-456"
  }
}
```

#### REFRESH
```json
{
  "type": "refresh",
  "payload": {
    "scope": "all",           // all | data | ui | specific
    "force": true,
    "components": ["header", "metrics"]
  }
}
```

### 6. Communication Messages

#### SUBSCRIBE
```json
{
  "type": "subscribe",
  "payload": {
    "topics": ["metrics", "alerts", "logs"],
    "filters": {
      "severity": ["error", "warning"],
      "source": ["api", "database"]
    },
    "options": {
      "batching": true,
      "interval": 1000
    }
  }
}
```

#### BROADCAST
```json
{
  "type": "broadcast",
  "payload": {
    "channel": "notifications",
    "message": {
      "type": "alert",
      "level": "warning",
      "text": "High memory usage detected"
    },
    "recipients": ["all"]     // all | group | specific IDs
  }
}
```

### 7. System Messages

#### HEARTBEAT
```json
{
  "type": "heartbeat",
  "payload": {
    "status": "alive",
    "uptime": 3600000,
    "statistics": {
      "messagesProcessed": 1234,
      "errors": 2,
      "avgResponseTime": 45
    }
  }
}
```

#### ERROR
```json
{
  "type": "error",
  "payload": {
    "code": "COMPONENT_ERROR",
    "message": "Failed to render component",
    "details": {
      "component": "MetricsChart",
      "error": "Invalid data format",
      "stack": "Error: Invalid data format\n  at MetricsChart.render..."
    },
    "recovery": {
      "action": "retry",
      "attempts": 3,
      "delay": 1000
    }
  }
}
```

#### METRICS
```json
{
  "type": "metrics",
  "payload": {
    "performance": {
      "renderTime": 45,
      "updateTime": 12,
      "messageLatency": 3
    },
    "resources": {
      "cpuUsage": 12.5,
      "memoryUsage": 256,
      "messageQueueSize": 5
    }
  }
}
```

## Message Exchange Patterns

### 1. Request-Response
```javascript
// Client sends request
{
  "id": "req-123",
  "type": "data_request",
  "requiresAck": true,
  "timeout": 5000
}

// Server sends response
{
  "id": "res-456",
  "type": "data_response",
  "metadata": {
    "correlationId": "req-123"
  }
}
```

### 2. Fire-and-Forget
```javascript
// Client sends message without expecting response
{
  "id": "msg-789",
  "type": "log",
  "requiresAck": false
}
```

### 3. Pub-Sub
```javascript
// Subscribe to topics
{
  "type": "subscribe",
  "payload": {
    "topics": ["metrics"]
  }
}

// Receive published messages
{
  "type": "data_update",
  "metadata": {
    "topic": "metrics"
  }
}
```

### 4. Streaming
```javascript
// Start stream
{
  "type": "stream_start",
  "payload": {
    "streamId": "logs-123",
    "source": "application.log"
  }
}

// Stream data chunks
{
  "type": "stream_data",
  "payload": {
    "streamId": "logs-123",
    "chunk": "log data...",
    "sequence": 1
  }
}

// End stream
{
  "type": "stream_end",
  "payload": {
    "streamId": "logs-123",
    "totalChunks": 42
  }
}
```

## Message Priority and QoS

### Priority Levels

| Priority | Use Case | Timeout | Retries |
|----------|----------|---------|---------|
| critical | System errors, shutdowns | 30s | 5 |
| high | User interactions | 10s | 3 |
| normal | Data updates | 5s | 2 |
| low | Metrics, logs | 2s | 0 |

### Quality of Service

```javascript
{
  "metadata": {
    "priority": "high",
    "requiresAck": true,
    "timeout": 10000,
    "maxRetries": 3,
    "retryDelay": 1000,
    "persistent": true,      // Survive reconnects
    "ordered": true          // Maintain order
  }
}
```

## Error Handling

### Error Codes

| Code | Description | Recovery |
|------|-------------|----------|
| CONNECTION_LOST | Lost connection to bridge | Reconnect with backoff |
| ARTIFACT_NOT_FOUND | Target artifact doesn't exist | Remove from registry |
| INVALID_MESSAGE | Message validation failed | Log and discard |
| TIMEOUT | Message timeout | Retry or fail |
| RATE_LIMIT | Rate limit exceeded | Backoff and retry |
| PERMISSION_DENIED | Insufficient permissions | Request auth |

### Error Response Format

```json
{
  "type": "error",
  "payload": {
    "code": "INVALID_MESSAGE",
    "message": "Message validation failed",
    "field": "payload.data",
    "expected": "object",
    "received": "string",
    "originalMessage": {
      "id": "msg-123"
    }
  }
}
```

## Security Considerations

### Message Validation

```javascript
// Validation schema using Joi
const messageSchema = Joi.object({
  id: Joi.string().uuid().required(),
  artifactId: Joi.string().uuid().required(),
  type: Joi.string().valid(...MessageTypes).required(),
  source: Joi.string().required(),
  target: Joi.string(),
  timestamp: Joi.number().positive().required(),
  payload: Joi.any().required(),
  metadata: Joi.object({
    version: Joi.string(),
    priority: Joi.string().valid('low', 'normal', 'high', 'critical'),
    requiresAck: Joi.boolean(),
    timeout: Joi.number().positive().max(60000),
    correlationId: Joi.string().uuid()
  })
});
```

### Message Signing

```javascript
// Optional message signing for sensitive operations
{
  "metadata": {
    "signature": "sha256-hash-of-message",
    "signedBy": "cli-key-id",
    "algorithm": "RS256"
  }
}
```

### Rate Limiting

```javascript
// Rate limit configuration
{
  "rateLimits": {
    "perArtifact": {
      "messages": 100,       // per second
      "updates": 10,         // per second
      "commands": 5          // per second
    },
    "global": {
      "messages": 1000,      // per second
      "connections": 100     // max concurrent
    }
  }
}
```

## Implementation Examples

### Bridge Server
```javascript
class MessageBridgeServer {
  constructor() {
    this.server = net.createServer();
    this.clients = new Map();
    this.artifacts = new Map();
  }

  start(port = 9876) {
    this.server.listen(port, () => {
      console.log(`Message bridge listening on port ${port}`);
    });

    this.server.on('connection', (socket) => {
      this.handleNewConnection(socket);
    });
  }

  handleNewConnection(socket) {
    const clientId = uuid();

    socket.on('data', (data) => {
      const messages = this.parseMessages(data);
      messages.forEach(msg => this.routeMessage(msg, clientId));
    });

    this.clients.set(clientId, socket);
  }

  routeMessage(message, senderId) {
    // Validate message
    const { error, value } = messageSchema.validate(message);
    if (error) {
      this.sendError(senderId, error);
      return;
    }

    // Route based on target
    if (message.target === 'all') {
      this.broadcast(message, senderId);
    } else if (message.artifactId) {
      this.sendToArtifact(message.artifactId, message);
    }
  }
}
```

### Artifact Client
```javascript
class ArtifactClient {
  constructor(artifactId) {
    this.artifactId = artifactId;
    this.socket = null;
    this.messageQueue = [];
  }

  connect(port) {
    this.socket = net.connect(port, 'localhost');

    this.socket.on('connect', () => {
      this.register();
      this.flushQueue();
    });

    this.socket.on('data', (data) => {
      const messages = this.parseMessages(data);
      messages.forEach(msg => this.handleMessage(msg));
    });
  }

  send(type, payload) {
    const message = {
      id: uuid(),
      artifactId: this.artifactId,
      type,
      source: 'artifact',
      timestamp: Date.now(),
      payload
    };

    if (this.socket?.writable) {
      this.socket.write(JSON.stringify(message) + '\n');
    } else {
      this.messageQueue.push(message);
    }
  }

  handleMessage(message) {
    switch(message.type) {
      case 'data_update':
        this.updateData(message.payload);
        break;
      case 'command':
        this.executeCommand(message.payload);
        break;
      case 'destroy':
        this.cleanup();
        break;
    }
  }
}
```

## Testing the Protocol

### Test Client
```javascript
// test/protocol-test.js
const net = require('net');

function testProtocol() {
  const client = net.connect(9876, 'localhost');

  // Test lifecycle
  client.write(JSON.stringify({
    id: 'test-1',
    artifactId: 'artifact-test',
    type: 'create',
    source: 'test',
    timestamp: Date.now(),
    payload: {
      type: 'dashboard',
      title: 'Test Dashboard'
    }
  }) + '\n');

  // Test data update
  setTimeout(() => {
    client.write(JSON.stringify({
      id: 'test-2',
      artifactId: 'artifact-test',
      type: 'data_update',
      source: 'test',
      timestamp: Date.now(),
      payload: {
        metrics: { cpu: 45 }
      }
    }) + '\n');
  }, 1000);

  client.on('data', (data) => {
    console.log('Received:', data.toString());
  });
}

testProtocol();
```

## Protocol Versioning

### Version Negotiation
```json
{
  "type": "handshake",
  "payload": {
    "clientVersion": "1.0.0",
    "supportedVersions": ["1.0.0", "0.9.0"],
    "features": ["streaming", "compression", "encryption"]
  }
}
```

### Version Response
```json
{
  "type": "handshake_ack",
  "payload": {
    "serverVersion": "1.0.0",
    "agreedVersion": "1.0.0",
    "enabledFeatures": ["streaming"]
  }
}
```

## Performance Considerations

1. **Message Batching**: Group multiple updates into single message
2. **Compression**: Enable for large payloads (>1KB)
3. **Connection Pooling**: Reuse connections for multiple artifacts
4. **Binary Protocol**: Consider MessagePack for high-frequency updates
5. **Buffering**: Buffer messages during network issues

## Monitoring and Debugging

### Debug Messages
```json
{
  "type": "debug",
  "payload": {
    "level": "verbose",
    "category": "routing",
    "message": "Message routed to artifact-123",
    "context": {
      "messageId": "msg-456",
      "latency": 3
    }
  }
}
```

### Protocol Analyzer
```bash
# Capture all messages
tcpdump -i lo -A port 9876 | grep -E '"type":|"artifactId":'

# Monitor with jq
nc localhost 9876 | jq '.type, .payload'
```