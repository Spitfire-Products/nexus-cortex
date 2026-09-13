#!/usr/bin/env node
/**
 * Generate the shipped `.env.defaults` from the MASTER config `.env`, and sync the
 * per-package copies — plus a CI drift guard.
 *
 * `.env` (the master, colorized/editable, tracked) is the ONE place harness levers are
 * authored. `.env.defaults` is its GENERATED mirror: same content + a "generated" banner,
 * committed and SHIPPED, read LIVE by the harness as the lowest-precedence default layer.
 * We can't ship a file literally named `.env` (it would load as a user override at highest
 * precedence, and editors only colorize `.env`), so the master stays `.env` and its mirror
 * ships as `.env.defaults`.
 *
 * Each entry-point package also ships its own `.env.defaults` copy so bootstrapEnv's
 * coreOwnRoot/packageRoot resolver finds one no matter which bin booted. Those copies are
 * gitignored BUILD ARTIFACTS and MUST match the root, or the read-live layer becomes
 * nondeterministic.
 *
 * 🔴 SECRET SAFETY: the master is tracked and its mirror ships, so a provider key must
 * NEVER carry a value here. This script REFUSES (exit 1) if any secret-named key has a
 * value — keys live in the environment / Replit Secrets / the user's ~/.cortex/.env.
 *
 * The published repo excludes `.env` (only `.env.defaults` ships), so when the master is
 * absent this script trusts the committed `.env.defaults` and only checks the per-package
 * copies against it.
 *
 * Run:
 *   node scripts/sync-env-defaults.mjs          # regenerate .env.defaults from .env + sync copies
 *   node scripts/sync-env-defaults.mjs --check   # exit 1 on any drift (CI, post-build)
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const MASTER = join(ROOT, '.env');
const DEFAULTS = join(ROOT, '.env.defaults');

const BANNER = [
  '# GENERATED — DO NOT EDIT. Read-live, shipped mirror of the MASTER config `.env`.',
  '# Edit `.env` (the master); regenerate with `npm run sync:env` (runs on build).',
  '# Read as the lowest-precedence default layer: user ~/.cortex/.env > real env > this.',
  '',
  '',
].join('\n');

// Secret-named keys must never carry a value in the master (it is tracked and its mirror
// ships). Superset name guard — better to over-flag than leak a key into the package.
const SECRET_RE = /(_API_KEY|_TOKEN|_SECRET|_ACCOUNT_ID|OAUTH)$/;

/**
 * Strip the LOCAL-ONLY section from the mirror. The master `.env` may end with a
 * "LOCAL-ONLY" section that REPEATS variables with local override values — because
 * dotenv is last-wins, those repeats take precedence LOCALLY, while the production
 * default stays in the variable's normal section above. The mirror (`.env.defaults`,
 * which ships) must NOT carry the local overrides, so we drop everything from the
 * LOCAL-ONLY section header to EOF. The master itself is never modified.
 */
function stripLocalOnly(content) {
  const lines = content.split('\n');
  // Match the section TITLE only — a comment that STARTS with "LOCAL-ONLY" (right after
  // the #). Prose that merely mentions the phrase ("see the LOCAL-ONLY section below")
  // must NOT trigger the strip.
  const titleIdx = lines.findIndex(l => /^\s*#\s*LOCAL[- ]ONLY\b/i.test(l));
  if (titleIdx === -1) return content;
  // Back up over the section's opening decorative border (# ====) and any blank lines
  // so the mirror doesn't keep a dangling header.
  let cut = titleIdx;
  while (cut > 0 && (/^\s*#\s*=+\s*$/.test(lines[cut - 1]) || /^\s*$/.test(lines[cut - 1]))) cut--;
  return lines.slice(0, cut).join('\n').replace(/\n*$/, '\n');
}

/** Build the mirror content from the master; exit 1 if a secret carries a value. The
 *  secret assert runs on the FULL master (LOCAL-ONLY section included). */
function generate(masterContent) {
  // 🔴 2026-09-12: the master was found APPENDED TO ITSELF (16 copies, 37K lines) by an as-yet-unidentified writer; the mirror
  // looked sane only because stripLocalOnly cut at the FIRST LOCAL-ONLY title. A duplicated master must fail the build/deploy
  // loudly instead of shipping silently.
  const headerCount = masterContent.split('\n').filter(l => l.startsWith('# Nexus Cortex — Complete Environment Configuration Reference')).length;
  if (headerCount > 1) {
    console.error(`[sync-env-defaults] REFUSE — the master .env contains its header ${headerCount} times (file appended to itself). Restore the single copy.`);
    process.exit(1);
  }
  const offenders = [];
  for (const raw of masterContent.split('\n')) {
    const t = raw.trim();
    if (!t || t.startsWith('#')) continue;
    const m = t.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    const val = m[2].trim().replace(/^['"]|['"]$/g, '');
    if (SECRET_RE.test(m[1]) && val) offenders.push(m[1]);
  }
  if (offenders.length) {
    console.error('[sync-env-defaults] REFUSE — secret keys carry values in .env (must be blank; the mirror ships):');
    console.error('  ' + offenders.join(', '));
    console.error('\nMove these into the environment / Replit Secrets / ~/.cortex/.env, blank them in .env, and retry.');
    process.exit(1);
  }
  const mirror = BANNER + stripLocalOnly(masterContent);
  // 🔴 Sanity: the LOCAL-ONLY strip must NEVER eat the real config. These levers live in
  // the upper sections, well above any LOCAL-ONLY section; if they are missing, the strip
  // cut too much (e.g. matched prose that mentions the phrase) — the drift guard can't see
  // this (it compares the mirror to the same buggy generation), so REFUSE here.
  const REQUIRED = ['DEFAULT_MODEL_ID=', 'CORTEX_ENDTURN_GATE=', 'ENABLE_WEBTOOLS='];
  const missing = REQUIRED.filter(k => !mirror.includes('\n' + k));
  if (missing.length) {
    console.error('[sync-env-defaults] REFUSE — the mirror is missing required levers (LOCAL-ONLY strip cut too much?):');
    console.error('  ' + missing.join(', '));
    console.error('\nCheck that only the section TITLE line begins with "LOCAL-ONLY" (not prose).');
    process.exit(1);
  }
  return mirror;
}

// Discover per-package targets: packages that SHIP .env.defaults (package.json `files`)
// or already have a copy on disk. Discovered, not hard-coded.
const pkgsDir = join(ROOT, 'packages');
const pkgTargets = [];
for (const name of readdirSync(pkgsDir)) {
  const pj = join(pkgsDir, name, 'package.json');
  if (!existsSync(pj)) continue;
  let ships = false;
  try { ships = (JSON.parse(readFileSync(pj, 'utf8')).files || []).includes('.env.defaults'); } catch { /* ignore */ }
  const file = join(pkgsDir, name, '.env.defaults');
  if (ships || existsSync(file)) pkgTargets.push({ name, file });
}

const haveMaster = existsSync(MASTER);

if (CHECK) {
  const problems = [];
  if (haveMaster) {
    const expected = generate(readFileSync(MASTER, 'utf8'));
    if (!existsSync(DEFAULTS) || readFileSync(DEFAULTS, 'utf8') !== expected) {
      problems.push('.env.defaults is stale vs the master .env');
    }
  } else {
    console.log('[sync-env-defaults] master .env absent (published repo) — trusting committed .env.defaults.');
  }
  const canonical = existsSync(DEFAULTS) ? readFileSync(DEFAULTS, 'utf8') : null;
  for (const t of pkgTargets) {
    if (canonical === null || !existsSync(t.file) || readFileSync(t.file, 'utf8') !== canonical) {
      problems.push(`packages/${t.name}/.env.defaults ${existsSync(t.file) ? 'differs from' : 'missing vs'} root .env.defaults`);
    }
  }
  if (problems.length) {
    console.error('[sync-env-defaults] DRIFT:');
    for (const p of problems) console.error('  ' + p);
    console.error('\nFix: edit ONLY the master .env, then run `npm run sync:env` (or `npm run build`).');
    process.exit(1);
  }
  console.log(`[sync-env-defaults] OK — .env.defaults ${haveMaster ? 'matches the master and ' : ''}has ${pkgTargets.length} package copies in sync.`);
} else {
  if (haveMaster) {
    const expected = generate(readFileSync(MASTER, 'utf8'));
    if (!existsSync(DEFAULTS) || readFileSync(DEFAULTS, 'utf8') !== expected) {
      writeFileSync(DEFAULTS, expected);
      console.log('[sync-env-defaults] regenerated .env.defaults from the master .env');
    }
  } else {
    console.log('[sync-env-defaults] master .env absent — leaving committed .env.defaults as-is.');
  }
  const canonical = existsSync(DEFAULTS) ? readFileSync(DEFAULTS, 'utf8') : '';
  let synced = 0;
  for (const t of pkgTargets) {
    const cur = existsSync(t.file) ? readFileSync(t.file, 'utf8') : null;
    if (cur !== canonical) { writeFileSync(t.file, canonical); synced++; console.log(`[sync-env-defaults] synced packages/${t.name}/.env.defaults`); }
  }
  console.log(`[sync-env-defaults] ${synced} package copies synced, ${pkgTargets.length - synced} current.`);
}
