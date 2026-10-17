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
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import {
  ModularModelRegistry, SettingsLoader, getGlobalConfigDir, getGlobalEnvPath, validateSetting, keysOnlyStub,
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
  '  cortex config set DEEPSEEK_API_KEY sk-...                   # or one setting at a time',
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

    if (opts.print) {
      if (opts.json) {
        out(JSON.stringify({ write: false, path: getGlobalEnvPath(), env: Object.fromEntries(Object.entries(env).map(([k, v]) => [k, maskSecret(k, v)])) }, null, 2));
        return 0;
      }
      out(`# would write to ${getGlobalEnvPath()}`);
      for (const [k, v] of Object.entries(env)) out(`${k}=${maskSecret(k, v)}`);
      return 0;
    }

    const wrote = writePlan(env);
    if (!wrote.ok) {
      out(`[cortex] Failed to write${wrote.error ? `: ${wrote.error}` : `: ${wrote.failed.join(', ')}`}`);
      return 1;
    }
    for (const [k, v] of Object.entries(env)) process.env[k] = v;

    const probes = opts.probe ? await probeModels([...new Set([answers.action, answers.helper, answers.mentor, ...(answers.vision ? [answers.vision] : [])])], out) : [];
    const bad = probes.filter((p) => !p.ok);

    if (opts.json) {
      out(JSON.stringify({
        write: true,
        path: getGlobalEnvPath(),
        env: Object.fromEntries(Object.entries(env).map(([k, v]) => [k, maskSecret(k, v)])),
        answers,
        probes,
        ok: bad.length === 0,
      }, null, 2));
      return bad.length ? 1 : 0;
    }

    out(`[OK] Saved ${Object.keys(env).length} settings to ${getGlobalEnvPath()}`);
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
  out('cortex setup — configure providers, keys and model roles (writes ' + getGlobalEnvPath() + ')');
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
  const keys: Record<string, string> = {};
  for (const p of chosenRows) {
    if (!p.keyEnv) continue;
    const existing = (process.env[p.keyEnv] ?? existingLoader.get(p.keyEnv as keyof EnvironmentVariables) ?? '').trim();
    const { value } = await inquirer.prompt<{ value: string }>([{
      type: 'password', name: 'value', mask: '*',
      message: existing ? `${p.keyEnv} (${p.label}) — a value is already set; enter to keep it, or paste a new one:` : `${p.keyEnv} (${p.label}):`,
      validate: (v: string) => (v.trim() || existing ? true : `A ${p.label} key is needed to use its models (leave the provider unselected to skip)`),
    }]);
    keys[p.keyEnv] = value.trim() || existing;
  }
  const keyEnvsPresent = new Set(Object.keys(keys).filter((k) => keys[k]));

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

  const answers: SetupAnswers = { keys, action, helper, mentor, vision, webToolsModel };
  out(''); for (const l of summaryLines(answers, byId)) out('  ' + l); out('');
  if (!opts.yes) {
    const { ok } = await inquirer.prompt<{ ok: boolean }>([{ type: 'confirm', name: 'ok', message: `Write these to ${getGlobalEnvPath()}?`, default: true }]);
    if (!ok) { out('[cortex] Nothing written.'); return 1; }
  }

  // 8. write through the canonical settings writer (validated against the schema)
  const env = planToEnv(answers);
  const wrote = writePlan(env);
  if (!wrote.ok) {
    out(`[cortex] Failed to write${wrote.error ? `: ${wrote.error}` : `: ${wrote.failed.join(', ')}`}`);
    return 1;
  }
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  out(`[OK] Saved ${Object.keys(env).length} settings to ${getGlobalEnvPath()}`);

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
