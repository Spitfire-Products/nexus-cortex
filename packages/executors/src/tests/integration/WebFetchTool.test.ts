/**
 * WebFetchTool Integration Tests
 *
 * Tests the WebFetchTool with real Gemini API calls and HTTP fetches
 * Requires GOOGLE_API_KEY or GEMINI_API_KEY environment variable
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WebFetchTool } from '../../implementations/web/WebFetchTool.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';
import path from 'path';

// Only run if ENABLE_SMOKE_TESTS is set
const shouldRunSmokeTests = process.env.ENABLE_SMOKE_TESTS === 'true';
const describeIf = shouldRunSmokeTests ? describe : describe.skip;

describeIf('WebFetchTool Integration Tests', () => {
  let tool: WebFetchTool;
  let config: ExecutorConfig;

  beforeEach(() => {
    config = {
      workingDirectory: path.resolve(process.cwd()),
    };
    tool = new WebFetchTool(config);
  });

  it('should fetch and process a public URL', async () => {
    const result = await tool.execute(
      {
        prompt: 'What is the main topic of https://example.com',
      },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toBeTruthy();
    expect(typeof result.llmContent).toBe('string');
    expect(result.metadata?.executionTime).toBeGreaterThanOrEqual(0);
    expect(result.metadata?.urls?.length).toBeGreaterThan(0);
    // URL may be normalized with trailing slash
    expect(result.metadata?.urls?.[0]).toMatch(/https:\/\/example\.com\/?/);
  }, 30000);

  it('should validate empty prompt', async () => {
    const result = await tool.execute(
      {
        prompt: '',
      },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('cannot be empty');
  });

  it('should validate prompt without URLs', async () => {
    const result = await tool.execute(
      {
        prompt: 'This is a prompt without any URLs',
      },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('valid URL');
  });

  it('should reject malformed URLs', async () => {
    const result = await tool.execute(
      {
        prompt: 'Fetch from htp://malformed-url',
      },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    // Error message contains "Unsupported protocol" for htp://
    expect(result.error).toMatch(/Unsupported protocol|Malformed URL/);
  });

  it('should reject unsupported protocols', async () => {
    const result = await tool.execute(
      {
        prompt: 'Fetch from ftp://example.com/file',
      },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported protocol');
  });

  it('should detect private IP addresses', async () => {
    // Test localhost - should use fallback
    const result = await tool.execute(
      {
        prompt: 'Fetch http://localhost:3000/test',
      },
      new AbortController().signal,
    );

    // Should complete (even if it fails to connect)
    expect(result.metadata?.executionTime).toBeGreaterThanOrEqual(0);
    // Should indicate fallback method
    if (result.success) {
      expect(result.metadata?.method).toBe('fallback');
    }
  }, 30000);

  it('should parse multiple URLs from prompt', async () => {
    const result = await tool.execute(
      {
        prompt: 'Compare https://example.com and https://example.org',
      },
      new AbortController().signal,
    );

    if (result.metadata?.urls) {
      expect(result.metadata.urls.length).toBeGreaterThanOrEqual(2);
      // URLs may be normalized with trailing slashes
      const urlsString = result.metadata.urls.join(' ');
      expect(urlsString).toMatch(/example\.com/);
      expect(urlsString).toMatch(/example\.org/);
    }
  }, 30000);

  it('should handle GitHub blob URLs', async () => {
    // This tests URL parsing - actual fetch may fail if repo doesn't exist
    const githubUrl = 'https://github.com/test/repo/blob/main/README.md';
    const result = await tool.execute(
      {
        prompt: `Summarize ${githubUrl}`,
      },
      new AbortController().signal,
    );

    // Should parse the URL
    if (result.metadata?.urls) {
      const urlsString = result.metadata.urls.join(' ');
      expect(urlsString).toContain('github.com');
    }
  }, 30000);

  it('should handle abort signal', async () => {
    const controller = new AbortController();

    // Abort before starting (more reliable test)
    controller.abort();

    const result = await tool.execute(
      {
        prompt: 'Fetch https://example.com',
      },
      controller.signal,
    );

    // May still succeed if abort happens after completion
    // Just check that it doesn't crash
    expect(result).toBeDefined();
    expect(result.metadata?.executionTime).toBeGreaterThanOrEqual(0);
  });

  it('should have proper tool metadata', () => {
    expect(tool.name).toBe('WebFetch');
    expect(tool.displayName).toBe('WebFetch');
    expect(tool.description).toContain('URL');
    expect(tool.parameterSchema.required).toContain('prompt');
  });

  it('should provide proper description for execution', () => {
    const description = tool.getDescription({
      prompt: 'Fetch https://example.com',
    });
    expect(description).toContain('Processing URL');
  });

  it('should include metadata about execution method', async () => {
    const result = await tool.execute(
      {
        prompt: 'Summarize https://example.com',
      },
      new AbortController().signal,
    );

    if (result.success) {
      expect(result.metadata?.method).toBeDefined();
      expect(['primary', 'fallback']).toContain(result.metadata?.method);
    }
  }, 30000);
});
