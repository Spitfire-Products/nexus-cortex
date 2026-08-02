/**
 * `cortex canon init` — scaffold a canon store repository.
 *
 * Creates the directory taxonomy (session + intent + artifact dimensions),
 * `.gitattributes` (jsonl merge=union), the A4 verification workflow, and a
 * README with token-scoping/privacy guidance, then `git init`s the target if
 * it is not already a repository.
 *
 * Idempotent by construction: existing files are NEVER overwritten (reported
 * as skipped), directories are only stamped with `.gitkeep` when newly
 * created, and re-running against a live store is a no-op. Purely local — no
 * network calls; `--remote` only records the origin URL.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ThemeManager } from '../../themes/ThemeManager.js';
import {
  CANON_VERIFY_MJS,
  GITATTRIBUTES,
  STORE_DIRS,
  STORE_README,
  VERIFY_YML,
} from './scaffoldAssets.js';

export interface CanonInitOptions {
  /** Target directory (default: current working directory). */
  dir?: string;
  /** Remote URL to record as `origin` (no push is performed). */
  remote?: string;
  json?: boolean;
}

interface ScaffoldEntry {
  rel: string;
  content: string;
}

export async function canonInit(options: CanonInitOptions): Promise<void> {
  const theme = ThemeManager.getTheme();
  const root = path.resolve(options.dir ?? '.');
  const created: string[] = [];
  const skipped: string[] = [];

  const git = (args: string[]) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });

  fs.mkdirSync(root, { recursive: true });

  // Repository first, so scaffold files land inside a repo from birth.
  let repoInitialized = false;
  if (!fs.existsSync(path.join(root, '.git'))) {
    execFileSync('git', ['init', '-q', '-b', 'main', root], {
      encoding: 'utf8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    repoInitialized = true;
  }

  const files: ScaffoldEntry[] = [
    { rel: '.gitattributes', content: GITATTRIBUTES },
    { rel: 'README.md', content: STORE_README },
    { rel: path.join('.github', 'workflows', 'canon-verify.yml'), content: VERIFY_YML },
    { rel: path.join('.github', 'scripts', 'canon-verify.mjs'), content: CANON_VERIFY_MJS },
  ];
  for (const { rel, content } of files) {
    const abs = path.join(root, rel);
    if (fs.existsSync(abs)) {
      skipped.push(rel);
      continue;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    created.push(rel);
  }

  for (const dir of STORE_DIRS) {
    const abs = path.join(root, dir);
    if (fs.existsSync(abs)) {
      skipped.push(dir + '/');
      continue;
    }
    fs.mkdirSync(abs, { recursive: true });
    fs.writeFileSync(path.join(abs, '.gitkeep'), '');
    created.push(dir + '/');
  }

  let remoteRecorded = false;
  if (options.remote) {
    const hasOrigin = git(['remote'])
      .split('\n')
      .some((r) => r.trim() === 'origin');
    if (hasOrigin) {
      skipped.push('remote origin (already set)');
    } else {
      git(['remote', 'add', 'origin', options.remote]);
      remoteRecorded = true;
      created.push(`remote origin → ${options.remote}`);
    }
  }

  if (options.json) {
    console.log(JSON.stringify({ root, repoInitialized, remoteRecorded, created, skipped }, null, 2));
    return;
  }

  console.log();
  console.log(` Canon store ${repoInitialized ? 'initialized' : 'updated'} at ${theme.colors.highlight(root)}`);
  for (const c of created) console.log(`   ${theme.colors.success('+')} ${c}`);
  for (const s of skipped) console.log(`   ${theme.colors.muted('=')} ${s} ${theme.colors.muted('(exists, untouched)')}`);
  console.log();
  console.log(theme.colors.muted(' Next steps:'));
  console.log(theme.colors.muted('   1. Create a PRIVATE remote repository and push (git push -u origin main).'));
  console.log(
    theme.colors.muted('      Pushing the workflow file needs a credential with the `workflow` scope.'),
  );
  console.log(
    theme.colors.muted('   2. Use a fine-grained PAT scoped to that single repo (Contents: read/write).'),
  );
  console.log(theme.colors.muted('   3. Agents write under native/<harness>/ — see README.md for the layout.'));
  console.log();
}
