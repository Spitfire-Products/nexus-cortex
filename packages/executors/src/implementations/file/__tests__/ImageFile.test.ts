/**
 * imageFile — magic-byte sniffing + payload validation (backlog item 7).
 * Never trust extensions; reject unsupported formats with actionable advice.
 */

import { describe, it, expect } from 'vitest';
import { sniffImageMediaType, toImagePayload, MAX_IMAGE_BYTES } from '../imageFile.js';

// Minimal real headers
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const TEXT = Buffer.from('PORT = 8080\n');
const BMP = Buffer.from('BM\x00\x00\x00\x00', 'latin1');

describe('sniffImageMediaType', () => {
  it('identifies all four supported formats by magic bytes', () => {
    expect(sniffImageMediaType(PNG)).toBe('image/png');
    expect(sniffImageMediaType(JPEG)).toBe('image/jpeg');
    expect(sniffImageMediaType(GIF)).toBe('image/gif');
    expect(sniffImageMediaType(WEBP)).toBe('image/webp');
  });
  it('rejects text, BMP, empty', () => {
    expect(sniffImageMediaType(TEXT)).toBeNull();
    expect(sniffImageMediaType(BMP)).toBeNull();
    expect(sniffImageMediaType(Buffer.alloc(0))).toBeNull();
  });
});

describe('toImagePayload', () => {
  it('encodes a valid image with correct media type and size', () => {
    const p = toImagePayload(PNG);
    expect(p.mediaType).toBe('image/png');
    expect(p.bytes).toBe(PNG.length);
    expect(Buffer.from(p.base64, 'base64').equals(PNG)).toBe(true);
  });
  it('throws actionable error on unsupported format', () => {
    expect(() => toImagePayload(TEXT)).toThrow(/PNG, JPEG, GIF, or WebP/);
    expect(() => toImagePayload(TEXT)).toThrow(/convert it first/i);
  });
  it('throws actionable error above the size cap', () => {
    expect(() => toImagePayload(PNG, 4)).toThrow(/too large/i);
    expect(() => toImagePayload(PNG, 4)).toThrow(/Downscale/i);
  });
  it('default cap is the DeepSeek 32 MiB inline limit', () => {
    expect(MAX_IMAGE_BYTES).toBe(32 * 1024 * 1024);
  });
});
