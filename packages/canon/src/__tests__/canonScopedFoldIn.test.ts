/**
 * A SCOPED sync never re-commits archived browser sessions (2026-09-26 night): the autoresearch sandbox's
 * `nexus-canon sync --scope autoresearch` folded every browser-cortex branch into its sparse clone; those files sit
 * OUTSIDE the cone, the archived-duplicate guard's `git rm` was refused there, and each job re-committed 75 archived
 * browser sessions (store commit a9018d02e) for the next archive run to drop again. E2E on a LOCAL bare fixture.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { canonSync } from '../canonSync.js';
import { dropArchivedDuplicates } from '../canonArchive.js';

const g = (cwd: string, args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const BODY = JSON.stringify({ type: 'user', message: { content: 'old browser session' } }) + '\n';
const REL = 'native/browser-cortex/u1/s1.jsonl';

let tmp: string, bare: string, home: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-scoped-foldin-'));
  bare = path.join(tmp, 'remote.git');
  home = path.join(tmp, 'home');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  execFileSync('git', ['-C', bare, 'config', 'uploadpack.allowFilter', 'true']);
  const seed = path.join(tmp, 'seed');
  execFileSync('git', ['init', '-q', '-b', 'main', seed]);
  g(seed, ['config', 'user.email', 't@t']); g(seed, ['config', 'user.name', 't']);
  fs.writeFileSync(path.join(seed, 'HARNESSES.json'), '{}');
  fs.mkdirSync(path.join(seed, 'archive/2026-07', path.dirname(REL)), { recursive: true });
  fs.writeFileSync(path.join(seed, 'archive/2026-07', REL), BODY); // archived; NOT live on main
  g(seed, ['add', '-A']); g(seed, ['commit', '-qm', 'seed']); g(seed, ['push', '-q', bare, 'main']);
  // a browser SPA branch still holding the archived session (unrelated history, as in production)
  g(seed, ['checkout', '-q', '--orphan', 'browser-cortex-abc']); g(seed, ['rm', '-rfq', '.']);
  fs.mkdirSync(path.join(seed, path.dirname(REL)), { recursive: true });
  fs.writeFileSync(path.join(seed, REL), BODY);
  g(seed, ['add', '-A']); g(seed, ['commit', '-qm', 'browser']); g(seed, ['push', '-q', bare, 'browser-cortex-abc']);
  // one autoresearch job transcript to capture
  const stage = path.join(home, '.cortex/autoresearch-stage/job1');
  fs.mkdirSync(stage, { recursive: true });
  fs.writeFileSync(path.join(stage, 'sess.jsonl'), JSON.stringify({ type: 'user', message: { content: 'job' } }) + '\n');
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const mainFiles = () => g(bare, ['ls-tree', '-r', '--name-only', 'main']).split('\n').filter(Boolean);

describe('scoped sync and archived browser sessions', () => {
  it('a scoped (autoresearch) sync captures its leg and does NOT re-add the archived browser session', async () => {
    const r = await canonSync({ store: path.join(tmp, 'store'), scope: 'autoresearch', repoUrl: `file://${bare}`, home });
    expect(r.pushed).toBe(true);
    const files = mainFiles();
    expect(files).toContain('native/autoresearch/job1/sess.jsonl');
    expect(files).not.toContain(REL);
  });

  it('the duplicate guard removes an index-added archived copy even OUTSIDE a sparse cone', () => {
    const sc = path.join(tmp, 'sc');
    execFileSync('git', ['clone', '-q', '--filter=blob:none', '--no-checkout', `file://${bare}`, sc], { stdio: 'ignore' });
    g(sc, ['sparse-checkout', 'set', '--cone', 'native/autoresearch']);
    g(sc, ['checkout', '-q', 'main']);
    g(sc, ['fetch', '-q', '--depth', '1', 'origin', 'browser-cortex-abc']);
    g(sc, ['checkout', 'FETCH_HEAD', '--', 'native/browser-cortex']);
    expect(g(sc, ['diff', '--cached', '--name-only', '--diff-filter=A', 'HEAD']).trim()).toBe(REL);
    expect(dropArchivedDuplicates(sc, 'test')).toBe(1);
    expect(g(sc, ['diff', '--cached', '--name-only', '--diff-filter=A', 'HEAD']).trim()).toBe('');
  });
});
