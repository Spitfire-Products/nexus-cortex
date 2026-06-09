import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { contextCompact } from '../../../../src/commands/context/compact.js';
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

describe('contextCompact command', () => {
  let mockPost: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockData = {
    success: true,
    tokensBefore: 85000,
    tokensAfter: 60000,
    saved: 25000,
    compressionRatio: 0.706
  };

  beforeEach(() => {
    (ConfigManager.load as any).mockResolvedValue({ serverUrl: 'http://localhost:4000' });
    mockPost = vi.fn().mockResolvedValue(mockData);
    (CortexClient as any).mockImplementation(() => ({
      post: mockPost
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
    test('should compact context', async () => {
      await contextCompact('test-session', {});
      expect(mockPost).toHaveBeenCalledWith('/sessions/test-session/compaction', {});
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    test('should output JSON format when requested', async () => {
      await contextCompact('test-session', { json: true });
      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed).toBeDefined();
      expect(parsed.success).toBe(true);
    });

    test('should use custom serverUrl when provided', async () => {
      await contextCompact('test-session', { serverUrl: 'http://custom:8080' });
      expect(CortexClient).toHaveBeenCalledWith('http://custom:8080');
    });

    test('should display compaction results', async () => {
      await contextCompact('test-session', {});
      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.join('\n');
      expect(output).toContain('Compaction');
    });
  });

  describe('Error cases', () => {
    test('should handle network error', async () => {
      mockPost.mockRejectedValue(new Error('Connection failed'));
      await contextCompact('test-session', {});
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should handle nothing to compact error', async () => {
      mockPost.mockRejectedValue(new Error('Nothing to compact'));
      await contextCompact('test-session', {});
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should handle server error', async () => {
      mockPost.mockRejectedValue(new Error('Server error: 500'));
      await contextCompact('test-session', {});
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
