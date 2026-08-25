/**
 * Error-family classing for the decision store (AHE borrow, 2026-08-23).
 *
 * The exact-input prior (stableInputHash) only catches byte-identical
 * retries; an agent that retries the same failing APPROACH with slightly
 * different arguments escapes it. Families normalize error snippets so
 * "No such file or directory: /a/b.txt" and "No such file or directory:
 * /a/c.txt" land in one family, and a cross-input family reminder can say
 * "stop retrying variations of this approach — switch strategy"
 * (phrasing after AHE's execution_risk_hints, the TB2 #1 harness).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { classifyErrorFamily } from '../errorFamily.js';
import { DecisionStore } from '../DecisionStore.js';
import { formatFamilyReminder } from '../DecisionPriorInjector.js';

describe('classifyErrorFamily', () => {
  it('same error class with different paths/numbers → same family', () => {
    const a = classifyErrorFamily('bash: line 1: cd: /app/src/foo: No such file or directory');
    const b = classifyErrorFamily('bash: line 3: cd: /app/lib/bar2: No such file or directory');
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('different error classes → different families', () => {
    const notFound = classifyErrorFamily('cat: /x/y: No such file or directory');
    const denied = classifyErrorFamily('touch: cannot touch /etc/passwd2: Permission denied');
    expect(notFound).not.toBe(denied);
  });

  it('digits, hex ids and quoted strings are normalized away', () => {
    const a = classifyErrorFamily('Error: container a3f9b2c1d4e5 exited with code 137');
    const b = classifyErrorFamily('Error: container 9e8d7c6b5a43 exited with code 143');
    expect(a).toBe(b);
  });

  it('multi-line snippets classify on the first line and stay bounded', () => {
    const fam = classifyErrorFamily('SyntaxError: invalid syntax\n  File "x.py", line 3\n    def f(:\n');
    expect(fam).toContain('syntaxerror');
    expect(fam.length).toBeLessThanOrEqual(96);
  });

  it('empty/blank input → empty family (never throws)', () => {
    expect(classifyErrorFamily('')).toBe('');
    expect(classifyErrorFamily('   \n')).toBe('');
  });
});

describe('DecisionStore.familyFailures', () => {
  let dir: string;
  let store: DecisionStore;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decfam-'));
    store = new DecisionStore(path.join(dir, 'decisions.jsonl'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('counts failures across DIFFERENT inputs in one family, tracks distinct inputs', async () => {
    await store.record({ sessionId: 's', toolName: 'Bash', input: { cmd: 'cat /a' }, success: false, errorSnippet: 'cat: /a: No such file or directory' });
    await store.record({ sessionId: 's', toolName: 'Bash', input: { cmd: 'cat /b' }, success: false, errorSnippet: 'cat: /b: No such file or directory' });
    await store.record({ sessionId: 's', toolName: 'Bash', input: { cmd: 'ls ok' }, success: true });
    const family = classifyErrorFamily('cat: /a: No such file or directory');
    const ff = await store.familyFailures('Bash', family);
    expect(ff.count).toBe(2);
    expect(ff.distinctInputs).toBe(2);
    expect(ff.recent.length).toBe(2);
  });

  it('scopes by tool and by family', async () => {
    await store.record({ sessionId: 's', toolName: 'Bash', input: { cmd: 'x' }, success: false, errorSnippet: 'Permission denied' });
    await store.record({ sessionId: 's', toolName: 'Edit', input: { f: 'y' }, success: false, errorSnippet: 'Permission denied' });
    const family = classifyErrorFamily('Permission denied');
    const ff = await store.familyFailures('Bash', family);
    expect(ff.count).toBe(1);
    const none = await store.familyFailures('Bash', classifyErrorFamily('No such file or directory: q'));
    expect(none.count).toBe(0);
  });
});

describe('formatFamilyReminder', () => {
  it('fires only for >=2 failures across >=2 distinct inputs', () => {
    expect(formatFamilyReminder('Bash', 'fam', 1, 1, [])).toBeNull();
    expect(formatFamilyReminder('Bash', 'fam', 3, 1, [])).toBeNull(); // exact-input reminder owns identical retries
    const msg = formatFamilyReminder('Bash', 'no such file or directory', 2, 2, []);
    expect(msg).toContain('system-reminder');
    expect(msg).toContain('Bash');
    expect(msg).toMatch(/switch|different|alternate/i);
  });
});
