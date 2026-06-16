#!/usr/bin/env node
/**
 * Vendor the shippable .cortex/ scaffold into an npm package at pack time.
 *
 * Why: npm tarballs ship only what's inside the package dir (`files: dist, bin`),
 * so the repo-root .cortex/ scaffold — builtin agent profiles, skills, commands,
 * system messages, sample bench tasks, the permissions example — never reaches an
 * `npm install`ed user. This script runs as `prepack` in packages/cli and
 * packages/server (cwd = the package dir), copying an ALLOWLISTED subset of the
 * repo-root scaffold into `<pkg>/.cortex/`, which is listed in the package's
 * `files`. At runtime the bins resolve CORTEX_ROOT to the monorepo root (git
 * clone) or the package root (npm install) so AgentStore's and SkillTool's
 * builtin tiers find it either way.
 *
 * Runtime content (sessions/, decisions.jsonl, router-matrix.jsonl, …) is NEVER
 * copied — those are created on demand by the stores (mkdir recursive).
 *
 * The vendored <pkg>/.cortex/ is a build artifact: gitignored in the dev repo,
 * regenerated on every pack.
 */
import { cpSync, existsSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const pkgDir = process.cwd();                       // npm runs lifecycle scripts from the package dir
const rootCortex = resolve(pkgDir, '..', '..', '.cortex');
const dest = join(pkgDir, '.cortex');

if (!existsSync(rootCortex)) {
  console.error(`[copy-pkg-cortex-scaffold] repo-root .cortex not found at ${rootCortex} — refusing to pack without the scaffold`);
  process.exit(1);
}

// Shippable scaffold only — mirrors the deploy script's .cortex keep-list.
const SCAFFOLD_DIRS = ['agents', 'skills', 'commands', 'system-messages', join('bench', 'tasks')];
const SCAFFOLD_FILES = ['permissions.example.json', 'permissions.dev.json', 'permissions.test.json', 'permissions.prod.json'];

rmSync(dest, { recursive: true, force: true });     // always rebuild — never accrete
mkdirSync(dest, { recursive: true });

let copied = 0;
for (const d of SCAFFOLD_DIRS) {
  const src = join(rootCortex, d);
  if (!existsSync(src)) continue;
  cpSync(src, join(dest, d), { recursive: true });
  copied++;
}
for (const f of SCAFFOLD_FILES) {
  const src = join(rootCortex, f);
  if (!existsSync(src)) continue;
  copyFileSync(src, join(dest, f));
  copied++;
}

// Fresh-install onboarding memory: ship the seed as MEMORY.md (never the dev MEMORY.md,
// which is project-private). Injected on turn 1; tells the first agent how to /init,
// discover skills/agents, and then replace it with real project memory.
// Source is MEMORY.seed.md in the dev repo, but the deploy renames it to MEMORY.md in the
// extracted repo (where CI publishes from) — so accept either, or MEMORY.md never ships.
const memorySeed = join(rootCortex, 'MEMORY.seed.md');
const memoryMd = join(rootCortex, 'MEMORY.md');
if (existsSync(memorySeed)) {
  copyFileSync(memorySeed, join(dest, 'MEMORY.md'));
  copied++;
} else if (existsSync(memoryMd)) {
  copyFileSync(memoryMd, join(dest, 'MEMORY.md'));
  copied++;
}

// Vendor the blank-value .env.example into the package root. The `cortex` first-run
// preflight copies it to ~/.cortex/.env (.env.example becomes .env — no codegen, no
// postinstall). All keys are blank so a value in the environment/secrets store wins.
const rootEnvExample = resolve(pkgDir, '..', '..', '.env.example');
if (existsSync(rootEnvExample)) {
  copyFileSync(rootEnvExample, join(pkgDir, '.env.example'));
  copied++;
  console.log(`[copy-pkg-cortex-scaffold] vendored .env.example into ${pkgDir}`);
}

if (copied === 0) {
  console.error('[copy-pkg-cortex-scaffold] nothing copied — scaffold dirs missing from repo-root .cortex');
  process.exit(1);
}
console.log(`[copy-pkg-cortex-scaffold] vendored ${copied} scaffold entr${copied === 1 ? 'y' : 'ies'} into ${dest}`);
