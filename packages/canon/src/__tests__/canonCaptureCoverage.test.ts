/**
 * Capture coverage (2026-09-26 audit): the Claude Code projects tree also holds what transcripts POINT TO (tool-results/:
 * large outputs, screenshots, PDFs; workflows/: run definitions + scripts), and ~/.claude/file-history holds the per-edit
 * backups (extensionless `<hash>@vN`). All must reach the store; binaries byte-exact (a UTF-8 read + text scrub corrupts
 * them), text still secret-scrubbed. Local store, no network.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { canonSync, isBinaryFile } from '../canonSync.js';

let HOME: string;
let STORE: string;
const SID = '3cf51d5b-bf70-4eb4-9d79-6caf0cfc7855';
const PROJ = '-home-me-proj';
const SECRET = 'ghp_' + 'A'.repeat(36);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0xff, 0x00, 0xfe]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from([0x00, 0xe2, 0xe3, 0xcf, 0xd3]), Buffer.from(`\n${SECRET}\n%%EOF\n`)]);

const put = (rel: string, body: string | Buffer) => {
  const p = path.join(HOME, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
};
const native = (rel: string) => path.join(STORE, 'native', rel);

beforeAll(async () => {
  HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-cov-home-'));
  STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-cov-store-'));
  execFileSync('git', ['init', '-q', STORE]);
  const P = `.claude/projects/${PROJ}`;
  put(`${P}/${SID}.jsonl`, JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }) + '\n');
  put(`${P}/${SID}/tool-results/shot.png`, PNG);
  put(`${P}/${SID}/tool-results/report.pdf`, PDF);
  put(`${P}/${SID}/tool-results/big-output.txt`, `line one\ntoken=${SECRET}\n`);
  put(`${P}/${SID}/workflows/wf_abc.json`, JSON.stringify({ name: 'review', phases: [{ title: 'Review' }] }));
  put(`${P}/${SID}/workflows/scripts/wf_abc.js`, 'export const meta = { name: "review" }\n');
  put(`.claude/file-history/${SID}/0a1b2c3d@v1`, `API_KEY=${SECRET}\nplain line\n`);
  put(`.claude/file-history/${SID}/9f8e7d6c@v2`, PNG);
  // an autoresearch campaign's staged transcript (the executor's capture step) carrying a job token + a cortex key
  put(`.cortex/autoresearch-stage/job123/app/work/wt1/.cortex/sessions/s1.jsonl`,
    JSON.stringify({ type: 'user', message: { content: `run with narjob_${'a'.repeat(32)} and ncx_${'B'.repeat(24)}` } }) + '\n');
  await canonSync({ store: STORE, home: HOME });
});

afterAll(() => {
  fs.rmSync(HOME, { recursive: true, force: true });
  fs.rmSync(STORE, { recursive: true, force: true });
});

describe('capture coverage of the projects tree + file-history', () => {
  it('tool-result images and PDFs land BYTE-EXACT (not UTF-8 mangled, not scrubbed)', () => {
    const base = `claude-code/${PROJ}/${SID}/tool-results`;
    expect(fs.readFileSync(native(`${base}/shot.png`)).equals(PNG)).toBe(true);
    expect(fs.readFileSync(native(`${base}/report.pdf`)).equals(PDF)).toBe(true);
  });

  it('text tool results are captured and secret-scrubbed', () => {
    const t = fs.readFileSync(native(`claude-code/${PROJ}/${SID}/tool-results/big-output.txt`), 'utf8');
    expect(t).toContain('line one');
    expect(t).not.toContain(SECRET);
  });

  it('workflow definitions and scripts are captured', () => {
    expect(fs.existsSync(native(`claude-code/${PROJ}/${SID}/workflows/wf_abc.json`))).toBe(true);
    expect(fs.existsSync(native(`claude-code/${PROJ}/${SID}/workflows/scripts/wf_abc.js`))).toBe(true);
  });

  it('file-history backups (extensionless) are captured: text scrubbed, binary byte-exact', () => {
    const txt = fs.readFileSync(native(`claude-code-file-history/${SID}/0a1b2c3d@v1`), 'utf8');
    expect(txt).toContain('plain line');
    expect(txt).not.toContain(SECRET);
    expect(fs.readFileSync(native(`claude-code-file-history/${SID}/9f8e7d6c@v2`)).equals(PNG)).toBe(true);
  });

  it('binary detection: by extension, or a NUL byte in an extensionless file; plain text is not binary', () => {
    expect(isBinaryFile(path.join(HOME, `.claude/projects/${PROJ}/${SID}/tool-results/shot.png`))).toBe(true);
    expect(isBinaryFile(path.join(HOME, `.claude/file-history/${SID}/9f8e7d6c@v2`))).toBe(true);
    expect(isBinaryFile(path.join(HOME, `.claude/file-history/${SID}/0a1b2c3d@v1`))).toBe(false);
  });

  it('autoresearch staged transcripts land in their own leg, platform tokens scrubbed', () => {
    const t = fs.readFileSync(native('autoresearch/job123/app/work/wt1/.cortex/sessions/s1.jsonl'), 'utf8');
    expect(t).toContain('[redacted:narjob]');
    expect(t).toContain('[redacted:ncx]');
    expect(t).not.toMatch(/narjob_a{32}|ncx_B{24}/);
  });
});
