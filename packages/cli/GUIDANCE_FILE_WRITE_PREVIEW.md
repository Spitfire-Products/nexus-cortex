# Guidance: File Write Preview & Document Preview Implementation

## Overview

This document provides implementation guidance for adding preview capabilities to the Write tool (file creation) and a new Document Write preview feature. It draws on the established patterns from the Edit tool diff display implementation.

## Background: Edit Tool Diff Pattern

The Edit tool diff display was implemented across multiple sessions with these key learnings:

### Architecture Pattern Established

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CORE LIBRARY                                 │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  CortexOrchestrator.ts                                   │   │
│  │  - Executes tool                                             │   │
│  │  - Generates preview data (diff, file content, etc.)         │   │
│  │  - Saves to tool_result.metadata for persistence             │   │
│  │  - Emits tool_result chunk with metadata during streaming    │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         CLI LAYER                                   │
│  ┌──────────────────────┐     ┌──────────────────────────────┐     │
│  │     Chalk UI         │     │         Ink UI               │     │
│  │  interactive.ts      │     │  CortexApp.tsx           │     │
│  │  - Renders during    │     │  StreamDisplay.tsx           │     │
│  │    streaming         │     │  - Renders during streaming  │     │
│  │  - Renders from      │     │  - Renders from session      │     │
│  │    session history   │     │    history                   │     │
│  └──────────────────────┘     └──────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Files Modified for Edit Tool Diff

1. **Core Library - Metadata Flow**
   - `packages/core/src/orchestrator/CortexOrchestrator.ts` (lines 1677-1684)
   - Critical: Both streaming and non-streaming paths must include `tool_name` and `metadata`

2. **Core Library - Types**
   - `packages/core/src/session/MessageTypes.ts`
   - `ToolResultMetadata` interface with `diff` and `fileStats` fields

3. **Core Library - Diff Parser**
   - `packages/core/src/utils/DiffParser.ts`
   - `parseUnifiedDiff()` function exported from `packages/core/src/utils/index.ts`

4. **Chalk UI - Streaming & History**
   - `packages/cli/src/commands/chat/interactive.ts`
   - Lines ~1217-1271: Renders diffs from loaded session history
   - Uses `ToolFormatter.formatDiff()` for display

5. **Ink UI - Streaming & History**
   - `packages/cli/src/ink-ui/CortexApp.tsx`
   - `MessageDisplay` component (lines ~365-534): Renders orchestrator messages
   - `UnifiedDiffDisplay` component for diff rendering
   - `useCortexStream.ts`: Processes streaming chunks, passes metadata

### Critical Pattern: Streaming Path Metadata

The root cause of the Edit diff persistence bug was that the streaming path in `CortexOrchestrator.ts` was NOT saving `tool_name` and `metadata` when creating tool_result messages. This must be done in BOTH paths:

```typescript
// In processPromptStreamV2() - STREAMING PATH
content: [{
  type: 'tool_result',
  tool_use_id: toolResult.tool_use_id,
  tool_name: toolResult.tool_name,        // ← CRITICAL
  content: toolResult.content,
  is_error: toolResult.is_error,
  metadata: toolResult.metadata           // ← CRITICAL
}]
```

---

## Part 1: Write Tool Preview Implementation

### Goal

When the Write tool creates a new file, display a preview showing:
- File path being created
- Full file content (syntax highlighted if possible)
- File statistics (line count, byte size)
- Preview persists in session history like Edit diffs

### Implementation Steps

#### Step 1: Generate Preview Metadata in Core

**File**: `packages/core/src/orchestrator/CortexOrchestrator.ts`

In the tool execution logic for Write tool, generate metadata:

```typescript
// After successful write execution
if (toolName === 'Write' && !toolResult.is_error) {
  const content = toolInput.content as string;
  const filePath = toolInput.file_path as string;

  toolResult.metadata = {
    writePreview: {
      filePath,
      content,
      lineCount: content.split('\n').length,
      byteSize: Buffer.byteLength(content, 'utf8'),
      language: detectLanguage(filePath), // Helper to detect from extension
    },
    fileStats: {
      path: filePath,
      operation: 'create',
    }
  };
}
```

#### Step 2: Update Types

**File**: `packages/core/src/session/MessageTypes.ts`

Extend `ToolResultMetadata`:

```typescript
export interface WritePreviewMetadata {
  filePath: string;
  content: string;
  lineCount: number;
  byteSize: number;
  language?: string;
}

export interface ToolResultMetadata {
  diff?: string;
  writePreview?: WritePreviewMetadata;
  fileStats?: {
    path?: string;
    occurrences?: number;
    operation?: 'edit' | 'create' | 'delete';
  };
  [key: string]: any;
}
```

#### Step 3: Chalk UI Rendering

**File**: `packages/cli/src/commands/chat/interactive.ts`

Add Write preview rendering in the tool result display logic:

```typescript
// In tool_result handling (around line 1217)
const hasWritePreview = c.metadata?.writePreview && c.tool_name?.toLowerCase() === 'write';

if (hasWritePreview) {
  const preview = c.metadata.writePreview;
  const result = toolFormatter.formatWritePreview({
    filePath: preview.filePath,
    content: preview.content,
    lineCount: preview.lineCount,
    byteSize: preview.byteSize,
    language: preview.language,
  });
  process.stdout.write(result);
}
```

**File**: `packages/cli/src/utils/ToolFormatter.ts`

Add `formatWritePreview()` method:

```typescript
formatWritePreview(preview: WritePreviewMetadata): string {
  const header = this.theme.colors.success('✓ ') +
    `Created ${preview.filePath} (${preview.lineCount} lines, ${this.formatBytes(preview.byteSize)})`;

  // Syntax highlight content based on language
  const highlighted = this.highlightCode(preview.content, preview.language);

  // Format with line numbers and border
  return this.formatCodeBlock(header, highlighted);
}
```

#### Step 4: Ink UI Rendering

**File**: `packages/cli/src/ink-ui/components/WritePreview.tsx` (NEW)

Create a new component:

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';

interface WritePreviewProps {
  filePath: string;
  content: string;
  lineCount: number;
  byteSize: number;
  language?: string;
  compact?: boolean;
}

export const WritePreview: React.FC<WritePreviewProps> = ({
  filePath,
  content,
  lineCount,
  byteSize,
  compact = false,
}) => {
  const lines = content.split('\n');
  const displayLines = compact ? lines.slice(0, 10) : lines;
  const truncated = compact && lines.length > 10;

  return (
    <Box flexDirection="column" marginY={1}>
      {/* Header */}
      <Box>
        <Text color={Colors.AccentGreen}>✓ </Text>
        <Text bold>{filePath}</Text>
        <Text dimColor> ({lineCount} lines, {formatBytes(byteSize)})</Text>
      </Box>

      {/* Content with line numbers */}
      <Box flexDirection="column" marginLeft={2} marginTop={1}>
        {displayLines.map((line, i) => (
          <Box key={i}>
            <Text dimColor>{String(i + 1).padStart(4)} │ </Text>
            <Text>{line}</Text>
          </Box>
        ))}
        {truncated && (
          <Text dimColor>    ... {lines.length - 10} more lines</Text>
        )}
      </Box>
    </Box>
  );
};
```

**File**: `packages/cli/src/ink-ui/CortexApp.tsx`

Add Write preview rendering in `MessageDisplay`:

```tsx
// In the tool_result block handling
if (block.type === 'tool_result') {
  const isWrite = block.tool_name?.toLowerCase() === 'write';
  const hasWritePreview = block.metadata?.writePreview;

  if (isWrite && hasWritePreview && !isError) {
    return (
      <Box key={`${msg.uuid}-result-${i}`} flexDirection="column" marginLeft={2}>
        <WritePreview
          filePath={block.metadata.writePreview.filePath}
          content={block.metadata.writePreview.content}
          lineCount={block.metadata.writePreview.lineCount}
          byteSize={block.metadata.writePreview.byteSize}
          language={block.metadata.writePreview.language}
        />
      </Box>
    );
  }
  // ... existing Edit diff handling
}
```

---

## Part 2: Document Write Preview Implementation

### Goal

When a document is written (markdown, text, etc.), display a rich preview that:
- Shows formatted document content during streaming
- Can be collapsed in historical transcript
- Expandable via keystroke (e.g., `d` to toggle document previews)

### Key Difference from Write Preview

Document previews do NOT need to persist the full content in metadata for re-rendering. Instead:
- During streaming: Show full preview
- In history: Show collapsed summary with expand option
- Expansion re-reads from disk if needed, or uses cached reference

### Implementation Steps

#### Step 1: Define Document Tool Behavior

Decide which tool(s) trigger document preview:
- Option A: Use existing Write tool with document detection (based on extension: .md, .txt, .rst)
- Option B: Create dedicated DocumentWrite tool
- **Recommended**: Option A with extension detection

#### Step 2: Add Collapsible State Management

**File**: `packages/cli/src/ink-ui/CortexApp.tsx`

Add state for document expansion:

```typescript
// State for which documents are expanded
const [expandedDocuments, setExpandedDocuments] = useState<Set<string>>(new Set());

// Toggle handler
const toggleDocumentExpansion = useCallback((docId: string) => {
  setExpandedDocuments(prev => {
    const next = new Set(prev);
    if (next.has(docId)) {
      next.delete(docId);
    } else {
      next.add(docId);
    }
    return next;
  });
}, []);
```

#### Step 3: Add Keyboard Shortcut

**File**: `packages/cli/src/ink-ui/CortexApp.tsx`

In the `useInput` handler:

```typescript
// 'd' key to toggle all document previews
if (input === 'd' && !key.ctrl && !key.meta) {
  // Toggle expansion of all documents, or cycle through: all collapsed → all expanded → individual
  toggleAllDocuments();
  return;
}
```

#### Step 4: Document Preview Component

**File**: `packages/cli/src/ink-ui/components/DocumentPreview.tsx` (NEW)

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { MarkdownText } from './MarkdownText.js';

interface DocumentPreviewProps {
  docId: string;
  filePath: string;
  content: string;
  isExpanded: boolean;
  onToggle: () => void;
}

export const DocumentPreview: React.FC<DocumentPreviewProps> = ({
  docId,
  filePath,
  content,
  isExpanded,
  onToggle,
}) => {
  const lineCount = content.split('\n').length;
  const wordCount = content.split(/\s+/).filter(Boolean).length;

  if (!isExpanded) {
    // Collapsed view - just show summary
    return (
      <Box>
        <Text color={Colors.AccentGreen}>✓ </Text>
        <Text bold>{filePath}</Text>
        <Text dimColor> ({lineCount} lines, {wordCount} words)</Text>
        <Text dimColor> [press 'd' to expand]</Text>
      </Box>
    );
  }

  // Expanded view - show formatted content
  const isMarkdown = filePath.endsWith('.md') || filePath.endsWith('.mdx');

  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color={Colors.AccentGreen}>✓ </Text>
        <Text bold>{filePath}</Text>
        <Text dimColor> ({lineCount} lines, {wordCount} words)</Text>
        <Text dimColor> [press 'd' to collapse]</Text>
      </Box>

      <Box
        flexDirection="column"
        marginLeft={2}
        marginTop={1}
        borderStyle="single"
        borderColor={Colors.Gray}
        paddingX={1}
      >
        {isMarkdown ? (
          <MarkdownText>{content}</MarkdownText>
        ) : (
          <Text>{content}</Text>
        )}
      </Box>
    </Box>
  );
};
```

#### Step 5: Minimal Metadata for Documents

For documents, store minimal metadata (no full content):

```typescript
// In orchestrator tool execution
if (toolName === 'Write' && isDocumentFile(filePath)) {
  toolResult.metadata = {
    documentPreview: {
      filePath,
      lineCount: content.split('\n').length,
      wordCount: content.split(/\s+/).filter(Boolean).length,
      // Note: content NOT stored - will read from disk if expanded
    },
    fileStats: {
      path: filePath,
      operation: 'create',
    }
  };
}
```

#### Step 6: Lazy Content Loading

When user expands a collapsed document in history:

```typescript
const loadDocumentContent = useCallback(async (filePath: string): Promise<string | null> => {
  try {
    // Use orchestrator client to read file
    const result = await client.readFile(filePath);
    return result.content;
  } catch {
    return null; // File may have been deleted
  }
}, [client]);
```

---

## Part 3: Persistence Checklist

### For Features That Must Persist (Write Preview)

1. [ ] Metadata generated in `CortexOrchestrator.ts` tool execution
2. [ ] `tool_name` included in tool_result content block
3. [ ] `metadata` included in tool_result content block
4. [ ] Types updated in `MessageTypes.ts`
5. [ ] Streaming path includes metadata (both paths in orchestrator)
6. [ ] Chalk UI renders from `c.metadata` in history loading (interactive.ts)
7. [ ] Ink UI renders from `block.metadata` in MessageDisplay (CortexApp.tsx)
8. [ ] Session loading calls `refreshOrchestratorHistory()` (already done)

### For Features That Don't Persist Full Content (Document Preview)

1. [ ] Minimal metadata (path, stats) saved for history display
2. [ ] Full content shown during streaming only
3. [ ] Collapsed summary shown in history
4. [ ] Expansion triggers lazy load from disk
5. [ ] Graceful handling if file deleted/moved

---

## Part 4: Testing Strategy

### Manual Testing

1. **Write Preview Persistence**
   - Create a new file with Write tool
   - Verify preview shows during streaming
   - Complete the turn, verify preview persists
   - Use `/continue` to load session, verify preview renders

2. **Document Preview Collapse/Expand**
   - Create a markdown file
   - Verify full preview during streaming
   - Verify collapsed in history after turn
   - Press 'd' to expand, verify content shows
   - Press 'd' again to collapse

3. **Cross-UI Consistency**
   - Test same session in Chalk UI and Ink UI
   - Verify both render previews correctly from history

### Edge Cases

- Very large files (implement truncation with "show more")
- Binary files (skip preview, show size only)
- Deleted files (graceful error when expanding)
- Unicode/special characters
- Files with no extension

---

## Part 5: Related Commits for Reference

```
524f1270 fix(cli): Display message history when loading sessions in Ink UI
b3f4dcce fix(cli): Edit tool diff display persistence in message history
f00579bb feat(cli): Nexus Cortex CLI comprehensive improvements checkpoint
```

Review these commits to see the exact code patterns used for Edit tool diffs.

---

## Summary

| Feature | Persist Full Content | During Streaming | In History |
|---------|---------------------|------------------|------------|
| Edit Diff | Yes (metadata.diff) | Full diff | Full diff |
| Write Preview | Yes (metadata.writePreview) | Full content | Full content |
| Document Preview | No (stats only) | Full content | Collapsed + expand |

The key insight is that persistence requires saving data to `tool_result.metadata` in the orchestrator, while collapsible features can use lazy loading and local state management in the UI layer.
