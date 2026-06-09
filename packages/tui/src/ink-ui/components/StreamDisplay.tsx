/**
 * StreamDisplay - Sequential display of stream content
 *
 * Renders content in EXACT order it arrives from the core library:
 * thinking → tool call → tool result → thinking → tool call → tool result → conclusion
 *
 * NO accumulation, NO reordering. Just render the sequence.
 */

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Box, Text, useStdout } from 'ink';
import { Colors } from '@nexus-cortex/cli/dist/themes/colors.js';
import type { StreamEvent, IndividualToolCallDisplay } from '../cortex-types.js';
import { StreamEventType, ToolCallStatus } from '../cortex-types.js';
import { DiffPreview, UnifiedDiffDisplay } from './DiffPreview.js';
import { theme } from '../semantic-colors.js';

/**
 * Lightweight inline markdown renderer — no context providers needed.
 * Ported from MarkdownRenderer.ts (fuzzycortex) for visual parity.
 * Handles: headings (4 levels), code blocks with syntax highlighting,
 * bold, italic, inline code, links, blockquotes, lists (ul/ol), HRs.
 */
const SimpleMarkdown: React.FC<{ text: string; width: number }> = ({ text, width }) => {
  const responseColor = theme.text.response ?? theme.text.primary;
  const primaryColor = theme.text.link ?? Colors.AccentCyan;
  const secondaryColor = theme.text.accent ?? Colors.AccentPurple;
  const infoColor = Colors.AccentCyan;
  const codeColor = theme.text.secondary ?? '#888888';

  const lines = text.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeLang = '';
  let lastEmpty = true;
  const INDENT = 2;

  const renderInline = (line: string, color: string): React.ReactNode => {
    const parts: React.ReactNode[] = [];
    let i = 0;
    let key = 0;
    while (i < line.length) {
      // Link: [text](url)
      if (line[i] === '[') {
        const closeBracket = line.indexOf(']', i + 1);
        if (closeBracket > i && line[closeBracket + 1] === '(') {
          const closeParen = line.indexOf(')', closeBracket + 2);
          if (closeParen > closeBracket) {
            const linkText = line.slice(i + 1, closeBracket);
            const url = line.slice(closeBracket + 2, closeParen);
            parts.push(<Text key={key++} color={infoColor}>{linkText}</Text>);
            parts.push(<Text key={key++} dimColor>{` (${url})`}</Text>);
            i = closeParen + 1;
            continue;
          }
        }
      }
      // Inline code
      if (line[i] === '`') {
        const end = line.indexOf('`', i + 1);
        if (end > i) {
          parts.push(<Text key={key++} color={codeColor}>{line.slice(i + 1, end)}</Text>);
          i = end + 1;
          continue;
        }
      }
      // Bold **text**
      if (line[i] === '*' && line[i + 1] === '*') {
        const end = line.indexOf('**', i + 2);
        if (end > i) {
          parts.push(<Text key={key++} bold color={color}>{line.slice(i + 2, end)}</Text>);
          i = end + 2;
          continue;
        }
      }
      // Italic *text* (not ** which is bold)
      if (line[i] === '*' && line[i + 1] !== '*') {
        const end = line.indexOf('*', i + 1);
        if (end > i && line[end + 1] !== '*') {
          parts.push(<Text key={key++} italic color={color}>{line.slice(i + 1, end)}</Text>);
          i = end + 1;
          continue;
        }
      }
      // Regular text — accumulate until next special char
      let j = i + 1;
      while (j < line.length && line[j] !== '`' && line[j] !== '*' && line[j] !== '[') j++;
      parts.push(<Text key={key++} color={color}>{line.slice(i, j)}</Text>);
      i = j;
    }
    return <>{parts}</>;
  };

  const highlightCode = (line: string, lang: string): React.ReactNode => {
    if (!lang || !['typescript', 'javascript', 'ts', 'js', 'tsx', 'jsx'].includes(lang)) {
      return <Text color={codeColor}>{line}</Text>;
    }
    const keywords = /\b(const|let|var|function|class|interface|type|import|export|from|return|if|else|for|while|async|await|new|this|extends|implements|enum|readonly|private|public|protected|static|abstract|override)\b/;
    const parts: React.ReactNode[] = [];
    let remaining = line;
    let key = 0;
    while (remaining.length > 0) {
      // Check for string literals
      const strMatch = remaining.match(/^(["'`])(?:(?=(\\?))\2.)*?\1/);
      if (strMatch) {
        parts.push(<Text key={key++} color="#98c379">{strMatch[0]}</Text>);
        remaining = remaining.slice(strMatch[0].length);
        continue;
      }
      // Check for comments
      if (remaining.startsWith('//')) {
        parts.push(<Text key={key++} dimColor>{remaining}</Text>);
        remaining = '';
        continue;
      }
      // Check for keywords
      const kwMatch = remaining.match(keywords);
      if (kwMatch && kwMatch.index === 0) {
        parts.push(<Text key={key++} color="#c678dd">{kwMatch[0]}</Text>);
        remaining = remaining.slice(kwMatch[0].length);
        continue;
      }
      // Check for numbers
      const numMatch = remaining.match(/^\b\d+(\.\d+)?\b/);
      if (numMatch) {
        parts.push(<Text key={key++} color="#d19a66">{numMatch[0]}</Text>);
        remaining = remaining.slice(numMatch[0].length);
        continue;
      }
      // Take one char of plain code
      const nextSpecial = remaining.slice(1).search(/["'`]|\/\/|\b(?:const|let|var|function|class|interface|type|import|export|from|return|if|else|for|while|async|await|new|this)\b|\b\d/);
      const take = nextSpecial === -1 ? remaining.length : nextSpecial + 1;
      parts.push(<Text key={key++} color={codeColor}>{remaining.slice(0, take)}</Text>);
      remaining = remaining.slice(take);
    }
    return <>{parts}</>;
  };

  const ruleWidth = Math.min(width - INDENT, 80);
  const rule = '─'.repeat(ruleWidth);

  const flushCode = (idx: number) => {
    const lang = codeLang;
    blocks.push(
      <Box key={`code-${idx}`} flexDirection="column" paddingLeft={INDENT}>
        <Text dimColor>{rule}</Text>
        {lang && <Text dimColor>{` [${lang}]`}</Text>}
        {codeLines.map((cl, ci) => (
          <Box key={ci} paddingLeft={INDENT}>
            {highlightCode(cl, lang)}
          </Box>
        ))}
        <Text dimColor>{rule}</Text>
      </Box>
    );
    codeLines = [];
    codeLang = '';
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];

    // Code fence toggle
    if (/^ *(`{3,}|~{3,})/.test(line)) {
      if (inCodeBlock) {
        flushCode(idx);
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        const m = line.match(/(`{3,}|~{3,})\s*(\w*)/);
        codeLang = m?.[2] || '';
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Empty line
    if (!line.trim()) {
      if (!lastEmpty) {
        blocks.push(<Box key={`sp-${idx}`} height={1} />);
        lastEmpty = true;
      }
      continue;
    }
    lastEmpty = false;

    // Headings — per-level colors with spacing, matching MarkdownRenderer
    const hm = line.match(/^(#{1,4})\s+(.*)/);
    if (hm) {
      const level = hm[1].length;
      const hColor = level === 1 ? primaryColor
        : level === 2 ? secondaryColor
        : level === 3 ? infoColor
        : responseColor;
      const spacing = level <= 2;
      blocks.push(
        <Box key={`h-${idx}`} flexDirection="column">
          {spacing && <Box height={1} />}
          <Box paddingLeft={INDENT}>
            <Text bold color={hColor}>{renderInline(hm[2], hColor)}</Text>
          </Box>
          {spacing && <Box height={1} />}
        </Box>
      );
      continue;
    }

    // HR — full width rule
    if (/^[-*_]{3,}\s*$/.test(line.trim())) {
      blocks.push(
        <Box key={`hr-${idx}`}>
          <Text dimColor>{'─'.repeat(Math.min(width, 80))}</Text>
        </Box>
      );
      continue;
    }

    // Blockquote
    if (line.trim().startsWith('> ')) {
      const content = line.trim().substring(2);
      blocks.push(
        <Box key={`bq-${idx}`} paddingLeft={INDENT}>
          <Text dimColor>{'│ '}</Text>
          <Text dimColor wrap="wrap">{renderInline(content, responseColor)}</Text>
        </Box>
      );
      continue;
    }

    // Unordered list — colored bullet
    const ulm = line.match(/^(\s*)([-*+])\s+(.*)/);
    if (ulm) {
      const indent = Math.floor(ulm[1].length / 2);
      blocks.push(
        <Box key={`ul-${idx}`} paddingLeft={INDENT + indent * 2}>
          <Text color={infoColor}>{'• '}</Text>
          <Text wrap="wrap" color={responseColor}>{renderInline(ulm[3], responseColor)}</Text>
        </Box>
      );
      continue;
    }

    // Ordered list — colored number
    const olm = line.match(/^(\s*)(\d+)\.\s+(.*)/);
    if (olm) {
      const indent = Math.floor(olm[1].length / 2);
      blocks.push(
        <Box key={`ol-${idx}`} paddingLeft={INDENT + indent * 2}>
          <Text color={infoColor}>{`${olm[2]}. `}</Text>
          <Text wrap="wrap" color={responseColor}>{renderInline(olm[3], responseColor)}</Text>
        </Box>
      );
      continue;
    }

    // Regular paragraph — indented, matching fuzzycortex's 2-space indent
    blocks.push(
      <Box key={`p-${idx}`} paddingLeft={INDENT}>
        <Text wrap="wrap" color={responseColor}>{renderInline(line, responseColor)}</Text>
      </Box>
    );
  }

  // Flush unclosed code block
  if (inCodeBlock && codeLines.length > 0) flushCode(lines.length);

  return <>{blocks}</>;
};

/**
 * Word-wrap code line to a specific width, breaking at logical points
 */
function wrapCodeLine(text: string, width: number): string[] {
  if (width <= 0 || !text || text.length <= width) return [text];

  const result: string[] = [];
  let remaining = text;

  while (remaining.length > width) {
    let breakPoint = width;
    const breakChars = [' ', ',', '(', ')', '{', '}', '[', ']', '+', '-', '=', '/', '|', '&'];
    for (const char of breakChars) {
      const lastIndex = remaining.lastIndexOf(char, width);
      if (lastIndex > width * 0.4) {
        breakPoint = lastIndex + 1;
        break;
      }
    }
    result.push(remaining.slice(0, breakPoint));
    remaining = remaining.slice(breakPoint);
  }

  if (remaining) {
    result.push(remaining);
  }

  return result.length > 0 ? result : [''];
}

/**
 * Word-wrap text to fit within width, breaking at word boundaries
 */
function wordWrap(text: string, width: number): string[] {
  if (width <= 0 || !text) return [text];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (!word) continue;
    if (!currentLine) {
      currentLine = word;
    } else if (currentLine.length + 1 + word.length <= width) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines.length > 0 ? lines : [''];
}

/**
 * Detect language from file extension
 */
function detectLanguage(filePath: string): string | undefined {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    'py': 'python', 'js': 'javascript', 'ts': 'typescript', 'tsx': 'typescript',
    'jsx': 'javascript', 'rs': 'rust', 'go': 'go', 'java': 'java',
    'c': 'c', 'cpp': 'c++', 'h': 'c', 'rb': 'ruby', 'sh': 'shell',
    'bash': 'shell', 'zsh': 'shell', 'md': 'markdown', 'json': 'json',
    'yaml': 'yaml', 'yml': 'yaml', 'html': 'html', 'css': 'css',
  };
  return ext ? langMap[ext] : undefined;
}

/**
 * Format bytes to human readable size
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Inline Write preview component - shows file content with line numbers
 * (same style as WritePreview for consistency)
 */
const InlineWritePreview: React.FC<{
  filePath: string;
  content: string;
  maxLines?: number;
}> = ({ filePath, content, maxLines = 50 }) => {
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns || 80;
  const lines = useMemo(() => content.split('\n'), [content]);
  const displayLines = useMemo(() => lines.slice(0, maxLines), [lines, maxLines]);
  const truncated = lines.length > maxLines;
  const language = detectLanguage(filePath);
  const byteSize = new TextEncoder().encode(content).length;

  // Calculate code width: terminal - marginLeft(3) - lineNum(7) - some margin
  const codeWidth = Math.max(terminalWidth - 14, 30);

  return (
    <Box flexDirection="column" marginLeft={2} marginTop={0.5}>
      {/* Header - same style as WritePreview */}
      <Box>
        <Text color={Colors.AccentGreen}>+ Creating </Text>
        <Text color={Colors.White} bold>{filePath.split('/').slice(-2).join('/')}</Text>
        <Text dimColor> ({lines.length} lines, {formatBytes(byteSize)})</Text>
        {language && <Text dimColor> [{language}]</Text>}
      </Box>

      {/* Content with line numbers */}
      <Box flexDirection="column" marginLeft={2} marginTop={1}>
        {displayLines.map((line, lineIndex) => {
          const wrappedLines = wrapCodeLine(line, codeWidth);
          return (
            <Box key={lineIndex} flexDirection="column">
              {wrappedLines.map((wrappedLine, wrapIndex) => (
                <Box key={wrapIndex}>
                  {wrapIndex === 0 ? (
                    <Text dimColor>{String(lineIndex + 1).padStart(4, ' ')} │ </Text>
                  ) : (
                    <Text dimColor>{' │ '}</Text>
                  )}
                  <Text>{wrappedLine}</Text>
                </Box>
              ))}
            </Box>
          );
        })}
        {truncated && (
          <Text dimColor>     ... {lines.length - maxLines} more lines</Text>
        )}
      </Box>
    </Box>
  );
};

/**
 * Derive streaming phase from events for indicator display.
 */
function derivePhase(events: StreamEvent[]): string {
  if (events.length === 0) return 'Thinking';
  const last = events[events.length - 1]!;
  if (last.type === StreamEventType.Thinking) return 'Thinking';
  if (last.type === StreamEventType.ToolCall) {
    const name = last.toolCall?.name || 'tool';
    return `Running ${name}`;
  }
  if (last.type === StreamEventType.ToolResult) return 'Thinking';
  return 'Generating';
}

/**
 * Estimate output tokens from accumulated text + thinking chars.
 */
function estimateTokens(events: StreamEvent[]): number {
  let chars = 0;
  for (const e of events) {
    if (e.type === StreamEventType.Text && e.text) chars += e.text.length;
    if (e.type === StreamEventType.Thinking && e.thinking) chars += e.thinking.length;
  }
  return Math.ceil(chars / 4);
}

/**
 * Format elapsed seconds as compact string: "1.2s", "12s", "1m 5s"
 */
function formatElapsed(ms: number): string {
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${Math.floor(s)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  return `${m}m ${rem}s`;
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Streaming indicator: spinner + phase + elapsed + token estimate
 */
const StreamingIndicator: React.FC<{
  events: StreamEvent[];
  startTime: number;
}> = ({ events, startTime }) => {
  const [frame, setFrame] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(f => (f + 1) % SPINNER_FRAMES.length);
      setElapsed(Date.now() - startTime);
    }, 80);
    return () => clearInterval(timer);
  }, [startTime]);

  const phase = derivePhase(events);
  const tokens = estimateTokens(events);
  const timeStr = formatElapsed(elapsed);

  return (
    <Box gap={1}>
      <Text color={Colors.AccentCyan}>{SPINNER_FRAMES[frame]}</Text>
      <Text color={Colors.AccentCyan}>{phase}</Text>
      <Text dimColor>{timeStr}</Text>
      {tokens > 0 && <Text dimColor>~{tokens} tokens</Text>}
    </Box>
  );
};

export interface StreamDisplayProps {
  /** Stream events in order from core library */
  events: StreamEvent[];
  /** Whether stream is still active */
  isStreaming: boolean;
  /** Show thinking content */
  showThinking?: boolean;
  /** Timestamp when streaming started (for elapsed timer) */
  streamStartTime?: number;
  /** Actual usage data from orchestrator response (if available) */
  turnUsage?: { inputTokens: number; outputTokens: number };
}

/**
 * Get status indicator for tool calls
 */
function getToolStatus(status: ToolCallStatus): { color: string; symbol: string } {
  switch (status) {
    case ToolCallStatus.Pending:
      return { color: Colors.AccentYellow, symbol: '○' };
    case ToolCallStatus.Executing:
      return { color: Colors.AccentCyan, symbol: '●' };
    case ToolCallStatus.Success:
      return { color: Colors.AccentGreen, symbol: '✓' };
    case ToolCallStatus.Error:
      return { color: Colors.AccentRed, symbol: '✗' };
    default:
      return { color: Colors.Gray, symbol: '?' };
  }
}

/**
 * Format tool input for display
 */
function formatToolInput(name: string, args?: Record<string, any>): string {
  if (!args) return '';

  const lowerName = name.toLowerCase();
  switch (lowerName) {
    case 'read':
      return args.file_path ? `file: ${args.file_path}` : '';
    case 'write':
      return args.file_path ? `file: ${args.file_path}` : '';
    case 'edit':
      return args.file_path ? `file: ${args.file_path}` : '';
    case 'glob':
      return args.pattern ? `pattern: ${args.pattern}` : '';
    case 'grep':
      return args.pattern ? `pattern: ${args.pattern}` : '';
    case 'bash':
      const cmd = args.command || '';
      return cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd;
    default:
      const first = Object.values(args).find(v => typeof v === 'string');
      if (first) {
        const s = String(first);
        return s.length > 60 ? s.slice(0, 60) + '...' : s;
      }
      return '';
  }
}

/**
 * Format tool result for display
 */
function formatToolResult(name: string, result?: { output?: string; error?: string; isError?: boolean }): string {
  if (!result) return '';
  if (result.isError || result.error) {
    const err = result.error || 'Error';
    return err.length > 80 ? err.slice(0, 80) + '...' : err;
  }
  if (!result.output) return 'Completed';

  const lowerName = name.toLowerCase();
  switch (lowerName) {
    case 'read':
      const lineCount = result.output.split('\n').length;
      return `${lineCount} line${lineCount !== 1 ? 's' : ''} read`;
    case 'write':
      return 'File created/written';
    case 'edit':
      return 'File modified successfully';
    case 'glob':
      const fileCount = result.output.split('\n').filter(Boolean).length;
      return `Found ${fileCount} file${fileCount !== 1 ? 's' : ''}`;
    case 'grep':
      const matchCount = result.output.split('\n').filter(Boolean).length;
      return `Found ${matchCount} match${matchCount !== 1 ? 'es' : ''}`;
    case 'bash':
      const lines = result.output.split('\n').filter(line => line.trim());
      if (lines.length === 0) return 'Command executed';
      if (lines.length === 1) {
        return lines[0].length > 60 ? lines[0].slice(0, 60) + '...' : lines[0];
      }
      return `${lines.length} lines of output`;
    default:
      return result.output.length > 80 ? result.output.slice(0, 80) + '...' : result.output;
  }
}

/**
 * Render a single tool call with its result
 */
const ToolCallItem: React.FC<{
  toolCall: IndividualToolCallDisplay;
  inputArgs?: Record<string, any>;
}> = ({ toolCall, inputArgs }) => {
  const { color, symbol } = getToolStatus(toolCall.status);
  const isExecuting = toolCall.status === ToolCallStatus.Executing || toolCall.status === ToolCallStatus.Pending;
  const isComplete = toolCall.status === ToolCallStatus.Success;
  const result = toolCall.resultDisplay ? formatToolResult(toolCall.name, toolCall.resultDisplay) : '';

  // Special handling for Write operations to show content preview
  const isWriteOperation = toolCall.name.toLowerCase() === 'write' && inputArgs;
  const input = !isWriteOperation ? formatToolInput(toolCall.name, inputArgs) : '';
  const filePath = inputArgs?.file_path;
  const content = inputArgs?.content || '';

  // Special handling for Edit operations with diff (case-insensitive check)
  const isEditOperation = toolCall.name.toLowerCase() === 'edit';
  const hasDiff = toolCall.resultDisplay?.metadata?.diff;
  // Check if we have old/new strings for preview (before approval)
  const oldStr = inputArgs?.old_string;
  const newStr = inputArgs?.new_string;
  const hasPreviewData = isEditOperation && oldStr !== undefined && newStr !== undefined;

  return (
    <Box flexDirection="column" marginY={0.5}>
      <Box>
        <Text color={color}>{symbol} </Text>
        <Text bold>{toolCall.name}</Text>
        {input && <Text dimColor> {input}</Text>}
        {isWriteOperation && filePath && <Text dimColor> file: {filePath}</Text>}
        {isExecuting && !hasPreviewData && <Text color={Colors.AccentCyan} dimColor> (running...)</Text>}
      </Box>

      {/* Show diff preview for pending Edit operations (before approval) */}
      {isEditOperation && isExecuting && hasPreviewData && (
        <Box marginLeft={2}>
          <DiffPreview
            oldString={oldStr}
            newString={newStr}
            filePath={filePath || 'file'}
            compact={false}
          />
        </Box>
      )}

      {/* Show content preview for Write operations - same style as WritePreview */}
      {isWriteOperation && content && filePath && (
        <InlineWritePreview
          filePath={filePath}
          content={content}
          maxLines={50}
        />
      )}

      {/* Show diff for completed Edit operations */}
      {isEditOperation && isComplete && hasDiff && (
        <Box marginLeft={3} marginTop={0.5}>
          <UnifiedDiffDisplay
            diffString={toolCall.resultDisplay!.metadata!.diff!}
            filePath={toolCall.resultDisplay?.metadata?.fileStats?.path || filePath || 'file'}
            compact={false}
            fileStats={toolCall.resultDisplay?.metadata?.fileStats}
          />
        </Box>
      )}

      {/* Show simple result for non-Edit tools or when no diff available */}
      {result && !(isEditOperation && isComplete && hasDiff) && (
        <Box marginLeft={3} marginTop={0.5}>
          <Text dimColor>→ </Text>
          <Text>{result}</Text>
        </Box>
      )}
    </Box>
  );
};

/**
 * Turn summary line — shown after model response completes.
 * CC-style: "duration · input/output tokens"
 */
const TurnSummaryLine: React.FC<{
  durationMs: number;
  events: StreamEvent[];
  usage?: { inputTokens: number; outputTokens: number };
}> = ({ durationMs, events, usage }) => {
  const elapsed = formatElapsed(durationMs);

  const toolCount = events.filter(e => e.type === StreamEventType.ToolCall).length;

  const parts: string[] = [elapsed];

  if (usage && (usage.inputTokens > 0 || usage.outputTokens > 0)) {
    parts.push(`${usage.inputTokens.toLocaleString()} in / ${usage.outputTokens.toLocaleString()} out`);
  } else {
    const estimated = estimateTokens(events);
    if (estimated > 0) parts.push(`~${estimated} tokens`);
  }

  if (toolCount > 0) {
    parts.push(`${toolCount} tool${toolCount !== 1 ? 's' : ''}`);
  }

  return (
    <Box marginTop={1}>
      <Text dimColor>{parts.join(' · ')}</Text>
    </Box>
  );
};

/**
 * Main StreamDisplay - renders events sequentially as they arrive
 */
export const StreamDisplay: React.FC<StreamDisplayProps> = ({
  events,
  isStreaming,
  showThinking: _showThinking = true, // Not used - interleaved thinking always shown
  streamStartTime,
  turnUsage,
}) => {
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns || 80;

  const startTimeRef = useRef(streamStartTime || Date.now());
  useEffect(() => {
    if (streamStartTime) startTimeRef.current = streamStartTime;
  }, [streamStartTime]);

  if (events.length === 0) {
    return isStreaming ? (
      <StreamingIndicator events={events} startTime={startTimeRef.current} />
    ) : null;
  }

  // Consolidate consecutive text/thinking chunks for cleaner display
  // but maintain the sequential order
  const consolidated: Array<{
    type: 'user' | 'text' | 'thinking' | 'tool';
    content?: string;
    toolCall?: IndividualToolCallDisplay;
    toolInputArgs?: Record<string, any>;
    id: string;
  }> = [];

  for (const event of events) {
    const last = consolidated[consolidated.length - 1];

    if (event.type === StreamEventType.UserMessage && event.userMessage) {
      // User message - always add as separate item (never consolidate)
      consolidated.push({ type: 'user', content: event.userMessage, id: event.id });
    } else if (event.type === StreamEventType.Text && event.text) {
      if (last?.type === 'text') {
        last.content = (last.content || '') + event.text;
      } else {
        consolidated.push({ type: 'text', content: event.text, id: event.id });
      }
    } else if (event.type === StreamEventType.Thinking && event.thinking) {
      if (last?.type === 'thinking') {
        last.content = (last.content || '') + event.thinking;
      } else {
        consolidated.push({ type: 'thinking', content: event.thinking, id: event.id });
      }
    } else if (event.type === StreamEventType.ToolCall && event.toolCall) {
      consolidated.push({
        type: 'tool',
        toolCall: event.toolCall,
        toolInputArgs: event.toolInputArgs,
        id: event.id,
      });
    }
  }

  return (
    <Box flexDirection="column">
      {consolidated.map((item) => {
        // User message
        if (item.type === 'user' && item.content) {
          return (
            <Box key={item.id} marginY={1}>
              <Text color={Colors.AccentBlue}>❯ </Text>
              <Text>{item.content}</Text>
            </Box>
          );
        }

        // Interleaved thinking (reasoning between tool calls) - ALWAYS show
        // This is the model's natural reasoning output, not toggleable extended thinking
        if (item.type === 'thinking' && item.content) {
          const thinkingLines = wordWrap(item.content, terminalWidth - 2);
          return (
            <Box key={item.id} flexDirection="column">
              {thinkingLines.map((line, i) => (
                <Text key={i} dimColor italic>{line}</Text>
              ))}
            </Box>
          );
        }

        if (item.type === 'text' && item.content) {
          return (
            <Box key={item.id} flexDirection="row">
              <Box width={2} flexShrink={0}>
                <Text color={theme.text.accent}>{'✦ '}</Text>
              </Box>
              <Box flexGrow={1} flexDirection="column">
                <SimpleMarkdown text={item.content} width={terminalWidth - 2} />
              </Box>
            </Box>
          );
        }

        if (item.type === 'tool' && item.toolCall) {
          return (
            <ToolCallItem
              key={item.id}
              toolCall={item.toolCall}
              inputArgs={item.toolInputArgs}
            />
          );
        }

        return null;
      })}

      {isStreaming && (
        <StreamingIndicator events={events} startTime={startTimeRef.current} />
      )}

      {!isStreaming && events.length > 0 && (
        <TurnSummaryLine
          durationMs={Date.now() - startTimeRef.current}
          events={events}
          usage={turnUsage}
        />
      )}
    </Box>
  );
};

export default StreamDisplay;
