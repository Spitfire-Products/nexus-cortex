# Auto-Approve Actions API Documentation

## Overview

The Auto-Approve Actions feature provides runtime control over graylist tool approval in Nexus Cortex. This allows clients to toggle whether graylist tools (Write, Edit, Bash) require explicit approval or execute automatically.

**Feature Status**: ✅ Production-ready (tested with 4/4 E2E tests passing)

---

## API Endpoints

### GET /v1/approval-mode

Get the current auto-approve actions setting.

**Request**:
```http
GET /v1/approval-mode HTTP/1.1
Host: localhost:4000
```

**Response** (200 OK):
```json
{
  "autoApproveActions": false,
  "yoloMode": false,
  "context": "Auto-approve OFF - graylist tools require prompt"
}
```

**Fields**:
- `autoApproveActions` (boolean) - Current auto-approve setting
  - `true`: Graylist tools auto-approved
  - `false`: Graylist tools require approval
- `yoloMode` (boolean) - Whether YOLO mode is enabled
  - `true`: All tools bypass permissions (YOLO=true environment)
  - `false`: Normal permission checks
- `context` (string) - Human-readable description of current mode

**Error Responses**:

503 Service Unavailable - Orchestrator not initialized:
```json
{
  "error": {
    "message": "Orchestrator not initialized",
    "type": "service_unavailable"
  }
}
```

---

### POST /v1/approval-mode

Toggle the auto-approve actions setting.

**Request**:
```http
POST /v1/approval-mode HTTP/1.1
Host: localhost:4000
Content-Type: application/json

{
  "autoApproveActions": true
}
```

**Parameters**:
- `autoApproveActions` (boolean, required) - New auto-approve setting
  - `true`: Enable auto-approve for graylist tools
  - `false`: Disable auto-approve (prompt for approval)

**Response** (200 OK):
```json
{
  "success": true,
  "autoApproveActions": true,
  "message": "Auto-approve actions enabled"
}
```

**Error Responses**:

400 Bad Request - Invalid input:
```json
{
  "error": {
    "message": "autoApproveActions must be boolean",
    "type": "invalid_request"
  }
}
```

400 Bad Request - YOLO mode active:
```json
{
  "error": {
    "message": "Cannot toggle approval mode in YOLO mode",
    "type": "invalid_request"
  }
}
```

503 Service Unavailable - Orchestrator not initialized:
```json
{
  "error": {
    "message": "Orchestrator not initialized",
    "type": "service_unavailable"
  }
}
```

---

## Usage Examples

### cURL Examples

**Get current approval mode:**
```bash
curl -X GET http://localhost:4000/v1/approval-mode
```

**Enable auto-approve:**
```bash
curl -X POST http://localhost:4000/v1/approval-mode \
  -H "Content-Type: application/json" \
  -d '{"autoApproveActions": true}'
```

**Disable auto-approve:**
```bash
curl -X POST http://localhost:4000/v1/approval-mode \
  -H "Content-Type: application/json" \
  -d '{"autoApproveActions": false}'
```

---

### JavaScript/TypeScript Examples

```typescript
// Fetch current approval mode
async function getApprovalMode() {
  const response = await fetch('http://localhost:4000/v1/approval-mode');
  const data = await response.json();
  return data;
}

// Enable auto-approve
async function enableAutoApprove() {
  const response = await fetch('http://localhost:4000/v1/approval-mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ autoApproveActions: true })
  });
  return await response.json();
}

// Disable auto-approve
async function disableAutoApprove() {
  const response = await fetch('http://localhost:4000/v1/approval-mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ autoApproveActions: false })
  });
  return await response.json();
}

// Example usage
const mode = await getApprovalMode();
console.log(`Auto-approve: ${mode.autoApproveActions ? 'ON' : 'OFF'}`);

if (!mode.autoApproveActions) {
  await enableAutoApprove();
  console.log('Auto-approve enabled');
}
```

---

### Python Example

```python
import requests

BASE_URL = 'http://localhost:4000'

# Get current approval mode
response = requests.get(f'{BASE_URL}/v1/approval-mode')
mode = response.json()
print(f"Auto-approve: {'ON' if mode['autoApproveActions'] else 'OFF'}")

# Enable auto-approve
response = requests.post(
    f'{BASE_URL}/v1/approval-mode',
    json={'autoApproveActions': True}
)
result = response.json()
print(result['message'])

# Disable auto-approve
response = requests.post(
    f'{BASE_URL}/v1/approval-mode',
    json={'autoApproveActions': False}
)
result = response.json()
print(result['message'])
```

---

## Integration Guide

### Client Integration Pattern

```typescript
class CortexClient {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:4000') {
    this.baseUrl = baseUrl;
  }

  // Get approval mode
  async getApprovalMode() {
    const response = await fetch(`${this.baseUrl}/v1/approval-mode`);
    if (!response.ok) {
      throw new Error(`Failed to get approval mode: ${response.statusText}`);
    }
    return await response.json();
  }

  // Set approval mode
  async setApprovalMode(autoApprove: boolean) {
    const response = await fetch(`${this.baseUrl}/v1/approval-mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoApproveActions: autoApprove })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error.message);
    }

    return await response.json();
  }

  // Toggle approval mode
  async toggleApprovalMode() {
    const current = await this.getApprovalMode();
    return await this.setApprovalMode(!current.autoApproveActions);
  }
}

// Usage
const client = new CortexClient();

// Check current mode
const mode = await client.getApprovalMode();
console.log(`Current mode: ${mode.autoApproveActions ? 'Auto' : 'Manual'}`);

// Enable auto-approve for batch operations
await client.setApprovalMode(true);
// ... perform operations ...
await client.setApprovalMode(false); // Restore manual approval
```

---

## Behavior Details

### Default Behavior by Context

**Interactive Sessions** (Terminal UI):
- Auto-approve: **OFF** (safe default for human users)
- User can toggle ON/OFF during session
- Blacklist tools always prompt

**Non-Interactive/Piped Commands**:
- Auto-approve: **ON** (automation-friendly)
- Graylist tools execute without prompts
- Blacklist tools timeout/deny if no approval handler

**YOLO Mode** (Environment: `YOLO=true`):
- Auto-approve: **N/A** (all checks bypassed)
- All tools execute without prompts
- API endpoint returns error if toggled

### Tool Behavior by Tier

**Whitelist Tools** (Always Execute):
- Read, Grep, Glob, BashOutput
- Auto-approve setting: **No effect**
- Behavior: Execute immediately

**Graylist Tools** (Conditional):
- Write, Edit, NotebookEdit, Bash (safe)
- Auto-approve ON: Execute without prompt
- Auto-approve OFF: Prompt for approval

**Blacklist Tools** (Always Prompt):
- Bash (dangerous), system file access
- Auto-approve setting: **No effect** (always prompt)
- Exception: YOLO mode bypasses

---

## Testing

### Manual Testing with cURL

```bash
# Start server with YOLO=false for testing
./scripts/test-server.sh

# Test 1: Get initial mode
curl -s http://localhost:4000/v1/approval-mode | python3 -m json.tool

# Test 2: Enable auto-approve
curl -s -X POST http://localhost:4000/v1/approval-mode \
  -H "Content-Type: application/json" \
  -d '{"autoApproveActions": true}' | python3 -m json.tool

# Test 3: Test graylist tool (should auto-approve)
curl -s -X POST http://localhost:4000/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.0-flash",
    "messages": [{
      "role": "user",
      "content": "Use the Write tool to create /tmp/test.txt"
    }]
  }' | python3 -m json.tool

# Test 4: Disable auto-approve
curl -s -X POST http://localhost:4000/v1/approval-mode \
  -H "Content-Type: application/json" \
  -d '{"autoApproveActions": false}' | python3 -m json.tool

# Test 5: Test graylist tool (should prompt and timeout)
curl -s -X POST http://localhost:4000/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.0-flash",
    "messages": [{
      "role": "user",
      "content": "Use the Write tool to create /tmp/test2.txt"
    }]
  }' | python3 -m json.tool
```

### Automated Testing

See `E2E_TEST_RESULTS.md` for complete test results.

**Test Coverage**: 4/4 tests passed (100%)
- ✅ Whitelist (Read) - Always allowed
- ✅ Graylist + Auto-approve ON - Auto-approved
- ✅ Graylist + Auto-approve OFF - Prompted correctly
- ✅ Blacklist (rm -rf) - Prompted despite auto-approve ON

---

## Security Considerations

### YOLO Mode Protection

The API prevents toggling approval mode when `YOLO=true`:

```json
{
  "error": {
    "message": "Cannot toggle approval mode in YOLO mode",
    "type": "invalid_request"
  }
}
```

**Rationale**: YOLO mode bypasses all permission checks. Allowing toggles would create confusion about actual behavior.

### Blacklist Override Protection

Blacklist tools ALWAYS require approval regardless of auto-approve setting:

```
Auto-approve: ON
Tool: Bash (rm -rf /tmp/test)
Result: PROMPTS for approval ✅
```

This prevents accidental destructive operations even when auto-approve is enabled.

### Context-Aware Defaults

Interactive sessions default to auto-approve OFF for safety:
- Terminal UI: User explicitly enables auto-approve
- Non-interactive: Auto-approve ON for automation

---

## Error Handling

### Common Errors

**1. Orchestrator Not Initialized**
```json
{
  "error": {
    "message": "Orchestrator not initialized",
    "type": "service_unavailable"
  }
}
```
**Solution**: Wait for server startup to complete

**2. Invalid Input Type**
```json
{
  "error": {
    "message": "autoApproveActions must be boolean",
    "type": "invalid_request"
  }
}
```
**Solution**: Ensure `autoApproveActions` is `true` or `false` (not string)

**3. YOLO Mode Active**
```json
{
  "error": {
    "message": "Cannot toggle approval mode in YOLO mode",
    "type": "invalid_request"
  }
}
```
**Solution**: Restart server without `YOLO=true`

---

## Related Documentation

- `README.md` - Permissions system overview
- `E2E_TEST_RESULTS.md` - Complete test results
- `TESTING_AUTO_APPROVE_ACTIONS.md` - Testing guide
- `packages/server/src/routes/approval.ts` - API implementation

---

## Version History

**v4.0.0** (2025-11-13)
- Initial implementation of auto-approve actions feature
- Three-tier security model (whitelist/graylist/blacklist)
- Runtime toggle via API endpoints
- Context-aware defaults
- Critical bug fix: Permission middleware initialization

---

## Support

For issues or questions:
1. Check `E2E_TEST_RESULTS.md` for verified behaviors
2. Review test examples in this document
3. Check server logs with `DEBUG=true`
4. Verify YOLO mode is not enabled
5. Ensure orchestrator is initialized
