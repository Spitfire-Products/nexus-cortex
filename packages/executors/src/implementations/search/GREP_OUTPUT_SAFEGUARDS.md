# GrepTool Output Safeguards & Token Usage Protection

## Overview

The GrepTool has **two independent layers of protection** to prevent different types of failures:

1. **Memory Protection** - Prevents heap exhaustion during file scanning
2. **Output Protection** - Prevents token exhaustion when sending results to model API

Both protections are necessary and work independently.

---

## Layer 1: Memory Protection (FIXED in commit 3976eb96)

### Problem
When searching large directories, the JavaScript fallback strategy would read every file into memory, causing heap exhaustion.

**Example crash scenario:**
```bash
grep(pattern=test, path=., glob=*.js)
```
- Scans entire workspace root
- Reads `.claude/file-history/` (thousands of files)
- Reads `.npm/` cache (thousands of packages)
- Result: `FATAL ERROR: JavaScript heap out of memory`

### Solution
Enhanced exclusion patterns to skip massive directories:

```typescript
// System grep exclusions (--exclude-dir flag)
const excludeDirs = [
  '.git', 'node_modules', 'bower_components', 'dist', 'build',
  '.claude',           // Claude Code data (thousands of files)
  '.cortex',           // Nexus Cortex runtime data
  '.npm',              // npm cache
  '.pythonlibs',       // Python libraries
  '.config',           // Configuration data
  'coverage',          // Test coverage
  '.next', '.nuxt', '.cache',
  'tmp', 'temp',
  '__pycache__', '.pytest_cache', '.mypy_cache',
  'vendor', '.venv', 'venv', 'env'
];

// JavaScript fallback exclusions (glob ignore patterns)
const ignorePatterns = [
  '.git/**', 'node_modules/**', /* ... same list with /** glob patterns */
  '**/*.min.js',  // Minified files
  '**/*.map',     // Source maps
  '**/*.log'      // Log files
];
```

**Protection Level**: Process-level (prevents Node.js heap exhaustion)

---

## Layer 2: Output Protection (ALREADY IN PLACE)

### Built-in Safeguards

```typescript
export class GrepTool extends BaseTool<GrepToolParams, ToolResult> {
  private static readonly MAX_RESULTS = 500;         // Maximum matches returned
  private static readonly MAX_CONTENT_LENGTH = 50000; // Maximum characters in output
}
```

### How It Works

#### 1. Match Count Limiting (MAX_RESULTS = 500)

```typescript
const truncated = totalMatches > GrepTool.MAX_RESULTS;
const displayMatches = truncated
  ? matches.slice(0, GrepTool.MAX_RESULTS)  // Only first 500
  : matches;

// Output includes both counts
llmContent = `Found ${totalMatches} matches (showing first ${MAX_RESULTS}) ...`;
```

**Result**: Even if grep finds 10,000 matches, only 500 are returned to the model.

#### 2. Content Length Limiting (MAX_CONTENT_LENGTH = 50000)

```typescript
let contentLength = llmContent.length;

for (const filePath in matchesByFile) {
  const fileHeader = `File: ${filePath}\n`;

  // Check before adding each file header
  if (contentLength + fileHeader.length > GrepTool.MAX_CONTENT_LENGTH) {
    llmContent += `\n... Content truncated ...\n`;
    break;  // Stop adding more results
  }

  llmContent += fileHeader;
  contentLength += fileHeader.length;

  for (const match of fileMatches) {
    const lineContent = `L${match.lineNumber}: ${trimmedLine}\n`;

    // Check before adding each line
    if (contentLength + lineContent.length > GrepTool.MAX_CONTENT_LENGTH) {
      llmContent += `... Content truncated ...\n`;
      break;  // Stop adding more lines
    }

    llmContent += lineContent;
    contentLength += lineContent.length;
  }
}
```

**Result**: Output is capped at 50,000 characters with clear truncation messages.

---

## Token Usage Analysis

### Character to Token Conversion

Approximate ratios:
- **English text**: ~4 characters per token
- **Code**: ~3-4 characters per token
- **Mixed content**: ~3.5 characters per token (conservative estimate)

### Maximum Token Usage

```
MAX_CONTENT_LENGTH = 50,000 characters

Worst case (code-heavy):
50,000 chars ÷ 3 chars/token = ~16,667 tokens

Typical case (mixed):
50,000 chars ÷ 4 chars/token = ~12,500 tokens

Best case (English text):
50,000 chars ÷ 4.5 chars/token = ~11,111 tokens
```

### Token Budget Comparison

| Model | Context Window | Grep Max Tokens | % of Context |
|-------|----------------|-----------------|--------------|
| Claude Sonnet 3.5 | 200,000 | 12,500 | 6.25% |
| Claude Opus 3 | 200,000 | 12,500 | 6.25% |
| GPT-4 Turbo | 128,000 | 12,500 | 9.77% |
| GPT-4 | 8,192 | 12,500 | 152% ⚠️ |
| Gemini 1.5 Pro | 1,000,000+ | 12,500 | 1.25% |

**Conclusion**: 50,000 character limit is safe for modern LLMs (Sonnet, Opus, GPT-4 Turbo, Gemini).

**Note**: For older models like GPT-4 (8K context), the orchestrator should handle output truncation at the API layer.

---

## Real-World Output Examples

### Small Search (Safe)
```
Pattern: "TODO"
Path: ./src
Results: 15 matches

Characters: ~1,500
Tokens: ~375
% of 50K limit: 3%
```

### Medium Search (Safe)
```
Pattern: "function.*export"
Path: ./packages
Results: 200 matches

Characters: ~15,000
Tokens: ~3,750
% of 50K limit: 30%
```

### Large Search (Truncated)
```
Pattern: "import"
Path: .
Results: 2,500 matches → showing 500

Characters: 50,000 (capped)
Tokens: ~12,500
% of 50K limit: 100%
Message: "... Content truncated ..."
```

### Massive Search (Heavily Truncated)
```
Pattern: "test"
Path: .
Results: 10,000+ matches → showing 500 (but content limit hit earlier)

Characters: 50,000 (capped)
Tokens: ~12,500
% of 50K limit: 100%
Message: "Found 10000 matches (showing first 500) ... Content truncated ..."
```

---

## How to Verify Protection is Working

### 1. Run the Test Suite

```bash
cd packages/executors
npm test -- GrepTool.output-limits.test.ts
```

Expected output:
```
✓ should limit results to MAX_RESULTS (500) matches
✓ should limit content length to MAX_CONTENT_LENGTH (50000 chars)
✓ should handle very long lines without exceeding limits
✓ should show truncation message when limits are hit
✓ should report actual vs displayed match counts in metadata
```

### 2. Test with Real Workspace

```bash
# Test a pattern that matches many files
grep(pattern=import, path=., output_mode=content)

# Expected behavior:
# 1. Memory: Doesn't crash (exclusions prevent reading massive directories)
# 2. Output: Returns ≤50,000 characters with truncation message
# 3. Tokens: Uses ≤12,500 tokens
```

### 3. Monitor Token Usage in Production

Check the `ToolResult` metadata:

```typescript
{
  success: true,
  llmContent: "Found 1000 matches (showing first 500) ... Content truncated ...",
  metadata: {
    matchCount: 1000,        // Total matches found
    displayedMatches: 500,   // Matches actually shown
    truncated: true,         // Whether output was truncated
    executionTime: 234,      // Milliseconds
    searchPath: "/path/to/dir",
    pattern: "test",
    strategy: "ripgrep"      // Which search method was used
  }
}
```

### 4. Check Orchestrator Logs

The orchestrator logs tool results. Look for:

```
[Tool: Grep] Execution time: 234ms
[Tool: Grep] Content length: 50000 chars
[Tool: Grep] Truncated: true (1000 total matches, showing 500)
```

---

## Comparison: Memory Crash vs Output Overflow

| Issue | Memory Crash | Output Overflow |
|-------|--------------|-----------------|
| **When** | During file scanning | When returning results |
| **Cause** | Too many files read into memory | Too much output sent to API |
| **Symptom** | `heap out of memory` fatal error | Token limit exceeded or API error |
| **Prevention** | Exclusion patterns (skip directories) | MAX_RESULTS + MAX_CONTENT_LENGTH |
| **Fixed in** | Commit 3976eb96 (added exclusions) | Original implementation |
| **Protection level** | Process-level (Node.js) | Result-level (tool output) |

**Key Insight**: The memory crash occurred BEFORE results were returned. The output limiting would have prevented API token exhaustion IF the search had completed.

---

## Why Both Protections Are Necessary

### Scenario: Search entire workspace for "test"

**Without memory protection (BEFORE fix)**:
1. Grep tries to read `.claude/file-history/` (10,000+ files)
2. Reads `.npm/` cache (5,000+ packages)
3. Memory usage: 2GB → 4GB → crash ❌
4. **Never gets to output limiting** because process crashes first

**With memory protection, without output limiting**:
1. Grep skips excluded directories ✅
2. Finds 50,000 matches in source code
3. Builds 5MB result string
4. Sends to API → token limit exceeded ❌

**With BOTH protections (CURRENT)**:
1. Grep skips excluded directories ✅
2. Finds 50,000 matches
3. Limits to first 500 matches ✅
4. Limits content to 50,000 chars ✅
5. Sends ~12,500 tokens to API ✅
6. Model sees: "Found 50000 matches (showing first 500) ... Content truncated ..."

---

## Adjusting Limits (If Needed)

### When to Increase Limits

**Current limits are SAFE and RECOMMENDED**. Consider increasing only if:

1. Using models with very large context windows (Gemini 1.5 Pro with 1M tokens)
2. Grep is primary workflow and needs more results
3. Users frequently hit truncation limits

### When to Decrease Limits

Consider decreasing if:

1. Using older models (GPT-4 8K)
2. Running many tools in parallel
3. Context window needs to preserve space for conversation history

### How to Adjust

Edit `packages/executors/src/implementations/search/GrepTool.ts`:

```typescript
export class GrepTool extends BaseTool<GrepToolParams, ToolResult> {
  // For smaller context models (GPT-4 8K):
  private static readonly MAX_RESULTS = 250;
  private static readonly MAX_CONTENT_LENGTH = 20000;  // ~5,000 tokens

  // For larger context models (Gemini 1.5 Pro):
  private static readonly MAX_RESULTS = 1000;
  private static readonly MAX_CONTENT_LENGTH = 200000;  // ~50,000 tokens

  // Current (recommended for Claude/GPT-4 Turbo):
  private static readonly MAX_RESULTS = 500;
  private static readonly MAX_CONTENT_LENGTH = 50000;  // ~12,500 tokens
}
```

**After changing**: Rebuild packages and run tests.

---

## Monitoring Recommendations

### 1. Add Token Usage Tracking to Orchestrator

Track cumulative token usage per turn:

```typescript
interface TurnMetrics {
  userInputTokens: number;
  systemPromptTokens: number;
  toolOutputTokens: number;      // Track this!
  modelOutputTokens: number;
  totalTokens: number;
}
```

### 2. Log Large Tool Outputs

```typescript
if (toolResult.llmContent.length > 30000) {
  logger.warn(`Large tool output: ${toolUse.name}`, {
    contentLength: toolResult.llmContent.length,
    estimatedTokens: Math.ceil(toolResult.llmContent.length / 4),
    truncated: toolResult.metadata?.truncated
  });
}
```

### 3. Add Metrics Dashboard

Track over time:
- Average tool output size
- Frequency of truncation
- Tools that produce largest outputs
- Token usage trends

---

## Conclusion

### ✅ Current Protection Status

1. **Memory crashes**: FIXED with enhanced exclusion patterns
2. **Token exhaustion**: ALREADY PROTECTED with built-in limits
3. **API errors**: PREVENTED by 50K character cap

### 📊 Safety Metrics

- Maximum output: 50,000 characters
- Maximum tokens: ~12,500 (6.25% of 200K context)
- Truncation: Clearly indicated to model
- Test coverage: Comprehensive test suite included

### 🎯 Recommendation

**No changes needed.** The current limits strike the right balance between:
- Providing useful search results
- Protecting against token exhaustion
- Staying within API limits
- Leaving room for conversation history

The GrepTool is production-ready with robust safeguards at both the memory and output levels.
