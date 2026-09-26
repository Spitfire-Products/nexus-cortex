/**
 * Session ECHOES (2026-09-26): a hosted box hydrates sessions with `pull --native --project "$PWD"` into
 * ~/.claude/projects/-root/ and its outbound sync captured them back as new sessions under native/claude-code/-root/ —
 * 21 archived ids were stored under two project dirs (all byte-identical) and `canon pull <uuid>` refused them as
 * ambiguous. Sync now skips echoes; pull resolves identical / continued copies and pins with --rel.
 * E2E against a LOCAL bare fixture repo (no network).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { canonArchive, dropEchoedSessions } from '../canonArchive.js';
import { canonPull, canonPullNative } from '../canonPull.js';

const g = (cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
const OLD = { GIT_AUTHOR_DATE: '2026-07-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-07-01T00:00:00Z' };
const ID = '3cf51d5b-bf70-4eb4-9d79-6caf0cfc7855';
const ID2 = '028cc60c-1111-4222-8333-444455556666';
const A = JSON.stringify({ type: 'user', message: { content: 'hi' } }) + '\n';

let tmp: string, bare: string, work: string;
const put = (rel: string, body: string) => {
  fs.mkdirSync(path.join(work, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(work, rel), body);
};
const commit = (msg: string, env: NodeJS.ProcessEnv = {}) => { g(work, ['add', '-A']); g(work, ['commit', '-qm', msg], env); };

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-echo-'));
  bare = path.join(tmp, 'remote.git');
  work = path.join(tmp, 'store');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  execFileSync('git', ['clone', '-q', bare, work], { stdio: ['ignore', 'pipe', 'pipe'] });
  g(work, ['config', 'user.email', 't@t']);
  g(work, ['config', 'user.name', 't']);
  g(work, ['checkout', '-q', '-b', 'main']);
  put('HARNESSES.json', '{}');
  put(`native/claude-code/proj/${ID}.jsonl`, A);
  put(`canon/claude-code/proj/${ID}.jsonl`, A);
  commit('original session');
  g(work, ['push', '-q', 'origin', 'main']);
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('sync skips echoed sessions', () => {
  it('drops an untracked byte-identical copy under another project dir', () => {
    put(`native/claude-code/-root/${ID}.jsonl`, A);
    expect(dropEchoedSessions(work, 'test')).toBe(1);
    expect(g(work, ['status', '--porcelain']).trim()).toBe('');
  });

  it('drops a STAGED echo too (pull-then-add paths stage what they write)', () => {
    put(`native/claude-code/-root/${ID}.jsonl`, A);
    g(work, ['add', '--', `native/claude-code/-root/${ID}.jsonl`]);
    expect(dropEchoedSessions(work, 'test')).toBe(1);
    expect(g(work, ['status', '--porcelain']).trim()).toBe('');
  });

  it('keeps a session continued on the box (bytes differ)', () => {
    put(`native/claude-code/-root/${ID}.jsonl`, A + '{"more":1}\n');
    expect(dropEchoedSessions(work, 'test')).toBe(0);
    expect(fs.existsSync(path.join(work, `native/claude-code/-root/${ID}.jsonl`))).toBe(true);
  });

  it('drops an echo of an ARCHIVED session', async () => {
    put(`native/claude-code/proj/${ID2}.jsonl`, 'x\n');
    commit('old', OLD);
    await canonArchive({ store: work, days: 30, push: false });
    put(`native/claude-code/-root/${ID2}.jsonl`, 'x\n');
    expect(dropEchoedSessions(work, 'test')).toBe(1);
  });

  it('keeps a chunked session whose new part exists nowhere else (whole unit, never split)', () => {
    put(`native/claude-code/proj/${ID2}.jsonl.part-0001`, 'p1\n');
    commit('chunked');
    put(`native/claude-code/-root/${ID2}.jsonl.part-0001`, 'p1\n');
    put(`native/claude-code/-root/${ID2}.jsonl.part-0002`, 'p2\n');
    expect(dropEchoedSessions(work, 'test')).toBe(0);
    expect(fs.existsSync(path.join(work, `native/claude-code/-root/${ID2}.jsonl.part-0001`))).toBe(true);
  });
});

describe('pull resolves stored copies of one session', () => {
  it('canon copies that differ ONLY by their provenance stamp (the live 3cf51d5b case) → pulls one', async () => {
    const stamped = (dir: string) => JSON.stringify({ type: 'user', provenance: { harness: 'claude-code', native: `claude-code/${dir}/${ID}.jsonl`, line: 1 } }) + '\n';
    put(`canon/claude-code/proj/${ID}.jsonl`, stamped('proj'));
    put(`canon/claude-code/-root/${ID}.jsonl`, stamped('-root'));
    commit('stamped echo');
    const out = path.join(tmp, 'out0');
    expect((await canonPull({ store: work, session: ID, to: out })).code).toBe(0);
  });

  it('identical copies under two dirs → pulls one (was: ambiguous, exit 1)', async () => {
    put(`canon/claude-code/-root/${ID}.jsonl`, A);
    commit('echo');
    const out = path.join(tmp, 'out1');
    expect((await canonPull({ store: work, session: ID, to: out })).code).toBe(0);
    expect(fs.readFileSync(path.join(out, `${ID}.jsonl`), 'utf8')).toBe(A);
  });

  it('one copy continued the other → pulls the longer', async () => {
    const longer = A + JSON.stringify({ type: 'user', message: { content: 'more' } }) + '\n';
    put(`canon/claude-code/-root/${ID}.jsonl`, longer);
    commit('continued');
    const out = path.join(tmp, 'out2');
    expect((await canonPull({ store: work, session: ID, to: out })).code).toBe(0);
    expect(fs.readFileSync(path.join(out, `${ID}.jsonl`), 'utf8')).toBe(longer);
  });

  it('divergent copies stay ambiguous until --rel pins one', async () => {
    const other = JSON.stringify({ type: 'user', message: { content: 'different' } }) + '\n';
    put(`canon/claude-code/-root/${ID}.jsonl`, other);
    commit('diverged');
    const out = path.join(tmp, 'out3');
    expect((await canonPull({ store: work, session: ID, to: out })).code).toBe(1);
    expect((await canonPull({ store: work, session: ID, to: out, rel: `claude-code/-root/${ID}.jsonl` })).code).toBe(0);
    expect(fs.readFileSync(path.join(out, `${ID}.jsonl`), 'utf8')).toBe(other);
  });

  it('a session continued in ANOTHER harness stays a choice: --harness picks it', async () => {
    put(`canon/claude-code/-root/${ID}.jsonl`, A); // echo within claude-code (collapses)
    const cx = JSON.stringify({ type: 'user', message: { content: 'resumed in cortex' } }) + '\n';
    put(`canon/nexus-cortex/omniclaude-v4/${ID}.jsonl`, cx);
    commit('cross-harness');
    const out = path.join(tmp, 'out5');
    expect((await canonPull({ store: work, session: ID, to: out })).code).toBe(1);
    expect((await canonPull({ store: work, session: ID, to: out, harness: 'claude-code' })).code).toBe(0);
    expect(fs.readFileSync(path.join(out, `${ID}.jsonl`), 'utf8')).toBe(A);
    expect((await canonPull({ store: work, session: ID, to: out, harness: 'nexus-cortex', force: true })).code).toBe(0);
  });

  it('pull-native resolves identical copies too', async () => {
    put(`native/claude-code/-root/${ID}.jsonl`, A);
    commit('echo native');
    const out = path.join(tmp, 'out4');
    const r = await canonPullNative({ store: work, session: ID, to: out });
    expect(r.code).toBe(0);
    expect(fs.readFileSync(path.join(out, `${ID}.jsonl`), 'utf8')).toBe(A);
  });
});
