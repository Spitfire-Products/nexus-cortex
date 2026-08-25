/**
 * ReadImageTool — the READ half of the binary bridge (backlog item 7).
 * Loads real files, sniffs magic bytes, carries the payload in metadata for
 * the orchestrator to consume, registers the read (frame coherence).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsp from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';
import { ReadImageTool } from '../../implementations/file/ReadImageTool.js';
import { FileReadTracker, EditTool } from '../../implementations/file/EditTool.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1]);
const signal = new AbortController().signal;

let dir: string;
let tool: ReadImageTool;
let config: ExecutorConfig;

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(tmpdir(), 'readimage-'));
  config = { workingDirectory: dir } as ExecutorConfig;
  tool = new ReadImageTool(config);
  FileReadTracker.clearSession();
});

afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

describe('ReadImageTool', () => {
  it('loads a PNG: text summary + payload in metadata', async () => {
    const p = path.join(dir, 'shot.png');
    await fsp.writeFile(p, PNG);
    const r = await tool.execute({ file_path: p }, signal);
    expect(r.success).toBe(true);
    expect(String(r.llmContent)).toMatch(/shot\.png.*image\/png/s);
    expect(String(r.llmContent)).toMatch(/attached as visual input/i);
    const payload = (r.metadata as any).imagePayload;
    expect(payload.mediaType).toBe('image/png');
    expect(Buffer.from(payload.base64, 'base64').equals(PNG)).toBe(true);
  });

  it('resolves relative paths against the working directory', async () => {
    await fsp.writeFile(path.join(dir, 'rel.png'), PNG);
    const r = await tool.execute({ file_path: 'rel.png' }, signal);
    expect(r.success).toBe(true);
  });

  it('sniffs content, not extension: text file named .png is refused with advice', async () => {
    const p = path.join(dir, 'fake.png');
    await fsp.writeFile(p, 'not an image');
    const r = await tool.execute({ file_path: p }, signal);
    expect(r.success).toBe(false);
    expect(String(r.llmContent)).toMatch(/PNG, JPEG, GIF, or WebP/);
  });

  it('missing file errors cleanly', async () => {
    const r = await tool.execute({ file_path: path.join(dir, 'nope.png') }, signal);
    expect(r.success).toBe(false);
    expect(String(r.llmContent)).toMatch(/not found/i);
  });

  it('registers the read: a subsequent Edit of the image path is legal', async () => {
    const p = path.join(dir, 'diagram.png');
    await fsp.writeFile(p, PNG);
    await tool.execute({ file_path: p }, signal);
    expect(FileReadTracker.hasBeenRead(p)).toBe(true);
  });
});

describe('downscale-at-ingest (item 7 addendum)', () => {
  const havePil = (() => {
    try {
      require('child_process').execFileSync('python3', ['-c', 'import PIL'], { timeout: 10000 });
      return true;
    } catch { return false; }
  })();

  it.skipIf(!havePil)('large image is downscaled before encoding (provider parity)', async () => {
    const p = path.join(dir, 'big.png');
    // Generate a genuinely large PNG via PIL (random noise defeats compression)
    require('child_process').execFileSync('python3', ['-c', `
from PIL import Image
import os
im = Image.frombytes('RGB', (2400, 2400), os.urandom(2400*2400*3))
im.save(${JSON.stringify(p)})
`], { timeout: 30000 });
    const big = (await fsp.stat(p)).size;
    expect(big).toBeGreaterThan(2 * 1024 * 1024);
    const r = await tool.execute({ file_path: p }, signal);
    expect(r.success).toBe(true);
    const payload = (r.metadata as any).imagePayload;
    expect(payload.bytes).toBeLessThan(big / 4);
    expect(String(r.llmContent)).toMatch(/downscaled/i);
  }, 60000);

  it.skipIf(!havePil)('small image passes through untouched', async () => {
    const p = path.join(dir, 'small2.png');
    require('child_process').execFileSync('python3', ['-c', `
from PIL import Image
Image.new('RGB', (300, 100), 'white').save(${JSON.stringify(p)})
`], { timeout: 30000 });
    const orig = await fsp.readFile(p);
    const r = await tool.execute({ file_path: p }, signal);
    const payload = (r.metadata as any).imagePayload;
    expect(Buffer.from(payload.base64, 'base64').equals(orig)).toBe(true);
    expect(String(r.llmContent)).not.toMatch(/downscaled/i);
  }, 60000);
});
