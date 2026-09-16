/**
 * R154 HB-IMAGE-REJECTION-HEAL (2026-09-16, tb4-flash-v3 retro-console-soc).
 *
 * A ReadImage result rides into the next request as an `image` content block. When the provider
 * rejects that block (DeepSeek: `400 .messages[290].image[0]: You have uploaded an unsupported
 * image ...` on an 8-bit grayscale PNG the model had just generated), the continuation call throws
 * AFTER the tool batch executed, the loop leaves (already-executed guard), and the R29a synthesis
 * call re-sends the same history and fails on the same block — the session ends with no answer
 * (retro-console-soc: iteration 133 of an 8-hour budget, 43 min in, 4/8 tests).
 *
 * The heal is provider-agnostic: recognise the rejection, replace every image block in the user
 * history with a short text stub that tells the model what happened and how to re-encode, and let
 * the caller retry the SAME request build once. Nothing else in the history changes.
 */

const IMAGE_REJECTION_RES = [
  /unsupported image/i,
  /invalid image/i,
  /image\[\d+\]/i,
  /could not (decode|process|load) (the )?image/i,
  /image (format|type) (is )?(not supported|unsupported|invalid)/i,
  /unsupported (media|mime) type.*image/i,
];

/** True when an API error is the provider refusing an image block (a request-shape 4xx, not transport). */
export function isImageRejectionError(err: unknown): boolean {
  const e = err as any;
  const msg = String(e?.message ?? e?.error?.message ?? e ?? '');
  if (!msg) return false;
  const status = Number(e?.status ?? e?.statusCode ?? e?.response?.status ?? NaN);
  const looksClientError = Number.isFinite(status) ? status >= 400 && status < 500 : /\b4\d\d\b/.test(msg);
  return looksClientError && IMAGE_REJECTION_RES.some((re) => re.test(msg));
}

export function imageRejectionStub(reason: string): string {
  const r = reason.replace(/\s+/g, ' ').trim().slice(0, 200);
  return (
    `[image withheld: the model provider rejected this image (${r}). ` +
    `If you still need it, re-encode it as an 8-bit RGB PNG or JPEG ` +
    `(e.g. python3 -c "from PIL import Image; Image.open('in.png').convert('RGB').save('out.png')") ` +
    `and call ReadImage on the new file.]`
  );
}

/**
 * Replace every `image` block in user messages of `history` (the orchestrator's messageHistory
 * records: `{ type, message: { role, content } }`) with a text stub. Returns the number of blocks
 * replaced. Mutates in place so the caller's next request build sees the healed history.
 */
export function stripRejectedImages(history: any[], reason: string): number {
  let n = 0;
  const stub = imageRejectionStub(reason);
  for (const rec of history) {
    const msg = rec?.message ?? rec;
    if (!msg || msg.role !== 'user') continue;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (let i = 0; i < content.length; i++) {
      const b = content[i];
      if (b && typeof b === 'object' && b.type === 'image') {
        content[i] = { type: 'text', text: stub };
        n++;
      }
    }
  }
  return n;
}
