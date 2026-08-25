/**
 * imageFile — pure helpers for the ReadImage tool (backlog item 7, the
 * image-path bridge). Validates a workspace image file by MAGIC BYTES (never
 * trust the extension), enforces provider limits, and produces the base64
 * payload + media type for an image content block.
 *
 * Provider envelope (DeepSeek vision, probe-verified 2026-08-25, the
 * strictest current consumer): JPEG/PNG/GIF/WebP only; ≤32 MiB per inline
 * image; images ride USER messages only; ~384 tokens per image after
 * provider-side resize.
 */

export interface ImagePayload {
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  base64: string;
  bytes: number;
}

/** Default cap mirrors DeepSeek's 32 MiB inline-image limit. */
export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

/** Sniff the image format from magic bytes. Returns null when the buffer is
 *  not one of the four supported formats. */
export function sniffImageMediaType(buf: Buffer): ImagePayload['mediaType'] | null {
  if (buf.length >= 8 &&
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buf.length >= 6) {
    const sig = buf.subarray(0, 6).toString('latin1');
    if (sig === 'GIF87a' || sig === 'GIF89a') return 'image/gif';
  }
  if (buf.length >= 12 &&
      buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
      buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/** Validate + encode an image buffer. Throws with a model-actionable message
 *  on unsupported format or size — the tool surfaces it verbatim. */
export function toImagePayload(buf: Buffer, maxBytes: number = MAX_IMAGE_BYTES): ImagePayload {
  const mediaType = sniffImageMediaType(buf);
  if (!mediaType) {
    throw new Error(
      'Not a supported image (magic-byte check): must be PNG, JPEG, GIF, or WebP. ' +
      'If this is a different format (e.g. BMP/TIFF/PDF), convert it first ' +
      '(e.g. via Bash: python3 -c "from PIL import Image; Image.open(...).save(..., \'PNG\')").',
    );
  }
  if (buf.length > maxBytes) {
    throw new Error(
      `Image too large (${(buf.length / (1024 * 1024)).toFixed(1)} MiB > ` +
      `${Math.floor(maxBytes / (1024 * 1024))} MiB limit). Downscale it first ` +
      '(e.g. via Bash with PIL/ffmpeg), then ReadImage again.',
    );
  }
  return { mediaType, base64: buf.toString('base64'), bytes: buf.length };
}

// ─── Downscale-at-ingest (item 7 addendum) ────────────────────────────────
// The provider resizes to ~800×800 anyway, so a local downscale to the same
// target is LOSSLESS to the model while cutting wire bytes ~100× (the base64
// re-uploads on every turn of the session). Opportunistic: PIL, then
// ImageMagick, else the original passes through (≤ the hard cap).

import { execFile } from 'child_process';
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as pathMod from 'path';

/** Above this, ReadImage attempts a local downscale before encoding.
 *  Env CORTEX_IMAGE_DOWNSCALE_BYTES overrides; 'off' disables. */
export function resolveDownscaleThreshold(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = (env.CORTEX_IMAGE_DOWNSCALE_BYTES ?? '').trim().toLowerCase();
  if (raw === 'off' || raw === 'never') return null;
  if (/^\d+$/.test(raw) && Number(raw) > 0) return Number(raw);
  return 2 * 1024 * 1024; // 2 MiB default
}

function run(cmd: string, args: string[], timeoutMs = 20000): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err) => resolve(!err));
  });
}

/**
 * Best-effort downscale of an image file to fit in maxDim×maxDim (provider
 * parity: 800). Writes the result to a temp file and returns its buffer, or
 * null when no converter is available / conversion fails — caller then uses
 * the original bytes. Never throws.
 */
export async function downscaleImageFile(
  srcPath: string,
  maxDim = 800,
): Promise<Buffer | null> {
  const tmp = pathMod.join(
    os.tmpdir(),
    `cortex-img-${process.pid}-${Date.now().toString(36)}${pathMod.extname(srcPath) || '.png'}`,
  );
  try {
    // 1. PIL (present in bench containers + most dev envs)
    const pilScript =
      `from PIL import Image\n` +
      `im = Image.open(${JSON.stringify(srcPath)})\n` +
      `im.thumbnail((${maxDim}, ${maxDim}))\n` +
      `im.save(${JSON.stringify(tmp)})\n`;
    if (await run('python3', ['-c', pilScript])) {
      const buf = await fsp.readFile(tmp).catch(() => null);
      if (buf && buf.length > 0 && sniffImageMediaType(buf)) return buf;
    }
    // 2. ImageMagick
    if (await run('convert', [srcPath, '-resize', `${maxDim}x${maxDim}>`, tmp])) {
      const buf = await fsp.readFile(tmp).catch(() => null);
      if (buf && buf.length > 0 && sniffImageMediaType(buf)) return buf;
    }
    return null;
  } catch {
    return null;
  } finally {
    fsp.unlink(tmp).catch(() => {});
  }
}
