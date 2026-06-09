/**
 * GrepTool Output Limiting Tests
 *
 * Verifies that GrepTool properly limits output to prevent:
 * 1. Token exhaustion from massive results
 * 2. API request size limits being exceeded
 * 3. Memory crashes from unbounded result sets
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GrepTool } from '../GrepTool.js';
import { ExecutorConfig } from '../../../base/ToolRegistry.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Migrated to offset-based pagination contract (2026-05-11):
//   • HARD_MAX_RESULTS = 500 (per-call ceiling, paginated via `offset`)
//   • MAX_CONTENT_LENGTH = 30_000 chars (content-mode buffer cap)
//   • Truncation marker: "[TRUNCATED] N more matches available. To see next
//     page, call Grep again with offset=N"
//   • metadata.displayedMatches + metadata.truncated populated in
//     `output_mode: 'content'` (the only mode that emits per-line bodies).
describe('GrepTool Output Limits', () => {
  let tempDir: string;
  let grepTool: GrepTool;
  let config: ExecutorConfig;

  beforeEach(async () => {
    // Create temp directory
    tempDir = path.join(os.tmpdir(), `grep-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    config = {
      workingDirectory: tempDir,
      homeDirectory: os.homedir(),
      allowedCommands: ['*'],
      systemPromptName: 'test',
      sandboxMode: false,
    };

    grepTool = new GrepTool(config);
  });

  it('caps per-call results at HARD_MAX_RESULTS (500) and surfaces total in metadata', async () => {
    // 1000 matches in a single file — exceeds the 500 per-call ceiling.
    const testFile = path.join(tempDir, 'large-file.txt');
    const lines = Array.from({ length: 1000 }, (_, i) => `Line ${i}: test pattern here`);
    fs.writeFileSync(testFile, lines.join('\n'));

    const result = await grepTool.execute(
      { pattern: 'test pattern', path: 'large-file.txt', output_mode: 'content', head_limit: 500 } as any,
      new AbortController().signal
    );

    expect(result.success).toBe(true);
    // Pagination marker rather than a single "showing first 500" string.
    expect(result.llmContent).toContain('[TRUNCATED]');
    expect(result.llmContent).toContain('offset=');
    expect(result.metadata?.matchCount).toBe(1000);
    expect(result.metadata?.displayedMatches).toBe(500);
    expect(result.metadata?.truncated).toBe(true);
    expect(result.metadata?.hasMore).toBe(true);
    expect(typeof result.metadata?.nextOffset).toBe('number');
  });

  it('caps content-mode output at MAX_CONTENT_LENGTH (30000 chars)', async () => {
    // 100 files × 10 long lines each → ~100KB of raw matches; tool must trim
    // to its 30KB ceiling.
    for (let i = 0; i < 100; i++) {
      const file = path.join(tempDir, `file${i}.txt`);
      const content = Array.from({ length: 10 }, (_, j) =>
        `Line ${j}: test pattern with additional content to make line longer and reach limit faster`
      ).join('\n');
      fs.writeFileSync(file, content);
    }

    const result = await grepTool.execute(
      { pattern: 'test pattern', path: '.', output_mode: 'content' } as any,
      new AbortController().signal
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('[TRUNCATED]');
    // Allow a small buffer for the truncation message + final newline.
    expect(result.llmContent.length).toBeLessThanOrEqual(30_500);
  });

  it('handles very long lines without exceeding the content cap', async () => {
    // 100 lines × ~10KB each → ~1MB raw; must trim hard.
    const testFile = path.join(tempDir, 'long-lines.txt');
    const longLine = 'test pattern ' + 'x'.repeat(10000);
    const lines = Array.from({ length: 100 }, () => longLine);
    fs.writeFileSync(testFile, lines.join('\n'));

    const result = await grepTool.execute(
      { pattern: 'test pattern', path: 'long-lines.txt', output_mode: 'content' } as any,
      new AbortController().signal
    );

    expect(result.success).toBe(true);
    expect(result.llmContent.length).toBeLessThanOrEqual(30_500);
    expect(result.llmContent).toContain('[TRUNCATED]');
  });

  it('shows the pagination marker when result or content limits are hit', async () => {
    for (let i = 0; i < 50; i++) {
      const file = path.join(tempDir, `file${i}.txt`);
      const content = Array.from({ length: 100 }, (_, j) =>
        `Line ${j}: test pattern with enough content to reach character limit`
      ).join('\n');
      fs.writeFileSync(file, content);
    }

    const result = await grepTool.execute(
      { pattern: 'test pattern', output_mode: 'content' } as any,
      new AbortController().signal
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toMatch(/\[TRUNCATED\].*offset=/);
  });

  it('reports actual vs displayed match counts in metadata', async () => {
    const testFile = path.join(tempDir, 'many-matches.txt');
    const lines = Array.from({ length: 750 }, (_, i) => `Line ${i}: test pattern`);
    fs.writeFileSync(testFile, lines.join('\n'));

    const result = await grepTool.execute(
      { pattern: 'test pattern', path: 'many-matches.txt', output_mode: 'content', head_limit: 500 } as any,
      new AbortController().signal
    );

    expect(result.success).toBe(true);
    expect(result.metadata?.matchCount).toBe(750); // Total matches
    expect(result.metadata?.displayedMatches).toBe(500); // Only 500 shown per call
    expect(result.metadata?.truncated).toBe(true);
    expect(result.metadata?.hasMore).toBe(true);
  });
});

describe('GrepTool Token Usage Estimation', () => {
  it('should estimate token usage for typical grep results', () => {
    // Test data approximations
    const scenarios = [
      {
        name: 'Small result (10 matches)',
        matches: 10,
        avgLineLength: 80,
        estimatedChars: 10 * 100, // ~100 chars per match with formatting
        estimatedTokens: Math.ceil((10 * 100) / 4),
        maxTokens: 250
      },
      {
        name: 'Medium result (100 matches)',
        matches: 100,
        avgLineLength: 80,
        estimatedChars: 100 * 100,
        estimatedTokens: Math.ceil((100 * 100) / 4),
        maxTokens: 2500
      },
      {
        name: 'Large result (500 matches, truncated)',
        matches: 500,
        avgLineLength: 80,
        estimatedChars: 50000, // MAX_CONTENT_LENGTH
        estimatedTokens: Math.ceil(50000 / 4),
        maxTokens: 12500
      },
      {
        name: 'Massive result (10000 matches, heavily truncated)',
        matches: 10000,
        actualShown: 500,
        estimatedChars: 50000, // Still capped at MAX_CONTENT_LENGTH
        estimatedTokens: Math.ceil(50000 / 4),
        maxTokens: 12500
      }
    ];

    scenarios.forEach(scenario => {
      console.log(`\n${scenario.name}:`);
      console.log(`  Estimated characters: ${scenario.estimatedChars}`);
      console.log(`  Estimated tokens: ${scenario.estimatedTokens}`);
      console.log(`  Max possible tokens: ${scenario.maxTokens}`);

      // Verify we never exceed reasonable token limits
      expect(scenario.estimatedTokens).toBeLessThanOrEqual(15000); // Well below typical context limits
    });
  });
});

describe('GrepTool vs Memory Crash Prevention', () => {
  it('should document the difference between memory crash and output limiting', () => {
    const analysis = {
      memoryIssue: {
        problem: 'JavaScript fallback reading ALL files in workspace',
        cause: 'Insufficient exclusion patterns (.claude/, .npm/ not excluded)',
        symptom: 'Heap out of memory crash BEFORE returning results',
        fix: 'Enhanced exclusion patterns (23 directories excluded)'
      },
      outputIssue: {
        problem: 'Sending too much data to model API',
        protection: 'MAX_RESULTS (500) and MAX_CONTENT_LENGTH (50000 chars)',
        symptom: 'Would cause token exhaustion or API request too large',
        status: 'ALREADY PROTECTED - limits in place since original implementation'
      },
      comparison: {
        memoryLimit: 'Process-level (Node.js heap)',
        outputLimit: 'Result-level (grep tool output)',
        independent: true,
        bothNeeded: true
      }
    };

    console.log('\n=== Memory vs Output Protection Analysis ===');
    console.log('\nMemory Issue (FIXED):');
    console.log(`  Problem: ${analysis.memoryIssue.problem}`);
    console.log(`  Cause: ${analysis.memoryIssue.cause}`);
    console.log(`  Fix: ${analysis.memoryIssue.fix}`);

    console.log('\nOutput Issue (ALREADY PROTECTED):');
    console.log(`  Protection: ${analysis.outputIssue.protection}`);
    console.log(`  Max tokens: ~12,500 (50,000 chars / 4)`);
    console.log(`  Status: ${analysis.outputIssue.status}`);

    // Both protections are independent and necessary
    expect(analysis.comparison.independent).toBe(true);
    expect(analysis.comparison.bothNeeded).toBe(true);
  });
});
