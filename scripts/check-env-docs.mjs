#!/usr/bin/env node
/**
 * Env-docs drift check (R65, 2026-08-18).
 *
 * Every `process.env.CORTEX_*` / `process.env.CANON_*` read in packages/[*]/src
 * must have a corresponding entry (active or commented) in .env.example, OR be
 * on the INTERNAL allowlist below (vars the harness sets for its own child
 * processes — not user configuration).
 *
 * Motivation: the R63/P6 levers existed only as raw process.env reads for a
 * day and were invisible in the env files; an operator audit caught it. This
 * makes the docs a build invariant instead of a memory.
 *
 * Run: node scripts/check-env-docs.mjs   (exit 1 on drift; wired into CI)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Harness-internal parent->child IPC vars: set BY the harness when spawning
// subprocesses, never user-configured. Add here only with a justification.
const INTERNAL = new Set([
  'CORTEX_SUBAGENT',            // marks a spawned sub-agent process
  'CORTEX_AGENT_MODE',          // agent-mode child bootstrap flag
  'CORTEX_ARM_STRATEGY',        // autoresearch arm label stamped per worker
  'CORTEX_TEST_POST_EXEC_THROW', // test-only fault injection for the tool-loop re-execution guard (reexecutionGuard.integration.test); never a user lever
]);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '__tests__') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) yield p;
  }
}

const reads = new Map(); // var -> first file seen
const pkgs = readdirSync(join(ROOT, 'packages'));
for (const pkg of pkgs) {
  const src = join(ROOT, 'packages', pkg, 'src');
  try { statSync(src); } catch { continue; }
  for (const file of walk(src)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/process\.env\.((?:CORTEX|CANON)_[A-Z0-9_]+)/g)) {
      if (!reads.has(m[1])) reads.set(m[1], file.slice(ROOT.length + 1));
    }
  }
}

const example = readFileSync(join(ROOT, '.env.example'), 'utf8');
const documented = new Set(
  [...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1])
);

const missing = [...reads.keys()]
  .filter((v) => !documented.has(v) && !INTERNAL.has(v))
  .sort();

if (missing.length) {
  console.error('[check-env-docs] FAIL — env reads with no .env.example entry:');
  for (const v of missing) console.error(`  ${v}  (first read: ${reads.get(v)})`);
  console.error('\nDocument each in .env.example (a commented "#VAR=" line counts),');
  console.error('or add to the INTERNAL allowlist in scripts/check-env-docs.mjs with a justification.');
  process.exit(1);
}
console.log(`[check-env-docs] OK — ${reads.size} CORTEX_/CANON_ env reads all documented (${INTERNAL.size} internal-allowlisted).`);
