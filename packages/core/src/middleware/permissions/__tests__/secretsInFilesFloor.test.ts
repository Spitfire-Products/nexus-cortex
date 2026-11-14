/**
 * 2026-11-14 (macbook battery C7): the agent wrote a key-shaped string from the task straight into ~/bat/key.txt although USER.md says keys
 * never go in files — a rule in a prompt is not a guard. The floor now ASKS (blacklist tier, so headless fails fast) before Write / Edit /
 * Bash put a key-shaped value on disk, and points at `cortex setup` / the vault.
 */
import { describe, it, expect } from 'vitest';
import { secretsInFilesFloorPolicy, keyShapeIn } from '../DefaultPolicies.js';

// Fake keys are ASSEMBLED at runtime so no key-shaped literal sits in source (the export's secret scanner refuses those — 11-14).
const j = (...p: string[]) => p.join('');
const FAKE = {
  skTest: j('sk', '-test-', '0'.repeat(22)), skAnt: j('sk', '-ant-', 'api03-', 'abcdefghijklmnopqrstuv'), xai: j('xa', 'i-', 'ABCDEFGHIJKLMNOPQRSTUVWX'),
  ghp: j('gh', 'p_', 'a'.repeat(36)), pat: j('github', '_pat_', 'A'.repeat(30)), akia: j('AK', 'IA', 'ABCDEFGHIJKLMNOP'), aiza: j('AI', 'za', 'x'.repeat(35)),
  hf: j('h', 'f_', 'b'.repeat(34)), pem: j('-----BEGIN OPENSSH ', 'PRIVATE KEY-----'),
};

const ev = (toolName: string, toolInput: any) => secretsInFilesFloorPolicy.evaluate({ toolName, toolInput } as any) as any;

describe('keyShapeIn', () => {
  it('finds provider key shapes', () => {
    for (const k of Object.values(FAKE)) {
      expect(keyShapeIn(`x ${k} y`), k).toBeTruthy();
    }
  });
  it('ignores ordinary text', () => {
    for (const t of ['task-list', 'sk-1', 'the risk-assessment notes', 'ask-me-anything', 'AKIA', 'hf_small']) expect(keyShapeIn(t), t).toBeFalsy();
  });
});

describe('secretsInFilesFloorPolicy', () => {
  it('asks before writing a key into a file (Write / Edit / Bash)', async () => {
    for (const [tool, input] of [['Write', { file_path: '/x/key.txt', content: FAKE.skTest }],
      ['Edit', { file_path: '/x/.env', old_string: 'A=', new_string: 'A=' + FAKE.xai }],
      ['Bash', { command: `echo '${FAKE.skTest}' > ~/bat/key.txt` }]] as const) {
      const d = await ev(tool, input);
      expect(d.allowed, tool).toBe(false); expect(d.canApprove).toBe(true); expect(d.tier).toBe('blacklist'); expect(d.reason).toMatch(/cortex setup|vault/);
    }
  });
  it('passes everything else through', async () => {
    expect((await ev('Write', { file_path: '/x/a.md', content: 'hello' })).allowed).toBe(true);
    expect((await ev('Read', { file_path: '/x/key.txt' })).allowed).toBe(true);
    expect((await ev('Bash', { command: 'ls -la' })).allowed).toBe(true);
  });
});
