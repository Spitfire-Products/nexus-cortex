/**
 * Server-Side Tool Support Tests
 *
 * Tests for provider-managed agentic tool execution
 */

import { describe, it, expect } from 'vitest';
import {
  type ToolExecutionMode,
  type ServerSideToolMetadata,
  type ServerSideToolDefinition,
  SERVER_SIDE_TOOL_REGISTRY,
  isServerSideTool,
  isClientSideTool,
  getServerSideTools,
  separateTools,
  extractServerSideMetadata,
  XAIServerSideTools
} from '../ServerSideTools.js';

describe('Server-Side Tool Registry', () => {
  it('should have XAI tools registered', () => {
    expect(SERVER_SIDE_TOOL_REGISTRY.xai).toBeDefined();
    expect(SERVER_SIDE_TOOL_REGISTRY.xai['web_search']).toBe('server');
    expect(SERVER_SIDE_TOOL_REGISTRY.xai['x_search']).toBe('server');
    expect(SERVER_SIDE_TOOL_REGISTRY.xai['code_execution']).toBe('server');
  });

  it('should identify XAI web_search as server-side', () => {
    expect(isServerSideTool('xai', 'web_search')).toBe(true);
    expect(isClientSideTool('xai', 'web_search')).toBe(false);
  });

  it('should treat unknown provider tools as client-side', () => {
    expect(isServerSideTool('unknown-provider', 'some_tool')).toBe(false);
    expect(isClientSideTool('unknown-provider', 'some_tool')).toBe(true);
  });

  it('should treat Anthropic tools as client-side (default)', () => {
    expect(isServerSideTool('anthropic', 'bash')).toBe(false);
    expect(isClientSideTool('anthropic', 'bash')).toBe(true);
  });

  it('should get all server-side tools for XAI', () => {
    const tools = getServerSideTools('xai');
    expect(tools).toContain('web_search');
    expect(tools).toContain('x_search');
    expect(tools).toContain('code_execution');
    expect(tools.length).toBeGreaterThanOrEqual(5);
  });

  it('should return PTC tools for Anthropic', () => {
    const tools = getServerSideTools('anthropic');
    expect(tools).toContain('code_execution_20260120');
    expect(tools).toContain('tool_search_tool_bm25_20251119');
    expect(tools.length).toBe(2);
  });

  it('should return empty array for providers without server-side tools', () => {
    // OpenAI now has hosted Responses API tools (web_search, code_interpreter,
    // file_search, image_generation, mcp). Use a truly empty provider for the
    // empty-case assertion.
    expect(getServerSideTools('google')).toEqual([]);
  });

  it('should include OpenAI Responses API hosted tools', () => {
    const tools = getServerSideTools('openai');
    expect(tools).toContain('web_search');
    expect(tools).toContain('code_interpreter');
    expect(tools).toContain('file_search');
    expect(tools).toContain('image_generation');
    expect(tools).toContain('mcp');
  });
});

describe('Tool Separation', () => {
  it('should separate client and server tools for XAI', () => {
    const tools = [
      { name: 'web_search', type: 'web_search' },
      { name: 'bash', type: 'bash_20241022' },
      { name: 'x_search', type: 'x_search' },
      { name: 'read', type: 'text_editor_20241022' }
    ];

    const { clientTools, serverTools } = separateTools('xai', tools);

    expect(serverTools).toHaveLength(2);
    expect(serverTools[0].name).toBe('web_search');
    expect(serverTools[1].name).toBe('x_search');

    expect(clientTools).toHaveLength(2);
    expect(clientTools[0].name).toBe('bash');
    expect(clientTools[1].name).toBe('read');
  });

  it('should treat all tools as client-side for Anthropic', () => {
    const tools = [
      { name: 'bash', type: 'bash_20241022' },
      { name: 'read', type: 'text_editor_20241022' }
    ];

    const { clientTools, serverTools } = separateTools('anthropic', tools);

    expect(serverTools).toHaveLength(0);
    expect(clientTools).toHaveLength(2);
  });

  it('should handle tools without names gracefully', () => {
    const tools = [
      { type: 'web_search' },
      { description: 'Some tool' }
    ];

    const { clientTools, serverTools } = separateTools('xai', tools);

    // Tools without names default to client-side
    expect(clientTools).toHaveLength(1); // The one without name/type
    expect(serverTools).toHaveLength(1); // web_search
  });
});

describe('XAI Tool Builders', () => {
  it('should build web search tool with config', () => {
    const tool = XAIServerSideTools.webSearch({
      allowed_domains: ['example.com'],
      excluded_domains: ['spam.com'],
      enable_image_understanding: true
    });

    expect(tool.executionMode).toBe('server');
    expect(tool.name).toBe('web_search');
    expect(tool.serverConfig?.allowed_domains).toEqual(['example.com']);
    expect(tool.serverConfig?.enable_image_understanding).toBe(true);
  });

  it('should build web search tool without config', () => {
    const tool = XAIServerSideTools.webSearch();

    expect(tool.executionMode).toBe('server');
    expect(tool.name).toBe('web_search');
    expect(tool.serverConfig).toBeUndefined();
  });

  it('should build X search tool with config', () => {
    const tool = XAIServerSideTools.xSearch({
      allowed_x_handles: ['@elonmusk'],
      from_date: '2024-01-01',
      to_date: '2024-12-31',
      enable_video_understanding: true
    });

    expect(tool.executionMode).toBe('server');
    expect(tool.name).toBe('x_search');
    expect(tool.serverConfig?.allowed_x_handles).toEqual(['@elonmusk']);
    expect(tool.serverConfig?.from_date).toBe('2024-01-01');
  });

  it('should build code execution tool', () => {
    const tool = XAIServerSideTools.codeExecution();

    expect(tool.executionMode).toBe('server');
    expect(tool.name).toBe('code_execution');
  });
});

describe('Server-Side Metadata Extraction', () => {
  it('should extract XAI server-side metadata', () => {
    const xaiResponse = {
      citations: [
        'https://example.com/page1',
        'https://example.com/page2'
      ],
      server_side_tool_usage: {
        web_search: 3,
        x_search: 1
      },
      tool_calls: [
        {
          id: 'call_1',
          function: {
            name: 'web_search',
            arguments: '{"query": "AI news"}'
          }
        },
        {
          id: 'call_2',
          function: {
            name: 'x_search',
            arguments: '{"query": "AI updates"}'
          }
        }
      ],
      usage: {
        reasoning_tokens: 150
      }
    };

    const metadata = extractServerSideMetadata('xai', xaiResponse);

    expect(metadata).toBeDefined();
    expect(metadata?.autonomousExecution).toBe(true);
    expect(metadata?.citations).toHaveLength(2);
    expect(metadata?.citations?.[0]).toBe('https://example.com/page1');
    expect(metadata?.toolUsage).toEqual({
      web_search: 3,
      x_search: 1
    });
    expect(metadata?.toolCalls).toHaveLength(2);
    expect(metadata?.toolCalls[0].name).toBe('web_search');
    expect(metadata?.providerMetadata?.reasoning_tokens).toBe(150);
  });

  it('should return null for XAI responses without server-side tools', () => {
    const xaiResponse = {
      content: 'Regular response without server-side tools'
    };

    const metadata = extractServerSideMetadata('xai', xaiResponse);
    expect(metadata).toBeNull();
  });

  it('should return null for non-XAI providers', () => {
    const anthropicResponse = {
      content: 'Response from Anthropic'
    };

    const metadata = extractServerSideMetadata('anthropic', anthropicResponse);
    expect(metadata).toBeNull();
  });

  it('should handle XAI responses with only citations', () => {
    const xaiResponse = {
      citations: ['https://example.com'],
      server_side_tool_usage: {},
      tool_calls: []
    };

    const metadata = extractServerSideMetadata('xai', xaiResponse);

    expect(metadata).toBeDefined();
    expect(metadata?.citations).toHaveLength(1);
    expect(metadata?.autonomousExecution).toBe(true);
  });

  it('should handle XAI responses with only tool usage', () => {
    const xaiResponse = {
      citations: [],
      server_side_tool_usage: {
        code_execution: 5
      },
      tool_calls: []
    };

    const metadata = extractServerSideMetadata('xai', xaiResponse);

    expect(metadata).toBeDefined();
    expect(metadata?.toolUsage).toEqual({ code_execution: 5 });
    expect(metadata?.autonomousExecution).toBe(true);
  });
});

describe('TypeScript Type Validation', () => {
  it('should validate ToolExecutionMode type', () => {
    const modes: ToolExecutionMode[] = ['client', 'server', 'both'];
    expect(modes).toHaveLength(3);
  });

  it('should validate ServerSideToolMetadata structure', () => {
    const metadata: ServerSideToolMetadata = {
      toolUsage: { web_search: 2 },
      citations: ['https://example.com'],
      toolCalls: [
        {
          id: 'call_1',
          name: 'web_search',
          arguments: '{"query": "test"}',
          status: 'success'
        }
      ],
      autonomousExecution: true,
      providerMetadata: {
        reasoning_tokens: 100
      }
    };

    expect(metadata.toolUsage).toBeDefined();
    expect(metadata.autonomousExecution).toBe(true);
  });

  it('should validate ServerSideToolDefinition structure', () => {
    const definition: ServerSideToolDefinition = {
      executionMode: 'server',
      type: 'web_search',
      name: 'web_search',
      description: 'Search the web',
      parameters: {},
      serverConfig: {
        allowed_domains: ['example.com']
      }
    };

    expect(definition.executionMode).toBe('server');
    expect(definition.serverConfig?.allowed_domains).toEqual(['example.com']);
  });
});
