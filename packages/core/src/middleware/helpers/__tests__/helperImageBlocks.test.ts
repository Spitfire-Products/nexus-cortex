import { describe, it, expect } from 'vitest';
import {
  imageFromBlock,
  hasImageBlocks,
  extractImages,
  markerFor,
  replaceImageBlocks,
} from '../helperImageBlocks.js';

const B64 = 'aGVsbG8='; // "hello"

describe('imageFromBlock — recognizes every image shape the harness produces', () => {
  it('canonical { type:image, image:{mediaType,data} }', () => {
    expect(imageFromBlock({ type: 'image', image: { mediaType: 'image/png', data: B64 } }))
      .toEqual({ mediaType: 'image/png', data: B64 });
  });
  it('anthropic base64 source', () => {
    expect(imageFromBlock({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: B64 } }))
      .toEqual({ mediaType: 'image/jpeg', data: B64 });
  });
  it('openai/chat image_url data-URI', () => {
    expect(imageFromBlock({ type: 'image_url', image_url: { url: `data:image/webp;base64,${B64}` } }))
      .toEqual({ mediaType: 'image/webp', data: B64 });
  });
  it('coerces an unknown media type to image/png', () => {
    expect(imageFromBlock({ type: 'image', image: { mediaType: 'image/tiff', data: B64 } }))
      .toEqual({ mediaType: 'image/png', data: B64 });
  });
  it('is null for non-image blocks', () => {
    expect(imageFromBlock({ type: 'text', text: 'hi' })).toBeNull();
    expect(imageFromBlock({ type: 'tool_use', name: 'Bash' })).toBeNull();
    expect(imageFromBlock({ type: 'tool_result', content: 'x' })).toBeNull();
    expect(imageFromBlock('a string')).toBeNull();
    expect(imageFromBlock(null)).toBeNull();
    expect(imageFromBlock({ type: 'image' })).toBeNull(); // no payload
    expect(imageFromBlock({ type: 'image_url', image_url: { url: 'https://x/y.png' } })).toBeNull(); // not a data URI
  });
});

describe('hasImageBlocks / extractImages', () => {
  it('false/empty for a string or image-free array', () => {
    expect(hasImageBlocks('plain text')).toBe(false);
    expect(hasImageBlocks([{ type: 'text', text: 'x' }])).toBe(false);
    expect(extractImages('plain text')).toEqual([]);
    expect(extractImages([{ type: 'text', text: 'x' }])).toEqual([]);
  });
  it('finds images among mixed blocks, in order', () => {
    const content = [
      { type: 'text', text: 'before' },
      { type: 'image', image: { mediaType: 'image/png', data: 'A' } },
      { type: 'text', text: 'mid' },
      { type: 'image', source: { type: 'base64', media_type: 'image/gif', data: 'B' } },
    ];
    expect(hasImageBlocks(content)).toBe(true);
    expect(extractImages(content)).toEqual([
      { mediaType: 'image/png', data: 'A' },
      { mediaType: 'image/gif', data: 'B' },
    ]);
  });
});

describe('markerFor', () => {
  it('is a compact type-tagged marker (no base64)', () => {
    const m = markerFor({ mediaType: 'image/png', data: B64 });
    expect(m).toBe('[image: image/png]');
    expect(m).not.toContain(B64);
  });
});

describe('replaceImageBlocks — swaps images for text, preserves everything else', () => {
  it('returns a string unchanged', () => {
    expect(replaceImageBlocks('hello', () => 'X')).toBe('hello');
  });
  it('replaces each image with a text block, non-images untouched, imageIndex ordered', () => {
    const content = [
      { type: 'text', text: 'before' },
      { type: 'image', image: { mediaType: 'image/png', data: 'A' } },
      { type: 'tool_use', name: 'Bash' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'B' } },
    ];
    const seen: Array<[string, number]> = [];
    const out = replaceImageBlocks(content, (img, i) => { seen.push([img.mediaType, i]); return `desc-${i}`; }) as any[];
    expect(seen).toEqual([['image/png', 0], ['image/jpeg', 1]]);
    expect(out).toEqual([
      { type: 'text', text: 'before' },
      { type: 'text', text: 'desc-0' },
      { type: 'tool_use', name: 'Bash' },
      { type: 'text', text: 'desc-1' },
    ]);
  });
  it('no base64 survives when the replacer emits a marker', () => {
    const content = [{ type: 'image', image: { mediaType: 'image/png', data: B64 } }];
    const out = replaceImageBlocks(content, (img) => markerFor(img)) as any[];
    expect(JSON.stringify(out)).not.toContain(B64);
    expect(out[0]).toEqual({ type: 'text', text: '[image: image/png]' });
  });
});
