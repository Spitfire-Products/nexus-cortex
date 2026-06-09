# V3 vs V4 Tool Naming Analysis

## V3 Production Approach (omniclaude_v3)

### What V3 Sends to Providers

**OpenAI/XAI** (`OpenAIProvider.ts` lines 734-1001):
```typescript
{
  type: 'function',
  function: {
    name: 'Bash',  // PascalCase
    name: 'Read',  // PascalCase
    name: 'Write', // PascalCase
    // ... etc
  }
}
```

**Google** (`GoogleProvider.ts` lines 242-398):
```typescript
{
  name: 'Read',   // PascalCase
  name: 'Write',  // PascalCase
  // ... etc
}
```

**Comment in toolDefinitions.ts** (lines 56, 83, 127):
> "Use PascalCase for all providers"

### What V3 Expects Back

**Reverse Mapping** (`toolDefinitions.ts` lines 592-632):
```typescript
const reverseMapping: Record<string, string> = {
  // Direct mappings (names we actually use)
  'Bash': 'Bash',
  'Read': 'Read',
  'Write': 'Write',
  'Edit': 'Edit',
  // ...
  // Legacy mappings (kept for compatibility)
  'read_file': 'Read',
  'write_file': 'Write',
  'edit_file': 'Edit',
  // ...
};
```

### V3's Assumption

V3 assumes:
1. Send `Read` to provider → Provider returns `Read`
2. Send `Write` to provider → Provider returns `Write`
3. Also accept legacy snake_case multi-word: `read_file`, `write_file`

**BUT: V3 does NOT have mappings for lowercase single-word names:**
- ❌ No mapping for `'read'` → `'Read'`
- ❌ No mapping for `'write'` → `'Write'`
- ❌ No mapping for `'bash'` → `'Bash'`

---

## V4 Initial Approach (omniclaude-v4)

### What V4 Configurators Claimed

All 14 configurators say: `namingConvention: 'snake_case'`
- AnthropicConfigurator: snake_case
- OpenAIConfigurator: snake_case
- GoogleConfigurator: snake_case
- XAIConfigurator: snake_case

### What V4 Gateway Did

**GatewayTranslationLayer** (`prepareRequest()` lines 105-153):
- Convert tools from PascalCase → snake_case before sending
- `Read` → `read`
- `Write` → `write`

**Problem**: No reverse conversion on responses!
- Provider returns `read`
- Gateway passes `read` to executor
- Executor expects `Read`
- **FAILURE**: Unknown tool `read`

---

## Actual Provider Behavior (Tested)

### XAI Test Results (V4)

**Scenario**: V4 sends request with tools
**Question**: What did XAI return?

From test output:
```
[Orchestrator Phase 2.5] Executing tool: read
[Orchestrator Phase 2.5] Unknown tool: read
```

**Conclusion**: XAI returned `read` (lowercase)

**Critical Question**: Did V4 send `read` or `Read` to XAI?
- If V4 sent `read` → XAI echoed it back as `read` ✅
- If V4 sent `Read` → XAI converted it to `read` ❌

Need to verify what V4 actually sent!

---

## The Critical Test

To understand the truth, I need to answer:

### Question 1: What does V4 send to XAI?

Check `GatewayTranslationLayer.prepareRequest()`:
- Does it convert `Read` → `read` for XAI?
- Or does it skip conversion?

### Question 2: What does OpenAI actually accept/return?

- Does OpenAI accept `Read` and return `Read`?
- Or does OpenAI convert `Read` → `read`?
- Or does OpenAI only accept `read` in the first place?

### Question 3: Is V3 broken for XAI?

If:
- V3 sends `Read` to XAI
- XAI converts to `read` and returns `read`
- V3 reverse mapping doesn't have `'read'` → `'Read'`
- **Then V3 would be broken!**

But V3 is production code that's supposedly working...

---

## Next Steps

1. **Check V4's actual outgoing request**: Verify what case V4 sent to XAI
2. **Test V3 with XAI**: Does V3 actually work with XAI?
3. **Test OpenAI directly**: What naming does OpenAI actually require?

---

## Hypothesis

I suspect:
- **V3 approach**: Send PascalCase, providers echo it back as PascalCase
- **V4 configurators were WRONG**: Providers actually want PascalCase, not snake_case
- **My V4 fix was RIGHT**: Convert snake_case → PascalCase on responses

But this contradicts:
- API documentation showing snake_case examples
- The configurator settings

**Something doesn't add up.**
