/**
 * Mock CortexClient for testing
 */

import { vi } from 'vitest';
import {
  mockModels,
  mockModelInfo,
  mockSessions,
  mockSessionDetails,
  mockMcpServers,
  mockMcpStatus,
  mockHealthResponse,
  mockApprovalMode,
  mockMessageResponse,
  mockStreamChunks
} from '../fixtures/mockResponses';

/**
 * Create a mock CortexClient with configurable responses
 */
export function createMockClient(overrides: Partial<any> = {}) {
  return {
    // Message methods
    sendMessage: vi.fn(async () => overrides.sendMessage || mockMessageResponse),

    streamMessage: vi.fn(async function* () {
      const chunks = overrides.streamChunks || mockStreamChunks;
      for (const chunk of chunks) {
        yield chunk;
      }
    }),

    // Model methods
    listModels: vi.fn(async () => overrides.listModels || mockModels),
    getModelInfo: vi.fn(async (id: string) =>
      overrides.getModelInfo || mockModelInfo
    ),

    // Session methods
    listSessions: vi.fn(async () => overrides.listSessions || mockSessions),
    getSession: vi.fn(async (id: string) =>
      overrides.getSession || mockSessionDetails
    ),
    exportSession: vi.fn(async (id: string, format: string) => ({
      data: `Exported session ${id} as ${format}`,
      format
    })),

    // MCP methods
    listMcpServers: vi.fn(async () => overrides.listMcpServers || mockMcpServers),
    getMcpStatus: vi.fn(async () => overrides.getMcpStatus || mockMcpStatus),
    enableMcpServer: vi.fn(async (name: string, options?: any) => ({
      success: true,
      server: name,
      message: `Enabled ${name}`
    })),
    disableMcpServer: vi.fn(async (name: string) => ({
      success: true,
      server: name,
      message: `Disabled ${name}`
    })),

    // Health methods
    health: vi.fn(async () => overrides.health || mockHealthResponse),

    // Permission methods
    getApprovalMode: vi.fn(async () => overrides.getApprovalMode || mockApprovalMode),
    setApprovalMode: vi.fn(async (mode: string) => ({
      mode,
      success: true
    })),

    // Generic HTTP methods
    get: vi.fn(async (path: string) => {
      if (path.includes('/models')) return mockModels;
      if (path.includes('/sessions')) return mockSessions;
      if (path.includes('/health')) return mockHealthResponse;
      return {};
    }),

    post: vi.fn(async (path: string, body: any) => {
      if (path.includes('/messages')) return mockMessageResponse;
      return { success: true };
    }),

    ...overrides
  };
}

/**
 * Create a mock client that throws errors
 */
export function createErrorClient(errorMessage = 'Mock error') {
  const error = new Error(errorMessage);

  return {
    sendMessage: vi.fn(async () => { throw error; }),
    streamMessage: vi.fn(async function* () { throw error; }),
    listModels: vi.fn(async () => { throw error; }),
    getModelInfo: vi.fn(async () => { throw error; }),
    listSessions: vi.fn(async () => { throw error; }),
    getSession: vi.fn(async () => { throw error; }),
    exportSession: vi.fn(async () => { throw error; }),
    listMcpServers: vi.fn(async () => { throw error; }),
    getMcpStatus: vi.fn(async () => { throw error; }),
    enableMcpServer: vi.fn(async () => { throw error; }),
    disableMcpServer: vi.fn(async () => { throw error; }),
    health: vi.fn(async () => { throw error; }),
    getApprovalMode: vi.fn(async () => { throw error; }),
    setApprovalMode: vi.fn(async () => { throw error; }),
    get: vi.fn(async () => { throw error; }),
    post: vi.fn(async () => { throw error; })
  };
}

/**
 * Create a mock client with network timeout
 */
export function createTimeoutClient(timeoutMs = 5000) {
  const timeout = () => new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
  );

  return {
    sendMessage: vi.fn(async () => timeout()),
    streamMessage: vi.fn(async function* () { await timeout(); }),
    listModels: vi.fn(async () => timeout()),
    getModelInfo: vi.fn(async () => timeout()),
    listSessions: vi.fn(async () => timeout()),
    getSession: vi.fn(async () => timeout()),
    exportSession: vi.fn(async () => timeout()),
    listMcpServers: vi.fn(async () => timeout()),
    getMcpStatus: vi.fn(async () => timeout()),
    enableMcpServer: vi.fn(async () => timeout()),
    disableMcpServer: vi.fn(async () => timeout()),
    health: vi.fn(async () => timeout()),
    getApprovalMode: vi.fn(async () => timeout()),
    setApprovalMode: vi.fn(async () => timeout()),
    get: vi.fn(async () => timeout()),
    post: vi.fn(async () => timeout())
  };
}
