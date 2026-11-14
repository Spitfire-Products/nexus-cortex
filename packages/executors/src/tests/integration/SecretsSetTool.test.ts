/**
 * SecretsSetTool (2026-11-14) — through the executor: stores, binds, never returns the value; refuses two sources up front.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SecretsSetToolExecutor } from '../../implementations/secrets/index.js';
import { _resetVaultSessionForTests, toolChildEnv, maskSecretText } from '@nexus-cortex/core';

let dir: string; const saved: Record<string, string | undefined> = {};
const touch = ['CORTEX_HOME', 'CORTEX_SECRETS_KEY', 'CORTEX_SECRETS_KEY_FILE', 'EXEC_KEY'];
beforeEach(() => {
  for (const k of touch) saved[k] = process.env[k];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-set-')); process.env.CORTEX_HOME = dir;
  // a key given in the env: the vault is created with it, never with the machine's keychain
  process.env.CORTEX_SECRETS_KEY = 'exec-test-master-key'; delete process.env.CORTEX_SECRETS_KEY_FILE;
  _resetVaultSessionForTests();
});
afterEach(() => { for (const k of touch) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } _resetVaultSessionForTests(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('SecretsSet executor', () => {
  const tool = () => new SecretsSetToolExecutor({ workingDirectory: process.cwd(), allowFileSystem: true } as any);

  it('stores from a file, deletes the plaintext, binds $NAME; the result never contains the value', async () => {
    const f = path.join(dir, 'k'); fs.writeFileSync(f, 'exec-secret-value-12345\n');
    const r: any = await tool().execute({ name: 'EXEC_KEY', from_file: f, delete_file: true }, new AbortController().signal);
    const text = JSON.stringify(r);
    expect(text).not.toContain('exec-secret-value-12345');
    expect(text).toContain('«secret:EXEC_KEY»'); expect(text).toContain('$EXEC_KEY');
    expect(fs.existsSync(f)).toBe(false);
    expect(toolChildEnv(process.env, 'Bash').EXEC_KEY).toBe('exec-secret-value-12345');
    expect(maskSecretText('out exec-secret-value-12345')).toBe('out «secret:EXEC_KEY»');
  });

  it('validation: name required, exactly one source', () => {
    expect(tool().validateToolParams({ name: '' } as any)).toMatch(/name/);
    expect(tool().validateToolParams({ name: 'A' } as any)).toMatch(/exactly one/);
    expect(tool().validateToolParams({ name: 'A', value: 'x', from_env: 'B' })).toMatch(/exactly one/);
    expect(tool().validateToolParams({ name: 'A', value: 'x' })).toBeNull();
  });

  it('an existing secret is not replaced without overwrite (error result, no value)', async () => {
    await tool().execute({ name: 'EXEC_KEY', value: 'first-exec-value-0001' }, new AbortController().signal);
    const r: any = await tool().execute({ name: 'EXEC_KEY', value: 'second-exec-value-002' }, new AbortController().signal);
    expect(JSON.stringify(r)).toMatch(/already exists/);
    expect(JSON.stringify(r)).not.toContain('second-exec-value-002');
  });
});
