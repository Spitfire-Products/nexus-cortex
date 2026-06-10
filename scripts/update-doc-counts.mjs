#!/usr/bin/env node
/**
 * Auto-updating doc counts.
 *
 * Registry-derived numbers (tool / model / provider counts) drift the moment a
 * model or tool is added, and hardcoding them in the README is the root cause of
 * stale docs. Instead, the README holds marker-delimited placeholders:
 *
 *     <!--AUTO-COUNT:tools-->45<!--/AUTO-COUNT-->
 *
 * and this script fills them from the live registries in the built core package.
 * The HTML comments are invisible in rendered Markdown — readers just see "45".
 *
 * Usage:
 *   node scripts/update-doc-counts.mjs           # rewrite README with current counts
 *   node scripts/update-doc-counts.mjs --check    # exit 1 if README is stale (for CI)
 *
 * Requires the core package to be built first (imports packages/core/dist).
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const README = join(root, 'README.md');
const CORE = join(root, 'packages/core/dist/index.js');
const check = process.argv.includes('--check');

if (!existsSync(CORE)) {
  console.error('[doc-counts] packages/core/dist not found — build core first (npm run build). Skipping.');
  process.exit(check ? 0 : 0); // non-fatal: nothing to update/verify without a build
}

const core = await import(pathToFileURL(CORE).href);
const registry = new core.ModularModelRegistry();
const models = registry.listModels().map((id) => registry.getModel(id));

const counts = {
  tools: String(core.toolFactory.getAllTools().length),
  models: String(new Set(models.map((m) => m.id)).size), // unique canonical
  providers: String(new Set(models.map((m) => m.provider)).size),
  slashCommands: String(core.slashCommandRegistry.getAllCommands().length),
};

const md = readFileSync(README, 'utf8');
const re = /<!--AUTO-COUNT:(\w+)-->(.*?)<!--\/AUTO-COUNT-->/g;
const drift = [];
let seen = 0;
const updated = md.replace(re, (_m, key, old) => {
  seen++;
  const val = counts[key];
  if (val === undefined) {
    console.error(`[doc-counts] unknown AUTO-COUNT key in README: "${key}" (known: ${Object.keys(counts).join(', ')})`);
    process.exit(2);
  }
  if (old !== val) drift.push(`${key}: ${old} → ${val}`);
  return `<!--AUTO-COUNT:${key}-->${val}<!--/AUTO-COUNT-->`;
});

if (seen === 0) {
  console.error('[doc-counts] no <!--AUTO-COUNT:…--> markers found in README.md');
  process.exit(check ? 1 : 2);
}

if (check) {
  if (drift.length) {
    console.error('[doc-counts] README counts are STALE:\n  ' + drift.join('\n  ') + '\n  Fix: npm run docs:counts');
    process.exit(1);
  }
  console.log(`[doc-counts] OK — README counts current (${seen} markers): ${JSON.stringify(counts)}`);
} else if (updated !== md) {
  writeFileSync(README, updated);
  console.log(`[doc-counts] updated README (${seen} markers): ${drift.join(', ')}`);
} else {
  console.log(`[doc-counts] README already current (${seen} markers): ${JSON.stringify(counts)}`);
}
