/**
 * `cortex secrets` — manage the encrypted secrets vault (~/.cortex/secrets.enc; core config/secretsVault.ts; plan docs/SECRETS_VAULT_PLAN.md).
 * Every action works headless with flags (agents / orchestrators); a person at a terminal gets masked prompts. Values are never taken
 * on the command line (they would show in the process list): a masked prompt, stdin (`--stdin` or a pipe), or `--from-env NAME`.
 *   cortex secrets status | init | unlock | list | set <NAME> | get <NAME> [--reveal] | delete <NAME> | bind <NAME> <ENV_VAR> |
 *                  unbind <ENV_VAR> | import-env [--strip] | exec [--only A,B] -- <command…>
 * The interactive menu is `/secrets` inside neoncortex / fuzzycortex.
 */
import fs from 'fs';
import os from 'os';
import inquirer from 'inquirer';
import {
  Vault, createVault, initVaultDefault, openVaultNonInteractive, vaultPath,
  getGlobalEnvPath, parseEnvFile,
} from '@nexus-cortex/core';

const SECRET_NAME = /(_API_KEY|_API_TOKEN|_OAUTH_TOKEN|_TOKEN|_SECRET|_PASSWORD|_ACCESS_KEY)$/;
const tty = () => !!process.stdin.isTTY && !!process.stdout.isTTY;
const out = (json: boolean, obj: unknown, text: string) => console.log(json ? JSON.stringify(obj) : text);
export const maskPreview = (v: string) => (v.length <= 8 ? '••••' : `${v.slice(0, 4)}…${v.slice(-2)} (${v.length})`);

async function readStdin(): Promise<string> { const chunks: Buffer[] = []; for await (const c of process.stdin) chunks.push(c as Buffer); return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, ''); }

/** Open the vault: the non-interactive chain first; a passphrase prompt only when a person is at the terminal. */
async function openVault(): Promise<Vault> {
  const r = openVaultNonInteractive();
  if (r.vault) return r.vault;
  if (!r.status.exists) throw new Error(`no vault yet — run \`cortex secrets init\` (${r.status.path})`);
  if (!tty()) throw new Error(r.status.error ?? 'vault is locked');
  const { pass } = await inquirer.prompt<{ pass: string }>([{ type: 'password', name: 'pass', mask: '*', message: 'Vault passphrase / key:' }]);
  return Vault.open(pass.trim(), 'passphrase');
}

async function valueFrom(opts: { stdin?: boolean; fromEnv?: string }, name: string): Promise<string> {
  if (opts.fromEnv) { const v = process.env[opts.fromEnv]; if (!v) throw new Error(`${opts.fromEnv} is not set`); return v; }
  if (opts.stdin || !process.stdin.isTTY) { const v = await readStdin(); if (!v) throw new Error('no value on stdin'); return v; }
  const { value } = await inquirer.prompt<{ value: string }>([{ type: 'password', name: 'value', mask: '*', message: `${name}:`, validate: (v: string) => (v.trim() ? true : 'empty') }]);
  return value.trim();
}

export async function runSecrets(action: string, args: string[], opts: Record<string, any>): Promise<number> {
  const json = !!opts.json;
  try {
    switch (action) {
      case 'status': {
        const r = openVaultNonInteractive();
        out(json, r.status, r.status.exists
          ? `vault ${r.status.path}: ${r.status.unlocked ? `unlocked via ${r.status.source}, ${r.status.count} secret(s)` : `LOCKED — ${r.status.error}`}`
          : `no vault yet (${r.status.path}) — run \`cortex secrets init\``);
        return 0;
      }
      case 'init': {
        if (fs.existsSync(vaultPath())) { out(json, { exists: true }, `a vault already exists at ${vaultPath()}`); return 0; }
        // Default (shared with the /secrets dialogs): the key already given (CORTEX_SECRETS_KEY / _FILE), else a new random key in the OS
        // keychain, else an owner-only key file beside the vault (headless VM / container).
        if (!opts.passphrase) { const r = initVaultDefault(); out(json, { created: r.path, key: r.where }, `vault created at ${r.path} — ${r.hint}`); return 0; }
        // --passphrase: the passphrase IS the key (unattended runs pass it as CORTEX_SECRETS_KEY).
        if (!tty()) throw new Error('--passphrase needs a terminal; headless callers pass CORTEX_SECRETS_KEY instead');
        const { p1 } = await inquirer.prompt<{ p1: string }>([{ type: 'password', name: 'p1', mask: '*', message: 'New vault passphrase (12+ chars):', validate: (v: string) => (v.length >= 12 ? true : 'at least 12 characters') }]);
        const { p2 } = await inquirer.prompt<{ p2: string }>([{ type: 'password', name: 'p2', mask: '*', message: 'Repeat it:' }]);
        if (p1 !== p2) throw new Error('passphrases differ');
        createVault(p1);
        out(json, { created: vaultPath(), key: 'passphrase' }, `vault created at ${vaultPath()} — unlock with the passphrase (or pass it as CORTEX_SECRETS_KEY for unattended runs)`);
        return 0;
      }
      case 'unlock': {
        const v = await openVault();
        if (opts.remember && v.source === 'passphrase') { /* the passphrase IS the master secret */ }
        out(json, { unlocked: true, source: v.source, count: v.names().length }, `unlocked (${v.source}), ${v.names().length} secret(s)`);
        return 0;
      }
      case 'list': {
        const v = await openVault();
        const rows = v.names().map((n) => ({ name: n, ...v.meta(n), preview: maskPreview(v.get(n) ?? '') }));
        if (json) { console.log(JSON.stringify({ secrets: rows, bindings: v.bindings() })); return 0; }
        if (!rows.length) { console.log('no secrets yet — `cortex secrets set NAME` or `cortex secrets import-env`'); return 0; }
        for (const r of rows) console.log(`${r.name.padEnd(32)} ${(r.provider ?? '').padEnd(12)} ${r.preview}`);
        for (const b of v.bindings()) console.log(`  bind ${b.secret} → $${b.envVar}${b.tool ? ` (tool ${b.tool})` : ''}`);
        return 0;
      }
      case 'set': {
        const name = args[0]; if (!name) throw new Error('usage: cortex secrets set NAME [--provider p] [--type t] [--stdin | --from-env VAR]');
        const v = await openVault();
        v.set(name, await valueFrom(opts, name), { provider: opts.provider, type: opts.type, category: opts.category, note: opts.note });
        out(json, { set: name }, `stored ${name}`);
        return 0;
      }
      case 'get': {
        const name = args[0]; if (!name) throw new Error('usage: cortex secrets get NAME [--reveal]');
        const v = await openVault(); const val = v.get(name); if (val === null) throw new Error(`no secret ${name}`);
        out(json, { name, ...(opts.reveal ? { value: val } : { preview: maskPreview(val) }) }, opts.reveal ? val : `${name} = ${maskPreview(val)}  (add --reveal to print it)`);
        return 0;
      }
      case 'delete': { const v = await openVault(); const ok = v.delete(args[0] ?? ''); out(json, { deleted: ok }, ok ? `deleted ${args[0]}` : `no secret ${args[0]}`); return ok ? 0 : 1; }
      case 'bind': {
        const [secret, envVar] = args; if (!secret || !envVar) throw new Error('usage: cortex secrets bind SECRET ENV_VAR [--tool name]');
        const v = await openVault(); v.bind({ secret, envVar, scope: opts.tool ? 'tool' : 'global', ...(opts.tool ? { tool: opts.tool } : {}) });
        out(json, { bound: secret, envVar }, `bound ${secret} → $${envVar}${opts.tool ? ` for ${opts.tool}` : ''}`); return 0;
      }
      case 'unbind': { const v = await openVault(); v.unbind(args[0] ?? '', opts.tool); out(json, { unbound: args[0] }, `unbound $${args[0]}`); return 0; }
      case 'import-env': {
        // Move the secret-looking keys from ~/.cortex/.env into the vault; --strip then blanks them in the .env (non-secrets stay).
        const envPath = getGlobalEnvPath(); const v = await openVault();
        const parsed = fs.existsSync(envPath) ? parseEnvFile(fs.readFileSync(envPath, 'utf8')) : {};
        const moved = Object.entries(parsed).filter(([k, val]) => SECRET_NAME.test(k) && String(val ?? '').trim()).map(([k, val]) => { v.set(k, String(val), { category: 'imported' }); return k; });
        if (opts.strip && moved.length) {
          const lines = fs.readFileSync(envPath, 'utf8').split('\n').map((l) => { const k = l.split('=')[0]?.trim(); return k && moved.includes(k) ? `${k}=   # moved to the secrets vault ${new Date().toISOString().slice(0, 10)}` : l; });
          // The backup keeps every other line, with the moved values blanked — a plaintext copy of the keys would undo the move.
          fs.writeFileSync(`${envPath}.pre-vault.bak`, lines.join('\n'), { mode: 0o600 }); fs.writeFileSync(envPath, lines.join('\n'));
        }
        out(json, { moved, stripped: !!opts.strip }, moved.length ? `moved ${moved.length} key(s) into the vault: ${moved.join(', ')}${opts.strip ? ` (blanked in ${envPath}; backup .pre-vault.bak)` : ' — add --strip to blank them in the .env'}` : 'no secret-looking keys with values in the .env');
        return 0;
      }
      case 'exec': {
        // Replit-style injection for ANY program: run it with the vault's keys in its environment (real env still wins; --only limits
        // which). Values never touch the screen, a file or shell history. `cortex secrets exec [--only A,B] -- <command> [args…]`
        if (!args.length) throw new Error('usage: cortex secrets exec [--only NAME,NAME] -- <command> [args…]');
        const v = await openVault();
        const only = opts.only ? new Set(String(opts.only).split(',').map((x: string) => x.trim()).filter(Boolean)) : null;
        const env: NodeJS.ProcessEnv = { ...process.env };
        let injected = 0;
        for (const n of v.names()) { if (only && !only.has(n)) continue; if (env[n] === undefined || env[n] === '') { env[n] = v.get(n)!; injected++; } }
        const { spawn } = await import('child_process');
        return await new Promise<number>((resolve) => {
          const child = spawn(args[0]!, args.slice(1), { env, stdio: 'inherit' });
          child.on('exit', (code, sig) => resolve(code ?? (sig ? 128 + ((os.constants.signals as Record<string, number>)[sig] ?? 1) : 1)));   // shell convention for a signal
          child.on('error', (e) => { console.error(`error: ${e.message}`); resolve(127); });
          if (opts.verbose) console.error(`[secrets] ${injected} key(s) injected`);
        });
      }
      default:
        console.error('usage: cortex secrets status|init|unlock|list|set|get|delete|bind|unbind|import-env|exec  (the interactive menu is /secrets in neoncortex)');
        return 2;
    }
  } catch (e) { out(json, { error: String((e as Error).message) }, `error: ${(e as Error).message}`); return 1; }
}
