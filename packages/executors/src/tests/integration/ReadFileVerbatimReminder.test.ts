/**
 * #10 — Read tool injects a <system-reminder> about verbatim transcription.
 *
 * Bench 3 of the 2026-05-10 audit caught grok-code-fast-1 reading a TypeScript
 * `export const PolicyPriority = { ... } as const` declaration and then
 * writing `export enum PolicyPriority { ... }` to its output file — a
 * structurally different declaration form that the model confabulated from
 * training-data priors rather than transcribing what `Read` returned.
 *
 * Mitigation: every successful Read result is prefixed with a
 * <system-reminder> block warning the model to transcribe verbatim if the
 * content feeds a subsequent Write/Edit. Models filter <system-reminder>
 * blocks from "quote verbatim" contexts (per the user's
 * feedback_system_reminder_filtering memory) so the reminder doesn't pollute
 * write content when the model is asked to copy a section exactly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';
import { ReadFileTool } from '../../implementations/file/ReadFileTool.js';

describe('#10 — ReadFileTool injects verbatim-transcription reminder', () => {
  let tool: ReadFileTool;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(tmpdir(), 'read-reminder-'));
    tool = new ReadFileTool({ workingDirectory: tmpDir });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function writeFixture(name: string, content: string): Promise<string> {
    const fp = path.join(tmpDir, name);
    await fs.writeFile(fp, content, 'utf-8');
    return fp;
  }

  it('prepends a <system-reminder> block before the file content', async () => {
    const fp = await writeFixture('a.ts', 'export const X = 1;\n');
    const result = await tool.execute({ file_path: fp }, new AbortController().signal);
    expect(result.success ?? !result.isError).toBe(true);

    const out = String(result.llmContent ?? result.output ?? '');
    expect(out).toContain('<system-reminder>');
    expect(out).toContain('</system-reminder>');
    // The reminder must precede the actual content so the model sees it first.
    const reminderIdx = out.indexOf('<system-reminder>');
    const contentIdx = out.indexOf('export const X = 1;');
    expect(reminderIdx).toBeGreaterThanOrEqual(0);
    expect(contentIdx).toBeGreaterThan(reminderIdx);
  });

  it('reminder text targets the confabulation failure mode', async () => {
    const fp = await writeFixture('b.ts', 'const Y = 2;\n');
    const result = await tool.execute({ file_path: fp }, new AbortController().signal);
    const out = String(result.llmContent ?? result.output ?? '');

    // Must mention verbatim transcription so the model's planning step picks
    // up the hint when synthesizing Write/Edit inputs from this content.
    expect(out.toLowerCase()).toContain('verbatim');
    // Should warn against the specific failure mode bench 3 surfaced:
    // converting between declaration forms (e.g. `const ... as const` ↔ `enum`).
    expect(out.toLowerCase()).toMatch(/declaration form|paraphras|restructur/);
  });

  it('reminder appears even when file is truncated', async () => {
    // Build a long-ish file so default offset/limit triggers truncation.
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
    const fp = await writeFixture('long.txt', lines.join('\n'));
    const result = await tool.execute(
      { file_path: fp, limit: 10 },
      new AbortController().signal,
    );
    const out = String(result.llmContent ?? result.output ?? '');
    expect(out).toContain('<system-reminder>');
    expect(out).toContain('line 1');
  });

  it('does NOT add the reminder to error results', async () => {
    const result = await tool.execute(
      { file_path: '/nonexistent/path/xyz.txt' },
      new AbortController().signal,
    );
    const out = String(result.llmContent ?? result.output ?? '');
    expect(out).not.toContain('<system-reminder>');
  });
});
