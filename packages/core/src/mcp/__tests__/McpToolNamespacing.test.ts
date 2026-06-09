/**
 * Regression tests for MCP tool namespacing.
 *
 * #12: Tools surfaced by McpClientManager.getAllTools() are exposed to the
 *      orchestrator with a `<serverName>__<rawName>` prefix when consumed via
 *      the helper functions below. This prevents collisions with native
 *      executors (e.g. nexus-browser's `browse` shadowing a future native
 *      `Browse` tool) and gives the model an unambiguous server-qualified
 *      name to call.
 *
 *      Round-trip: `prefixMcpToolName(server, tool)` → `parseMcpToolName()`
 *      returns the same `{ serverName, toolName }`.
 */

import { describe, it, expect } from 'vitest';
import {
  prefixMcpToolName,
  parseMcpToolName,
  isPrefixedMcpToolName,
} from '../mcpToolNamespacing.js';

describe('MCP tool namespacing — #12 prefix round-trip', () => {
  it('prefixes a raw tool name with serverName__', () => {
    expect(prefixMcpToolName('nexus-browser', 'browse')).toBe('nexus-browser__browse');
    expect(prefixMcpToolName('filesystem', 'read_text_file')).toBe(
      'filesystem__read_text_file',
    );
  });

  it('parses a prefixed name back to {serverName, toolName}', () => {
    expect(parseMcpToolName('nexus-browser__browse')).toEqual({
      serverName: 'nexus-browser',
      toolName: 'browse',
    });
  });

  it('handles tool names containing underscores correctly', () => {
    expect(parseMcpToolName('nexus-browser__wait_for_challenge_resolution')).toEqual({
      serverName: 'nexus-browser',
      toolName: 'wait_for_challenge_resolution',
    });
  });

  it('handles tool names containing __ within them by splitting on FIRST __', () => {
    // If a tool ever had `__` in its name (rare), the split-on-first-occurrence
    // rule keeps the server boundary unambiguous.
    expect(parseMcpToolName('server__odd__tool__name')).toEqual({
      serverName: 'server',
      toolName: 'odd__tool__name',
    });
  });

  it('returns null when no __ separator is present (raw name, not prefixed)', () => {
    expect(parseMcpToolName('Browse')).toBeNull();
    expect(parseMcpToolName('browse')).toBeNull();
    expect(parseMcpToolName('plain_tool_name')).toBeNull();
  });

  it('isPrefixedMcpToolName returns true only for valid prefixed names', () => {
    expect(isPrefixedMcpToolName('nexus-browser__browse')).toBe(true);
    expect(isPrefixedMcpToolName('Browse')).toBe(false);
    expect(isPrefixedMcpToolName('browse')).toBe(false);
    // Empty server name is not valid — would mean we mis-parsed.
    expect(isPrefixedMcpToolName('__browse')).toBe(false);
    // Empty tool name is not valid either.
    expect(isPrefixedMcpToolName('server__')).toBe(false);
  });
});
