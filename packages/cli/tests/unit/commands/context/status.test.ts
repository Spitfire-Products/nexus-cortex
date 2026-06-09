import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { contextStatus } from '../../../../src/commands/context/status.js';
import { CortexClient } from '../../../../src/client/CortexClient.js';

vi.mock('../../../../src/client/CortexClient.js', () => ({
  CortexClient: vi.fn()
}));

vi.mock('../../../../src/config/ConfigManager.js', () => ({
  ConfigManager: {
    load: vi.fn().mockResolvedValue({ serverUrl: 'http://localhost:4000' }),
    get: vi.fn().mockReturnValue(undefined),
    clearCache: vi.fn()
  }
}));

import { ConfigManager } from '../../../../src/config/ConfigManager.js';

describe('contextStatus command', () => {
  let mockGet: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockData = {
    model: {
      name: 'Test Model',
      id: 'test-model',
      contextWindow: 200000
    },
    budget: {
      maxTokens: 200000,
      reservedForOutput: 8192,
      availableForInput: 191808,
      systemMessageAllocation: 5000
    },
    usage: {
      estimatedTokens: 45000,
      utilization: 22.5,
      remaining: 146808
    }
  };

  beforeEach(() => {
    (ConfigManager.load as any).mockResolvedValue({ serverUrl: 'http://localhost:4000' });
    mockGet = vi.fn().mockResolvedValue(mockData);
    (CortexClient as any).mockImplementation(() => ({
      get: mockGet
    }));

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('Success cases', () => {
    test('should get context status', async () => {
      await contextStatus('test-session', {});
      expect(mockGet).toHaveBeenCalledWith('/sessions/test-session/context');
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    test('should output JSON format when requested', async () => {
      await contextStatus('test-session', { json: true });
      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed).toBeDefined();
      expect(parsed.model.id).toBe('test-model');
    });

    test('should use custom serverUrl when provided', async () => {
      await contextStatus('test-session', { serverUrl: 'http://custom:8080' });
      expect(CortexClient).toHaveBeenCalledWith('http://custom:8080');
    });

    test('should display context status', async () => {
      await contextStatus('test-session', {});
      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.join('\n');
      expect(output).toContain('Context');
    });
  });

  describe('Error cases', () => {
    test('should handle network error', async () => {
      mockGet.mockRejectedValue(new Error('Connection failed'));
      await contextStatus('test-session', {});
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should handle empty context data', async () => {
      mockGet.mockResolvedValue({
        model: { name: 'Test', id: 'test', contextWindow: 200000 },
        budget: { maxTokens: 200000, reservedForOutput: 0, availableForInput: 200000, systemMessageAllocation: 0 },
        usage: { estimatedTokens: 0, utilization: 0, remaining: 200000 }
      });
      await contextStatus('test-session', {});
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    test('should handle server error', async () => {
      mockGet.mockRejectedValue(new Error('Server error: 500'));
      await contextStatus('test-session', {});
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
