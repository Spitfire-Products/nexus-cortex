/**
 * Curated ESSENTIAL tool sets for auto-connected MCP servers (2026-11-02). A pinned server's essential tools go into every request
 * directly; its other tools stay deferred and are found through SearchTools — the progressive-discovery form the nexus-browser MCP
 * server itself uses (~18 direct + searchTools/dispatch). Before, every tool of a pinned server was essential: the Browse delegate
 * carried all 50 nexus-browser schemas (~49k chars) on each of its requests.
 * A server with no curated set keeps all its tools pinned (previous behaviour).
 */
export const ESSENTIAL_MCP_TOOLS: Record<string, ReadonlySet<string>> = {
  'nexus-browser': new Set([
    'browse', 'scan', 'snapshot', 'grab', 'get_content',                 // read
    'click', 'type', 'select', 'keypress', 'scroll', 'fill_form',        // act (structure)
    'screenshot', 'computer_use',                                          // pixels
    'wait_for', 'dismiss_overlays', 'evaluate', 'close_session',          // flow
    'steps', 'page_state',                                                 // several actions in one call; one read of URL/filters/main count (2026-11-03)
  ]),
};

/** Is this tool in its server's essential set? True for every tool of a server without a curated set. */
export function isEssentialMcpTool(serverName: string, toolName: string): boolean {
  const set = ESSENTIAL_MCP_TOOLS[serverName];
  return set ? set.has(toolName) : true;
}
