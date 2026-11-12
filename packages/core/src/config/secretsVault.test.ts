/**
 * secretsVault — format compatibility with the Nexus Terminal SPA (Web Crypto), unlock chain, startup precedence, headless safety, masking.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { webcrypto } from 'crypto';
import {
  createVault, initVaultDefault, writeVaultFile, readVaultFile, Vault, deriveKey, encryptValue, decryptValue, loadVaultIntoEnv, openVaultNonInteractive, maskSecrets,
  toolChildEnv, maskSecretText, maskToolResults, describeVaultForAgent, _resetVaultSessionForTests,
  PBKDF2_ITERATIONS, VAULT_ID, type EncryptedSecret,
} from './secretsVault.js';

// The SPA's exact derivation + encryption (nexus-terminal/services/secrets/crypto.ts), via Web Crypto.
async function spaKey(token: string, userId: string) {
  const enc = new TextEncoder();
  const material = await webcrypto.subtle.importKey('raw', enc.encode(token), 'PBKDF2', false, ['deriveKey']);
  return webcrypto.subtle.deriveKey({ name: 'PBKDF2', salt: enc.encode(`nexus-secrets-v1-${userId}`), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function spaEncrypt(key: CryptoKey, plaintext: string): Promise<EncryptedSecret> {
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const out = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, new TextEncoder().encode(plaintext)));
  return { iv: Buffer.from(iv).toString('base64'), ciphertext: Buffer.from(out.slice(0, -16)).toString('base64'), tag: Buffer.from(out.slice(-16)).toString('base64'), version: 1 };
}
async function spaDecrypt(key: CryptoKey, e: EncryptedSecret): Promise<string> {
  const data = Buffer.concat([Buffer.from(e.ciphertext, 'base64'), Buffer.from(e.tag, 'base64')]);
  return new TextDecoder().decode(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(e.iv, 'base64'), tagLength: 128 }, key, data));
}

let dir: string; let file: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-vault-')); file = path.join(dir, 'secrets.enc'); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('format = the SPA SECRETS format', () => {
  it('what the SPA encrypts, the vault decrypts — and the reverse', async () => {
    const k = await spaKey('master-xyz', VAULT_ID);
    expect(decryptValue(deriveKey('master-xyz'), await spaEncrypt(k, 'sk-from-the-spa'))).toBe('sk-from-the-spa');
    expect(await spaDecrypt(k, encryptValue(deriveKey('master-xyz'), 'sk-from-the-harness'))).toBe('sk-from-the-harness');
  });
});

describe('vault', () => {
  it('stores encrypted (no plaintext on disk), reads back, deletes, binds', () => {
    createVault('m1', file);
    const v = Vault.open('m1', 'env', file);
    v.set('DEEPSEEK_API_KEY', 'sk-test-1234567890', { provider: 'deepseek', type: 'api-key' });
    expect(fs.readFileSync(file, 'utf8')).not.toContain('sk-test-1234567890');
    expect(Vault.open('m1', 'env', file).get('DEEPSEEK_API_KEY')).toBe('sk-test-1234567890');
    v.bind({ secret: 'DEEPSEEK_API_KEY', envVar: 'DS_KEY', scope: 'global' });
    expect(v.bindings()).toHaveLength(1);
    expect(v.delete('DEEPSEEK_API_KEY')).toBe(true);
    expect(v.bindings()).toHaveLength(0);
    expect((fs.statSync(file).mode & 0o777).toString(8)).toBe('600');
  });
  it('rejects the wrong key', () => { createVault('right', file); expect(() => Vault.open('wrong', 'env', file)).toThrow(/wrong vault key/); });
});

describe('startup (headless-safe, real env > vault > .env)', () => {
  it('no key anywhere → locked status, nothing thrown, nothing loaded', () => {
    process.env.CORTEX_HOME = dir;   // isolate from a real ~/.cortex/vault.key (the key-file fallback)
    createVault('m2', file);
    const r = openVaultNonInteractive({ HOME: dir }, file);
    delete process.env.CORTEX_HOME;
    expect(r.vault).toBeNull(); expect(r.status.unlocked).toBe(false); expect(r.status.error).toMatch(/CORTEX_SECRETS_KEY/);
  });
  it('CORTEX_SECRETS_KEY unlocks; real env wins over the vault', () => {
    process.env.CORTEX_HOME = dir; fs.mkdirSync(path.join(dir, '.cortex'));
    const vf = path.join(dir, '.cortex', 'secrets.enc');
    createVault('m3', vf); const v = Vault.open('m3', 'env', vf);
    v.set('ONLY_IN_VAULT', 'value-from-vault'); v.set('ALSO_IN_ENV', 'value-from-vault');
    const env: NodeJS.ProcessEnv = { CORTEX_SECRETS_KEY: 'm3', ALSO_IN_ENV: 'value-from-env' };
    const st = loadVaultIntoEnv(env);
    expect(st.unlocked).toBe(true); expect(st.source).toBe('env');
    expect(env.ONLY_IN_VAULT).toBe('value-from-vault');
    expect(env.ALSO_IN_ENV).toBe('value-from-env');
    delete process.env.CORTEX_HOME;
  });
  it('CORTEX_SECRETS_KEY_FILE works too', () => {
    process.env.CORTEX_HOME = dir; fs.mkdirSync(path.join(dir, '.cortex'));
    createVault('m4', path.join(dir, '.cortex', 'secrets.enc'));
    fs.writeFileSync(path.join(dir, 'key'), 'm4\n');
    expect(loadVaultIntoEnv({ CORTEX_SECRETS_KEY_FILE: path.join(dir, 'key') }).source).toBe('env-file');
    delete process.env.CORTEX_HOME;
  });
});

describe('key-file fallback (no keychain: headless VM / container)', () => {
  it('~/.cortex/vault.key unlocks when nothing else is set', () => {
    process.env.CORTEX_HOME = dir; fs.mkdirSync(path.join(dir, '.cortex'));
    createVault('m5', path.join(dir, '.cortex', 'secrets.enc'));
    fs.writeFileSync(path.join(dir, '.cortex', 'vault.key'), 'm5\n', { mode: 0o600 });
    const st = loadVaultIntoEnv({});
    delete process.env.CORTEX_HOME;
    expect(st.unlocked).toBe(true); expect(st.source).toBe('key-file');
  });
});

describe('maskSecrets', () => {
  it('replaces raw, base64 and URL-encoded forms; ignores very short values', () => {
    const vals = [{ name: 'TOKEN', value: 'ghp_abc123/xyz=' }, { name: 'PIN', value: '12' }];
    const out = maskSecrets(`raw ghp_abc123/xyz= b64 ${Buffer.from('ghp_abc123/xyz=').toString('base64')} url ${encodeURIComponent('ghp_abc123/xyz=')} pin 12`, vals);
    expect(out).not.toContain('ghp_abc123'); expect(out.match(/«secret:TOKEN»/g)).toHaveLength(3); expect(out).toContain('pin 12');
  });
});

describe('Phase 2 — tool processes and tool output', () => {
  const saved: Record<string, string | undefined> = {};
  const touch = ['CORTEX_HOME', 'CORTEX_SECRETS_KEY', 'CORTEX_SECRETS_KEY_FILE', 'P2_VAULT_ONLY', 'P2_REAL', 'P2_BOUND', 'GH_TOKEN', 'TOOL_ONLY'];
  beforeEach(() => { for (const k of touch) saved[k] = process.env[k]; _resetVaultSessionForTests(); });
  afterEach(() => { for (const k of touch) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } _resetVaultSessionForTests(); });

  function setup() {
    process.env.CORTEX_HOME = dir; fs.mkdirSync(path.join(dir, '.cortex'), { recursive: true });
    const vf = path.join(dir, '.cortex', 'secrets.enc');
    createVault('master-p2-xyz', vf); const v = Vault.open('master-p2-xyz', 'env', vf);
    v.set('P2_VAULT_ONLY', 'vault-only-value-123'); v.set('P2_REAL', 'vault-copy-of-real-456'); v.set('P2_BOUND', 'ghp_bound_value_789');
    v.bind({ secret: 'P2_BOUND', envVar: 'GH_TOKEN', scope: 'global' });
    v.bind({ secret: 'P2_VAULT_ONLY', envVar: 'TOOL_ONLY', scope: 'tool', tool: 'Bash' });
    process.env.CORTEX_SECRETS_KEY = 'master-p2-xyz'; process.env.P2_REAL = 'real-env-value';
    delete process.env.P2_VAULT_ONLY; delete process.env.P2_BOUND; delete process.env.GH_TOKEN; delete process.env.TOOL_ONLY;
    expect(loadVaultIntoEnv(process.env).unlocked).toBe(true);
    return { v, vf };
  }

  it('no vault → identity (a copy of the env, masking off)', () => {
    expect(toolChildEnv({ A: '1' })).toEqual({ A: '1' });
    expect(maskSecretText('anything vault-only-value-123')).toBe('anything vault-only-value-123');
  });

  it('children lose vault-loaded keys + the unlock key, keep real env, get bindings', () => {
    setup();
    expect(process.env.P2_VAULT_ONLY).toBe('vault-only-value-123');      // the harness itself has it
    const child = toolChildEnv(process.env);
    expect(child.P2_VAULT_ONLY).toBeUndefined();
    expect(child.P2_BOUND).toBeUndefined();
    expect(child.P2_REAL).toBe('real-env-value');                        // a real env var is the user's own choice
    expect(child.CORTEX_SECRETS_KEY).toBeUndefined();
    expect(child.GH_TOKEN).toBe('ghp_bound_value_789');                  // global binding
    expect(child.TOOL_ONLY).toBeUndefined();                             // tool-scoped binding, other tool
    expect(toolChildEnv(process.env, 'Bash').TOOL_ONLY).toBe('vault-only-value-123');
  });

  it('a second startup pass (OrchestratorFactory bootstrapEnv) keeps the filter', () => {
    setup();
    expect(loadVaultIntoEnv(process.env).count).toBe(0);                 // nothing new to inject the second time
    expect(toolChildEnv(process.env).P2_VAULT_ONLY).toBeUndefined();
  });

  it('tool output is masked, including the vault key and the shadowed vault value', () => {
    setup();
    const out = maskSecretText('a vault-only-value-123 b ghp_bound_value_789 c master-p2-xyz d vault-copy-of-real-456 e real-env-value');
    expect(out).toBe('a «secret:P2_VAULT_ONLY» b «secret:P2_BOUND» c «secret:CORTEX_SECRETS_KEY» d «secret:P2_REAL» e real-env-value');
    const [r] = maskToolResults([{ tool_use_id: 't', tool_name: 'Bash', content: 'echo vault-only-value-123', is_error: false }]);
    expect(r!.content).toBe('echo «secret:P2_VAULT_ONLY»');
  });

  it('a vault edit during the session is picked up (new value masked, new binding applied)', async () => {
    const { vf } = setup();
    await new Promise((r) => setTimeout(r, 20));
    const v2 = Vault.open('master-p2-xyz', 'env', vf); v2.set('LATE_ADD', 'late-added-secret-000'); v2.bind({ secret: 'LATE_ADD', envVar: 'LATE_ENV', scope: 'global' });
    expect(maskSecretText('x late-added-secret-000')).toBe('x «secret:LATE_ADD»');
    expect(toolChildEnv(process.env).LATE_ENV).toBe('late-added-secret-000');
    delete process.env.LATE_ENV;
  });

  it('describeVaultForAgent lists names and bindings, never values', () => {
    setup();
    const d = describeVaultForAgent(); const text = JSON.stringify(d);
    expect(d.unlocked).toBe(true); expect(d.secrets.map((s) => s.name)).toEqual(['P2_BOUND', 'P2_REAL', 'P2_VAULT_ONLY']);
    expect(d.secrets.find((s) => s.name === 'P2_BOUND')!.boundAs).toEqual(['$GH_TOKEN']);
    for (const val of ['vault-only-value-123', 'ghp_bound_value_789', 'master-p2-xyz', 'vault-copy-of-real-456']) expect(text).not.toContain(val);
  });
});

// 2026-11-12 (operator: "make sure that cortex update doesnt remove or overwrite the nexus-cortex secrets vault")
describe('the vault is never overwritten', () => {
  it('createVault refuses an existing vault and leaves it byte-identical', () => {
    createVault('first', file); const v = Vault.open('first', 'env', file); v.set('A_KEY', 'value-a', {});
    const before = fs.readFileSync(file);
    expect(() => createVault('second', file)).toThrow(/already exists/);
    expect(fs.readFileSync(file).equals(before)).toBe(true);
    expect(Vault.open('first', 'env', file).get('A_KEY')).toBe('value-a');
  });
  it('every rewrite keeps the previous version as <vault>.bak (owner-only)', () => {
    createVault('k', file); const v = Vault.open('k', 'env', file); v.set('ONE', '1', {});
    const prev = fs.readFileSync(file); v.set('TWO', '2', {});
    expect(fs.readFileSync(file + '.bak').equals(prev)).toBe(true);
    expect((fs.statSync(file + '.bak').mode & 0o077)).toBe(0);
    expect(readVaultFile(file + '.bak')?.secrets.TWO).toBeUndefined();
  });
  it('initVaultDefault reuses an existing key file instead of writing a new key', () => {
    process.env.CORTEX_HOME = dir; const cd = path.join(dir, '.cortex'); fs.mkdirSync(cd);
    fs.writeFileSync(path.join(cd, 'vault.key'), 'kept-key\n', { mode: 0o600 });
    try { initVaultDefault({}); } finally { delete process.env.CORTEX_HOME; }
    expect(fs.readFileSync(path.join(cd, 'vault.key'), 'utf8')).toBe('kept-key\n');
    expect(() => Vault.open('kept-key', 'key-file', path.join(cd, 'secrets.enc'))).not.toThrow();
  });
});
