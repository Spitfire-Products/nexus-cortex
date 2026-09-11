/**
 * Settings Loader
 *
 * Loads and writes configuration to .env file and creates OrchestratorConfig.
 * Supports both reading and writing settings while preserving comments and formatting.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import type { OrchestratorConfig } from '../orchestrator/CortexOrchestrator.js';
import type { EnvironmentVariables } from './SettingsSchema.js';
import { DEFAULT_SETTINGS, SETTINGS_METADATA, validateSetting, getSettingMetadata } from './SettingsSchema.js';

/**
 * Result of a write operation
 */
export interface WriteResult {
  success: boolean;
  error?: string;
  previousValue?: string;
  newValue: string;
}

/**
 * Parse .env file content into key-value pairs
 */
export function parseEnvFile(content: string): EnvironmentVariables {
  const env: EnvironmentVariables = {};
  const lines = content.split('\n');

  for (const line of lines) {
    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith('#')) {
      continue;
    }

    // Parse KEY=VALUE
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && match[2] !== undefined) {
      const key = match[1] as keyof EnvironmentVariables;
      let value = match[2].trim();

      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      env[key] = value;
    }
  }

  return env;
}

/**
 * The global user-config directory (~/.cortex) — the canonical, home-directory
 * location every surface (CLI, TUI, server) reads regardless of where the binary
 * is installed or which directory it's launched from. This is what makes a global
 * `npm i -g` install configurable: the binary may live in /opt/homebrew/... but
 * your settings live in a path you own.
 */
export function getGlobalConfigDir(): string {
  return path.join(os.homedir() || process.cwd(), '.cortex');
}

/** Absolute path to the global config file (~/.cortex/.env). */
export function getGlobalEnvPath(): string {
  return path.join(getGlobalConfigDir(), '.env');
}

/**
 * Resolve the shipped `.env.defaults` — the read-live default config layer.
 *
 * This file is committed + ships in the package and is READ directly (never copied
 * into the user's .env), so a package upgrade ships new defaults automatically. It is
 * loaded as the LOWEST-precedence layer (below the user's ~/.cortex/.env, below the
 * real shell env) and also overlays DEFAULT_SETTINGS as the effective floor.
 *
 * Search order mirrors the (legacy) seed: the caller's packageRoot, then cwd, then
 * CORE's own root — core is a dependency of every entry point and is build-synced
 * with the root canonical, so the file exists for any current/future bin even when
 * the calling package doesn't ship its own copy.
 */
export function resolveDefaultsEnvPath(packageRoot?: string): string | undefined {
  const cwd = process.cwd();
  const coreOwnRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  return [
    packageRoot ? path.join(packageRoot, '.env.defaults') : undefined,
    path.join(cwd, '.env.defaults'),
    path.join(coreOwnRoot, '.env.defaults'),
  ].find((p): p is string => !!p && fs.existsSync(p));
}

/**
 * The keys-only seed for a fresh `~/.cortex/.env`: the secret keys + a short header,
 * NO levers. Harness defaults ship in `.env.defaults` and are read live, so freezing
 * them into the user's file is exactly what blocks upgrades from propagating new
 * defaults. Seeding only the keys keeps the file sparse — an upgrade brings new
 * defaults with nothing to regenerate and no keys to re-enter.
 */
export function keysOnlyStub(): string {
  const secretKeys = SETTINGS_METADATA.filter(m => m.secret).map(m => m.key);
  const header =
    '# Nexus Cortex — your keys & overrides\n' +
    '#\n' +
    '# Put your provider API keys here (or run: cortex config set <KEY> <value>).\n' +
    '# Harness DEFAULTS are NOT in this file — they ship in the package (.env.defaults)\n' +
    '# and are read live, so upgrades bring new defaults with nothing to regenerate and\n' +
    '# no keys to re-enter. Only set a lever here to DIVERGE from the shipped default;\n' +
    '# an uncommented KEY=value here overrides it.\n' +
    '\n';
  return header + secretKeys.map(k => `${k}=`).join('\n') + '\n';
}

let _effectiveDefaults: Readonly<typeof DEFAULT_SETTINGS> | undefined;
/**
 * `DEFAULT_SETTINGS` overlaid with the shipped `.env.defaults` — the EFFECTIVE floor.
 *
 * The read-live default layer reaches most levers through `process.env` (bootstrapEnv
 * loads `.env.defaults` as the lowest base file), but a handful of merge keys don't
 * consult `process.env`. Overlaying `.env.defaults` onto `DEFAULT_SETTINGS` makes the
 * shipped file authoritative for EVERY lever. Secrets are untouched (they are Omitted
 * from `DEFAULT_SETTINGS`, so the loop never visits them). Cached — the shipped file
 * does not change at runtime.
 */
export function getEffectiveDefaults(): Readonly<typeof DEFAULT_SETTINGS> {
  if (_effectiveDefaults) return _effectiveDefaults;
  const d = { ...DEFAULT_SETTINGS };
  const shipped = resolveDefaultsEnvPath();
  if (shipped) {
    try {
      const parsed = parseEnvFile(fs.readFileSync(shipped, 'utf-8'));
      for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof typeof DEFAULT_SETTINGS)[]) {
        const v = (parsed as Record<string, string | undefined>)[k as string];
        if (v !== undefined && v !== '') (d as Record<string, string>)[k as string] = v;
      }
    } catch { /* keep the hardcoded floor */ }
  }
  _effectiveDefaults = d;
  return d;
}

/**
 * THE canonical .env → process.env bootstrap for every CLI/TUI entry point.
 *
 * One implementation, so a consumer never hand-rolls dotenv loading (and can't
 * forget the global `~/.cortex/.env`). It seeds a KEYS-ONLY `~/.cortex/.env` on first
 * run (below), then READS + layers the .env files into process.env. All bins call this
 * ONCE at startup; a change here takes effect for every launcher.
 *
 * Precedence (highest → lowest): a `.env.local` beside any of the base files wins over
 * everything; then project `./.env` (or `packageRoot/.env`) beats the global
 * `~/.cortex/.env`, which beats the shipped `.env.defaults` (the read-live default
 * layer, appended last). Matches `loadEnvFile()`'s layering.
 *
 * FIRST-WINS over the real environment: a value already present in `process.env`
 * (e.g. a key the hosting container injected) is NEVER overwritten by a base .env
 * file — so a blank baked template can't clobber an injected secret. `.local`
 * files DO override (they are explicit developer overrides).
 *
 * @param packageRoot optional install/monorepo root to also check for a `.env`
 *        (the dev/`omniclaude-v4/.env` location); pass the bin's resolved root.
 * @returns the list of files actually loaded (for an [OK]/[WARN] startup log).
 */
export function bootstrapEnv(packageRoot?: string): { loadedFrom: string[] } {
  const cwd = process.cwd();

  // FIRST-ACTIVATION SEED — a KEYS-ONLY `~/.cortex/.env` (somewhere to put secrets),
  // NOT a copy of every lever. The first time ANY entry point activates the library
  // (server, `cortex`, `cortex-cli`, `fuzzycortex`, `neoncortex`, …) and no global
  // config exists yet, write the sparse keys stub. Harness DEFAULTS are read live from
  // the shipped `.env.defaults` (loaded below as the lowest layer) — freezing them into
  // the user's file is exactly what USED to block upgrades from propagating new
  // defaults, so we no longer seed levers or a `packageRoot/.env` copy. Best-effort —
  // a read-only home is skipped, and a real injected key still works (blank = unset).
  const defaultsPath = resolveDefaultsEnvPath(packageRoot);
  try {
    const target = getGlobalEnvPath();
    if (!fs.existsSync(target)) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, keysOnlyStub(), 'utf-8');
    }
  } catch { /* read-only home — skip; the file just won't exist for this launch */ }

  // 🔴 NO auto-migration here. `migrateGlobalConfigToSparse()` used to run at bootstrap and
  // COLLAPSE a full-snapshot ~/.cortex/.env in place — which silently mutated a live/working
  // config (it clobbered the dev config 2026-09-06). Migration is now OPT-IN only (a deliberate
  // `cortex config migrate` command with a diff + confirm); bootstrap must NEVER modify the
  // user's config. Propagation for the common case already works without it: any lever a user
  // did not override flows from the shipped `.env.defaults` (read-live) on upgrade.

  // Base files, HIGHEST precedence first (first-wins → earlier entries win). The
  // shipped `.env.defaults` is appended LAST = lowest precedence: it is the read-live
  // default layer, below the user's files and below the real injected env — so a user
  // override (or a bench env-override) always wins, and unset levers flow from the
  // shipped defaults.
  const baseFiles = [
    path.join(cwd, '.env'),
    ...(packageRoot ? [path.join(packageRoot, '.env')] : []),
    getGlobalEnvPath(),
    ...(defaultsPath ? [defaultsPath] : []),
  ];
  // `.local` overrides beside each base location (these DO override existing env).
  const localFiles = [
    path.join(cwd, '.env.local'),
    ...(packageRoot ? [path.join(packageRoot, '.env.local')] : []),
  ];

  const loadedFrom: string[] = [];
  const apply = (file: string, override: boolean) => {
    if (!fs.existsSync(file)) return;
    let parsed: EnvironmentVariables;
    try { parsed = parseEnvFile(fs.readFileSync(file, 'utf-8')); } catch { return; }
    let used = false;
    for (const [k, v] of Object.entries(parsed)) {
      if (override || process.env[k] === undefined) { process.env[k] = v as string; used = true; }
    }
    if (used || fs.existsSync(file)) loadedFrom.push(file);
  };

  for (const f of baseFiles) apply(f, false);   // first-wins, never clobber real env
  for (const f of localFiles) apply(f, true);    // explicit overrides
  return { loadedFrom };
}

/** Read+parse a single .env file; returns {} if absent or unreadable. */
function readEnvFileAt(envPath: string): EnvironmentVariables {
  if (!fs.existsSync(envPath)) return {};
  try {
    return parseEnvFile(fs.readFileSync(envPath, 'utf-8'));
  } catch (error: any) {
    console.error(`[SettingsLoader] Error reading .env file ${envPath}: ${error.message}`);
    return {};
  }
}

/**
 * Load merged .env config.
 *
 * Layering (low → high precedence): global ~/.cortex/.env  →  project ./.env.
 * The global file is the user's persistent config (written by `config set`); a
 * project-local ./.env is an optional override for when you're working inside a
 * specific project (this is what makes the Replit "just edit ./.env" flow work).
 * process.env and built-in defaults are applied afterwards in mergeWithDefaults().
 */
export function loadEnvFile(projectPath: string = process.cwd()): EnvironmentVariables {
  const globalEnvPath = getGlobalEnvPath();
  const projectEnvPath = path.join(projectPath, '.env');

  const globalEnv = readEnvFileAt(globalEnvPath);
  // Avoid double-reading when projectPath IS the global dir (e.g. config set).
  const projectEnv = projectEnvPath === globalEnvPath ? {} : readEnvFileAt(projectEnvPath);

  const merged = { ...globalEnv, ...projectEnv };

  if (Object.keys(merged).length === 0) {
    console.log(`[SettingsLoader] No .env found (checked ${globalEnvPath} and ${projectEnvPath}), using defaults`);
  }

  return merged;
}

/**
 * Update a single setting in the .env file while preserving comments and formatting
 */
export function writeEnvSetting(
  projectPath: string,
  key: keyof EnvironmentVariables,
  value: string
): WriteResult {
  const envPath = path.join(projectPath, '.env');

  // Validate the setting if metadata exists
  const metadata = getSettingMetadata(key);
  if (metadata) {
    const validation = validateSetting(key, value);
    if (validation !== true) {
      return {
        success: false,
        error: validation,
        newValue: value
      };
    }
  }

  let content: string;
  let previousValue: string | undefined;

  try {
    if (fs.existsSync(envPath)) {
      content = fs.readFileSync(envPath, 'utf-8');
    } else {
      // Create new .env file with header
      content = `# Nexus Cortex Configuration\n# Generated ${new Date().toISOString()}\n\n`;
    }
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to read .env file: ${error.message}`,
      newValue: value
    };
  }

  // Parse to find existing value
  const env = parseEnvFile(content);
  previousValue = env[key];

  // Check if key exists in file
  const keyRegex = new RegExp(`^${key}=.*$`, 'm');
  const keyExists = keyRegex.test(content);

  // Quote value if it contains spaces or special characters
  const needsQuotes = /[\s#'"\\]/.test(value) || value.includes('=');
  const formattedValue = needsQuotes ? `"${value.replace(/"/g, '\\"')}"` : value;

  let newContent: string;

  if (keyExists) {
    // Replace existing line
    newContent = content.replace(keyRegex, `${key}=${formattedValue}`);
  } else {
    // Add new setting
    // Try to add it in the appropriate category based on metadata
    const section = metadata?.category;

    if (section) {
      // Look for section comment
      const sectionComment = `# ${section}`;
      const sectionIndex = content.indexOf(sectionComment);

      if (sectionIndex !== -1) {
        // Find the end of the section (next section comment or end of file)
        const nextSectionMatch = content.slice(sectionIndex + sectionComment.length).match(/\n#\s*[A-Z]/);
        let insertIndex: number;

        if (nextSectionMatch && nextSectionMatch.index !== undefined) {
          insertIndex = sectionIndex + sectionComment.length + nextSectionMatch.index;
        } else {
          // Add at end of file
          insertIndex = content.length;
        }

        // Insert before next section or at end
        const beforeInsert = content.slice(0, insertIndex).trimEnd();
        const afterInsert = content.slice(insertIndex);
        newContent = `${beforeInsert}\n${key}=${formattedValue}${afterInsert.startsWith('\n') ? '' : '\n'}${afterInsert}`;
      } else {
        // Section doesn't exist, add at end with section comment
        const sectionHeader = `\n# ${section}\n`;
        newContent = content.trimEnd() + sectionHeader + `${key}=${formattedValue}\n`;
      }
    } else {
      // No section info, add at end
      newContent = content.trimEnd() + `\n${key}=${formattedValue}\n`;
    }
  }

  try {
    fs.mkdirSync(path.dirname(envPath), { recursive: true });
    fs.writeFileSync(envPath, newContent, 'utf-8');
    return {
      success: true,
      previousValue,
      newValue: value
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to write .env file: ${error.message}`,
      previousValue,
      newValue: value
    };
  }
}

/**
 * Update multiple settings in the .env file
 */
export function writeEnvSettings(
  projectPath: string,
  settings: Partial<EnvironmentVariables>
): Record<string, WriteResult> {
  const results: Record<string, WriteResult> = {};

  for (const [key, value] of Object.entries(settings)) {
    if (value !== undefined) {
      results[key] = writeEnvSetting(
        projectPath,
        key as keyof EnvironmentVariables,
        value
      );
    }
  }

  return results;
}

/**
 * Surgically REMOVE a setting's line from the .env file (delete the `KEY=...` line and
 * its value), preserving every other line and all comments. This is the correct "reset
 * to default" in the read-live model: deleting a user's override line makes the lever
 * fall back to the shipped `.env.defaults` — so the user rejoins the default flow and
 * picks up future improvements. (Writing the current default VALUE would re-freeze it.)
 * A key that isn't present is a no-op success.
 */
export function removeEnvSetting(
  projectPath: string,
  key: keyof EnvironmentVariables
): WriteResult {
  const envPath = path.join(projectPath, '.env');
  if (!fs.existsSync(envPath)) {
    return { success: true, newValue: '' }; // nothing to remove
  }
  let content: string;
  try {
    content = fs.readFileSync(envPath, 'utf-8');
  } catch (error: any) {
    return { success: false, error: `Failed to read .env file: ${error.message}`, newValue: '' };
  }
  const previousValue = parseEnvFile(content)[key];
  if (previousValue === undefined) {
    return { success: true, newValue: '' }; // key not set — nothing to remove
  }
  // Drop the KEY=... line (allow leading whitespace); leave comments/other lines intact.
  const keyLine = new RegExp(`^[ \\t]*${key}=.*(?:\\r?\\n)?`, 'm');
  const newContent = content.replace(keyLine, '');
  try {
    fs.writeFileSync(envPath, newContent, 'utf-8');
    return { success: true, previousValue, newValue: '' };
  } catch (error: any) {
    return { success: false, error: `Failed to write .env file: ${error.message}`, previousValue, newValue: '' };
  }
}

/** Set a single setting in the GLOBAL ~/.cortex/.env (surgical, sparse). The canonical
 *  write target for every /config surface — harness config is global (identical from any
 *  directory), so a user's choice lives in one place and survives package updates. */
export function setGlobalSetting(key: keyof EnvironmentVariables, value: string): WriteResult {
  return writeEnvSetting(getGlobalConfigDir(), key, value);
}

/** Remove a single setting's override line from the GLOBAL ~/.cortex/.env (reset-to-default). */
export function removeGlobalSetting(key: keyof EnvironmentVariables): WriteResult {
  return removeEnvSetting(getGlobalConfigDir(), key);
}

/** The SHIPPED default value for a lever, read from the live `.env.defaults` (covers every
 *  lever, including the ones not in DEFAULT_SETTINGS). '' if the file/key is absent. Used
 *  to restore a lever to its shipped default after removing a user override. */
export function getShippedDefault(key: keyof EnvironmentVariables): string {
  const p = resolveDefaultsEnvPath();
  if (!p) return '';
  try { return parseEnvFile(fs.readFileSync(p, 'utf-8'))[key] ?? ''; } catch { return ''; }
}

/**
 * ONE-TIME migration for EXISTING users upgrading to the read-live model. The old install
 * seeded a FULL copy of every lever into `~/.cortex/.env`, which now FREEZES those levers
 * (a user value beats the shipped `.env.defaults`), so an upgrade would never reach them.
 *
 * This collapses that full snapshot back to SPARSE: a lever line is removed when its value
 * equals a DEFAULT — either the new shipped default (`.env.defaults`) OR the hardcoded
 * `DEFAULT_SETTINGS` floor (which still holds the OLD pre-reson defaults). Matching either
 * means the user never deliberately chose it, so removing it lets the lever inherit the
 * current shipped default (and every future one). Genuine divergences and ALL API keys are
 * preserved untouched. Marker-gated (`~/.cortex/.env-migrated`) so it runs exactly once;
 * best-effort (never blocks boot); only acts on a FULL snapshot, never a sparse file.
 */
export function migrateGlobalConfigToSparse(): { migrated: boolean; removed: number } {
  const dir = getGlobalConfigDir();
  const marker = path.join(dir, '.env-migrated');
  const envPath = getGlobalEnvPath();
  try {
    if (fs.existsSync(marker) || !fs.existsSync(envPath)) return { migrated: false, removed: 0 };
    const shippedPath = resolveDefaultsEnvPath();
    const shipped = shippedPath ? parseEnvFile(fs.readFileSync(shippedPath, 'utf-8')) : {};
    const userEnv = parseEnvFile(fs.readFileSync(envPath, 'utf-8'));
    const secretKeys = new Set<string>(SETTINGS_METADATA.filter(m => m.secret).map(m => m.key));

    const leverEntries = Object.entries(userEnv).filter(([k]) => !secretKeys.has(k));
    // Only act on a FULL snapshot (the old copy-seed signature) — never disturb a file the
    // user has already curated down to a few sparse overrides.
    if (leverEntries.length <= 15) {
      try { fs.writeFileSync(marker, `skipped (sparse) ${new Date().toISOString()}\n`); } catch { /* ignore */ }
      return { migrated: false, removed: 0 };
    }

    const toRemove = leverEntries
      .filter(([k, v]) => {
        const shippedVal = shipped[k as keyof EnvironmentVariables];
        const floorVal = (DEFAULT_SETTINGS as Record<string, string>)[k];
        return (shippedVal !== undefined && shippedVal === v) || (floorVal !== undefined && floorVal === v);
      })
      .map(([k]) => k);

    if (toRemove.length > 0) {
      try { fs.copyFileSync(envPath, envPath + '.pre-migrate-backup'); } catch { /* best-effort */ }
      for (const k of toRemove) removeEnvSetting(dir, k as keyof EnvironmentVariables);
    }
    try { fs.writeFileSync(marker, `migrated ${new Date().toISOString()} removed=${toRemove.length}\n`); } catch { /* ignore */ }
    return { migrated: true, removed: toRemove.length };
  } catch {
    return { migrated: false, removed: 0 };
  }
}

/**
 * Get Google/Gemini API key with proper fallback
 * Priority: GEMINI_API_KEY (recommended by Google) -> GOOGLE_API_KEY (legacy)
 *
 * @returns The API key to use for Google/Gemini models
 */
export function getGoogleApiKey(): string {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
}

/**
 * Merge environment variables with defaults
 */
export function mergeWithDefaults(env: EnvironmentVariables): Required<EnvironmentVariables> {
  // Apply Google/Gemini API key fallback to process.env for backward compatibility
  // Priority: GEMINI_API_KEY (recommended) -> GOOGLE_API_KEY (legacy)
  if (!process.env.GEMINI_API_KEY && process.env.GOOGLE_API_KEY) {
    process.env.GEMINI_API_KEY = process.env.GOOGLE_API_KEY;
  }

  // Effective floor = hardcoded DEFAULT_SETTINGS overlaid with the shipped .env.defaults
  // (read-live). Used below wherever a value falls through to the code default.
  const D = getEffectiveDefaults();

  return {
    // API Keys (no defaults, use empty string if not set)
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '',
    OPENAI_API_KEY: env.OPENAI_API_KEY || process.env.OPENAI_API_KEY || '',
    GOOGLE_API_KEY: env.GOOGLE_API_KEY || process.env.GOOGLE_API_KEY || '',
    GEMINI_API_KEY: env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '',
    XAI_API_KEY: env.XAI_API_KEY || process.env.XAI_API_KEY || '',
    DEEPSEEK_API_KEY: env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY || '',
    INCEPTION_API_KEY: env.INCEPTION_API_KEY || process.env.INCEPTION_API_KEY || '',
    DASHSCOPE_API_KEY: env.DASHSCOPE_API_KEY || process.env.DASHSCOPE_API_KEY || '',
    ZHIPU_API_KEY: env.ZHIPU_API_KEY || process.env.ZHIPU_API_KEY || '',
    MOONSHOT_API_KEY: env.MOONSHOT_API_KEY || process.env.MOONSHOT_API_KEY || '',
    MINIMAX_API_KEY: env.MINIMAX_API_KEY || process.env.MINIMAX_API_KEY || '',
    CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || '',
    CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || '',
    NVIDIA_API_KEY: env.NVIDIA_API_KEY || process.env.NVIDIA_API_KEY || '',

    // Anthropic Authentication
    ANTHROPIC_AUTH_METHOD: env.ANTHROPIC_AUTH_METHOD || process.env.ANTHROPIC_AUTH_METHOD || D.ANTHROPIC_AUTH_METHOD,
    CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN || process.env.CLAUDE_CODE_OAUTH_TOKEN || '',

    // Prompt Caching
    ANTHROPIC_PROMPT_CACHING: env.ANTHROPIC_PROMPT_CACHING || process.env.ANTHROPIC_PROMPT_CACHING || D.ANTHROPIC_PROMPT_CACHING,

    // Model Configuration
    DEFAULT_MODEL_ID: env.DEFAULT_MODEL_ID || D.DEFAULT_MODEL_ID,
    HELPER_MODEL_ID: env.HELPER_MODEL_ID || D.HELPER_MODEL_ID,

    // System Settings
    DEBUG: env.DEBUG || D.DEBUG,
    USE_EMOJI: env.USE_EMOJI || D.USE_EMOJI,
    PROJECT_PATH: env.PROJECT_PATH || D.PROJECT_PATH,

    // Reactive Mentorship
    MENTORSHIP_ENABLED: env.MENTORSHIP_ENABLED || D.MENTORSHIP_ENABLED,
    MENTORSHIP_TRIGGER_ON_ERROR: env.MENTORSHIP_TRIGGER_ON_ERROR || D.MENTORSHIP_TRIGGER_ON_ERROR,
    MENTORSHIP_ERROR_THRESHOLD: env.MENTORSHIP_ERROR_THRESHOLD || D.MENTORSHIP_ERROR_THRESHOLD,
    MENTORSHIP_KEYWORDS_ENABLED: env.MENTORSHIP_KEYWORDS_ENABLED || D.MENTORSHIP_KEYWORDS_ENABLED,
    MENTORSHIP_CUSTOM_KEYWORDS: env.MENTORSHIP_CUSTOM_KEYWORDS || D.MENTORSHIP_CUSTOM_KEYWORDS,
    MENTORSHIP_HELPER_MODEL: env.MENTORSHIP_HELPER_MODEL || D.MENTORSHIP_HELPER_MODEL,
    CORTEX_MENTOR_REASONING: env.CORTEX_MENTOR_REASONING || process.env.CORTEX_MENTOR_REASONING || D.CORTEX_MENTOR_REASONING,
    CORTEX_MENTOR_EFFORT: env.CORTEX_MENTOR_EFFORT || process.env.CORTEX_MENTOR_EFFORT || D.CORTEX_MENTOR_EFFORT,
    CORTEX_ASK_FOR_ADVICE: env.CORTEX_ASK_FOR_ADVICE || process.env.CORTEX_ASK_FOR_ADVICE || D.CORTEX_ASK_FOR_ADVICE,
    CORTEX_MENTOR_CONSULT_REASONING: env.CORTEX_MENTOR_CONSULT_REASONING || process.env.CORTEX_MENTOR_CONSULT_REASONING || D.CORTEX_MENTOR_CONSULT_REASONING,
    CORTEX_MENTOR_TEMPERATURE: env.CORTEX_MENTOR_TEMPERATURE || process.env.CORTEX_MENTOR_TEMPERATURE || D.CORTEX_MENTOR_TEMPERATURE,
    CORTEX_MENTOR_REASONING_ALLOWANCE: env.CORTEX_MENTOR_REASONING_ALLOWANCE || process.env.CORTEX_MENTOR_REASONING_ALLOWANCE || D.CORTEX_MENTOR_REASONING_ALLOWANCE,
    CORTEX_MENTOR_THINKING_TIMEOUT_MS: env.CORTEX_MENTOR_THINKING_TIMEOUT_MS || process.env.CORTEX_MENTOR_THINKING_TIMEOUT_MS || D.CORTEX_MENTOR_THINKING_TIMEOUT_MS,
    CORTEX_LIFT_PLAN_REASONING: env.CORTEX_LIFT_PLAN_REASONING || process.env.CORTEX_LIFT_PLAN_REASONING || D.CORTEX_LIFT_PLAN_REASONING,
    CORTEX_ENDTURN_RESOLVER_REASONING: env.CORTEX_ENDTURN_RESOLVER_REASONING || process.env.CORTEX_ENDTURN_RESOLVER_REASONING || D.CORTEX_ENDTURN_RESOLVER_REASONING,
    CORTEX_DEADLINE_EXIT_MENTOR_REASONING: env.CORTEX_DEADLINE_EXIT_MENTOR_REASONING || process.env.CORTEX_DEADLINE_EXIT_MENTOR_REASONING || D.CORTEX_DEADLINE_EXIT_MENTOR_REASONING,
    CORTEX_LOOP_TOOL_BLOCK_REASONING: env.CORTEX_LOOP_TOOL_BLOCK_REASONING || process.env.CORTEX_LOOP_TOOL_BLOCK_REASONING || D.CORTEX_LOOP_TOOL_BLOCK_REASONING,
    MENTORSHIP_TURN_BASED_ENABLED: env.MENTORSHIP_TURN_BASED_ENABLED || D.MENTORSHIP_TURN_BASED_ENABLED,
    MENTORSHIP_TURN_INTERVAL: env.MENTORSHIP_TURN_INTERVAL || D.MENTORSHIP_TURN_INTERVAL,
    MENTORSHIP_INTERLEAVED_THINKING: env.MENTORSHIP_INTERLEAVED_THINKING || D.MENTORSHIP_INTERLEAVED_THINKING,
    MENTORSHIP_PATTERN_DETECTION: env.MENTORSHIP_PATTERN_DETECTION || D.MENTORSHIP_PATTERN_DETECTION,
    MENTORSHIP_PATTERN_THRESHOLD: env.MENTORSHIP_PATTERN_THRESHOLD || D.MENTORSHIP_PATTERN_THRESHOLD,
    MENTORSHIP_ACTIVE_DISCOVERY: env.MENTORSHIP_ACTIVE_DISCOVERY || D.MENTORSHIP_ACTIVE_DISCOVERY,

    // Turn Summary & Prediction
    TURN_SUMMARY_PREDICTION: env.TURN_SUMMARY_PREDICTION || D.TURN_SUMMARY_PREDICTION,

    // Canon (reactive session capture)
    CANON_AUTO_SYNC: env.CANON_AUTO_SYNC || process.env.CANON_AUTO_SYNC || D.CANON_AUTO_SYNC,
    CANON_AUTO_SYNC_DEBOUNCE_MS: env.CANON_AUTO_SYNC_DEBOUNCE_MS || process.env.CANON_AUTO_SYNC_DEBOUNCE_MS || D.CANON_AUTO_SYNC_DEBOUNCE_MS,
    CANON_STORE: env.CANON_STORE || process.env.CANON_STORE || D.CANON_STORE,
    CANON_REPO: env.CANON_REPO || process.env.CANON_REPO || D.CANON_REPO,

    // Context Management
    THINKING_AS_TEXT_FALLBACK: env.THINKING_AS_TEXT_FALLBACK || process.env.THINKING_AS_TEXT_FALLBACK || D.THINKING_AS_TEXT_FALLBACK,

    // Session Configuration
    SESSION_STORAGE_DIR: env.SESSION_STORAGE_DIR || D.SESSION_STORAGE_DIR,
    MCP_AUTO_INJECT: env.MCP_AUTO_INJECT || D.MCP_AUTO_INJECT,
    AUTORESEARCH_AGENTS: env.AUTORESEARCH_AGENTS || D.AUTORESEARCH_AGENTS,
    SYSTEM_MESSAGE_DOC_MAX_BYTES: env.SYSTEM_MESSAGE_DOC_MAX_BYTES || D.SYSTEM_MESSAGE_DOC_MAX_BYTES,
    MEMORY_ARCHIVE_MAX_BYTES: env.MEMORY_ARCHIVE_MAX_BYTES || D.MEMORY_ARCHIVE_MAX_BYTES,

    // Loop Control
    MAX_TOOL_ITERATIONS: env.MAX_TOOL_ITERATIONS || D.MAX_TOOL_ITERATIONS,
    MAX_CONSECUTIVE_ERRORS: env.MAX_CONSECUTIVE_ERRORS || D.MAX_CONSECUTIVE_ERRORS,
    TOOL_BUDGET_SOFT: env.TOOL_BUDGET_SOFT || D.TOOL_BUDGET_SOFT,
    TOOL_TIMEOUT_MS: env.TOOL_TIMEOUT_MS || D.TOOL_TIMEOUT_MS,
    MAX_LOOP_REPETITIONS: env.MAX_LOOP_REPETITIONS || D.MAX_LOOP_REPETITIONS,

    // Web Tools
    WEB_TOOLS_MODEL: env.WEB_TOOLS_MODEL || process.env.WEB_TOOLS_MODEL || D.WEB_TOOLS_MODEL,

    // Server-Side Tools
    ENABLE_SERVER_SIDE_TOOLS: env.ENABLE_SERVER_SIDE_TOOLS || process.env.ENABLE_SERVER_SIDE_TOOLS || D.ENABLE_SERVER_SIDE_TOOLS,
    XAI_API_MODE: env.XAI_API_MODE || process.env.XAI_API_MODE || D.XAI_API_MODE,
    OPENAI_API_MODE: env.OPENAI_API_MODE || process.env.OPENAI_API_MODE || D.OPENAI_API_MODE,

    // Agent Team Monitoring
    AGENT_TMUX_MONITOR: env.AGENT_TMUX_MONITOR || process.env.AGENT_TMUX_MONITOR || D.AGENT_TMUX_MONITOR,

    // PTC / Code Execution / Deferred Loading
    ENABLE_PTC: env.ENABLE_PTC || process.env.ENABLE_PTC || D.ENABLE_PTC,
    ENABLE_WEBTOOLS: env.ENABLE_WEBTOOLS || process.env.ENABLE_WEBTOOLS || D.ENABLE_WEBTOOLS,
    VISION_HELPER_MODEL: env.VISION_HELPER_MODEL || process.env.VISION_HELPER_MODEL || D.VISION_HELPER_MODEL,
    TOOL_TIMEOUT_MODE: env.TOOL_TIMEOUT_MODE || process.env.TOOL_TIMEOUT_MODE || D.TOOL_TIMEOUT_MODE,
    VISION_HANDOFF_MAX: env.VISION_HANDOFF_MAX || process.env.VISION_HANDOFF_MAX || D.VISION_HANDOFF_MAX,
    CORTEX_SLICE_NUDGE: env.CORTEX_SLICE_NUDGE || process.env.CORTEX_SLICE_NUDGE || D.CORTEX_SLICE_NUDGE,
    CORTEX_SLICE_BLOCK: env.CORTEX_SLICE_BLOCK || process.env.CORTEX_SLICE_BLOCK || D.CORTEX_SLICE_BLOCK,
    CORTEX_SLICE_BLOCK_AT: env.CORTEX_SLICE_BLOCK_AT || process.env.CORTEX_SLICE_BLOCK_AT || D.CORTEX_SLICE_BLOCK_AT,
    CORTEX_SLICE_BLOCK_MAX: env.CORTEX_SLICE_BLOCK_MAX || process.env.CORTEX_SLICE_BLOCK_MAX || D.CORTEX_SLICE_BLOCK_MAX,
    ENABLE_LOCAL_CODE_EXECUTION: env.ENABLE_LOCAL_CODE_EXECUTION || process.env.ENABLE_LOCAL_CODE_EXECUTION || D.ENABLE_LOCAL_CODE_EXECUTION,
    ENABLE_DEFERRED_TOOL_LOADING: env.ENABLE_DEFERRED_TOOL_LOADING || process.env.ENABLE_DEFERRED_TOOL_LOADING || D.ENABLE_DEFERRED_TOOL_LOADING,

    // Model Router
    MODEL_ROUTER_ENABLED: env.MODEL_ROUTER_ENABLED || process.env.MODEL_ROUTER_ENABLED || D.MODEL_ROUTER_ENABLED,
    MODEL_ROUTER_STRATEGY: env.MODEL_ROUTER_STRATEGY || process.env.MODEL_ROUTER_STRATEGY || D.MODEL_ROUTER_STRATEGY,
    MODEL_ROUTER_RECORD: env.MODEL_ROUTER_RECORD || process.env.MODEL_ROUTER_RECORD || D.MODEL_ROUTER_RECORD,
    ROUTER_MIN_CONFIDENCE: env.ROUTER_MIN_CONFIDENCE || process.env.ROUTER_MIN_CONFIDENCE || D.ROUTER_MIN_CONFIDENCE,
    ROUTER_MIN_SAMPLES: env.ROUTER_MIN_SAMPLES || process.env.ROUTER_MIN_SAMPLES || D.ROUTER_MIN_SAMPLES,
    MODEL_ROUTER_EXPLORATION: env.MODEL_ROUTER_EXPLORATION || process.env.MODEL_ROUTER_EXPLORATION || D.MODEL_ROUTER_EXPLORATION,
    MODEL_ROUTER_EXCLUDE: env.MODEL_ROUTER_EXCLUDE ?? process.env.MODEL_ROUTER_EXCLUDE ?? D.MODEL_ROUTER_EXCLUDE,

    // Endturn Gate / Training
    CORTEX_ENDTURN_GATE: env.CORTEX_ENDTURN_GATE || process.env.CORTEX_ENDTURN_GATE || D.CORTEX_ENDTURN_GATE,
    CORTEX_TOOL_PROFILE: env.CORTEX_TOOL_PROFILE || process.env.CORTEX_TOOL_PROFILE || D.CORTEX_TOOL_PROFILE,

    // Decision Store
    CORTEX_RECORD_DECISIONS: env.CORTEX_RECORD_DECISIONS || process.env.CORTEX_RECORD_DECISIONS || D.CORTEX_RECORD_DECISIONS,
    CORTEX_LOOKUP_PRIOR_DECISIONS: env.CORTEX_LOOKUP_PRIOR_DECISIONS || process.env.CORTEX_LOOKUP_PRIOR_DECISIONS || D.CORTEX_LOOKUP_PRIOR_DECISIONS,
    CORTEX_DECISIONS_MAX_BYTES: env.CORTEX_DECISIONS_MAX_BYTES || process.env.CORTEX_DECISIONS_MAX_BYTES || D.CORTEX_DECISIONS_MAX_BYTES,

    // Runtime
    CORTEX_MODE: env.CORTEX_MODE || D.CORTEX_MODE,
    CORTEX_UPDATE_POLICY: env.CORTEX_UPDATE_POLICY || process.env.CORTEX_UPDATE_POLICY || D.CORTEX_UPDATE_POLICY,
    YOLO: env.YOLO || process.env.YOLO || D.YOLO,
    AUTO_RESUME: env.AUTO_RESUME || process.env.AUTO_RESUME || D.AUTO_RESUME,
    PORT: env.PORT || process.env.PORT || D.PORT,
    CORTEX_SERVER_URL: env.CORTEX_SERVER_URL || D.CORTEX_SERVER_URL,
    DEBUG_PAYLOAD: env.DEBUG_PAYLOAD || process.env.DEBUG_PAYLOAD || D.DEBUG_PAYLOAD,
    DEBUG_THINKING: env.DEBUG_THINKING || process.env.DEBUG_THINKING || D.DEBUG_THINKING,
    ENABLE_SMOKE_TESTS: env.ENABLE_SMOKE_TESTS || process.env.ENABLE_SMOKE_TESTS || D.ENABLE_SMOKE_TESTS,

    // Git / PR access control
    GIT_ALLOWED_REPOS: env.GIT_ALLOWED_REPOS || process.env.GIT_ALLOWED_REPOS || D.GIT_ALLOWED_REPOS,
    GIT_ALLOWED_ACTIONS: env.GIT_ALLOWED_ACTIONS || process.env.GIT_ALLOWED_ACTIONS || D.GIT_ALLOWED_ACTIONS,
    GIT_AUTH_TOKEN: env.GIT_AUTH_TOKEN || process.env.GIT_AUTH_TOKEN || '',
    GIT_HOST: env.GIT_HOST || process.env.GIT_HOST || D.GIT_HOST,
    GITHUB_WEBHOOK_SECRET: env.GITHUB_WEBHOOK_SECRET || process.env.GITHUB_WEBHOOK_SECRET || '',
  };
}

/**
 * Convert environment variables to OrchestratorConfig
 */
export function envToOrchestratorConfig(env: Required<EnvironmentVariables>): OrchestratorConfig {
  const config: OrchestratorConfig = {
    // Required fields
    defaultModelId: env.DEFAULT_MODEL_ID,
    projectPath: env.PROJECT_PATH,

    // Optional fields
    debug: env.DEBUG === 'true',
    storageDir: env.SESSION_STORAGE_DIR,

    // Reactive Mentorship
    reactiveMentorship: env.MENTORSHIP_ENABLED === 'true' ? {
      enabled: true,
      triggerOnError: env.MENTORSHIP_TRIGGER_ON_ERROR === 'true',
      errorSeverityThreshold: env.MENTORSHIP_ERROR_THRESHOLD as 'low' | 'medium' | 'high',
      enableKeywords: env.MENTORSHIP_KEYWORDS_ENABLED === 'true',
      customKeywords: env.MENTORSHIP_CUSTOM_KEYWORDS
        ? env.MENTORSHIP_CUSTOM_KEYWORDS.split(',').map(k => k.trim()).filter(k => k)
        : undefined,
      helperModelId: env.MENTORSHIP_HELPER_MODEL,
      turnBasedEnabled: env.MENTORSHIP_TURN_BASED_ENABLED === 'true',
      turnInterval: parseInt(env.MENTORSHIP_TURN_INTERVAL),
      interleavedThinking: env.MENTORSHIP_INTERLEAVED_THINKING === 'true',
      patternDetection: env.MENTORSHIP_PATTERN_DETECTION === 'true',
      patternThreshold: parseInt(env.MENTORSHIP_PATTERN_THRESHOLD),
      activeDiscovery: env.MENTORSHIP_ACTIVE_DISCOVERY === 'true'
    } : undefined,

    // Loop Control (inline detection)
    loopControl: {
      maxToolIterations: parseInt(env.MAX_TOOL_ITERATIONS),
      maxConsecutiveErrors: parseInt(env.MAX_CONSECUTIVE_ERRORS),
      toolBudgetSoft: parseInt(env.TOOL_BUDGET_SOFT),
      toolTimeoutMs: parseInt(env.TOOL_TIMEOUT_MS),
      maxLoopRepetitions: parseInt(env.MAX_LOOP_REPETITIONS)
    }
  };

  return config;
}

/**
 * Load OrchestratorConfig from .env file
 */
export function loadOrchestratorConfig(projectPath: string = process.cwd()): OrchestratorConfig {
  const env = loadEnvFile(projectPath);
  const mergedEnv = mergeWithDefaults(env);
  return envToOrchestratorConfig(mergedEnv);
}

/**
 * Settings Loader Class
 */
export class SettingsLoader {
  private projectPath: string;
  private env: Required<EnvironmentVariables>;

  constructor(projectPath: string = process.cwd()) {
    this.projectPath = projectPath;
    this.env = mergeWithDefaults(loadEnvFile(projectPath));
  }

  /**
   * Get full environment variables
   */
  getEnvironment(): Required<EnvironmentVariables> {
    return { ...this.env };
  }

  /**
   * Get specific environment variable
   */
  get<K extends keyof EnvironmentVariables>(key: K): string {
    return this.env[key as keyof Required<EnvironmentVariables>];
  }

  /**
   * Get OrchestratorConfig
   */
  getOrchestratorConfig(): OrchestratorConfig {
    return envToOrchestratorConfig(this.env);
  }

  /**
   * Check if API key is configured
   */
  hasApiKey(provider: 'anthropic' | 'openai' | 'google' | 'xai' | 'deepseek'): boolean {
    const keyMap = {
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      google: 'GOOGLE_API_KEY',
      xai: 'XAI_API_KEY',
      deepseek: 'DEEPSEEK_API_KEY',
      mercury: 'INCEPTION_API_KEY',
      qwen: 'DASHSCOPE_API_KEY',
      zhipu: 'ZHIPU_API_KEY',
      moonshot: 'MOONSHOT_API_KEY',
      minimax: 'MINIMAX_API_KEY'
    };

    const key = keyMap[provider];

    // Special handling for Google: check both GEMINI_API_KEY and GOOGLE_API_KEY
    if (provider === 'google') {
      return this.getGoogleApiKey().length > 0;
    }

    return this.env[key as keyof Required<EnvironmentVariables>].length > 0;
  }

  /**
   * Get Google API key with proper fallback
   * Priority: GEMINI_API_KEY (recommended by Google) -> GOOGLE_API_KEY (legacy)
   */
  getGoogleApiKey(): string {
    return this.env.GEMINI_API_KEY || this.env.GOOGLE_API_KEY || '';
  }

  /**
   * Get configured API providers
   */
  getConfiguredProviders(): string[] {
    const providers: string[] = [];

    if (this.hasApiKey('anthropic')) providers.push('anthropic');
    if (this.hasApiKey('openai')) providers.push('openai');
    if (this.hasApiKey('google')) providers.push('google');
    if (this.hasApiKey('xai')) providers.push('xai');
    if (this.hasApiKey('deepseek')) providers.push('deepseek');

    return providers;
  }

  /**
   * Reload configuration from file
   */
  reload(): void {
    const env = loadEnvFile(this.projectPath);
    this.env = mergeWithDefaults(env);
  }

  /**
   * Set a single environment variable and persist to .env file
   */
  set<K extends keyof EnvironmentVariables>(key: K, value: string): WriteResult {
    const result = writeEnvSetting(this.projectPath, key, value);
    if (result.success) {
      // Update in-memory copy
      this.env[key as keyof Required<EnvironmentVariables>] = value;
    }
    return result;
  }

  /**
   * Set multiple environment variables and persist to .env file
   */
  setMultiple(settings: Partial<EnvironmentVariables>): Record<string, WriteResult> {
    const results = writeEnvSettings(this.projectPath, settings);

    // Update in-memory copy for successful writes
    for (const [key, result] of Object.entries(results)) {
      if (result.success) {
        this.env[key as keyof Required<EnvironmentVariables>] = result.newValue;
      }
    }

    return results;
  }

  /**
   * Remove a setting's override line (reset-to-default). Deletes the user's override so
   * the lever falls back to the shipped `.env.defaults` — the correct reset in the
   * read-live model (writing the current default value would re-freeze it).
   */
  remove<K extends keyof EnvironmentVariables>(key: K): WriteResult {
    const result = removeEnvSetting(this.projectPath, key);
    if (result.success) this.reload();
    return result;
  }

  /** Alias — reset a single setting to the shipped default by removing the override. */
  resetToDefault<K extends keyof EnvironmentVariables>(key: K): WriteResult {
    return this.remove(key);
  }

  /**
   * True if this key is set as an override in the user's OWN .env file (vs flowing from
   * the shipped .env.defaults). Powers the "your override / shipped default" display.
   */
  isUserOverride<K extends keyof EnvironmentVariables>(key: K): boolean {
    return readEnvFileAt(path.join(this.projectPath, '.env'))[key] !== undefined;
  }

  /** All keys the user has overridden in their own .env file (one read — for a display
   *  that needs to mark many rows without re-reading the file per row). */
  getOverriddenKeys(): string[] {
    return Object.keys(readEnvFileAt(path.join(this.projectPath, '.env')));
  }

  /**
   * Reset all LEVERS to defaults by removing their override lines (API keys preserved),
   * so every lever falls back to the shipped `.env.defaults`.
   */
  resetAllToDefaults(): Record<string, WriteResult> {
    const results: Record<string, WriteResult> = {};
    const secretKeys = new Set<string>(SETTINGS_METADATA.filter(m => m.secret).map(m => m.key));
    const fileEnv = readEnvFileAt(path.join(this.projectPath, '.env'));
    for (const key of Object.keys(fileEnv)) {
      if (secretKeys.has(key)) continue; // preserve API keys
      results[key] = removeEnvSetting(this.projectPath, key as keyof EnvironmentVariables);
    }
    this.reload();
    return results;
  }

  /**
   * Get configuration summary for display
   */
  getSummary(): {
    providers: string[];
    defaultModel: string;
    helperModel: string;
    mentorshipEnabled: boolean;
    debugEnabled: boolean;
    mentorship?: {
      triggerOnError: boolean;
      errorThreshold: string;
      keywordsEnabled: boolean;
      helperModel: string;
      turnBasedEnabled: boolean;
      turnInterval: number;
      interleavedThinking: boolean;
      patternDetection: boolean;
      patternThreshold: number;
      activeDiscovery: boolean;
    };
  } {
    const mentorshipEnabled = this.env.MENTORSHIP_ENABLED === 'true';

    return {
      providers: this.getConfiguredProviders(),
      defaultModel: this.env.DEFAULT_MODEL_ID,
      helperModel: this.env.HELPER_MODEL_ID,
      mentorshipEnabled,
      debugEnabled: this.env.DEBUG === 'true',
      mentorship: mentorshipEnabled ? {
        triggerOnError: this.env.MENTORSHIP_TRIGGER_ON_ERROR === 'true',
        errorThreshold: this.env.MENTORSHIP_ERROR_THRESHOLD,
        keywordsEnabled: this.env.MENTORSHIP_KEYWORDS_ENABLED === 'true',
        helperModel: this.env.MENTORSHIP_HELPER_MODEL,
        turnBasedEnabled: this.env.MENTORSHIP_TURN_BASED_ENABLED === 'true',
        turnInterval: parseInt(this.env.MENTORSHIP_TURN_INTERVAL),
        interleavedThinking: this.env.MENTORSHIP_INTERLEAVED_THINKING === 'true',
        patternDetection: this.env.MENTORSHIP_PATTERN_DETECTION === 'true',
        patternThreshold: parseInt(this.env.MENTORSHIP_PATTERN_THRESHOLD),
        activeDiscovery: this.env.MENTORSHIP_ACTIVE_DISCOVERY === 'true'
      } : undefined
    };
  }
}
