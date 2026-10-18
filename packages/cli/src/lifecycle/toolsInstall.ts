/**
 * External tools for the narrow bash+edit frame: sgrep (hybrid semantic+lexical code search) and ripgrep, installed into
 * `<CORTEX_HOME|~>/.cortex/bin` — the directory the Bash tool prepends to its PATH (executors/utils/killGuard.ts harnessBinDir) and
 * the orient scaffold advertises ("-- search: prefer rg … | sgrep …"). Nothing ships INSIDE the npm package: each tool is a pinned
 * release asset downloaded at first run (or `cortex tools install`), verified against a pinned sha256, extracted with the host's
 * `tar`. Sources: sgrep from the in-house release store github.com/Spitfire-Products/cortex-tools (public; Linux AND macOS arm64
 * builds of context-dot-dev/sgrep at one pinned commit — upstream's own macOS tarball is cut from the v0.3.0 tag and lacks the flags
 * the orient line relies on), ripgrep from BurntSushi/ripgrep releases. An asset is identified by its sha256, not its version string:
 * a changed pin re-installs even when the version is unchanged.
 *
 * Policy (canonical setting CORTEX_TOOLS_AUTO_INSTALL): auto (default — install missing/outdated tools on startup, TTL-gated, best-effort,
 * never blocks the CLI on a network failure) | off (never download; `cortex tools install` still works explicitly). Bench containers run
 * `off` (the box package cache provides the same binaries). Every path here is best-effort and must never throw into the CLI.
 */
import { createHash } from 'crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
import { createWriteStream } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
import { getGlobalConfigDir, getGlobalEnvPath } from '@nexus-cortex/core';

export type AssetKind = 'bin' | 'tar';
export interface ToolAsset { url: string; sha256: string; kind: AssetKind; member?: string }
export interface ToolSpec { version: string; assets: Record<string, ToolAsset> }
export type ToolManifest = Record<string, ToolSpec>;
export type ToolsPolicy = 'auto' | 'off';
export interface InstallResult { tool: string; status: 'installed' | 'up-to-date' | 'unsupported' | 'failed'; version?: string; error?: string }
export interface StatusRow { tool: string; pinned: string; installed: string | null; path: string; supported: boolean }

const CT = 'https://github.com/Spitfire-Products/cortex-tools/releases/download/sgrep-0.3.0';
const RG = 'https://github.com/BurntSushi/ripgrep/releases/download/15.2.0';
const rg = (triple: string, ext = 'tar.gz') => `${RG}/ripgrep-15.2.0-${triple}.${ext}`;

/** Pinned versions + per-platform assets. Bump here (and the LEDGER line in .env) to roll a tool forward. */
export const TOOLS_MANIFEST: ToolManifest = {
  sgrep: {
    version: '0.3.0',
    assets: {
      // static musl build runs on every x86_64 Linux (glibc and Alpine alike)
      'linux-x64': { url: `${CT}/sgrep-0.3.0-x86_64-linux-musl`, sha256: '07c4d2f90bdd600811070c1d7b9a77e9c1ffeccaff51e7a60d98d943e05215e8', kind: 'bin' },
      // built by cortex-tools' macOS job from the SAME pinned commit: upstream's own macOS tarball is the v0.3.0 TAG, which predates
      // --explain/--stdin/--rg-json (both report 0.3.0 — the sha pin below is what tells them apart)
      'darwin-arm64': { url: `${CT}/sgrep-0.3.0-aarch64-darwin`, sha256: '4605e996e88d8455244dfc767ab0f58494a0dcf0a403902aec36927cc16bc975', kind: 'bin' },
    },
  },
  rg: {
    version: '15.2.0',
    assets: {
      'linux-x64': { url: rg('x86_64-unknown-linux-musl'), sha256: '33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c', kind: 'tar', member: 'ripgrep-15.2.0-x86_64-unknown-linux-musl/rg' },
      'linux-arm64': { url: rg('aarch64-unknown-linux-musl'), sha256: '800b1e7206afe799dfb5a6901f23147cfaabe0e52210538100f61e86e1740915', kind: 'tar', member: 'ripgrep-15.2.0-aarch64-unknown-linux-musl/rg' },
      'darwin-arm64': { url: rg('aarch64-apple-darwin'), sha256: '3750b2e93f37e0c692657da574d7019a101c0084da05a790c83fd335bad973e4', kind: 'tar', member: 'ripgrep-15.2.0-aarch64-apple-darwin/rg' },
      'darwin-x64': { url: rg('x86_64-apple-darwin'), sha256: 'af7825fcc69a2afc7a7aea55fc9af90e26421d8f20fe59df32e233c0b8a231c1', kind: 'tar', member: 'ripgrep-15.2.0-x86_64-apple-darwin/rg' },
      'win32-x64': { url: rg('x86_64-pc-windows-msvc', 'zip'), sha256: '71b2fef860abe467217a538ff31de02f5258807c0129f771846f87bd029aafc5', kind: 'tar', member: 'ripgrep-15.2.0-x86_64-pc-windows-msvc/rg.exe' },
      'win32-arm64': { url: rg('aarch64-pc-windows-msvc', 'zip'), sha256: 'e4abca10c3a64ebea742667dd7009449d49403db5460dd6873e389fa2945360f', kind: 'tar', member: 'ripgrep-15.2.0-aarch64-pc-windows-msvc/rg.exe' },
    },
  },
};

const CHECK_TTL_MS = 24 * 60 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 30_000;

export const platformKey = (): string => `${process.platform}-${process.arch}`;
export const toolsBinDir = (): string => join(getGlobalConfigDir(), 'bin');
const statePath = () => join(toolsBinDir(), '.tools.json');
const checkPath = () => join(getGlobalConfigDir(), '.tools-check');
const exeName = (tool: string) => (process.platform === 'win32' ? `${tool}.exe` : tool);

type State = Record<string, { version: string; sha256?: string; installedAt: string; platform: string }>;
function readState(): State { try { return JSON.parse(readFileSync(statePath(), 'utf8')); } catch { return {}; } }
function writeState(s: State): void { try { mkdirSync(toolsBinDir(), { recursive: true }); writeFileSync(statePath(), JSON.stringify(s, null, 2)); } catch { /* best-effort */ } }

/** Lightweight policy read (env, then ~/.cortex/.env) — mirrors updateCheck's readPolicyRaw; no SettingsLoader startup cost. */
export function resolveToolsPolicy(): ToolsPolicy {
  let raw = process.env.CORTEX_TOOLS_AUTO_INSTALL ?? '';
  if (!raw) {
    try {
      const p = getGlobalEnvPath();
      if (existsSync(p)) { const m = readFileSync(p, 'utf8').match(/^CORTEX_TOOLS_AUTO_INSTALL=(.*)$/m); if (m) raw = m[1].trim().replace(/^["']|["']$/g, ''); }
    } catch { /* default */ }
  }
  raw = raw.trim().toLowerCase();
  return raw === 'off' || raw === 'false' || raw === '0' ? 'off' : 'auto';
}

async function download(url: string, dest: string, redirects = 0): Promise<void> {
  if (redirects > 6) throw new Error('too many redirects');
  const mod = url.startsWith('https:') ? await import('node:https') : await import('node:http');
  await new Promise<void>((resolve, reject) => {
    const req = mod.get(url, { timeout: DOWNLOAD_TIMEOUT_MS, headers: { 'user-agent': 'nexus-cortex-tools' } }, (res) => {
      const code = res.statusCode ?? 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        download(next, dest, redirects + 1).then(resolve, reject); return;
      }
      if (code !== 200) { res.resume(); reject(new Error(`HTTP ${code} for ${url}`)); return; }
      const out = createWriteStream(dest);
      res.pipe(out); out.on('finish', () => out.close(() => resolve())); out.on('error', reject); res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('download timed out')); });
  });
}

const sha256File = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');

/** Extract `member` from a tar/tar.gz/zip archive with the host's tar (bsdtar on macOS/Windows reads zip). */
function extractMember(archive: string, member: string, outDir: string): string {
  const r = spawnSync('tar', ['-xf', archive, '-C', outDir, member], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`tar extract failed: ${(r.stderr || '').trim().slice(0, 200)}`);
  const p = join(outDir, member);
  if (!existsSync(p)) throw new Error(`archive has no member ${member}`);
  return p;
}

async function installOne(tool: string, spec: ToolSpec, opts: { force?: boolean; log: (s: string) => void }): Promise<InstallResult> {
  const asset = spec.assets[platformKey()];
  if (!asset) return { tool, status: 'unsupported', version: spec.version };
  const bin = toolsBinDir(); const target = join(bin, exeName(tool));
  const state = readState();
  if (!opts.force && state[tool]?.version === spec.version && state[tool]?.sha256 === asset.sha256 && existsSync(target)) return { tool, status: 'up-to-date', version: spec.version };
  const work = mkdtempSync(join(tmpdir(), `cortex-tool-${tool}-`));
  try {
    const archive = join(work, 'asset');
    await download(asset.url, archive);
    const got = sha256File(archive);
    if (got !== asset.sha256) throw new Error(`sha256 mismatch for ${tool} (${got.slice(0, 12)}… ≠ pinned ${asset.sha256.slice(0, 12)}…)`);
    const file = asset.kind === 'bin' ? archive : extractMember(archive, asset.member || tool, work);
    mkdirSync(bin, { recursive: true });
    const tmpTarget = `${target}.tmp-${process.pid}`;
    copyFileSync(file, tmpTarget); chmodSync(tmpTarget, 0o755); renameSync(tmpTarget, target);
    state[tool] = { version: spec.version, sha256: asset.sha256, installedAt: new Date().toISOString(), platform: platformKey() };
    writeState(state);
    opts.log(`[tools] ${tool} ${spec.version} → ${target}`);
    return { tool, status: 'installed', version: spec.version };
  } catch (e) {
    return { tool, status: 'failed', version: spec.version, error: e instanceof Error ? e.message : String(e) };
  } finally {
    try { rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/** Install the named tools (default: every tool in the manifest). Explicit path — runs regardless of policy. */
export async function installTools(names: string[] = [], opts: { manifest?: ToolManifest; force?: boolean; log?: (s: string) => void } = {}): Promise<InstallResult[]> {
  const manifest = opts.manifest ?? TOOLS_MANIFEST; const log = opts.log ?? ((s: string) => process.stderr.write(`${s}\n`));
  const list = names.length ? names : Object.keys(manifest);
  const out: InstallResult[] = [];
  for (const tool of list) {
    const spec = manifest[tool];
    if (!spec) { out.push({ tool, status: 'failed', error: `unknown tool (known: ${Object.keys(manifest).join(', ')})` }); continue; }
    out.push(await installOne(tool, spec, { force: opts.force, log }));
  }
  return out;
}

export function toolsStatus(opts: { manifest?: ToolManifest } = {}): StatusRow[] {
  const manifest = opts.manifest ?? TOOLS_MANIFEST; const state = readState(); const bin = toolsBinDir();
  return Object.entries(manifest).map(([tool, spec]) => {
    const p = join(bin, exeName(tool));
    const present = (() => { try { return statSync(p).isFile(); } catch { return false; } })();
    return { tool, pinned: spec.version, installed: present ? (state[tool]?.version ?? 'unknown') : null, path: p, supported: Boolean(spec.assets[platformKey()]) };
  });
}

/** Startup hook: under policy `auto`, install missing/outdated tools at most once per TTL. Best-effort, never throws, never blocks on failure. */
export async function ensureTools(opts: { manifest?: ToolManifest; log?: (s: string) => void; ttlMs?: number } = {}): Promise<void> {
  try {
    if (resolveToolsPolicy() === 'off') return;
    const ttl = opts.ttlMs ?? CHECK_TTL_MS; const cp = checkPath();
    let last = 0; try { last = Number(readFileSync(cp, 'utf8')) || 0; } catch { /* never checked */ }
    if (ttl > 0 && Date.now() - last < ttl) return;
    const manifest = opts.manifest ?? TOOLS_MANIFEST;
    const log = opts.log ?? ((s: string) => { if (process.stderr.isTTY) process.stderr.write(`${s}\n`); });
    const results = await installTools(Object.keys(manifest), { manifest, log });
    for (const r of results) if (r.status === 'failed') log(`[tools] ${r.tool}: not installed (${r.error}); run \`cortex tools install ${r.tool}\` later or set CORTEX_TOOLS_AUTO_INSTALL=off`);
    try { mkdirSync(getGlobalConfigDir(), { recursive: true }); writeFileSync(cp, String(Date.now())); } catch { /* best-effort */ }
  } catch { /* never let the tools check break the CLI */ }
}
