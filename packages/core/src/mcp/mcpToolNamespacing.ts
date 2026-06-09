/**
 * MCP tool namespacing helpers.
 *
 * MCP servers (e.g. nexus-browser, filesystem) define tool names in their own
 * naming convention — typically lowercase verbs (`browse`, `scan`,
 * `read_text_file`). When multiple servers connect, or when a server's tool
 * name overlaps with a native executor (e.g. `Read` vs `read`), bare names
 * collide. We surface MCP tools to the model with a `<serverName>__<toolName>`
 * prefix so every name is unambiguous.
 *
 * The prefix uses double-underscore as the separator; it is split on the FIRST
 * occurrence so tool names that themselves contain `__` survive a round-trip.
 */

const SEPARATOR = '__';

export function prefixMcpToolName(serverName: string, toolName: string): string {
  return `${serverName}${SEPARATOR}${toolName}`;
}

export interface ParsedMcpToolName {
  serverName: string;
  toolName: string;
}

/**
 * Parse a prefixed name. Returns `null` when the input has no separator OR
 * when either side of the separator is empty (the input is not a valid
 * prefixed name).
 */
export function parseMcpToolName(name: string): ParsedMcpToolName | null {
  const sepIndex = name.indexOf(SEPARATOR);
  if (sepIndex <= 0) return null;
  const serverName = name.slice(0, sepIndex);
  const toolName = name.slice(sepIndex + SEPARATOR.length);
  if (!serverName || !toolName) return null;
  return { serverName, toolName };
}

export function isPrefixedMcpToolName(name: string): boolean {
  return parseMcpToolName(name) !== null;
}
