/**
 * SimpleMarkdown — line-level markdown renderer for Ink.
 *
 * Extracted from StreamDisplay.tsx (2026-08-27) so the SAME renderer draws BOTH
 * the live stream AND the completed/history turn — eliminating the layout
 * "mutation on completion" (operator gripe: the streamed layout is more readable
 * than the block-level re-render). This is now the single source of truth;
 * CortexApp history sites use it instead of MarkdownText.
 *
 * Line-level (preserves the model's own line breaks) — no paragraph re-grouping.
 * Handles: headings (4 levels), fenced code (with TS/JS syntax highlighting),
 * bold, italic, inline code, links, blockquotes, ul/ol lists, HRs, and GFM
 * tables (added 2026-08-27).
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '@nexus-cortex/cli/dist/themes/colors.js';
import { theme } from '../semantic-colors.js';

export const SimpleMarkdown: React.FC<{ text: string; width: number }> = ({ text, width }) => {
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
      const strMatch = remaining.match(/^(["'`])(?:(?=(\\?))\2.)*?\1/);
      if (strMatch) {
        parts.push(<Text key={key++} color="#98c379">{strMatch[0]}</Text>);
        remaining = remaining.slice(strMatch[0].length);
        continue;
      }
      if (remaining.startsWith('//')) {
        parts.push(<Text key={key++} dimColor>{remaining}</Text>);
        remaining = '';
        continue;
      }
      const kwMatch = remaining.match(keywords);
      if (kwMatch && kwMatch.index === 0) {
        parts.push(<Text key={key++} color="#c678dd">{kwMatch[0]}</Text>);
        remaining = remaining.slice(kwMatch[0].length);
        continue;
      }
      const numMatch = remaining.match(/^\b\d+(\.\d+)?\b/);
      if (numMatch) {
        parts.push(<Text key={key++} color="#d19a66">{numMatch[0]}</Text>);
        remaining = remaining.slice(numMatch[0].length);
        continue;
      }
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

  // ── GFM tables (added 2026-08-27) ──────────────────────────────────────────
  // Visible length after stripping inline markdown markers (for column sizing).
  const visibleLen = (s: string): number =>
    s.replace(/\*\*/g, '').replace(/`/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').length;
  // Split a "| a | b |" row into trimmed cells (drop the empty leading/trailing).
  const splitRow = (l: string): string[] => {
    const cells = l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    return cells;
  };
  const isSeparatorRow = (l: string): boolean =>
    /\|/.test(l) && /^[\s|:-]+$/.test(l.trim()) && /-/.test(l);

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

    // GFM table: a pipe row immediately followed by a separator row.
    if (line.includes('|') && idx + 1 < lines.length && isSeparatorRow(lines[idx + 1])) {
      const header = splitRow(line);
      const ncols = header.length;
      const dataRows: string[][] = [];
      let j = idx + 2;
      while (j < lines.length && lines[j].includes('|') && lines[j].trim()) {
        const cells = splitRow(lines[j]);
        while (cells.length < ncols) cells.push('');
        dataRows.push(cells.slice(0, ncols));
        j++;
      }
      // Natural column widths (header + data), then shrink to fit terminal width.
      const colW = header.map((h, ci) =>
        Math.max(visibleLen(h), ...dataRows.map((r) => visibleLen(r[ci] || ''))));
      const avail = Math.max(20, width - INDENT);
      const sepOverhead = 3 * (ncols - 1);
      let total = colW.reduce((a, b) => a + b, 0) + sepOverhead;
      if (total > avail) {
        const scale = (avail - sepOverhead) / (total - sepOverhead);
        for (let ci = 0; ci < ncols; ci++) colW[ci] = Math.max(3, Math.floor(colW[ci] * scale));
      }
      const cellBox = (content: string, ci: number, bold: boolean, color: string) => (
        <Box key={ci} width={colW[ci]} flexShrink={0}>
          <Text bold={bold} color={color} wrap="truncate">{renderInline(content, color)}</Text>
        </Box>
      );
      const sepText = colW.map((w) => '─'.repeat(w));
      blocks.push(
        <Box key={`tbl-${idx}`} flexDirection="column" paddingLeft={INDENT} marginY={0}>
          <Box>
            {header.map((h, ci) => (
              <React.Fragment key={ci}>
                {ci > 0 && <Text dimColor>{' │ '}</Text>}
                {cellBox(h, ci, true, primaryColor)}
              </React.Fragment>
            ))}
          </Box>
          <Box>
            {sepText.map((s, ci) => (
              <React.Fragment key={ci}>
                {ci > 0 && <Text dimColor>{'─┼─'}</Text>}
                <Text dimColor>{s}</Text>
              </React.Fragment>
            ))}
          </Box>
          {dataRows.map((row, ri) => (
            <Box key={ri}>
              {row.map((c, ci) => (
                <React.Fragment key={ci}>
                  {ci > 0 && <Text dimColor>{' │ '}</Text>}
                  {cellBox(c, ci, false, responseColor)}
                </React.Fragment>
              ))}
            </Box>
          ))}
        </Box>
      );
      idx = j - 1; // advance past the consumed table
      continue;
    }

    // Headings — per-level colors with spacing
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

    // Regular paragraph — indented, line-level (preserves the model's breaks)
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

export default SimpleMarkdown;
