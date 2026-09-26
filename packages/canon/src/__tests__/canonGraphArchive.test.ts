/**
 * Graphs keep archived sessions (2026-09-26): the hot/archive split keeps archive/ out of the worktree, and the live
 * store carried ~4.3k canon sessions ONLY because the 09-20 re-add duplicated them. Once those duplicates are dropped,
 * `canon graph` must read the archived canonical line from git objects — or every project graph shrinks to the last
 * 30 days. E2E against a LOCAL bare fixture repo (no network).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { canonArchive } from '../canonArchive.js';
import { discoverArchivedCanonSessions, sessionLines } from '../canonArchiveRead.js';
import { discoverCanonSessions } from '../canonPull.js';
import { canonGraph } from '../canonGraph.js';

const g = (cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
const OLD = { GIT_AUTHOR_DATE: '2026-07-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-07-01T00:00:00Z' };

const ID = '3cf51d5b-bf70-4eb4-9d79-6caf0cfc7855';
const DIR = 'canon/claude-code/proj';
const MAIN = [
  JSON.stringify({ type: 'user', message: { content: 'hi' } }),
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/work/src/a.ts' } }] } }),
].join('\n') + '\n';
const EVENTS = JSON.stringify({ type: 'ai-title', aiTitle: 'Archived session title' }) + '\n';

let tmp: string, bare: string, work: string, home: string, prevHome: string | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-graph-archive-'));
  bare = path.join(tmp, 'remote.git');
  work = path.join(tmp, 'store');
  home = path.join(tmp, 'home');
  fs.mkdirSync(home);
  prevHome = process.env.HOME;
  process.env.HOME = home; // touched + title caches land in the fixture, never the real ~/.canon
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  execFileSync('git', ['clone', '-q', bare, work], { stdio: ['ignore', 'pipe', 'pipe'] });
  g(work, ['config', 'user.email', 't@t']);
  g(work, ['config', 'user.name', 't']);
  g(work, ['checkout', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(work, 'HARNESSES.json'), '{}');
  fs.mkdirSync(path.join(work, DIR), { recursive: true });
  fs.writeFileSync(path.join(work, DIR, `${ID}.jsonl`), MAIN);
  fs.writeFileSync(path.join(work, DIR, `${ID}.events.jsonl`), EVENTS);
  g(work, ['add', '-A']);
  g(work, ['commit', '-qm', 'old session'], OLD);
  fs.writeFileSync(path.join(work, DIR, 'bbbbbbbb-0000-4000-8000-000000000000.jsonl'), MAIN);
  g(work, ['add', '-A']);
  g(work, ['commit', '-qm', 'live session']);
  g(work, ['push', '-q', 'origin', 'main']);
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('archived canon sessions read from git objects', () => {
  it('lists an archived session with its title, bytes and blob ids, and streams it byte-exact', async () => {
    await canonArchive({ store: work, days: 30, push: true });
    expect(fs.existsSync(path.join(work, DIR, `${ID}.jsonl`))).toBe(false);
    const live = discoverCanonSessions(work).map((s) => s.rel);
    const archived = discoverArchivedCanonSessions(work, live);
    expect(archived.map((s) => s.uuid)).toEqual([ID]);
    const s = archived[0]!;
    expect(s.rel).toBe(`claude-code/proj/${ID}.jsonl`);
    expect(s.title).toBe('Archived session title');
    expect(s.bytes).toBe(Buffer.byteLength(MAIN));
    expect(s.archived?.path).toBe(`archive/2026-07/canon/claude-code/proj/${ID}.jsonl`);
    const lines: string[] = [];
    for await (const l of sessionLines(s)) lines.push(l);
    expect(lines.join('\n') + '\n').toBe(MAIN);
  });

  it('a live copy wins over the archived one (no double count while duplicates exist)', async () => {
    await canonArchive({ store: work, days: 30, push: true });
    fs.writeFileSync(path.join(work, DIR, `${ID}.jsonl`), MAIN); // the 09-20 re-add
    const live = discoverCanonSessions(work).map((s) => s.rel);
    expect(discoverArchivedCanonSessions(work, live)).toEqual([]);
  });

  it('canon graph keeps the archived session (node + touched edge source) and caches it by blob id', async () => {
    await canonArchive({ store: work, days: 30, push: true });
    fs.mkdirSync(path.join(work, 'projects'), { recursive: true });
    fs.writeFileSync(path.join(work, 'projects', 'ROOTS.json'), JSON.stringify({ roots: { proj: '/work' } }));
    g(work, ['add', '-A']);
    g(work, ['commit', '-qm', 'roots']);
    await canonGraph({ store: work });
    const graph = JSON.parse(fs.readFileSync(path.join(work, 'projects', 'proj', 'graph.json'), 'utf8'));
    const sess = graph.nodes.find((n: any) => n.id === `sess:${ID}`);
    expect(sess?.label).toBe('Archived session title');
    expect(sess?.source_file).toBe(`archive/2026-07/canon/claude-code/proj/${ID}.jsonl`);
    expect(graph.nodes.some((n: any) => n.id === 'sess:bbbbbbbb-0000-4000-8000-000000000000')).toBe(true);
    const touchedFromArchived = graph.links.filter((l: any) => l.source === `sess:${ID}` && l.relation === 'touched');
    expect(touchedFromArchived.length).toBeGreaterThan(0);
    const cache = JSON.parse(fs.readFileSync(path.join(home, '.canon', 'touched-cache.json'), 'utf8'));
    expect(cache[`claude-code/proj/${ID}.jsonl`].sig.startsWith('v6|blob|')).toBe(true);
  });
});
