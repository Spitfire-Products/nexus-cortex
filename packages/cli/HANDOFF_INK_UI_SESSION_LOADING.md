# Handoff: Tool Preview System - Write Preview & Document Collapse/Expand

## Status Summary

| Feature | Status | Commit |
|---------|--------|--------|
| Edit tool diff display during streaming | ✅ Complete | `b3f4dcce` |
| Edit diff persistence in session history | ✅ Complete | `b3f4dcce` |
| Session loading displays history (Ink UI) | ✅ Complete | `524f1270` |
| Write tool file preview | 🔲 Not Started | - |
| Document preview with collapse/expand | 🔲 Not Started | - |

---

## Completed Work: Architecture Pattern Established

### The Metadata Persistence Pattern

The Edit tool diff implementation established the critical pattern for tool result previews:

```
┌─────────────────────────────────────────────────────────────────────┐
│                     CortexOrchestrator.ts                       │
│                                                                     │
│   Tool Execution → Generate Preview Data → Save to metadata         │
│                                                                     │
│   CRITICAL: Both streaming AND non-streaming paths must include:    │
│   - tool_name                                                       │
│   - metadata (contains diff, preview data, etc.)                    │
└─────────────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┴─────────────────┐
            ▼                                   ▼
   ┌─────────────────┐                 ┌─────────────────┐
   │    Chalk UI     │                 │     Ink UI      │
   │  interactive.ts │                 │ CortexApp   │
   │                 │                 │ StreamDisplay   │
   │ Renders from:   │                 │ MessageDisplay  │
   │ - streaming     │                 │                 │
   │ - session load  │                 │ Renders from:   │
   └─────────────────┘                 │ - streaming     │
                                       │ - session load  │
                                       └─────────────────┘
```

### Key Code Locations

**Core Library - Metadata Injection Point**
```
packages/core/src/orchestrator/CortexOrchestrator.ts
Lines ~1677-1684 (streaming path tool_result creation)
```

```typescript
// BOTH paths must include tool_name and metadata
content: [{
  type: 'tool_result',
  tool_use_id: toolResult.tool_use_id,
  tool_name: toolResult.tool_name,        // ← REQUIRED for persistence
  content: toolResult.content,
  is_error: toolResult.is_error,
  metadata: toolResult.metadata           // ← REQUIRED for persistence
}]
```

**Types Definition**
```
packages/core/src/session/MessageTypes.ts
```

```typescript
export interface ToolResultMetadata {
  diff?: string;                    // Edit tool diff
  fileStats?: {
    path?: string;
    occurrences?: number;
    operation?: string;
  };
  [key: string]: any;               // Extensible for new preview types
}
```

**Session Loading Fix (Ink UI)**
```
packages/cli/src/ink-ui/CortexApp.tsx
Lines ~2285-2288 (/resume handler)
Lines ~2796-2799 (session picker onSelect)
```

The fix was adding `refreshOrchestratorHistory()` after `client.resumeSession()`:
```typescript
await client.resumeSession(sessionId);
refreshOrchestratorHistory();  // ← This syncs UI state with loaded session
```

---

## Next Feature 1: Write Tool File Preview

### Goal

When the Write tool creates a new file, display a preview showing:
- File path and creation status
- Full file content with syntax highlighting
- Line count and byte size
- **Preview persists in session history** (like Edit diffs)

### Implementation Checklist

#### Step 1: Core Library - Generate Metadata

**File**: `packages/core/src/orchestrator/CortexOrchestrator.ts`

Find the Write tool execution result handling and add:

```typescript
if (toolName === 'Write' && !toolResult.is_error) {
  const content = toolInput.content as string;
  const filePath = toolInput.file_path as string;

  toolResult.metadata = {
    writePreview: {
      filePath,
      content,
      lineCount: content.split('\n').length,
      byteSize: Buffer.byteLength(content, 'utf8'),
      language: getLanguageFromExtension(filePath),
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
  writePreview?: WritePreviewMetadata;  // ← ADD THIS
  fileStats?: { ... };
  [key: string]: any;
}
```

#### Step 3: Ink UI - Create WritePreview Component

**File**: `packages/cli/src/ink-ui/components/WritePreview.tsx` (NEW)

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
  const maxLines = compact ? 15 : 50;
  const displayLines = lines.slice(0, maxLines);
  const truncated = lines.length > maxLines;

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color={Colors.AccentGreen}>✓ Created </Text>
        <Text bold>{filePath}</Text>
        <Text dimColor> ({lineCount} lines, {formatBytes(byteSize)})</Text>
      </Box>

      <Box flexDirection="column" marginLeft={2} marginTop={1}>
        {displayLines.map((line, i) => (
          <Box key={i}>
            <Text dimColor>{String(i + 1).padStart(4)} │ </Text>
            <Text color={Colors.text}>{line}</Text>
          </Box>
        ))}
        {truncated && (
          <Text dimColor>     ... {lines.length - maxLines} more lines</Text>
        )}
      </Box>
    </Box>
  );
};
```

#### Step 4: Ink UI - Integrate into MessageDisplay

**File**: `packages/cli/src/ink-ui/CortexApp.tsx`

In the `MessageDisplay` component, find the tool_result handling (around line 457) and add:

```tsx
if (block.type === 'tool_result') {
  const isError = block.is_error;
  const isWrite = block.tool_name?.toLowerCase() === 'write';
  const hasWritePreview = block.metadata?.writePreview;

  // NEW: Write tool preview
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

  // EXISTING: Edit tool diff (keep this)
  const isEdit = block.tool_name?.toLowerCase() === 'edit';
  const hasDiff = block.metadata?.diff;
  // ... existing diff handling
}
```

#### Step 5: Chalk UI - Add Write Preview Rendering

**File**: `packages/cli/src/commands/chat/interactive.ts`

In the tool_result rendering section (around line 1217), add:

```typescript
} else if (c.type === 'tool_result') {
  const hasWritePreview = c.metadata?.writePreview && c.tool_name?.toLowerCase() === 'write';
  const hasDiff = c.metadata?.diff && c.tool_name?.toLowerCase() === 'edit';

  if (c.is_error) {
    // existing error handling
  } else if (hasWritePreview) {
    // NEW: Write preview
    const preview = c.metadata.writePreview;
    const header = theme.colors.success('✓ Created ') + preview.filePath +
      theme.dimmed(` (${preview.lineCount} lines, ${formatBytes(preview.byteSize)})`);
    console.log(header);

    // Display content with line numbers
    const lines = preview.content.split('\n').slice(0, 50);
    lines.forEach((line, i) => {
      console.log(theme.dimmed(`${String(i + 1).padStart(4)} │ `) + line);
    });
    if (preview.lineCount > 50) {
      console.log(theme.dimmed(`     ... ${preview.lineCount - 50} more lines`));
    }
  } else if (hasDiff) {
    // existing diff handling
  }
}
```

**File**: `packages/cli/src/utils/ToolFormatter.ts`

Add helper method:

```typescript
formatWritePreview(preview: WritePreviewMetadata): string {
  // Implementation similar to formatDiff but for file content
}
```

---

## Next Feature 2: Document Preview with Collapse/Expand

### Goal

When documents (markdown, text files) are written:
- Show full formatted preview during streaming
- In session history, show **collapsed** summary by default
- User can press `d` key to **expand/collapse** document previews
- Expansion loads content from disk (lazy load, not persisted in metadata)

### Key Difference from Write Preview

| Aspect | Write Preview | Document Preview |
|--------|---------------|------------------|
| Full content in metadata | Yes | No (stats only) |
| Persistence | Full preview persists | Collapsed summary persists |
| Expand/Collapse | No | Yes (keyboard shortcut) |
| Re-render from history | From metadata | Lazy load from disk |

### Implementation Checklist

#### Step 1: Detect Document Files

**File**: `packages/core/src/orchestrator/CortexOrchestrator.ts`

```typescript
const DOCUMENT_EXTENSIONS = ['.md', '.mdx', '.txt', '.rst', '.adoc'];

function isDocumentFile(filePath: string): boolean {
  return DOCUMENT_EXTENSIONS.some(ext => filePath.toLowerCase().endsWith(ext));
}
```

#### Step 2: Minimal Metadata for Documents

For documents, store minimal metadata (no full content):

```typescript
if (toolName === 'Write' && isDocumentFile(filePath) && !toolResult.is_error) {
  toolResult.metadata = {
    documentInfo: {
      filePath,
      lineCount: content.split('\n').length,
      wordCount: content.split(/\s+/).filter(Boolean).length,
      isMarkdown: filePath.endsWith('.md') || filePath.endsWith('.mdx'),
      // NOTE: content NOT stored - lazy loaded on expand
    },
    fileStats: {
      path: filePath,
      operation: 'create',
    }
  };
}
```

#### Step 3: Add Expansion State to Ink UI

**File**: `packages/cli/src/ink-ui/CortexApp.tsx`

```typescript
// Near other state declarations (around line 1640)
const [expandedDocuments, setExpandedDocuments] = useState<Set<string>>(new Set());
const [documentContents, setDocumentContents] = useState<Map<string, string>>(new Map());

// Toggle function
const toggleDocumentExpansion = useCallback(async (docId: string, filePath: string) => {
  setExpandedDocuments(prev => {
    const next = new Set(prev);
    if (next.has(docId)) {
      next.delete(docId);
    } else {
      next.add(docId);
      // Lazy load content if not cached
      if (!documentContents.has(docId) && client) {
        client.readFile(filePath).then(result => {
          if (result.content) {
            setDocumentContents(prev => new Map(prev).set(docId, result.content));
          }
        }).catch(() => {
          // File may have been deleted
          setDocumentContents(prev => new Map(prev).set(docId, '[File not found]'));
        });
      }
    }
    return next;
  });
}, [client, documentContents]);

// Toggle all documents
const toggleAllDocuments = useCallback(() => {
  // If any expanded, collapse all; otherwise expand all
  if (expandedDocuments.size > 0) {
    setExpandedDocuments(new Set());
  } else {
    // Collect all document IDs from history and expand them
    const allDocIds = history
      .filter(item => item.type === 'orchestrator')
      .flatMap(item => /* extract doc IDs from tool_results */)
      .filter(Boolean);
    setExpandedDocuments(new Set(allDocIds));
  }
}, [expandedDocuments, history]);
```

#### Step 4: Add Keyboard Shortcut

**File**: `packages/cli/src/ink-ui/CortexApp.tsx`

In the `useInput` handler (around line 2550):

```typescript
// 'd' key to toggle document previews (when not in input mode)
if (input === 'd' && !key.ctrl && !key.meta && streamingState === StreamingState.Idle) {
  toggleAllDocuments();
  return;
}
```

#### Step 5: Create DocumentPreview Component

**File**: `packages/cli/src/ink-ui/components/DocumentPreview.tsx` (NEW)

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { MarkdownText } from './MarkdownText.js';

interface DocumentPreviewProps {
  docId: string;
  filePath: string;
  lineCount: number;
  wordCount: number;
  isMarkdown: boolean;
  isExpanded: boolean;
  content?: string;  // Only present if expanded and loaded
  onToggle: () => void;
}

export const DocumentPreview: React.FC<DocumentPreviewProps> = ({
  filePath,
  lineCount,
  wordCount,
  isMarkdown,
  isExpanded,
  content,
  onToggle,
}) => {
  if (!isExpanded) {
    // Collapsed view
    return (
      <Box>
        <Text color={Colors.AccentGreen}>✓ </Text>
        <Text bold>{filePath}</Text>
        <Text dimColor> ({lineCount} lines, {wordCount} words)</Text>
        <Text color={Colors.AccentCyan}> [d to expand]</Text>
      </Box>
    );
  }

  // Expanded view
  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color={Colors.AccentGreen}>✓ </Text>
        <Text bold>{filePath}</Text>
        <Text dimColor> ({lineCount} lines, {wordCount} words)</Text>
        <Text color={Colors.AccentCyan}> [d to collapse]</Text>
      </Box>

      <Box
        flexDirection="column"
        marginLeft={2}
        marginTop={1}
        borderStyle="round"
        borderColor={Colors.Gray}
        paddingX={1}
        paddingY={1}
      >
        {content ? (
          isMarkdown ? (
            <MarkdownText>{content}</MarkdownText>
          ) : (
            <Text>{content}</Text>
          )
        ) : (
          <Text dimColor>Loading...</Text>
        )}
      </Box>
    </Box>
  );
};
```

#### Step 6: Integrate into MessageDisplay

**File**: `packages/cli/src/ink-ui/CortexApp.tsx`

In `MessageDisplay`, handle document info:

```tsx
if (block.type === 'tool_result') {
  const isError = block.is_error;

  // Document preview (collapsible)
  const hasDocumentInfo = block.metadata?.documentInfo;
  if (hasDocumentInfo && !isError) {
    const docInfo = block.metadata.documentInfo;
    const docId = `${msg.uuid}-doc-${i}`;
    const isExpanded = expandedDocuments.has(docId);
    const content = documentContents.get(docId);

    return (
      <DocumentPreview
        key={docId}
        docId={docId}
        filePath={docInfo.filePath}
        lineCount={docInfo.lineCount}
        wordCount={docInfo.wordCount}
        isMarkdown={docInfo.isMarkdown}
        isExpanded={isExpanded}
        content={content}
        onToggle={() => toggleDocumentExpansion(docId, docInfo.filePath)}
      />
    );
  }

  // Write preview (non-document files) - always expanded
  const hasWritePreview = block.metadata?.writePreview;
  if (hasWritePreview && !isError) {
    // ... write preview rendering
  }

  // Edit diff
  const hasDiff = block.metadata?.diff;
  if (hasDiff && !isError) {
    // ... existing diff rendering
  }
}
```

---

## File Reference Quick Guide

| File | Purpose | Key Lines |
|------|---------|-----------|
| `packages/core/src/orchestrator/CortexOrchestrator.ts` | Metadata injection point | ~1677-1684 |
| `packages/core/src/session/MessageTypes.ts` | Type definitions | ToolResultMetadata |
| `packages/cli/src/ink-ui/CortexApp.tsx` | Main Ink UI, state, keyboard | ~1640-1700, ~2550 |
| `packages/cli/src/ink-ui/CortexApp.tsx` | MessageDisplay component | ~365-534 |
| `packages/cli/src/ink-ui/components/DiffPreview.tsx` | Reference: UnifiedDiffDisplay | Full file |
| `packages/cli/src/commands/chat/interactive.ts` | Chalk UI rendering | ~1217-1330 |
| `packages/cli/src/utils/ToolFormatter.ts` | Chalk formatting helpers | formatDiff(), formatToolResult() |

---

## Relevant Commits

```bash
# Session loading fix (most recent)
524f1270 fix(cli): Display message history when loading sessions in Ink UI

# Edit diff persistence (established the pattern)
b3f4dcce fix(cli): Edit tool diff display persistence in message history

# Recent comprehensive improvements
f00579bb feat(cli): Nexus Cortex CLI comprehensive improvements checkpoint
```

---

## Testing Checklist

### Write Preview
- [ ] Create new file with Write tool
- [ ] Preview shows during streaming with line numbers
- [ ] Preview persists after turn completion
- [ ] Load session with `/continue`, preview renders
- [ ] Works in both Chalk UI and Ink UI

### Document Preview
- [ ] Create markdown file with Write tool
- [ ] Full preview shows during streaming
- [ ] After turn, shows collapsed summary
- [ ] Press `d` to expand, content loads
- [ ] Press `d` again to collapse
- [ ] Delete file, expand shows "[File not found]"
- [ ] Works across session reload

---

## Decision Points for Implementer

1. **Write vs Document detection**: Should be based on file extension. Code files (.ts, .js, .py, etc.) get Write preview. Documents (.md, .txt) get collapsible Document preview.

2. **Large file handling**: For Write preview, truncate at 50 lines with "show more" indicator. For Document preview, lazy loading handles this naturally.

3. **Syntax highlighting**: Optional enhancement - can use existing MarkdownText component patterns or add a generic code highlighter.

4. **Chalk UI document collapse**: The Chalk UI doesn't have interactive keyboard shortcuts during history display. Consider: (a) always show collapsed with note to use Ink UI for expansion, or (b) implement simpler pagination.
