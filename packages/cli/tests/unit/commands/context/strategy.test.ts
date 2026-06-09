import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { contextStrategy } from '../../../../src/commands/context/strategy.js';
import { CortexClient } from '../../../../src/client/CortexClient.js';

vi.mock('../../../../src/client/CortexClient.js', () => {
  return { CortexClient: vi.fn() };
});

describe('contextStrategy command', () => {
  let mockGet: any;
  let mockPost: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockData = {
    currentStrategy: 'sliding-window',
    available: ['sliding-window', 'compression', 'summarization', 'hybrid'],
    settings: {
      windowSize: 10,
      compressionRatio: 0.7
    }
  };

  beforeEach(() => {
    mockGet = vi.fn().mockResolvedValue(mockData);
    mockPost = vi.fn().mockResolvedValue({ success: true, strategy: 'compression' });
    (CortexClient as any).mockImplementation(() => ({
      get: mockGet,
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
    test('should get current strategy', async () => {
      await contextStrategy(undefined, {});
      expect(mockGet).toHaveBeenCalledWith('/context/strategy');
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    test('should output JSON format when requested', async () => {
      await contextStrategy(undefined, { json: true });
      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed).toBeDefined();
      expect(parsed.currentStrategy).toBe('sliding-window');
    });

    test('should use custom serverUrl when provided', async () => {
      await contextStrategy(undefined, { serverUrl: 'http://custom:8080' });
      expect(CortexClient).toHaveBeenCalledWith('http://custom:8080');
    });

    test('should set new strategy', async () => {
      await contextStrategy('balanced', {});
      expect(mockPost).toHaveBeenCalledWith('/context/strategy', { strategy: 'balanced' });
    });

    test('should display strategy information', async () => {
      await contextStrategy(undefined, {});
      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.join('\n');
      expect(output).toContain('Strategy');
    });

    test('should set strategy with options', async () => {
      await contextStrategy('balanced', {});
      expect(mockPost).toHaveBeenCalledWith('/context/strategy', {
        strategy: 'balanced'
      });
    });

    test('should list available strategies', async () => {
      await contextStrategy(undefined, {});
      expect(mockGet).toHaveBeenCalledWith('/context/strategy');
    });

    test('should compare strategies when requested', async () => {
      await contextStrategy(undefined, {});
      expect(mockGet).toHaveBeenCalledWith('/context/strategy');
    });
  });

  describe('Error cases', () => {
    test('should handle network error', async () => {
      mockGet.mockRejectedValue(new Error('Connection failed'));
      await contextStrategy(undefined, {});
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should handle invalid strategy error', async () => {
      mockPost.mockRejectedValue(new Error('Invalid strategy'));
      await contextStrategy('invalid', {});
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should handle server error', async () => {
      mockGet.mockRejectedValue(new Error('Server error: 500'));
      await contextStrategy(undefined, {});
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
