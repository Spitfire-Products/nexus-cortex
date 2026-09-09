/**
 * helperImageBlocks — pure image-block normalization for the helper overflow paths.
 *
 * The context-overflow handlers (compaction + tool-result summarization) flatten message
 * content to text for a cheap helper model. Before this module they DROPPED image blocks
 * (renderBlock's `return ''` fallthrough) or JSON.stringify'd them into a base64 text blob
 * (handleToolResultOverflow) — either way the visual information was lost AND, in the
 * stringify case, the giant base64 tripped the summarizer to "summarize" gibberish.
 *
 * This module recognizes an image block in every shape the harness produces and lets the
 * middleware DESCRIBE-then-REPLACE it (base64 image → one line of vision-helper text) so the
 * information survives compaction and the context actually shrinks. Pure + unit-tested; the
 * vision call itself lives in HelperModelMiddleware (describeImage).
 */

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export interface NormalizedImage {
  mediaType: ImageMediaType;
  /** raw base64 (no data: prefix) */
  data: string;
}

const MEDIA_TYPES: ReadonlyArray<ImageMediaType> = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

function coerceMediaType(v: unknown): ImageMediaType {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return (MEDIA_TYPES as ReadonlyArray<string>).includes(s) ? (s as ImageMediaType) : 'image/png';
}

/**
 * Normalize a single content block to a {mediaType, data} image, or null if it is not an image.
 * Handles the three shapes the harness / providers use:
 *   - canonical      { type:'image', image:{ mediaType, data } }        (harness native, injectImageUserMessage)
 *   - anthropic      { type:'image', source:{ type:'base64', media_type, data } }
 *   - openai/chat    { type:'image_url', image_url:{ url:'data:<mt>;base64,<data>' } }
 */
export function imageFromBlock(block: unknown): NormalizedImage | null {
  if (!block || typeof block !== 'object') return null;
  const b = block as Record<string, any>;

  // canonical
  if (b.type === 'image' && b.image && typeof b.image.data === 'string') {
    return { mediaType: coerceMediaType(b.image.mediaType), data: b.image.data };
  }
  // anthropic base64 source
  if (b.type === 'image' && b.source && b.source.type === 'base64' && typeof b.source.data === 'string') {
    return { mediaType: coerceMediaType(b.source.media_type), data: b.source.data };
  }
  // openai/chat data-URI
  if (b.type === 'image_url' && b.image_url && typeof b.image_url.url === 'string') {
    const m = /^data:(image\/[a-z+]+);base64,(.*)$/is.exec(b.image_url.url.trim());
    if (m && m[2]) return { mediaType: coerceMediaType(m[1]), data: m[2] };
  }
  return null;
}

/** True if `content` is a block array containing at least one image block. */
export function hasImageBlocks(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some((b) => imageFromBlock(b) !== null);
}

/** All normalized images in a block array, in order (empty for a string or image-free array). */
export function extractImages(content: unknown): NormalizedImage[] {
  if (!Array.isArray(content)) return [];
  const out: NormalizedImage[] = [];
  for (const b of content) {
    const img = imageFromBlock(b);
    if (img) out.push(img);
  }
  return out;
}

/** A compact text marker for an image block (the no-vision fallback). */
export function markerFor(img: NormalizedImage): string {
  return `[image: ${img.mediaType}]`;
}

/**
 * Return a NEW content array with every image block replaced by a text block whose text is
 * `replace(image, imageIndex)`. Non-image blocks are passed through untouched; a string
 * `content` (no blocks) is returned unchanged. `imageIndex` counts only image blocks, in order,
 * so the caller can align it with a parallel array of descriptions.
 */
export function replaceImageBlocks(
  content: unknown,
  replace: (img: NormalizedImage, imageIndex: number) => string,
): unknown {
  if (!Array.isArray(content)) return content;
  let imageIndex = 0;
  return content.map((b) => {
    const img = imageFromBlock(b);
    if (!img) return b;
    const text = replace(img, imageIndex++);
    return { type: 'text', text };
  });
}
