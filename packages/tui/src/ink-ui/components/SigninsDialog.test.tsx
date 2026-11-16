/**
 * /signins import flow end to end through the REAL dialog (ink-testing-library): a fabricated Chrome profile (Linux v10 values, DB
 * version 24) in a temp HOME, a temp vault with an explicit key. Keys: i → Enter (profile) → ↓ Space (github.com) → Enter. The sensitive
 * site stays unticked and is not imported; no cookie value is ever rendered.
 */
import React from 'react';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { render } from 'ink-testing-library';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
import { listSites } from '@nexus-cortex/core';
import { SigninsDialog } from './SigninsDialog.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'signins-dialog-'));
const prev = { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, CORTEX_HOME: process.env.CORTEX_HOME, CORTEX_SECRETS_KEY: process.env.CORTEX_SECRETS_KEY };
beforeAll(() => {
  Object.assign(process.env, { XDG_CONFIG_HOME: path.join(tmp, '.config'), CORTEX_HOME: tmp, CORTEX_SECRETS_KEY: 'dialog-test-master' });
  const root = path.join(tmp, '.config', 'google-chrome'); const prof = path.join(root, 'Default', 'Network');
  fs.mkdirSync(prof, { recursive: true });
  fs.writeFileSync(path.join(root, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Fixture' } } } }));
  const key = crypto.pbkdf2Sync('peanuts', 'saltysalt', 1, 16, 'sha1');
  const enc = (v: string, h: string) => { const c = crypto.createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20)); return Buffer.concat([Buffer.from('v10'), c.update(Buffer.concat([crypto.createHash('sha256').update(h).digest(), Buffer.from(v)])), c.final()]); };
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as any;
  const db = new DatabaseSync(path.join(prof, 'Cookies'));
  db.exec("CREATE TABLE meta(key TEXT,value TEXT);INSERT INTO meta VALUES('version','24');CREATE TABLE cookies(host_key TEXT,top_frame_site_key TEXT,has_cross_site_ancestor INTEGER,name TEXT,value TEXT,encrypted_value BLOB,path TEXT,expires_utc INTEGER,is_secure INTEGER,is_httponly INTEGER,has_expires INTEGER,is_persistent INTEGER,samesite INTEGER)");
  const ins = db.prepare('INSERT INTO cookies VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
  ins.run('.chase.com', '', 0, 'bank', '', enc('BANK-VALUE', '.chase.com'), '/', 0n, 1, 1, 0, 0, -1);
  ins.run('.github.com', '', 0, 'user_session', '', enc('GH-VALUE', '.github.com'), '/', (2000000000n + 11644473600n) * 1000000n, 1, 1, 1, 1, 1);
  // 11-15: hundreds of cookie sites (the operator's real profile) — the picker must filter and keep the highlight on screen
  for (let k = 0; k < 300; k++) { const h = `.site${String(k).padStart(3, '0')}.example`; ins.run(h, '', 0, 'id', '', enc(`V${k}`, h), '/', (2000000000n + 11644473600n) * 1000000n, 1, 1, 1, 1, 1); }
  ins.run('.x.com', '', 0, 'auth_token', '', enc('X-VALUE', '.x.com'), '/', (2000000000n + 11644473600n) * 1000000n, 1, 1, 1, 1, 1);
  db.close();
});
afterAll(() => {
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 4000) { const end = Date.now() + ms; while (!fn() && Date.now() < end) await tick(30); }

describe.runIf(process.platform === 'linux')('SigninsDialog import (i → profile → tick → Enter)', () => {
  it('imports only the ticked site; the sensitive one stays unticked; values never render', async () => {
    const notices: string[] = [];
    const { stdin, lastFrame, unmount } = render(<SigninsDialog onClose={() => {}} onNotice={(t) => notices.push(t)} />);
    await tick();
    expect(lastFrame()).toMatch(/Press i to import/);
    stdin.write('i'); await tick();
    expect(lastFrame()).toMatch(/Google Chrome — Fixture \(chrome:Default\)/);
    stdin.write('\r');
    await until(() => /github\.com/.test(lastFrame() ?? '') && !/reading the site list/.test(lastFrame() ?? ''));   // keys are ignored while busy
    const sitesFrame = lastFrame() ?? '';
    expect(sitesFrame).toMatch(/\[ \] chase\.com.*sensitive/);
    expect(sitesFrame).toMatch(/\[ \] github\.com/);
    stdin.write('\u001B[B'); await tick();   // ↓ github.com
    stdin.write(' '); await until(() => /\[x\] github\.com/.test(lastFrame() ?? ''));   // 300+ fixture sites: wait for the re-render
    expect(lastFrame()).toMatch(/\[x\] github\.com/);
    stdin.write('\r');
    await until(() => notices.length > 0);
    expect(notices[0]).toBe('github.com: 1 saved');
    await until(() => /github\.com\s+1 cookies/.test(lastFrame() ?? ''));
    expect(listSites(path.join(tmp, '.cortex', 'session-vault.enc')).map((s) => s.site)).toEqual(['github.com']);
    const all = lastFrame() ?? '';
    expect(all + notices.join('')).not.toMatch(/GH-VALUE|BANK-VALUE/);
    unmount();
  });
});

describe.runIf(process.platform === 'linux')('SigninsDialog site picker with hundreds of sites (11-15 operator feedback)', () => {
  it('typing narrows to x.com; 250 ↓ keep the highlight on screen; Ctrl+A ticks all listed non-sensitive sites', async () => {
    const { stdin, lastFrame, unmount } = render(<SigninsDialog onClose={() => {}} />);
    await tick();
    stdin.write('i'); await tick(); stdin.write('\r');
    await until(() => /of 30\d sites/.test(lastFrame() ?? '') && !/reading the site list/.test(lastFrame() ?? ''));
    let f = lastFrame() ?? '';
    expect(f).toMatch(/of 30\d sites/);
    expect((f.match(/cookies/g) ?? []).length).toBeLessThanOrEqual(20);              // a window, not every site
    for (const c of 'x.c') { stdin.write(c); await tick(20); }
    f = lastFrame() ?? '';
    expect(f).toMatch(/filter: x\.c/); expect(f).toMatch(/❯ \[ \] x\.com/); expect(f).toMatch(/1 of 30\d sites/);
    stdin.write('\u001B'); await tick();                                            // Esc clears the filter
    for (let k = 0; k < 250; k++) stdin.write('\u001B[B');
    await tick(200);
    f = lastFrame() ?? '';
    expect(f).toMatch(/❯ \[ \] site248\.example/);                                  // all 250 ↓ landed (chase, github, site000…)
    expect(f).toMatch(/❯ \[ \] /);                                                  // the highlighted row is drawn
    expect(f).toMatch(/↑ \d+ more/); expect(f).toMatch(/↓ \d+ more/);
    stdin.write('\u0001'); await tick();                                            // Ctrl+A
    f = lastFrame() ?? '';
    const n = Number((f.match(/·\s+(\d+) ticked/) ?? [])[1]);
    expect(n).toBeGreaterThanOrEqual(301);                                          // every non-sensitive site …
    expect(f).not.toMatch(/\[x\] chase\.com/);                                     // … never the sensitive one
    unmount();
  });
});
