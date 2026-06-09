/**
 * MCP auto-injection policy.
 *
 * Determines whether discovered MCP tools should be auto-injected into every
 * request's `tools` array. Two conditions must hold:
 *
 * 1. At least one MCP server is connected (otherwise there's nothing to inject).
 * 2. The operator has not opted out via `MCP_AUTO_INJECT=false`.
 *
 * The env var must gate INJECTION, not just config LOAD. Loading
 * `MCP_CONFIG.md` and connecting servers is harmless; what costs tokens is
 * shipping every discovered tool's schema on every request. nexus-browser
 * alone contributes ~43 tools / ~12.5K input tokens. The previous behavior
 * ignored the env var and unconditionally enabled injection whenever any
 * server connected.
 */
export function shouldAutoInjectMcp(
  connectedCount: number,
  envValue: string | undefined
): boolean {
  if (connectedCount <= 0) return false;
  if (envValue === 'false') return false;
  return true;
}
