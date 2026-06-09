/**
 * Test helper utilities
 */

import { vi } from 'vitest';

/**
 * Create a mock console for testing console output
 */
export function mockConsole() {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  const logs: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  console.log = vi.fn((...args) => {
    logs.push(args.map(a => String(a)).join(' '));
  });

  console.error = vi.fn((...args) => {
    errors.push(args.map(a => String(a)).join(' '));
  });

  console.warn = vi.fn((...args) => {
    warnings.push(args.map(a => String(a)).join(' '));
  });

  return {
    logs,
    errors,
    warnings,
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
    }
  };
}

/**
 * Create a mock process.stdout for testing stream output
 */
export function mockStdout() {
  const originalWrite = process.stdout.write;
  const chunks: string[] = [];

  process.stdout.write = vi.fn((chunk: any) => {
    chunks.push(String(chunk));
    return true;
  }) as any;

  return {
    chunks,
    getOutput: () => chunks.join(''),
    restore: () => {
      process.stdout.write = originalWrite;
    }
  };
}

/**
 * Create a mock HTTP server response
 */
export function mockFetchResponse(data: any, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: new Map([['content-type', 'application/json']])
  };
}

/**
 * Create a mock SSE stream
 */
export function* mockSSEStream(chunks: any[]) {
  for (const chunk of chunks) {
    yield `data: ${JSON.stringify(chunk)}\n\n`;
  }
  yield 'data: [DONE]\n\n';
}

/**
 * Mock fetch for HTTP requests
 */
export function mockFetch(responses: Map<string, any>) {
  return vi.fn(async (url: string, options?: any) => {
    const key = `${options?.method || 'GET'} ${url}`;
    const response = responses.get(key);

    if (!response) {
      throw new Error(`No mock response for ${key}`);
    }

    if (typeof response === 'function') {
      return response(url, options);
    }

    return mockFetchResponse(response);
  });
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  throw new Error(`Timeout waiting for condition after ${timeout}ms`);
}

/**
 * Create a temporary directory for tests
 */
export function createTempDir(): string {
  const os = require('os');
  const path = require('path');
  const fs = require('fs');

  const tempDir = path.join(os.tmpdir(), `cortex-test-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  return tempDir;
}

/**
 * Clean up temporary directory
 */
export function cleanupTempDir(dir: string): void {
  const fs = require('fs');

  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Assert that a string contains all given substrings
 */
export function assertContains(str: string, ...substrings: string[]): void {
  for (const substring of substrings) {
    if (!str.includes(substring)) {
      throw new Error(`String does not contain "${substring}"`);
    }
  }
}

/**
 * Assert that a string does not contain any given substrings
 */
export function assertNotContains(str: string, ...substrings: string[]): void {
  for (const substring of substrings) {
    if (str.includes(substring)) {
      throw new Error(`String should not contain "${substring}"`);
    }
  }
}

/**
 * Delay for testing
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
