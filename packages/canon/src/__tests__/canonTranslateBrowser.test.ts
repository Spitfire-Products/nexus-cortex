/**
 * browser-cortex → canon translate branch: identity + provenance stamp + the
 * shared structural repairs, over a real throwaway git store (bare origin
 * absorbs the push). Fixture records mirror the SPA CanonSyncService
 * serializer's exact envelope.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { canonTranslate } from '../canonTranslate.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-bc-'));
const STORE = path.join(tmp, 'store');
const BARE = path.join(tmp, 'bare.git');
const git = (dir: string, args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' });

const RECORDS = [
  { uuid: 'u1', timestamp: '2026-08-03T00:00:01.000Z', type: 'user', message: { role: 'user', content: 'hello' }, timeline: { sessionId: 'bc-1', conversationId: 'bc-1', turnNumber: 1 } },
  { uuid: 'a1', parentUuid: 'u1', timestamp: '2026-08-03T00:00:02.000Z', type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }, { type: 'tool_use', id: 't1', name: 'scan', input: {} }] }, timeline: { sessionId: 'bc-1', conversationId: 'bc-1', turnNumber: 1 }, model: { id: 'claude-sonnet-4-5', provider: 'anthropic', apiPattern: 'messages' } },
  { uuid: 'r1', parentUuid: 'a1', timestamp: '2026-08-03T00:00:03.000Z', type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] }, timeline: { sessionId: 'bc-1', conversationId: 'bc-1', turnNumber: 1 } },
  { uuid: 'orphan-r', timestamp: '2026-08-03T00:00:04.000Z', type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't-gone', content: 'orphaned' }] }, timeline: { sessionId: 'bc-1', conversationId: 'bc-1', turnNumber: 1 } },
];

beforeAll(() => {
  execFileSync('git', ['init', '-q', '-b', 'main', '--bare', BARE]);
  execFileSync('git', ['init', '-q', '-b', 'main', STORE]);
  git(STORE, ['remote', 'add', 'origin', BARE]);
  const native = path.join(STORE, 'native', 'browser-cortex');
  fs.mkdirSync(native, { recursive: true });
  fs.writeFileSync(path.join(native, 'bc-1.jsonl'), RECORDS.map((r) => JSON.stringify(r)).join('\n') + '\n');
  git(STORE, ['add', '-A']);
  git(STORE, ['commit', '-q', '-m', 'seed']);
  git(STORE, ['push', '-q', 'origin', 'main']);
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('canonTranslate — browser-cortex branch', () => {
  it('translates /native/browser-cortex into the canonical line with repairs + projection ref', async () => {
    // Isolate the incremental manifest from the real $HOME.
    const savedHome = process.env.HOME;
    process.env.HOME = tmp;
    let result;
    try { result = await canonTranslate({ store: STORE }); }
    finally { process.env.HOME = savedHome; }
    expect(result.errors).toEqual([]);

    const out = fs.readFileSync(path.join(STORE, 'canon', 'browser-cortex', 'bc-1.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l));

    // Identity: originals carried verbatim + provenance stamped.
    const u1 = out.find((r) => r.uuid === 'u1');
    expect(u1.message).toEqual({ role: 'user', content: 'hello' });
    expect(u1.provenance).toMatchObject({ harness: 'browser-cortex', native: 'native/browser-cortex/bc-1.jsonl', line: 1 });

    // Shared orphan-result repair: synthetic tool_use precedes the orphan.
    const synthIdx = out.findIndex((r) => r.synthetic === 'canon-orphan-result-repair');
    const orphanIdx = out.findIndex((r) => r.uuid === 'orphan-r');
    expect(synthIdx).toBeGreaterThan(-1);
    expect(synthIdx).toBeLessThan(orphanIdx);
    expect(out[synthIdx].message.content[0]).toMatchObject({ type: 'tool_use', id: 't-gone' });

    // Projection: canon IS the cortex dialect — ref materialized.
    const ref = fs.readFileSync(path.join(STORE, 'projections', 'nexus-cortex', 'browser-cortex', 'bc-1.jsonl.ref'), 'utf8').trim();
    expect(ref).toBe('canon/browser-cortex/bc-1.jsonl');
  });
});
