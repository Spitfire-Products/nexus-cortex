/**
 * secretsVault — the encrypted secrets store for nexus-cortex (plan: docs/SECRETS_VAULT_PLAN.md, operator 2026-11-02).
 *
 * File `~/.cortex/secrets.enc` (owner-only). Each value is encrypted in the SAME format as the Nexus Terminal SPA's SECRETS store
 * (nexus-terminal/services/secrets/crypto.ts): PBKDF2-SHA256 100k (salt `nexus-secrets-v1-<id>`) → AES-256-GCM, 12-byte IV,
 * 16-byte tag, `{ iv, ciphertext, tag, version }` in base64 — so one format serves both surfaces. Node's synchronous crypto is used
 * here (byte-compatible with the SPA's Web Crypto) because `bootstrapEnv` is synchronous.
 *
 * Unlock — NEVER blocks a headless run (nexus-cortex is mostly driven by other agents):
 *   1. CORTEX_SECRETS_KEY (the master secret) or CORTEX_SECRETS_KEY_FILE (a file holding it) — how orchestrators pass it, like Replit
 *   2. the OS keychain through each system's own CLI (no native add-ons): macOS `security`, Linux `secret-tool` (Secret Service)
 *   3. ~/.cortex/vault.key — owner-only, written by `cortex secrets init` when the machine has no keychain (headless VM / container)
 *   4. a passphrase — only when a person is at a terminal, asked by the interactive commands (never here)
 *   5. otherwise: no vault this run (status reported once; nothing hangs, nothing exits)
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import os from 'os';

/** Same rule as SettingsLoader.getGlobalConfigDir (kept local: SettingsLoader imports this module). */
const getGlobalConfigDir = (): string => path.join(process.env.CORTEX_HOME || os.homedir() || process.cwd(), '.cortex');

export const VAULT_FILE = 'secrets.enc';
export const VAULT_ID = 'cortex-local';                 // the SPA derives per user id; the harness vault is per machine user
// The SPA's own parameters (synced copy of nexus-terminal/services/secrets/types.ts) — one source for both surfaces.
import { PBKDF2_ITERATIONS, ENCRYPTION_VERSION } from './spaSecretTypes.js';
export { PBKDF2_ITERATIONS, ENCRYPTION_VERSION };
const KEYCHAIN_SERVICE = 'nexus-cortex-vault';
const KEYCHAIN_ACCOUNT = 'master';
const CHECK_PLAINTEXT = 'nexus-cortex-vault-ok';

export interface EncryptedSecret { iv: string; ciphertext: string; tag: string; version: number }
export interface VaultEntry { enc: EncryptedSecret; provider?: string; type?: string; category?: string; note?: string; updatedAt: number }
export interface VaultBinding { secret: string; envVar: string; scope: 'global' | 'tool'; tool?: string }
export interface VaultFile { version: 1; id: string; check: EncryptedSecret; secrets: Record<string, VaultEntry>; bindings: VaultBinding[] }
export type UnlockSource = 'env' | 'env-file' | 'keychain' | 'key-file' | 'passphrase';
export interface VaultStatus { exists: boolean; unlocked: boolean; source?: UnlockSource; count?: number; error?: string; path: string }

export const vaultPath = (): string => path.join(getGlobalConfigDir(), VAULT_FILE);
/** Where `cortex secrets init` keeps the key when the machine has no keychain (headless VM / container): owner-only, beside the vault. */
export const vaultKeyFilePath = (): string => path.join(getGlobalConfigDir(), 'vault.key');

// ── crypto (SPA-compatible) ─────────────────────────────────────────────────
export function deriveKey(master: string, id = VAULT_ID): Buffer {
  return crypto.pbkdf2Sync(Buffer.from(master, 'utf8'), Buffer.from(`nexus-secrets-v1-${id}`, 'utf8'), PBKDF2_ITERATIONS, 32, 'sha256');
}
export function encryptValue(key: Buffer, plaintext: string): EncryptedSecret {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return { iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: c.getAuthTag().toString('base64'), version: ENCRYPTION_VERSION };
}
export function decryptValue(key: Buffer, e: EncryptedSecret): string {
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(e.iv, 'base64'));
  d.setAuthTag(Buffer.from(e.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(e.ciphertext, 'base64')), d.final()]).toString('utf8');
}

// ── the master secret ───────────────────────────────────────────────────────
function keychainGet(): string | null {
  try {
    if (process.platform === 'darwin') return execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString().trim() || null;
    if (process.platform === 'linux') return execFileSync('secret-tool', ['lookup', 'service', KEYCHAIN_SERVICE, 'account', KEYCHAIN_ACCOUNT], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString().trim() || null;
  } catch { /* no keychain / no entry / locked — next source */ }
  return null;
}
/** Store the master secret in the OS keychain. Returns false when no usable keychain exists (headless VM, container). */
export function keychainSet(master: string): boolean {
  try {
    if (process.platform === 'darwin') { execFileSync('security', ['add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w', master], { stdio: 'ignore', timeout: 5000 }); return true; }
    if (process.platform === 'linux') { execFileSync('secret-tool', ['store', '--label=nexus-cortex secrets vault', 'service', KEYCHAIN_SERVICE, 'account', KEYCHAIN_ACCOUNT], { input: master, stdio: ['pipe', 'ignore', 'ignore'], timeout: 5000 }); return true; }
  } catch { /* no keychain */ }
  return false;
}
/** The master secret from the non-interactive sources, in order. Never prompts. */
export function resolveMasterSecret(env: NodeJS.ProcessEnv = process.env): { master: string; source: UnlockSource } | null {
  if (env.CORTEX_SECRETS_KEY?.trim()) return { master: env.CORTEX_SECRETS_KEY.trim(), source: 'env' };
  if (env.CORTEX_SECRETS_KEY_FILE?.trim()) { try { const v = fs.readFileSync(env.CORTEX_SECRETS_KEY_FILE.trim(), 'utf8').trim(); if (v) return { master: v, source: 'env-file' }; } catch { /* unreadable → next */ } }
  const k = keychainGet(); if (k) return { master: k, source: 'keychain' };
  // No keychain on this machine: the owner-only key file `init` wrote (zero-friction default for headless VMs).
  try { const v = fs.readFileSync(vaultKeyFilePath(), 'utf8').trim(); if (v) return { master: v, source: 'key-file' }; } catch { /* none */ }
  return null;
}
export const newMasterSecret = (): string => crypto.randomBytes(32).toString('base64url');

// ── the vault file ──────────────────────────────────────────────────────────
export function readVaultFile(file = vaultPath()): VaultFile | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as VaultFile; } catch { return null; }
}
export function writeVaultFile(v: VaultFile, file = vaultPath()): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 1), { mode: 0o600 });
  // 2026-11-12 (operator: an update must never remove or overwrite the vault): keep the previous version as <vault>.bak before replacing it
  try { if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`), fs.chmodSync(`${file}.bak`, 0o600); } catch { /* best effort */ }
  fs.renameSync(tmp, file);   // atomic replace — a crash never leaves a half-written vault
}
/** Create a NEW vault. Never replaces an existing one: the file is linked into place, which fails atomically when it exists. */
export function createVault(master: string, file = vaultPath()): VaultFile {
  if (fs.existsSync(file)) throw new Error(`a vault already exists at ${file} — refusing to overwrite it`);
  const v: VaultFile = { version: 1, id: VAULT_ID, check: encryptValue(deriveKey(master), CHECK_PLAINTEXT), secrets: {}, bindings: [] };
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.new`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 1), { mode: 0o600 });
  try { fs.linkSync(tmp, file); }
  catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') throw new Error(`a vault already exists at ${file} — refusing to overwrite it`);
    // filesystems without hard links: exclusive create ('wx' fails when the file exists)
    try { fs.writeFileSync(file, JSON.stringify(v, null, 1), { mode: 0o600, flag: 'wx' }); }
    catch (e2) { if ((e2 as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`a vault already exists at ${file} — refusing to overwrite it`); throw e2; }
  }
  finally { try { fs.unlinkSync(tmp); } catch { /* gone */ } }
  return v;
}

/** An open vault: values are decrypted only on request and never logged. */
export class Vault {
  private constructor(private readonly key: Buffer, private data: VaultFile, readonly file: string, readonly source: UnlockSource) {}
  static open(master: string, source: UnlockSource, file = vaultPath()): Vault {
    const data = readVaultFile(file); if (!data) throw new Error(`no vault at ${file}`);
    const key = deriveKey(master, data.id);
    try { if (decryptValue(key, data.check) !== CHECK_PLAINTEXT) throw new Error('bad check'); } catch { throw new Error('wrong vault key'); }
    return new Vault(key, data, file, source);
  }
  names(): string[] { return Object.keys(this.data.secrets).sort(); }
  meta(name: string): Omit<VaultEntry, 'enc'> | null { const e = this.data.secrets[name]; if (!e) return null; const { enc: _enc, ...m } = e; return m; }
  get(name: string): string | null { const e = this.data.secrets[name]; return e ? decryptValue(this.key, e.enc) : null; }
  set(name: string, value: string, meta: Omit<VaultEntry, 'enc' | 'updatedAt'> = {}): void {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('secret names are environment-variable style: letters, digits, _');
    const prev = this.data.secrets[name];
    this.data.secrets[name] = { ...(prev ? { provider: prev.provider, type: prev.type, category: prev.category, note: prev.note } : {}), ...meta, enc: encryptValue(this.key, value), updatedAt: Date.now() };
    writeVaultFile(this.data, this.file);
  }
  delete(name: string): boolean { if (!this.data.secrets[name]) return false; delete this.data.secrets[name]; this.data.bindings = this.data.bindings.filter((b) => b.secret !== name); writeVaultFile(this.data, this.file); return true; }
  bindings(): VaultBinding[] { return [...this.data.bindings]; }
  bind(b: VaultBinding): void { if (!this.data.secrets[b.secret]) throw new Error(`no secret ${b.secret}`); this.data.bindings = [...this.data.bindings.filter((x) => !(x.envVar === b.envVar && x.tool === b.tool)), b]; writeVaultFile(this.data, this.file); }
  unbind(envVar: string, tool?: string): void { this.data.bindings = this.data.bindings.filter((x) => !(x.envVar === envVar && x.tool === tool)); writeVaultFile(this.data, this.file); }
  /** Every value, for output masking only (never for display). */
  allValues(): Array<{ name: string; value: string }> { return this.names().map((name) => ({ name, value: this.get(name)! })).filter((x) => x.value.length >= 6); }
}

/** Open the vault from the non-interactive sources, or report why not. */
export function openVaultNonInteractive(env: NodeJS.ProcessEnv = process.env, file = vaultPath()): { vault: Vault | null; status: VaultStatus } {
  const exists = fs.existsSync(file);
  if (!exists) return { vault: null, status: { exists: false, unlocked: false, path: file } };
  const m = resolveMasterSecret(env);
  if (!m) return { vault: null, status: { exists: true, unlocked: false, path: file, error: 'locked: set CORTEX_SECRETS_KEY (or CORTEX_SECRETS_KEY_FILE), or unlock with `cortex secrets unlock`' } };
  try { const vault = Vault.open(m.master, m.source, file); return { vault, status: { exists: true, unlocked: true, source: m.source, count: vault.names().length, path: file } }; }
  catch (e) { return { vault: null, status: { exists: true, unlocked: false, path: file, error: String((e as Error).message) } }; }
}

/** STARTUP: put the vault's secrets into `env` without overriding what is already set (real env > vault > .env files). Never throws. */
export function loadVaultIntoEnv(env: NodeJS.ProcessEnv = process.env): VaultStatus {
  try {
    const { vault, status } = openVaultNonInteractive(env);
    if (!vault) return status;
    let loaded = 0; const injected: string[] = [];
    for (const name of vault.names()) if (env[name] === undefined || env[name] === '') { env[name] = vault.get(name)!; loaded++; injected.push(name); }
    if (env === process.env) recordVaultSession(vault, injected, env);
    return { ...status, count: loaded };
  } catch (e) { return { exists: true, unlocked: false, path: vaultPath(), error: String((e as Error).message) }; }
}

/** Replace any stored secret value appearing in `text` with «secret:NAME» — applied to tool output before the model sees it. */
export function maskSecrets(text: string, values: Array<{ name: string; value: string }>): string {
  let out = text;
  for (const { name, value } of [...values].sort((a, b) => b.value.length - a.value.length)) {
    if (!value || value.length < 6) continue;
    for (const form of [value, Buffer.from(value).toString('base64'), encodeURIComponent(value)]) if (form && out.includes(form)) out = out.split(form).join(`«secret:${name}»`);
  }
  return out;
}

/** Create the vault the zero-friction way (shared by `cortex secrets init` and the /secrets dialogs): the key already given
 *  (CORTEX_SECRETS_KEY / _FILE), else a new random key kept in the OS keychain, else in the owner-only key file beside the vault. */
export function initVaultDefault(env: NodeJS.ProcessEnv = process.env): { where: UnlockSource; path: string; hint: string } {
  if (fs.existsSync(vaultPath())) throw new Error(`a vault already exists at ${vaultPath()}`);
  const given = resolveMasterSecret(env);
  let master: string; let where: UnlockSource;
  // reuse ANY key that already exists (env, key file, keychain entry) — never replace a stored key with a new one (2026-11-12)
  if (given && given.source !== 'passphrase') { master = given.master; where = given.source; }
  else {
    master = newMasterSecret();
    if (keychainSet(master)) where = 'keychain';
    else { fs.mkdirSync(path.dirname(vaultKeyFilePath()), { recursive: true, mode: 0o700 }); fs.writeFileSync(vaultKeyFilePath(), master + '\n', { mode: 0o600 }); where = 'key-file'; }
  }
  createVault(master);
  const hint = where === 'key-file' ? `key in ${vaultKeyFilePath()} (owner-only; no keychain on this machine) — for stronger separation move it and pass CORTEX_SECRETS_KEY_FILE`
    : where === 'keychain' ? 'key in the OS keychain; unlocks automatically for this user' : `key from ${where === 'env' ? 'CORTEX_SECRETS_KEY' : 'CORTEX_SECRETS_KEY_FILE'}`;
  return { where, path: vaultPath(), hint };
}

// ── Phase 2: what tool processes see, and what the model sees (docs/SECRETS_VAULT_PLAN.md) ─────────────────────────────────────────
// The harness keeps the vault's keys in its own environment (providers read process.env). Processes that run MODEL-CHOSEN code (the
// shell, code execution, tmux, the terminal sandbox, artifacts, git/gh) get toolChildEnv() instead: the vault keys the startup loaded
// are removed (real environment variables stay — a Replit secret is the user's own choice), so are the vault unlock variables, and
// only the BOUND secrets are added (`cortex secrets bind NAME ENV_VAR [--tool T]`). Every tool result is passed through
// maskSecretText() before the model or the screen sees it, which also catches a value that reached output any other way. Both are
// no-ops when no vault was unlocked at startup.

interface VaultSession { injected: Map<string, string>; mask: Array<{ name: string; value: string }>; bindings: Array<VaultBinding & { value: string }>; file: string; mtimeMs: number }
let session: VaultSession | null = null;

function recordVaultSession(vault: Vault, injected: string[], env: NodeJS.ProcessEnv): void {
  const m = resolveMasterSecret(env);
  const values = new Map(vault.names().map((n) => [n, vault.get(n)!] as const));
  // bootstrapEnv runs more than once per process (entry point + OrchestratorFactory, per request in stateless mode); a later run finds
  // the vault keys already set and injects nothing — keep what earlier runs injected or the tool-env filter would forget them.
  const names = new Set([...(session?.injected.keys() ?? []), ...injected].filter((n) => values.has(n)));
  session = {
    injected: new Map([...names].map((n) => [n, values.get(n)!] as const)),
    mask: [...vault.allValues(), ...(m ? [{ name: 'CORTEX_SECRETS_KEY', value: m.master }] : [])],
    bindings: vault.bindings().filter((b) => values.has(b.secret)).map((b) => ({ ...b, value: values.get(b.secret)! })),
    file: vault.file, mtimeMs: safeMtime(vault.file),
  };
}

const safeMtime = (f: string): number => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };

/** The session, re-read when the vault file changed (a /secrets edit or `cortex secrets set` during the session). */
function currentSession(): VaultSession | null {
  if (!session || safeMtime(session.file) === session.mtimeMs) return session;
  try {
    const m = resolveMasterSecret(process.env); if (!m) return session;
    const vault = Vault.open(m.master, m.source, session.file);
    // Names the startup injected stay "injected" (their process.env value may now be stale — still the vault's, never the user's).
    recordVaultSession(vault, [...session.injected.keys()], process.env);
  } catch { /* keep the previous session */ }
  return session;
}

/** Environment for a process that runs model-chosen code. `tool` selects tool-scoped bindings (e.g. 'Bash'). Always returns an object. */
export function toolChildEnv(base: NodeJS.ProcessEnv = process.env, tool?: string): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...base };
  // Sub-agent nesting guard (2026-11-12, operator "fix the sub-agent nesting gap"): every process a tool starts carries the depth of the
  // agent that started it, so a `cortex` CLI launched from an agent's Bash refuses to start ANOTHER agent (bin/cortex.js) — the bounded
  // Task/Browse spawners (SubAgentProcessManager, HerdrSubAgentRunner) launch agent-mode.js directly and are unaffected. A separate var,
  // not CORTEX_AGENT_DEPTH itself, so test suites an agent runs through Bash see the env they expect.
  { const n = parseInt(base.CORTEX_AGENT_DEPTH ?? '', 10); out.CORTEX_TOOL_PARENT_DEPTH = String(Number.isFinite(n) && n >= 0 ? n : base.CORTEX_AGENT_MODE === 'true' ? 1 : 0); }
  const s = currentSession();
  if (!s) return out;
  for (const [name, value] of s.injected) if (out[name] === value) delete out[name];
  delete out.CORTEX_SECRETS_KEY; delete out.CORTEX_SECRETS_KEY_FILE;
  for (const b of s.bindings) if (b.scope === 'global' || (tool && b.tool === tool)) out[b.envVar] = b.value;
  return out;
}

/** Replace every vault value (and the vault key) in `text` with «secret:NAME». Identity when no vault is unlocked. */
export function maskSecretText(text: string): string {
  const s = currentSession();
  return s && typeof text === 'string' && text ? maskSecrets(text, s.mask) : text;
}

/** maskSecretText over a batch of tool results (content strings only; everything else passes through). */
export function maskToolResults<T extends { content: unknown }>(results: T[]): T[] {
  if (!currentSession()) return results;
  return results.map((r) => (typeof r.content === 'string' ? { ...r, content: maskSecretText(r.content) } : r));
}

/** What the secrets-list tool reports: names, providers, bindings, and how the vault unlocked. Never values. */
export function describeVaultForAgent(): { unlocked: boolean; source?: string; secrets: Array<{ name: string; provider?: string; type?: string; boundAs: string[] }>; note: string } {
  const r = openVaultNonInteractive();
  if (!r.vault) return { unlocked: false, secrets: [], note: r.status.exists ? `vault locked (${r.status.error ?? 'no key'})` : 'no vault on this machine' };
  const v = r.vault;
  return {
    unlocked: true, source: r.status.source,
    secrets: v.names().map((name) => ({ name, provider: v.meta(name)?.provider, type: v.meta(name)?.type,
      boundAs: v.bindings().filter((b) => b.secret === name).map((b) => (b.tool ? `$${b.envVar} (tool ${b.tool})` : `$${b.envVar}`)) })),
    note: 'Values are never shown. A secret reaches your shell/tool processes only through a binding (the user runs `cortex secrets bind NAME ENV_VAR`); the harness itself already uses provider keys from the vault. Tool output shows a stored value as «secret:NAME».',
  };
}

/** Test hook: forget the recorded session. */
export function _resetVaultSessionForTests(): void { session = null; }
