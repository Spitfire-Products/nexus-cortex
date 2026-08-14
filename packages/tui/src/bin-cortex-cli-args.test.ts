/**
 * P0-3 (docs/TUI_UX_FINDINGS.md) — cortex-cli argument parsing + TTY guard.
 *
 * Empirical contract for bin/cortex-ui.js (the `cortex-cli` bin):
 *  - `--help` / `-h`     → usage on stdout, exit 0 (must NOT boot the TUI)
 *  - `--version` / `-V`  → package version on stdout, exit 0
 *  - unknown flag        → usage/error on stderr, exit 2
 *  - non-TTY stdin       → one-line human error on stderr, exit 1
 *    (no Ink raw-mode stack dump, no React reconciler frames)
 */
import { describe, it, expect } from 'vitest';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = join(__dirname, '..', 'bin', 'cortex-ui.js');
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runBin(args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [BIN, ...args],
      { timeout: 30000 },
      (error, stdout, stderr) => {
        resolve({ code: child.exitCode, stdout, stderr });
      }
    );
    // Piped stdin (non-TTY) — close immediately, like `echo | cortex-cli`
    child.stdin?.end();
  });
}

describe('cortex-cli (bin/cortex-ui.js) argument parsing', () => {
  it('--help prints usage and exits 0 without booting the TUI', async () => {
    const r = await runBin(['--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Usage: cortex-cli');
    expect(r.stdout).not.toContain('Initializing');
    expect(r.stderr).not.toContain('Raw mode');
  });

  it('-h is an alias for --help', async () => {
    const r = await runBin(['-h']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Usage: cortex-cli');
  });

  it('--version prints the package version and exits 0', async () => {
    const r = await runBin(['--version']);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toContain(pkg.version);
  });

  it('unknown flags print usage to stderr and exit 2', async () => {
    const r = await runBin(['--badflag']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--badflag');
    expect(r.stderr).toContain('Usage: cortex-cli');
  });

  it('non-TTY stdin exits 1 with a clear one-line error (no React stack dump)', async () => {
    const r = await runBin([]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('requires an interactive terminal');
    const combined = r.stdout + r.stderr;
    expect(combined).not.toContain('react-reconciler');
    expect(combined).not.toContain('ERROR Raw mode');
  });
});
