/**
 * R154 HB-IMAGE-REJECTION-HEAL — recognise a provider image rejection and stub the image blocks so
 * the same request build can be retried once.
 */
import { describe, it, expect } from 'vitest';
import { isImageRejectionError, stripRejectedImages, imageRejectionStub } from '../imageRejectionHeal.js';

const DEEPSEEK_MSG = "400 .messages[290].image[0]: You have uploaded an unsupported image. Please make sure your image is valid and has one of the following formats: webp, png, jpeg";

describe('isImageRejectionError', () => {
  it('matches the DeepSeek unsupported-image 400 (status on the error)', () => {
    expect(isImageRejectionError(Object.assign(new Error(DEEPSEEK_MSG), { status: 400 }))).toBe(true);
  });
  it('matches when the status is only in the message text', () => {
    expect(isImageRejectionError(new Error(DEEPSEEK_MSG))).toBe(true);
  });
  it('rejects transport faults and unrelated 400s', () => {
    expect(isImageRejectionError(new Error('Connection error.'))).toBe(false);
    expect(isImageRejectionError(Object.assign(new Error('400 invalid tool schema'), { status: 400 }))).toBe(false);
    expect(isImageRejectionError(Object.assign(new Error('unsupported image'), { status: 503 }))).toBe(false);
    expect(isImageRejectionError(null)).toBe(false);
  });
});

describe('stripRejectedImages', () => {
  it('replaces every image block in user messages with the stub and reports the count', () => {
    const history: any[] = [
      { type: 'user', message: { role: 'user', content: 'plain task text' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'image', image: { mediaType: 'image/png', data: 'x' } }] } },
      { type: 'user', message: { role: 'user', content: [
        { type: 'text', text: '<system-reminder>Visual input</system-reminder>' },
        { type: 'image', image: { mediaType: 'image/png', data: 'iVBOR' } },
      ] } },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
    ];
    const n = stripRejectedImages(history, DEEPSEEK_MSG);
    expect(n).toBe(1);
    const healed = history[2].message.content;
    expect(healed[1].type).toBe('text');
    expect(healed[1].text).toContain('image withheld');
    expect(healed[1].text).toContain('convert(\'RGB\')');
    // assistant-side blocks are never touched; string content is left alone
    expect(history[1].message.content[0].type).toBe('image');
    expect(history[0].message.content).toBe('plain task text');
  });
  it('is a no-op (0) when there is nothing to strip', () => {
    expect(stripRejectedImages([{ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }], 'x')).toBe(0);
  });
  it('stub is short and carries the reason', () => {
    const s = imageRejectionStub('a'.repeat(500));
    expect(s.length).toBeLessThan(600);
    expect(s).toContain('ReadImage');
  });
});
