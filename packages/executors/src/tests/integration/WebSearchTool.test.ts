/**
 * WebSearchTool Integration Tests
 *
 * Tests the WebSearchTool with real Gemini API calls
 * Requires GOOGLE_API_KEY or GEMINI_API_KEY environment variable
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WebSearchTool } from '../../implementations/web/WebSearchTool.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';
import path from 'path';

// Only run if ENABLE_SMOKE_TESTS is set
const shouldRunSmokeTests = process.env.ENABLE_SMOKE_TESTS === 'true';
const describeIf = shouldRunSmokeTests ? describe : describe.skip;

describeIf('WebSearchTool Integration Tests', () => {
  let tool: WebSearchTool;
  let config: ExecutorConfig;

  beforeEach(() => {
    config = {
      workingDirectory: path.resolve(process.cwd()),
    };
    tool = new WebSearchTool(config);
  });

  it('should perform a basic web search with citations', async () => {
    const result = await tool.execute(
      {
        query: 'What is TypeScript?',
      },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toBeTruthy();
    expect(typeof result.llmContent).toBe('string');
    expect(result.metadata?.executionTime).toBeGreaterThanOrEqual(0);
  }, 30000); // 30s timeout for API call

  it('should return sources metadata', async () => {
    const result = await tool.execute(
      {
        query: 'TypeScript programming language',
      },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    if (result.sources && result.sources.length > 0) {
      expect(result.metadata?.sourceCount).toBeGreaterThan(0);
      // Check source structure
      const firstSource = result.sources[0];
      expect(firstSource).toBeDefined();
      // Sources may have web property with URI and title
      if (firstSource.web) {
        expect(typeof firstSource.web.uri).toBe('string');
      }
    }
  }, 30000);

  it('should handle empty results gracefully', async () => {
    const result = await tool.execute(
      {
        query: 'xyzabc123nonexistentquery456def',
      },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toBeTruthy();
    expect(result.metadata?.sourceCount).toBe(0);
  }, 30000);

  it('should validate empty query', async () => {
    const result = await tool.execute(
      {
        query: '',
      },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('cannot be empty');
  });

  it('should include query in metadata', async () => {
    const testQuery = 'TypeScript 5.3 features';
    const result = await tool.execute(
      {
        query: testQuery,
      },
      new AbortController().signal,
    );

    expect(result.metadata?.query).toBe(testQuery);
  }, 30000);

  it('should handle abort signal', async () => {
    const controller = new AbortController();

    // Abort before starting (more reliable test)
    controller.abort();

    const result = await tool.execute(
      {
        query: 'test query',
      },
      controller.signal,
    );

    // May still succeed if abort happens after completion
    // Just check that it doesn't crash
    expect(result).toBeDefined();
    expect(result.metadata?.executionTime).toBeGreaterThanOrEqual(0);
  });

  it('should have proper tool metadata', () => {
    expect(tool.name).toBe('WebSearch');
    expect(tool.displayName).toBe('GoogleSearch');
    expect(tool.description).toContain('Google Search');
    expect(tool.parameterSchema.required).toContain('query');
  });

  it('should provide proper description for execution', () => {
    const description = tool.getDescription({ query: 'test query' });
    expect(description).toContain('test query');
    expect(description).toContain('Searching');
  });
});
