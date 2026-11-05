/**
 * `cortex setup` — the first-run wizard (2026-10-17). Walks a new user through: the providers they intend to use → their API keys →
 * the ACTION model → a cheap HELPER model → the stronger MENTOR model → the vision hand-off → the web-tools backend; writes everything
 * to ~/.cortex/.env through the canonical settings writer; then proves each chosen model with one tiny call ("then everything works").
 *
 * The decisions (what to offer, the suggested defaults, the env map) live in @nexus-cortex/core `setupPlan` — this file only prompts,
 * writes and probes. Offered automatically by the no-key preflight in a TTY.
 *
 * NON-INTERACTIVE (a script, a container, or any answer flag given): every question has a flag, and anything not named falls back to
 * the same suggestions the prompts show — so `cortex setup --key DEEPSEEK_API_KEY=sk-… --yes` is a complete first run.
 *   cortex setup --provider deepseek --key DEEPSEEK_API_KEY=sk-… --action deepseek-flash \
 *                --helper deepseek-flash --mentor deepseek-v4-pro --vision deepseek-flash --web auto -y
 * `--print` shows the env lines instead of writing; `--json` reports machine-readable; `--probe` opts a scripted run into the live
 * one-request-per-model check (the interactive wizard probes by default, a scripted run does not — no surprise network calls).
 */
import inquirer from 'inquirer';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import {
  ModularModelRegistry, SettingsLoader, getGlobalConfigDir, getGlobalEnvPath, validateSetting, keysOnlyStub,
  Vault, openVaultNonInteractive, initVaultDefault, vaultPath, providerForName,
  providerChoices, suggestRoles, webChoices, planToEnv, summaryLines, resolveSetupAnswers,
  type SetupAnswers, type ModelCardSummary, type EnvironmentVariables,
} from '@nexus-cortex/core';
import { OrchestratorClient } from '../../orchestrator/OrchestratorClient.js';

export interface SetupOptions {
  /** live one-request check per chosen model; default: ON interactively, OFF for a scripted run */
  probe?: boolean;
  /** write without the confirm prompt */
  yes?: boolean;
  /** provider ids (or their key env var), comma-separated on the command line */
  providers?: string[];
  /** env var → value entered on the command line (repeatable --key KEY=value) */
  keys?: Record<string, string>;
  action?: string;
  helper?: string;
  mentor?: string;
  /** 'none' = no vision hand-off */
  vision?: string;
  /** WEB_TOOLS_MODEL value; 'auto' / 'off' = auto-pick */
  web?: string;
  /** print the env lines that WOULD be written (secrets masked) and exit — no write, no probe */
  print?: boolean;
  json?: boolean;
  /** where API keys / tokens go: 'vault' (default — the encrypted ~/.cortex/secrets.enc) or 'env' (plaintext ~/.cortex/.env, the old way) */
  secretsTo?: 'vault' | 'env';
  /** 'local' = install the local browser now (everything it needs; choosing it is the approval) · 'hosted' = the hosted browser MCP */
  browser?: 'local' | 'hosted';
}

const fmtPrice = (m: ModelCardSummary) => (m.inputCost || m.outputCost) ? `$${m.inputCost}/$${m.outputCost} per M` : 'price n/a';
const fmtModel = (m: ModelCardSummary) => `${m.displayName.padEnd(38)} ${fmtPrice(m).padEnd(22)} ${m.reasoning ? 'reasoning ' : ''}${m.vision ? 'vision' : ''}`.trimEnd();

/** Secret-looking values never get echoed back in full (a wizard must not leak keys into a log). */
const maskSecret = (key: string, value: string): string => {
  if (!/(_API_KEY|_API_TOKEN|_OAUTH_TOKEN|_SECRET|_TOKEN)$/.test(key) || !value) return value;
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : '***';
};

/** Keys already resolvable from the environment (the same rule the no-key preflight uses). */
function presentEnvKeys(): Set<string> {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(process.env)) {
    if (/(_API_KEY|_API_TOKEN|_OAUTH_TOKEN)$/.test(k) && String(v || '').trim()) out.add(k);
  }
  return out;
}

/** Write through the canonical settings writer (validated against the schema). Never bin-local. */
function writePlan(env: Record<string, string>): { ok: boolean; failed: string[]; error?: string } {
  for (const [k, v] of Object.entries(env)) {
    const valid = validateSetting(k as keyof EnvironmentVariables, v);
    if (valid !== true) return { ok: false, failed: [k], error: `${k}=${maskSecret(k, v)} rejected: ${valid}` };
  }
  // First activation: seed the canonical KEYS-ONLY ~/.cortex/.env (the same stub bootstrapEnv writes) so the
  // wizard fills a real file instead of tripping the loader's "no .env found" path.
  const envPath = getGlobalEnvPath();
  try {
    if (!existsSync(envPath)) {
      mkdirSync(dirname(envPath), { recursive: true });
      writeFileSync(envPath, keysOnlyStub(), 'utf-8');
    }
  } catch { /* read-only home — setMultiple reports the real error below */ }
  const loader = new SettingsLoader(getGlobalConfigDir());
  const results = loader.setMultiple(env as Partial<EnvironmentVariables>);
  const failed = Object.entries(results).filter(([, r]) => !(r as { success: boolean }).success).map(([k]) => k);
  return { ok: failed.length === 0, failed };
}

const SECRET_KEY = /(_API_KEY|_API_TOKEN|_OAUTH_TOKEN|_SECRET|_TOKEN)$/;

/** Split a plan into secrets (keys / tokens) and plain settings. */
function splitSecrets(env: Record<string, string>): { secrets: Record<string, string>; settings: Record<string, string> } {
  const secrets: Record<string, string> = {}; const settings: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) (SECRET_KEY.test(k) ? secrets : settings)[k] = v;
  return { secrets, settings };
}

interface SecretWrite { ok: boolean; where: 'vault' | 'env'; path: string; source?: string; created?: boolean; blanked: string[]; error?: string }

/**
 * Secrets vault Phase 3: keys go to the encrypted vault (~/.cortex/secrets.enc), not the plaintext .env. No vault yet → create one the
 * zero-friction way (OS keychain, else an owner-only key file). A locked (passphrase) vault → ask at a terminal; a script must provide
 * CORTEX_SECRETS_KEY or choose --secrets-to env. A plaintext copy of the same key left in ~/.cortex/.env is blanked (it would only go
 * stale: the vault ranks above the .env file).
 */
async function writeSecrets(secrets: Record<string, string>, opts: SetupOptions, interactive: boolean): Promise<SecretWrite> {
  if (Object.keys(secrets).length === 0) return { ok: true, where: opts.secretsTo === 'env' ? 'env' : 'vault', path: vaultPath(), blanked: [] };
  if (opts.secretsTo === 'env') { const w = writePlan(secrets); return { ok: w.ok, where: 'env', path: getGlobalEnvPath(), blanked: [], error: w.error ?? (w.ok ? undefined : w.failed.join(', ')) }; }
  let vault: Vault | null = null; let created = false;
  try {
    let r = openVaultNonInteractive();
    if (!r.status.exists) { initVaultDefault(); created = true; r = openVaultNonInteractive(); }
    vault = r.vault;
    if (!vault && r.status.exists && interactive) {
      const { pass } = await inquirer.prompt<{ pass: string }>([{ type: 'password', name: 'pass', mask: '*', message: 'The secrets vault is locked — its passphrase / key:' }]);
      vault = Vault.open(pass.trim(), 'passphrase');
    }
    if (!vault) return { ok: false, where: 'vault', path: vaultPath(), blanked: [], error: `the secrets vault ${vaultPath()} is locked — set CORTEX_SECRETS_KEY (or CORTEX_SECRETS_KEY_FILE) to its key, run setup at a terminal to be asked for it, or pass --secrets-to env to write the keys to ${getGlobalEnvPath()} instead` };
    for (const [k, v] of Object.entries(secrets)) vault.set(k, v, providerForName(k) ? { provider: providerForName(k)!.id } : {});
  } catch (e) {
    return { ok: false, where: 'vault', path: vaultPath(), blanked: [], error: String((e as Error).message) };
  }
  // Blank stale plaintext copies in ~/.cortex/.env (other lines untouched).
  const blanked: string[] = []; const envPath = getGlobalEnvPath();
  try {
    if (existsSync(envPath)) {
      const lines = readFileSync(envPath, 'utf-8').split('\n').map((l) => {
        const m = l.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (m && m[1]! in secrets && m[2]!.replace(/#.*$/, '').trim().replace(/^["']|["']$/g, '')) { blanked.push(m[1]!); return `${m[1]}=   # moved to the secrets vault`; }
        return l;
      });
      if (blanked.length) writeFileSync(envPath, lines.join('\n'), 'utf-8');
    }
  } catch { /* read-only home — the vault still wins on precedence */ }
  return { ok: true, where: 'vault', path: vault.file, source: vault.source, created, blanked };
}

const secretLine = (w: SecretWrite, n: number): string => n === 0 ? '' : w.where === 'env'
  ? `${n} key(s) to ${w.path} (plaintext — \`cortex secrets import-env --strip\` moves them into the encrypted vault)`
  : `${n} key(s) to the encrypted secrets vault ${w.path}${w.created ? ' (created; ' : ' ('}unlocks via ${w.source ?? 'its key'})${w.blanked.length ? `; blanked the old plaintext copies in ${getGlobalEnvPath()}: ${w.blanked.join(', ')}` : ''}`;

/** The browser choice: 'local' installs the local browser now (the choice is the approval); 'hosted' records the hosted MCP. */
async function applyBrowserChoice(choice: 'local' | 'hosted' | undefined, approved: boolean, out: (s?: string) => void): Promise<{ ok: boolean; message: string } | null> {
  if (!choice) return null;
  if (choice === 'hosted') {
    new SettingsLoader(getGlobalConfigDir()).setMultiple({ NEXUS_BROWSER_MODE: 'hosted' } as Partial<EnvironmentVariables>);
    process.env.NEXUS_BROWSER_MODE = 'hosted';
    return { ok: true, message: 'Browser: the hosted browser MCP (NEXUS_BROWSER_MODE=hosted).' };
  }
  out('Installing the local browser…');
  const { installLocalBrowser } = await import('../browser/index.js');
  return installLocalBrowser({ approved, out: (s) => out(s) });
}

interface ProbeResult { model: string; ok: boolean; ms: number; detail: string }

async function probeModels(ids: string[], out: (s?: string) => void): Promise<ProbeResult[]> {
  out('');
  out(`Checking ${ids.length} model${ids.length === 1 ? '' : 's'} with one tiny request each...`);
  const results: ProbeResult[] = [];
  for (const id of ids) {
    const t0 = Date.now();
    try {
      const client = new OrchestratorClient({ mode: 'direct' });
      await client.initialize();
      const res = await Promise.race([
        client.sendMessage('Reply with the single word OK.', { model: id }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timed out after 60 s')), 60_000)),
      ]);
      const text = String((res as any)?.text ?? (res as any)?.content ?? (res as any)?.message ?? '').trim();
      const r: ProbeResult = { model: id, ok: true, ms: Date.now() - t0, detail: text.slice(0, 40).replace(/\s+/g, ' ') };
      results.push(r);
      out(`  [OK]   ${id.padEnd(28)} ${Math.round(r.ms / 100) / 10}s  ${r.detail}`);
    } catch (e: any) {
      const r: ProbeResult = { model: id, ok: false, ms: Date.now() - t0, detail: String(e?.message ?? e).split('\n')[0]!.slice(0, 120) };
      results.push(r);
      out(`  [FAIL] ${id.padEnd(28)} ${r.detail}`);
    }
  }
  return results;
}

const RECIPE = [
  '[cortex] setup needs answers (providers, keys, model roles). Non-interactive recipe:',
  '  cortex setup --key DEEPSEEK_API_KEY=sk-... --yes            # one key configures every role',
  '  cortex setup --provider deepseek --key DEEPSEEK_API_KEY=sk-... \\',
  '               --action deepseek-flash --helper deepseek-flash \\',
  '               --mentor deepseek-v4-pro --vision deepseek-flash --web auto --yes',
  '  cortex setup --print --key DEEPSEEK_API_KEY=sk-...          # show the env lines, write nothing',
  '  cortex secrets set DEEPSEEK_API_KEY                          # or one key at a time (masked prompt / stdin; encrypted vault)',
];

export async function runSetup(opts: SetupOptions = {}): Promise<number> {
  const out = (s = '') => process.stdout.write(s + '\n');
  const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
  const registry = new ModularModelRegistry();
  const cards = registry.getAllModels();
  const providers = providerChoices(cards);
  const byId = (id: string) => providers.flatMap((p) => p.models).find((m) => m.id === id);

  const hasAnswerFlags = !!(opts.providers?.length || Object.keys(opts.keys ?? {}).length || opts.action
    || opts.helper || opts.mentor || opts.vision !== undefined || opts.web !== undefined || opts.print);

  // A bare `cortex setup` with no terminal and no flags stays INERT (recipe + exit 2): a script must ask for a
  // write, either with answer flags or with --yes (which then resolves from the flags/env present). A bare
  // non-TTY run silently rewriting ~/.cortex/.env is exactly the surprise a first-run wizard must not spring.
  if (!interactive && !hasAnswerFlags && !opts.yes) {
    for (const line of RECIPE) out(line);
    return 2;
  }

  // ── Scripted path: flags + env, same suggestions as the prompts ────────────────────────────────
  if (!interactive || hasAnswerFlags) {
    const resolved = resolveSetupAnswers(cards, {
      providers: opts.providers,
      keys: opts.keys,
      action: opts.action,
      helper: opts.helper,
      mentor: opts.mentor,
      vision: opts.vision,
      webToolsModel: opts.web,
    }, presentEnvKeys());
    if (!resolved) {
      for (const line of RECIPE) out(line);
      return 2;
    }
    const answers = resolved.answers;
    const env = planToEnv(answers);

    const { secrets, settings } = splitSecrets(env);
    const secretsWhere = opts.secretsTo === 'env' ? getGlobalEnvPath() : vaultPath();
    if (opts.print) {
      if (opts.json) {
        out(JSON.stringify({ write: false, path: getGlobalEnvPath(), secretsPath: secretsWhere, env: Object.fromEntries(Object.entries(env).map(([k, v]) => [k, maskSecret(k, v)])) }, null, 2));
        return 0;
      }
      out(`# would write to ${getGlobalEnvPath()}`);
      for (const [k, v] of Object.entries(settings)) out(`${k}=${maskSecret(k, v)}`);
      if (Object.keys(secrets).length) { out(`# keys would go to ${secretsWhere}`); for (const [k, v] of Object.entries(secrets)) out(`${k}=${maskSecret(k, v)}`); }
      return 0;
    }

    const sw = await writeSecrets(secrets, opts, interactive);
    if (!sw.ok) { out(`[cortex] Failed to store the keys: ${sw.error}`); return 1; }
    const wrote = writePlan(settings);
    if (!wrote.ok) {
      out(`[cortex] Failed to write${wrote.error ? `: ${wrote.error}` : `: ${wrote.failed.join(', ')}`}`);
      return 1;
    }
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    const browserMsg = await applyBrowserChoice(opts.browser, true, out);

    const probes = opts.probe ? await probeModels([...new Set([answers.action, answers.helper, answers.mentor, ...(answers.vision ? [answers.vision] : [])])], out) : [];
    const bad = probes.filter((p) => !p.ok);

    if (opts.json) {
      out(JSON.stringify({
        write: true,
        path: getGlobalEnvPath(),
        secrets: { where: sw.where, path: sw.path, names: Object.keys(secrets), created: !!sw.created, blanked: sw.blanked },
        env: Object.fromEntries(Object.entries(env).map(([k, v]) => [k, maskSecret(k, v)])),
        answers: { ...answers, keys: Object.fromEntries(Object.entries(answers.keys).map(([k, v]) => [k, maskSecret(k, v)])) },
        probes,
        ok: bad.length === 0,
      }, null, 2));
      return bad.length ? 1 : 0;
    }

    out(`[OK] Saved ${Object.keys(settings).length} settings to ${getGlobalEnvPath()}`);
    if (Object.keys(secrets).length) out(`[OK] Saved ${secretLine(sw, Object.keys(secrets).length)}`);
    if (browserMsg) out(`[${browserMsg.ok ? 'OK' : 'cortex'}] ${browserMsg.message}`);
    out('');
    for (const l of summaryLines(answers, byId)) out('  ' + l);
    out('');
    if (bad.length) {
      out(`[cortex] ${bad.length} model${bad.length === 1 ? '' : 's'} failed the check — fix the key or pick another model with: cortex setup`);
      return 1;
    }
    out(opts.probe
      ? '[cortex] Everything works. Try:  cortex "What is this project?"'
      : '[cortex] Configured. Try:  cortex "What is this project?"   (re-run with --probe to verify each model)');
    return 0;
  }

  // ── Interactive path ───────────────────────────────────────────────────────────────────────────
  out('');
  out('cortex setup — configure providers, keys and model roles (settings → ' + getGlobalEnvPath() + (opts.secretsTo === 'env' ? '' : '; keys → the encrypted secrets vault') + ')');
  out('');

  // 1. providers
  const { chosen } = await inquirer.prompt<{ chosen: string[] }>([{
    type: 'checkbox', name: 'chosen', message: 'Which LLM providers do you intend to use? (space to select, enter to continue)',
    choices: providers.map((p) => ({ name: `${p.label}  — key: ${p.keyEnv || '(none needed)'}, ${p.models.length} model${p.models.length === 1 ? '' : 's'}`, value: p.provider, checked: p.provider === 'deepseek' })),
    validate: (v: string[]) => (v.length > 0 ? true : 'Pick at least one provider'),
  }]);
  const chosenRows = providers.filter((p) => chosen.includes(p.provider));

  // 2. keys
  const existingLoader = new SettingsLoader(getGlobalConfigDir());
  // The vault counts as "already set" even when this entry point did not load it into the environment.
  const inVault = new Set(openVaultNonInteractive().vault?.names() ?? []);
  const keys: Record<string, string> = {};
  const present = new Set<string>();
  for (const p of chosenRows) {
    if (!p.keyEnv) continue;
    const existing = (process.env[p.keyEnv] || existingLoader.get(p.keyEnv as keyof EnvironmentVariables) || (inVault.has(p.keyEnv) ? '(in the secrets vault)' : '')).trim();
    const { value } = await inquirer.prompt<{ value: string }>([{
      type: 'password', name: 'value', mask: '*',
      message: existing ? `${p.keyEnv} (${p.label}) — a value is already set; enter to keep it, or paste a new one:` : `${p.keyEnv} (${p.label}):`,
      validate: (v: string) => (v.trim() || existing ? true : `A ${p.label} key is needed to use its models (leave the provider unselected to skip)`),
    }]);
    // Only a key the user typed is written; keeping an existing one writes nothing (it already resolves — from the real
    // environment, the vault or the .env — and copying it would put e.g. a platform secret into a plaintext file).
    if (value.trim()) keys[p.keyEnv] = value.trim();
    else if (existing) present.add(p.keyEnv);
  }
  const keyEnvsPresent = new Set([...Object.keys(keys).filter((k) => keys[k]), ...present]);

  // 3-6. roles
  const suggested = suggestRoles(chosenRows)!;
  const modelChoices = chosenRows.flatMap((p) => p.models).map((m) => ({ name: fmtModel(m), value: m.id }));
  const pick = async (message: string, def: string | null, filter?: (m: ModelCardSummary) => boolean) => {
    const list = filter ? modelChoices.filter((c) => filter(byId(c.value)!)) : modelChoices;
    if (list.length === 0) return null;
    const a = await inquirer.prompt<{ v: string }>([{ type: 'list', name: 'v', message, choices: list, default: def ?? undefined, pageSize: 14 }]);
    return a.v;
  };
  const action = (await pick('Main ACTION model (does the work; one DeepSeek key runs everything by default):', suggested.action))!;
  const helper = (await pick('Cheap HELPER model (compaction, summaries, turn prediction; thinking off — cheapest is right):', suggested.helper))!;
  const mentor = (await pick('Stronger MENTOR model (lift plan, EndTurn judge, exit planners; a same-strength mentor adds nothing):', suggested.mentor))!;
  const vision = await pick('VISION hand-off model (reads images for text-only models):', suggested.vision, (m) => m.vision);

  // 7. web tools
  const web = webChoices(keyEnvsPresent);
  const { webToolsModel } = await inquirer.prompt<{ webToolsModel: string }>([{
    type: 'list', name: 'webToolsModel', message: 'Web tools backend (WebSearch / Browse need a search-capable key; WebFetch always works):',
    choices: web.map((w) => ({ name: w.label, value: w.value })), default: web[0]!.value,
  }]);

  // 8. browser (only when the optional local browser package is on this machine; otherwise the hosted browser MCP, no question)
  let browserChoice: 'local' | 'hosted' | undefined = opts.browser;
  if (!browserChoice) {
    const { loadBrowserPackage } = await import('../browser/index.js');
    const pkg = await loadBrowserPackage();
    if (pkg) {
      const plan = pkg.installPlan();
      const { local } = await inquirer.prompt<{ local: boolean }>([{ type: 'confirm', name: 'local', default: false,
        message: `Run the browser on this machine (the local @nexus-cortex/browser) instead of the hosted browser MCP?${plan.steps.length ? ` It installs everything it needs now (about ${plan.approxMB} MB: ${plan.steps.length} step${plan.steps.length === 1 ? '' : 's'}).` : ' (already installed)'}` }]);
      browserChoice = local ? 'local' : 'hosted';
    }
  }

  const answers: SetupAnswers = { keys, action, helper, mentor, vision, webToolsModel };
  out(''); for (const l of summaryLines(answers, byId)) out('  ' + l); out('');
  if (!opts.yes) {
    const { ok } = await inquirer.prompt<{ ok: boolean }>([{ type: 'confirm', name: 'ok', message: `Write these (settings → ${getGlobalEnvPath()}${Object.keys(keys).length ? `, keys → ${opts.secretsTo === 'env' ? getGlobalEnvPath() : 'the encrypted secrets vault'}` : ''})?`, default: true }]);
    if (!ok) { out('[cortex] Nothing written.'); return 1; }
  }

  // 8. write through the canonical settings writer (validated against the schema)
  const env = planToEnv(answers);
  const { secrets, settings } = splitSecrets(env);
  const sw = await writeSecrets(secrets, opts, true);
  if (!sw.ok) { out(`[cortex] Failed to store the keys: ${sw.error}`); return 1; }
  const wrote = writePlan(settings);
  if (!wrote.ok) {
    out(`[cortex] Failed to write${wrote.error ? `: ${wrote.error}` : `: ${wrote.failed.join(', ')}`}`);
    return 1;
  }
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  out(`[OK] Saved ${Object.keys(settings).length} settings to ${getGlobalEnvPath()}`);
  if (Object.keys(secrets).length) out(`[OK] Saved ${secretLine(sw, Object.keys(secrets).length)}`);
  const browserMsg = await applyBrowserChoice(browserChoice, true, out);
  if (browserMsg) out(`[${browserMsg.ok ? 'OK' : 'cortex'}] ${browserMsg.message}`);

  // 9. probe (interactive: ON unless --no-probe)
  if (opts.probe === false) { out('[cortex] Probe skipped (--no-probe). Try: cortex "hello"'); return 0; }
  const toProbe = [...new Set([action, helper, mentor, ...(vision ? [vision] : [])])];
  const probes = await probeModels(toProbe, out);
  const bad = probes.filter((p) => !p.ok).length;
  out('');
  if (bad) { out(`[cortex] ${bad} model${bad === 1 ? '' : 's'} failed the check — fix the key or pick another model with: cortex setup`); return 1; }
  out('[cortex] Everything works. Try:  cortex "What is this project?"');
  return 0;
}
