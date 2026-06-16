/**
 * Persistent MCP token store.
 *
 * Some HTTP MCP servers (notably nexus-browser) auto-provision a free-tier API
 * key on the first anonymous connection and hand it back via the `X-Mcp-Token`
 * response header. If the client discards that token, EVERY subsequent
 * connection — the parent process, every sub-agent child process, every server
 * auto-start, and every reconnect — re-provisions a brand-new key. That:
 *   1. lands on a DIFFERENT Durable Object each time, so quota/session state is
 *      fragmented and a long session with many browse calls gets confused;
 *   2. trips the server's per-IP "too many fresh registrations" throttle, which
 *      surfaces as an intermittent bare `fetch failed`;
 *   3. defeats the free→paid funnel — a depleted free key should drive the user
 *      to sign up for a long-running key, not silently mint another free one.
 *
 * This store persists the provisioned token GLOBALLY (`~/.cortex/.mcp-tokens.json`,
 * keyed by server URL) so the parent and all sub-agent processes reuse the SAME
 * key → same DO → consistent quota. The token is provisioned exactly once; on
 * depletion the server's signup message surfaces instead of a re-provision.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import * as os from 'os';

/** serverUrl -> bearer token */
type TokenMap = Record<string, string>;

/**
 * Global token file location. Lives under `~/.cortex/` (NOT the project dir) so
 * that the parent process and every sub-agent child process — which may run with
 * a different cwd — share one token per server.
 */
function getTokenStorePath(): string {
  const home = os.homedir() || process.cwd();
  return join(home, '.cortex', '.mcp-tokens.json');
}

function readAll(): TokenMap {
  try {
    const raw = readFileSync(getTokenStorePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as TokenMap) : {};
  } catch {
    // Missing/corrupt file → no persisted tokens yet.
    return {};
  }
}

/**
 * Return a previously-provisioned token for this server URL, if any.
 */
export function getPersistedMcpToken(serverUrl: string): string | undefined {
  if (!serverUrl) return undefined;
  const token = readAll()[serverUrl];
  return typeof token === 'string' && token.length > 0 ? token : undefined;
}

/**
 * Persist a token for this server URL. Best-effort: a write failure (read-only
 * home, permissions) must never break an otherwise-working MCP connection.
 * No-ops when the token is unchanged to avoid pointless disk churn.
 */
export function persistMcpToken(serverUrl: string, token: string): void {
  if (!serverUrl || !token) return;
  try {
    const all = readAll();
    if (all[serverUrl] === token) return;
    all[serverUrl] = token;
    const path = getTokenStorePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(all, null, 2), 'utf8');
  } catch {
    /* best-effort */
  }
}
