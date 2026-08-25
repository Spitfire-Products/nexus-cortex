/**
 * Decision-store capture by DEFAULT (data-lake rule, 2026-08-25): a fresh
 * canon setup must capture .cortex/decisions.jsonl without any HARNESSES.json
 * config — sessions alone mislabel exit-masked failures and strip the
 * post-persist steering events (loop_escalation / gate-fallback / inaction).
 * Also under test: single-FILE roots sync directly (walk only descends dirs).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { canonSync } from '../canonSync.js';

let HOME: string;
let STORE: string;

beforeAll(() => {
  HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-dec-home-'));
  STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-dec-store-'));
  execFileSync('git', ['init', '-q', STORE]);
  // a workspace decision store with a 4.70+ event row + a decision row
  const cdir = path.join(HOME, '.cortex');
  fs.mkdirSync(cdir, { recursive: true });
  fs.writeFileSync(
    path.join(cdir, 'decisions.jsonl'),
    JSON.stringify({ ts: 1, sessionId: 's1', toolName: 'Bash', inputHash: 'x', inputSummary: '{}', success: false, errorSnippet: 'Command failed with exit code 2' }) + '\n' +
    JSON.stringify({ ts: 2, sessionId: 's1', toolName: 'Bash', inputHash: '', inputSummary: '', success: true, kind: 'loop_escalation', detail: { rung: 'diversify' } }) + '\n',
  );
  // and a session so the sync has ordinary work too
  const sdir = path.join(cdir, 'sessions');
  fs.mkdirSync(sdir, { recursive: true });
  fs.writeFileSync(path.join(sdir, 'aaa.jsonl'), JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }) + '\n');
});

afterAll(() => {
  fs.rmSync(HOME, { recursive: true, force: true });
  fs.rmSync(STORE, { recursive: true, force: true });
});

describe('default decision-store capture', () => {
  it('captures .cortex/decisions.jsonl with NO HARNESSES.json config', async () => {
    await canonSync({ store: STORE, home: HOME });
    const captured = path.join(STORE, 'native', 'nexus-cortex-decisions', 'workspace', 'decisions.jsonl');
    expect(fs.existsSync(captured)).toBe(true);
    const body = fs.readFileSync(captured, 'utf8');
    expect(body).toContain('loop_escalation');
    expect(body).toContain('"success":false');
  });

  it('sessions still capture normally alongside (no duplication into decisions harness)', async () => {
    const sess = path.join(STORE, 'native', 'nexus-cortex', 'workspace', 'aaa.jsonl');
    expect(fs.existsSync(sess)).toBe(true);
    // the decisions harness must NOT have swept the sessions dir
    const wrong = path.join(STORE, 'native', 'nexus-cortex-decisions', 'workspace', 'aaa.jsonl');
    expect(fs.existsSync(wrong)).toBe(false);
  });

  it('absent decision stores are silently skipped (fresh installs)', async () => {
    const HOME2 = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-dec-empty-'));
    const STORE2 = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-dec-store2-'));
    execFileSync('git', ['init', '-q', STORE2]);
    await expect(canonSync({ store: STORE2, home: HOME2 })).resolves.toBeTruthy();
    fs.rmSync(HOME2, { recursive: true, force: true });
    fs.rmSync(STORE2, { recursive: true, force: true });
  });
});
