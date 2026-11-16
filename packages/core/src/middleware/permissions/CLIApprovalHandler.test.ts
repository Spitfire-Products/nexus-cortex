/**
 * CLIApprovalHandler through the REAL handler (vault task T3, defect D1) — a fake TTY stdin + captured stdout.
 *
 * The load_session dialog must offer the four choices (once / this session / always for this site / no) and answer with the
 * answer object; the pre-existing three-option prompt must keep behaving exactly as before.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'stream';
import { CLIApprovalHandler } from './CLIApprovalHandler.js';
import type { ApprovalRequest } from '../contracts/MiddlewareContracts.js';

const LOAD_SESSION_CHOICES = [
  { value: 'once', label: 'Yes, just this once' },
  { value: 'session', label: 'Yes, for this session' },
  { value: 'always', label: 'Yes, always for github.com' },
  { value: 'no', label: 'No, do not load it (esc)' },
] as const;

let stdin: PassThrough & { isTTY?: boolean; isRaw?: boolean; setRawMode?: (m: boolean) => void };
let out: string[];
let realStdin: NodeJS.ReadStream;
let realStdoutWrite: typeof process.stdout.write;
let realLog: typeof console.log;
let toggled: number;

const tick = () => new Promise((r) => setImmediate(r));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fakeStdin(): PassThrough & { isTTY?: boolean; isRaw?: boolean; setRawMode?: (m: boolean) => void } {
  const s = new PassThrough() as any;
  s.isTTY = true;
  s.isRaw = false;
  s.setRawMode = (m: boolean) => { s.isRaw = m; };
  // the handler checks isPaused()/resume()/pause() — PassThrough provides them; keep it paused-safe
  s.pause();
  return s;
}

beforeEach(() => {
  toggled = 0;
  out = [];
  realStdin = process.stdin;
  stdin = fakeStdin();
  Object.defineProperty(process, 'stdin', { value: stdin, configurable: true, writable: true });
  realStdoutWrite = process.stdout.write.bind(process.stdout);
  (process.stdout as any).write = (chunk: any) => { out.push(String(chunk)); return true; };
  // vitest's console interception does not go through our process.stdout.write, so capture console.log too
  realLog = console.log;
  (console as any).log = (...args: any[]) => { out.push(args.map((a) => String(a)).join(' ')); };
});

afterEach(() => {
  (console as any).log = realLog;
  (process.stdout as any).write = realStdoutWrite;
  Object.defineProperty(process, 'stdin', { value: realStdin, configurable: true, writable: true });
});

const handler = () => new CLIApprovalHandler({
  onToggleAutoApprove: () => { toggled += 1; },
  getAutoApproveStatus: () => toggled > 0,
});

const loadSessionRequest = (): ApprovalRequest => ({
  toolName: 'nexus-browser__load_session',
  toolInput: { site: 'github.com' },
  reason: 'release the saved session for github.com?',
  timestamp: new Date(),
  tier: 'blacklist',
  kind: 'load_session',
  site: 'github.com',
  choices: LOAD_SESSION_CHOICES as unknown as ApprovalRequest['choices'],
});

const genericRequest = (): ApprovalRequest => ({
  toolName: 'Bash', toolInput: { command: 'ls' }, reason: 'run ls?', timestamp: new Date(), tier: 'blacklist',
});

/** Start a request, wait for the prompt to be on stdin, send one key, return the answer. */
async function answerWith(req: ApprovalRequest, key: string) {
  const p = handler().requestApproval(req);
  await tick();
  stdin.emit('data', Buffer.from(key));
  return await p;
}

const printed = () => out.join('');

describe('CLIApprovalHandler — load_session four-way dialog (D1)', () => {
  it('renders four choices with the labels from the request', async () => {
    const p = handler().requestApproval(loadSessionRequest());
    await tick();
    const text = printed();
    for (const c of LOAD_SESSION_CHOICES) expect(text).toContain(c.label);
    stdin.emit('data', Buffer.from('4'));
    await p;
  });

  it.each([
    ['1', 'once'],
    ['2', 'session'],
    ['3', 'always'],
  ])('key %s answers {approved:true, scope:%s}', async (key, scope) => {
    await expect(answerWith(loadSessionRequest(), key)).resolves.toEqual({ approved: true, scope });
  });

  it('key 4 answers false (no)', async () => {
    await expect(answerWith(loadSessionRequest(), '4')).resolves.toBe(false);
  });

  it('esc answers false', async () => {
    const p = handler().requestApproval(loadSessionRequest());
    await tick();
    stdin.emit('data', Buffer.from('\x1b'));
    await expect(p).resolves.toBe(false);
    await sleep(150);
  });

  it('arrow-down then enter picks the second choice (session)', async () => {
    const p = handler().requestApproval(loadSessionRequest());
    await tick();
    stdin.emit('data', Buffer.from('\x1b[B'));
    await tick();
    stdin.emit('data', Buffer.from('\r'));
    await expect(p).resolves.toEqual({ approved: true, scope: 'session' });
  });
});

describe('CLIApprovalHandler — the existing three-option prompt is unchanged', () => {
  it('key 1 → true', async () => {
    await expect(answerWith(genericRequest(), '1')).resolves.toBe(true);
  });

  it('key 2 → true and toggles auto-approve', async () => {
    await expect(answerWith(genericRequest(), '2')).resolves.toBe(true);
    expect(toggled).toBe(1);
  });

  it('key 3 → false', async () => {
    await expect(answerWith(genericRequest(), '3')).resolves.toBe(false);
  });

  it('renders exactly the three legacy options', async () => {
    const p = handler().requestApproval(genericRequest());
    await tick();
    const text = printed();
    expect(text).toContain('1. Yes');
    expect(text).toContain('2. Yes, auto-approve all actions this session');
    expect(text).toContain('3. No, skip this operation (esc)');
    expect(text).not.toContain('always for github.com');
    stdin.emit('data', Buffer.from('1'));
    await p;
  });
});
