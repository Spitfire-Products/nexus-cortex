import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { contextBoundaries } from '../../../../src/commands/context/boundaries.js';
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

describe('contextBoundaries command', () => {
  let mockGet: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockData = {
    boundaries: [
      { turn: 1, timestamp: '2025-01-14T10:00:00Z', tokensSaved: 5000 },
      { turn: 3, timestamp: '2025-01-14T11:00:00Z', tokensSaved: 8000 }
    ]
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
    test('should get context boundaries', async () => {
      await contextBoundaries('test-session', {});
      expect(mockGet).toHaveBeenCalledWith('/sessions/test-session/compaction/boundaries');
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    test('should output JSON format when requested', async () => {
      await contextBoundaries('test-session', { json: true });
      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed).toBeDefined();
      expect(parsed.boundaries).toHaveLength(2);
    });

    test('should use custom serverUrl when provided', async () => {
      await contextBoundaries('test-session', { serverUrl: 'http://custom:8080' });
      expect(CortexClient).toHaveBeenCalledWith('http://custom:8080');
    });

    test('should display boundaries information', async () => {
      await contextBoundaries('test-session', {});
      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.join('\n');
      expect(output).toContain('Boundaries');
    });
  });

  describe('Error cases', () => {
    test('should handle network error', async () => {
      mockGet.mockRejectedValue(new Error('Connection failed'));
      await contextBoundaries('test-session', {});
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should handle empty boundaries', async () => {
      mockGet.mockResolvedValue({ boundaries: [] });
      await contextBoundaries('test-session', {});
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    test('should handle server error', async () => {
      mockGet.mockRejectedValue(new Error('Server error: 500'));
      await contextBoundaries('test-session', {});
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
