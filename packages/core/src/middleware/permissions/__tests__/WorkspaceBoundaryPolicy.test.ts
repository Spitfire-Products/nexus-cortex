import { describe, it, expect } from 'vitest';
import { WorkspaceBoundaryPolicy } from '../WorkspaceBoundaryPolicy.js';

const ctx = (toolName: string, toolInput: any): any => ({
  toolName,
  toolInput,
  sessionId: 'test-session',
  timestamp: new Date(),
});

describe('WorkspaceBoundaryPolicy', () => {
  const root = '/home/proj';
  const policy = new WorkspaceBoundaryPolicy([root]);

  it('allows in-bounds absolute paths', async () => {
    const d = await policy.evaluate(ctx('Read', { file_path: '/home/proj/src/x.ts' }));
    expect(d.allowed).toBe(true);
    expect(d.tier).toBeUndefined(); // abstains (pass-through), does not definitively allow
  });

  it('allows in-bounds relative paths', async () => {
    const d = await policy.evaluate(ctx('Read', { file_path: 'src/x.ts' }));
    expect(d.allowed).toBe(true);
  });

  it('denies an out-of-bounds absolute path with canApprove + explain-why reason', async () => {
    const d = await policy.evaluate(ctx('Read', { file_path: '/etc/passwd' }));
    expect(d.allowed).toBe(false);
    expect(d.canApprove).toBe(true);
    expect(d.reason).toMatch(/outside the project/i);
    expect(d.reason).toMatch(/explain why/i);
  });

  it('denies relative ../ escapes (the old Deficiency-#15 case)', async () => {
    const d = await policy.evaluate(ctx('Read', { file_path: '../../etc/passwd' }));
    expect(d.allowed).toBe(false);
    expect(d.canApprove).toBe(true);
  });

  it('allows paths within a user-granted additional directory (--add-dir)', async () => {
    const granted = new WorkspaceBoundaryPolicy([root, '/data/shared']);
    const d = await granted.evaluate(ctx('Read', { file_path: '/data/shared/x.txt' }));
    expect(d.allowed).toBe(true);
  });

  it('gates the Shell `directory` param', async () => {
    const d = await policy.evaluate(ctx('Bash', { command: 'ls', directory: '/etc' }));
    expect(d.allowed).toBe(false);
    expect(d.canApprove).toBe(true);
  });

  it('does not gate a Bash command that has no directory param', async () => {
    const d = await policy.evaluate(ctx('Bash', { command: 'cat /etc/passwd' }));
    expect(d.allowed).toBe(true); // command-string paths are BashCommandPolicy's concern, not this one
  });

  it('abstains (allows) for non-file/shell tools', async () => {
    const d = await policy.evaluate(ctx('WebSearch', { query: 'x' }));
    expect(d.allowed).toBe(true);
  });

  it('is inert (allows everything) when no roots are configured', async () => {
    const off = new WorkspaceBoundaryPolicy([]);
    const d = await off.evaluate(ctx('Read', { file_path: '/etc/passwd' }));
    expect(d.allowed).toBe(true);
  });

  it('evaluates above the whitelist so the boundary runs before Read is whitelisted', () => {
    expect(policy.priority).toBeGreaterThan(100); // CRITICAL/whitelist priority
  });
});
