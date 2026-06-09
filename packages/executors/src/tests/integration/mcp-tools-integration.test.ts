/**
 * MCP Dynamic Tool Registration Integration Test
 *
 * Tests the new dynamic MCP tool registration architecture where each MCP tool
 * is registered individually in the ToolRegistry (per-tool registration).
 *
 * Architecture:
 * - Orchestrator connects to MCP servers
 * - getMcpToolDeclarations() returns list of discovered tools
 * - Each tool is wrapped in DiscoveredMcpToolExecutor
 * - Tools are registered individually in ToolRegistry
 * - LLM sees each tool with its actual name and schema
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CortexOrchestrator, createOrchestrator } from '@nexus-cortex/core';
import { ToolRegistry } from '../../base/ToolRegistry.js';
import { DiscoveredMcpToolExecutor } from '../../implementations/mcp/DiscoveredMcpTool.js';
import { resolve } from 'path';
import { mkdir, writeFile, rm } from 'fs/promises';

// Intentionally skipped — see rationale below; not slated for revival.
//
// This integration suite spawns `@modelcontextprotocol/server-filesystem` via
// `npx` per test and asserts on the end-to-end LLM-workflow shape. Three
// reasons it's not worth migrating:
//
//   1) The npx-spawn pattern is the very thing that leaked puppeteer MCP
//      processes earlier in the audit (saturated the cgroup pid ceiling at
//      1019 / 1024 and crashed the host). Re-enabling these tests in CI
//      would re-introduce that pattern.
//   2) The MCP surface is already covered by 113 unit tests in
//      `packages/core/src/mcp/__tests__/` (config parser, server registry,
//      namespacing, HTTP reconnection) + 17 in
//      `packages/core/src/orchestrator/__tests__/mcp-config-integration.test.ts`.
//   3) End-to-end MCP execution was validated LIVE in audit benches 4 & 5
//      (nexus-browser via subscriber permanent key, prefixed tool names,
//      verbatim conversion). Those benches exercise the same path with
//      ground-truthed output.
//
// If a future need arises for real-subprocess MCP integration testing, the
// right pattern is a single dedicated suite that mocks at the transport
// layer, not respawns npx per test.
describe.skip('MCP Dynamic Tool Registration Integration', () => {
  let orchestrator: CortexOrchestrator;
  let toolRegistry: ToolRegistry;
  let testDir: string;
  let registeredMcpTools: string[] = [];

  beforeAll(async () => {
    // Create test directory
    testDir = resolve(process.cwd(), 'test-mcp-integration-workspace');
    await mkdir(testDir, { recursive: true });
    await writeFile(
      resolve(testDir, 'test-file.txt'),
      'Hello MCP Integration Test!\nThis is a test file for dynamic MCP tool registration.',
    );
    await writeFile(
      resolve(testDir, 'package.json'),
      JSON.stringify({ name: 'test-project', version: '1.0.0' }, null, 2),
    );

    // Create orchestrator via the factory (handles all DI wiring including
    // the permission profile load that the old direct-constructor form
    // didn't perform).
    orchestrator = await createOrchestrator({
      enableMcp: true,
      mcpServers: {
        filesystem: {
          name: 'filesystem',
          command: 'npx',
          args: ['@modelcontextprotocol/server-filesystem', testDir],
          timeout: 30000,
        },
      } as any,
      defaultModelId: 'claude-sonnet-4-5',
      projectPath: testDir,
      debug: false,
    } as any);

    // Create session (this connects to MCP servers and discovers tools)
    await orchestrator.createSession(testDir);

    // Wait for connection to stabilize
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Create tool registry
    toolRegistry = new ToolRegistry({
      workingDirectory: testDir,
      allowNetwork: false,
      allowFileSystem: true,
      allowShellExecution: false,
      mcpManager: orchestrator.getMcpManager(),
    });

    // Register MCP tools dynamically (this is the key new pattern)
    const mcpToolDeclarations = orchestrator.getMcpToolDeclarations();

    for (const toolDecl of mcpToolDeclarations) {
      const mcpTool = new DiscoveredMcpToolExecutor(
        toolDecl.serverName,
        toolDecl.toolName,
        {
          name: toolDecl.toolName,
          description: toolDecl.description,
          inputSchema: toolDecl.inputSchema,
        },
        () => orchestrator.getMcpManager(),
      );

      toolRegistry.registerTool(mcpTool);
      registeredMcpTools.push(mcpTool.name);
    }
  });

  afterAll(async () => {
    // Cleanup orchestrator (disconnects MCP servers)
    await orchestrator.cleanup();

    // Remove test directory
    await rm(testDir, { recursive: true, force: true });
  });

  describe('MCP Server Connection', () => {
    it('should have MCP enabled in orchestrator', () => {
      expect(orchestrator.isMcpEnabled()).toBe(true);
    });

    it('should have filesystem server connected', () => {
      const serverInfo = orchestrator.getMcpServerInfo();

      expect(serverInfo).toHaveLength(1);
      expect(serverInfo[0].name).toBe('filesystem');
      expect(serverInfo[0].status).toBe('connected');
      expect(serverInfo[0].toolCount).toBeGreaterThan(0);
    });

    it('should have discovered MCP tools', () => {
      const toolDeclarations = orchestrator.getMcpToolDeclarations();

      expect(toolDeclarations.length).toBeGreaterThan(0);

      // Verify tool structure
      const firstTool = toolDeclarations[0];
      expect(firstTool).toHaveProperty('serverName');
      expect(firstTool).toHaveProperty('toolName');
      expect(firstTool).toHaveProperty('description');
      expect(firstTool).toHaveProperty('inputSchema');
    });
  });

  describe('Dynamic Tool Registration', () => {
    it('should have registered MCP tools in ToolRegistry', () => {
      expect(registeredMcpTools.length).toBeGreaterThan(0);

      // Verify tools are actually in registry
      for (const toolName of registeredMcpTools) {
        expect(toolRegistry.hasTool(toolName)).toBe(true);
      }
    });

    it('should register tools with their actual names from MCP server', () => {
      // Filesystem MCP server should have these tools
      const expectedTools = [
        'read_file',
        'read_text_file',
        'list_directory',
        'list_allowed_directories',
      ];

      for (const toolName of expectedTools) {
        const isRegistered = registeredMcpTools.includes(toolName);
        expect(isRegistered).toBe(true);
      }
    });

    it('should have tool metadata from MCP server', () => {
      const listDirTool = toolRegistry.getTool('list_directory');

      expect(listDirTool).toBeDefined();
      expect(listDirTool?.name).toBe('list_directory');
      expect(listDirTool?.description).toBeDefined();
      expect(listDirTool?.description.length).toBeGreaterThan(0);
    });
  });

  describe('Direct Tool Execution', () => {
    it('should execute list_allowed_directories tool directly', async () => {
      const result = await toolRegistry.executeTool(
        'list_allowed_directories',
        {},
        new AbortController().signal,
      );

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.returnDisplay).toContain(testDir);
    });

    it('should execute list_directory tool directly', async () => {
      const result = await toolRegistry.executeTool(
        'list_directory',
        { path: testDir },
        new AbortController().signal,
      );

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.returnDisplay).toContain('test-file.txt');
      expect(result.returnDisplay).toContain('package.json');
    });

    it('should execute read_text_file tool directly', async () => {
      const result = await toolRegistry.executeTool(
        'read_text_file',
        { path: resolve(testDir, 'test-file.txt') },
        new AbortController().signal,
      );

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.returnDisplay).toContain('Hello MCP Integration Test!');
      expect(result.returnDisplay).toContain('dynamic MCP tool registration');
    });

    it('should execute get_file_info tool directly', async () => {
      const result = await toolRegistry.executeTool(
        'get_file_info',
        { path: resolve(testDir, 'test-file.txt') },
        new AbortController().signal,
      );

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.returnDisplay).toBeDefined();
      // File info typically includes size, type, etc.
    });

    it('should handle tool execution errors gracefully', async () => {
      const result = await toolRegistry.executeTool(
        'read_text_file',
        { path: resolve(testDir, 'nonexistent-file.txt') },
        new AbortController().signal,
      );

      expect(result).toBeDefined();
      // Note: Filesystem MCP server may handle missing files differently
      // Some versions return error, others return empty/success
      expect(result.returnDisplay).toBeDefined();

      // If it succeeded, verify it has content (even if empty)
      // If it failed, verify it has an error message
      if (result.success) {
        expect(typeof result.returnDisplay).toBe('string');
      } else {
        expect(result.returnDisplay.length).toBeGreaterThan(0);
      }
    });

    it('should handle abort signal during tool execution', async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await toolRegistry.executeTool(
        'list_directory',
        { path: testDir },
        controller.signal,
      );

      expect(result).toBeDefined();
      expect(result.success).toBe(false);
      expect(result.returnDisplay).toContain('cancelled');
    });
  });

  describe('Tool Result Formatting', () => {
    it('should format tool results properly', async () => {
      const result = await toolRegistry.executeTool(
        'list_directory',
        { path: testDir },
        new AbortController().signal,
      );

      expect(result.returnDisplay).toBeDefined();
      expect(typeof result.returnDisplay).toBe('string');
      expect(result.returnDisplay.length).toBeGreaterThan(0);
    });

    it('should include metadata in tool results', async () => {
      const result = await toolRegistry.executeTool(
        'list_allowed_directories',
        {},
        new AbortController().signal,
      );

      expect(result.metadata).toBeDefined();
      expect(result.metadata).toHaveProperty('executionTime');
      expect(result.metadata).toHaveProperty('serverName');
      expect(result.metadata).toHaveProperty('toolName');

      expect(result.metadata.serverName).toBe('filesystem');
      expect(result.metadata.toolName).toBe('list_allowed_directories');
    });
  });

  describe('Integration - Full LLM Workflow', () => {
    it('should support complete LLM interaction pattern', async () => {
      // Simulate LLM workflow:
      // 1. LLM sees "list_directory" in tool list
      // 2. LLM decides to call it
      // 3. Tool executes directly with MCP server
      // 4. Result is returned to LLM

      // Step 1: Verify tool is visible (LLM would see this)
      const hasListDir = toolRegistry.hasTool('list_directory');
      expect(hasListDir).toBe(true);

      // Step 2: Get tool metadata (LLM would see this schema)
      const tool = toolRegistry.getTool('list_directory');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('list_directory');

      // Step 3: Execute tool (LLM makes tool call)
      const result = await toolRegistry.executeTool(
        'list_directory',
        { path: testDir },
        new AbortController().signal,
      );

      // Step 4: Verify result (LLM receives this)
      expect(result.success).toBe(true);
      expect(result.returnDisplay).toContain('test-file.txt');
    });

    it('should support chained tool calls', async () => {
      // Simulate LLM workflow with multiple tool calls:
      // 1. List directory to find files
      // 2. Read file contents

      // First call: List directory
      const listResult = await toolRegistry.executeTool(
        'list_directory',
        { path: testDir },
        new AbortController().signal,
      );

      expect(listResult.success).toBe(true);
      expect(listResult.returnDisplay).toContain('test-file.txt');

      // Second call: Read file
      const readResult = await toolRegistry.executeTool(
        'read_text_file',
        { path: resolve(testDir, 'test-file.txt') },
        new AbortController().signal,
      );

      expect(readResult.success).toBe(true);
      expect(readResult.returnDisplay).toContain('Hello MCP Integration Test!');
    });

    it('should handle parallel tool calls', async () => {
      // Simulate LLM making multiple tool calls in parallel
      const promises = [
        toolRegistry.executeTool(
          'list_directory',
          { path: testDir },
          new AbortController().signal,
        ),
        toolRegistry.executeTool(
          'list_allowed_directories',
          {},
          new AbortController().signal,
        ),
        toolRegistry.executeTool(
          'get_file_info',
          { path: resolve(testDir, 'test-file.txt') },
          new AbortController().signal,
        ),
      ];

      const results = await Promise.all(promises);

      // All should succeed
      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing tool parameters', async () => {
      const result = await toolRegistry.executeTool(
        'list_directory',
        {}, // Missing 'path' parameter
        new AbortController().signal,
      );

      expect(result).toBeDefined();
      expect(result.success).toBe(false);
    });

    it('should handle invalid parameter types', async () => {
      const result = await toolRegistry.executeTool(
        'list_directory',
        { path: 123 as any }, // Invalid type
        new AbortController().signal,
      );

      expect(result).toBeDefined();
      expect(result.success).toBe(false);
    });

    it('should handle tool execution timeout gracefully', async () => {
      // Note: This test may take time to run
      const controller = new AbortController();

      // Abort after a short delay
      setTimeout(() => controller.abort(), 100);

      const result = await toolRegistry.executeTool(
        'list_directory',
        { path: testDir },
        controller.signal,
      );

      // Should either succeed quickly or be cancelled
      expect(result).toBeDefined();
      if (!result.success) {
        expect(result.returnDisplay).toContain('cancelled');
      }
    });
  });

  describe('Architecture Verification', () => {
    it('should register each tool individually', () => {
      // Verify key architectural properties:

      // 1. Each MCP tool is a separate tool in registry
      expect(registeredMcpTools.length).toBeGreaterThan(3);

      // 2. Tools have their actual names from MCP server
      expect(registeredMcpTools).toContain('read_file');
      expect(registeredMcpTools).toContain('list_directory');

      // 3. No wrapper tools exist
      expect(toolRegistry.hasTool('Mcp')).toBe(false);
      expect(toolRegistry.hasTool('ListMcpResources')).toBe(false);
      expect(toolRegistry.hasTool('ReadMcpResource')).toBe(false);
    });

    it('should have proper tool executor instances', () => {
      const listDirTool = toolRegistry.getTool('list_directory');

      expect(listDirTool).toBeDefined();
      expect(listDirTool).toBeInstanceOf(DiscoveredMcpToolExecutor);
    });

    it('should support getMcpToolDeclarations pattern', () => {
      const declarations = orchestrator.getMcpToolDeclarations();

      expect(Array.isArray(declarations)).toBe(true);
      expect(declarations.length).toBeGreaterThan(0);

      // Each declaration should have required fields
      declarations.forEach(decl => {
        expect(decl).toHaveProperty('serverName');
        expect(decl).toHaveProperty('toolName');
        expect(decl).toHaveProperty('description');
        expect(decl).toHaveProperty('inputSchema');
      });
    });
  });
});
