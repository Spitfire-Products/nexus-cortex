#!/usr/bin/env node
/**
 * Count tokens in a session JSONL file
 *
 * Usage: node count-session-tokens.js <session-id-or-path>
 *
 * Token counting uses cl100k_base approximation (~4 chars per token)
 */

import fs from 'fs';
import path from 'path';

// Approximate token count (cl100k_base averages ~4 chars per token)
function countTokens(text) {
  if (!text) return 0;
  const charCount = text.length;
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

  // Use weighted average of both methods
  const charBasedTokens = Math.ceil(charCount / 4);
  const wordBasedTokens = Math.ceil(wordCount * 1.3);

  return Math.ceil((charBasedTokens + wordBasedTokens) / 2);
}

// Extract text content from a message entry (JSONL line)
function extractTextFromEntry(entry) {
  let text = '';
  const msg = entry.message;

  if (!msg) return '';

  // Handle message.content
  if (msg.content) {
    if (typeof msg.content === 'string') {
      text += msg.content;
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          text += block.text + '\n';
        } else if (block.type === 'thinking' && block.thinking) {
          text += block.thinking + '\n';
        } else if (block.type === 'tool_use' && block.toolUse) {
          // Tool use has input object
          if (block.toolUse.input) {
            text += JSON.stringify(block.toolUse.input) + '\n';
          }
        } else if (block.type === 'tool_result') {
          // Tool result content
          if (block.content) {
            text += (typeof block.content === 'string' ? block.content : JSON.stringify(block.content)) + '\n';
          }
        }
      }
    }
  }

  return text;
}

// Count thinking tokens from entry
function countThinkingTokens(entry) {
  let tokens = 0;
  const msg = entry.message;
  if (!msg || !msg.content || !Array.isArray(msg.content)) return 0;

  for (const block of msg.content) {
    if (block.type === 'thinking' && block.thinking) {
      tokens += countTokens(block.thinking);
    }
  }
  return tokens;
}

// Count tool uses from entry
function countToolUses(entry) {
  let count = 0;
  const msg = entry.message;
  if (!msg || !msg.content || !Array.isArray(msg.content)) return 0;

  for (const block of msg.content) {
    if (block.type === 'tool_use') {
      count++;
    }
  }
  return count;
}

// Count tool result tokens from entry
function countToolResultTokens(entry) {
  let tokens = 0;
  const msg = entry.message;
  if (!msg || !msg.content || !Array.isArray(msg.content)) return 0;

  for (const block of msg.content) {
    if (block.type === 'tool_result' && block.content) {
      const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
      tokens += countTokens(text);
    }
  }
  return tokens;
}

// Main function
async function main() {
  const arg = process.argv[2];

  if (!arg) {
    console.log('Usage: node count-session-tokens.js <session-id-or-path>');
    console.log('');
    console.log('Examples:');
    console.log('  node count-session-tokens.js ff7da63c-26dc-4a26-b5a1-05943d3e3c20');
    console.log('  node count-session-tokens.js /path/to/session.jsonl');
    process.exit(1);
  }

  // Determine file path
  let filePath;
  if (arg.endsWith('.jsonl') && fs.existsSync(arg)) {
    filePath = arg;
  } else {
    // Try common session locations
    const searchPaths = [
      path.join(process.cwd(), '.cortex/sessions', `${arg}.jsonl`),
      path.join('/home/runner/workspace/.cortex/sessions', `${arg}.jsonl`),
      path.join('/home/runner/workspace/nexus-cortex/.cortex/sessions', `${arg}.jsonl`),
    ];

    for (const p of searchPaths) {
      if (fs.existsSync(p)) {
        filePath = p;
        break;
      }
    }
  }

  if (!filePath || !fs.existsSync(filePath)) {
    console.error(`Session not found: ${arg}`);
    console.error('Searched in:');
    console.error('  - Current directory .cortex/sessions/');
    console.error('  - /home/runner/workspace/.cortex/sessions/');
    console.error('  - /home/runner/workspace/nexus-cortex/.cortex/sessions/');
    process.exit(1);
  }

  console.log(`\nAnalyzing session: ${filePath}\n`);

  // Read and parse JSONL
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n').filter(l => l.trim());

  // Stats
  let totalTokens = 0;
  let totalChars = 0;
  const roleStats = {
    user: { count: 0, tokens: 0, chars: 0 },
    assistant: { count: 0, tokens: 0, chars: 0 },
    system: { count: 0, tokens: 0, chars: 0 },
  };

  let thinkingTokens = 0;
  let toolUseCount = 0;
  let toolResultTokens = 0;
  let modelUsed = '';
  let firstTimestamp = '';
  let lastTimestamp = '';

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const role = entry.message?.role || entry.type || 'unknown';
      const text = extractTextFromEntry(entry);
      const tokens = countTokens(text);
      const chars = text.length;

      totalTokens += tokens;
      totalChars += chars;

      // Track model
      if (entry.model?.id && !modelUsed) {
        modelUsed = entry.model.id;
      }

      // Track timestamps
      if (entry.timestamp) {
        if (!firstTimestamp) firstTimestamp = entry.timestamp;
        lastTimestamp = entry.timestamp;
      }

      if (roleStats[role]) {
        roleStats[role].count++;
        roleStats[role].tokens += tokens;
        roleStats[role].chars += chars;
      }

      // Count special content
      thinkingTokens += countThinkingTokens(entry);
      toolUseCount += countToolUses(entry);
      toolResultTokens += countToolResultTokens(entry);

    } catch (e) {
      // Skip invalid JSON lines
    }
  }

  // Calculate duration
  let duration = '';
  if (firstTimestamp && lastTimestamp) {
    const start = new Date(firstTimestamp);
    const end = new Date(lastTimestamp);
    const diffMs = end - start;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours > 0) {
      duration = `${diffHours}h ${diffMins % 60}m`;
    } else {
      duration = `${diffMins}m`;
    }
  }

  // Print results
  console.log('═══════════════════════════════════════════════════════');
  console.log('                    SESSION TOKEN COUNT                 ');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log(`  Model:              ${modelUsed || 'unknown'}`);
  console.log(`  Duration:           ${duration || 'unknown'}`);
  console.log(`  Total Messages:     ${lines.length}`);
  console.log(`  Total Characters:   ${totalChars.toLocaleString()}`);
  console.log(`  Total Tokens (est): ${totalTokens.toLocaleString()}`);
  console.log('');
  console.log('───────────────────────────────────────────────────────');
  console.log('  By Role:');
  console.log('───────────────────────────────────────────────────────');

  for (const [role, stats] of Object.entries(roleStats)) {
    if (stats.count > 0) {
      const pct = totalTokens > 0 ? ((stats.tokens / totalTokens) * 100).toFixed(1) : '0.0';
      console.log(`  ${role.padEnd(12)} ${stats.count.toString().padStart(4)} msgs │ ${stats.tokens.toLocaleString().padStart(8)} tokens (${pct}%)`);
    }
  }

  console.log('');
  console.log('───────────────────────────────────────────────────────');
  console.log('  Special Content:');
  console.log('───────────────────────────────────────────────────────');
  console.log(`  Thinking blocks:    ${thinkingTokens.toLocaleString()} tokens`);
  console.log(`  Tool calls:         ${toolUseCount} calls`);
  console.log(`  Tool results:       ${toolResultTokens.toLocaleString()} tokens`);
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log('Note: Token counts are estimates using cl100k_base approximation');
  console.log('      (~4 chars per token, adjusted for word boundaries)');
}

main().catch(console.error);
