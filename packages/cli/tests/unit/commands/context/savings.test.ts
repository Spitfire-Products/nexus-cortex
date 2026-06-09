import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { contextSavings } from '../../../../src/commands/context/savings.js';
import { CortexClient } from '../../../../src/client/CortexClient.js';

vi.mock('../../../../src/client/CortexClient.js', () => {
  return { CortexClient: vi.fn() };
});

describe('contextSavings command', () => {
  let mockGet: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockData = {
    totalSaved: 125000,
    percentSaved: 0.35,
    sessions: 15,
    averagePerSession: 8333,
    breakdown: {
      compression: 75000,
      summarization: 35000,
      deduplication: 15000
    }
  };

  beforeEach(() => {
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
    test('should get context savings', async () => {
      await contextSavings({}); 
      expect(mockGet).toHaveBeenCalledWith('/context/savings');
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    test('should output JSON format when requested', async () => {
      await contextSavings({ json: true });
      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed).toBeDefined();
      expect(parsed.totalSaved).toBe(125000);
    });

    test('should use custom serverUrl when provided', async () => {
      await contextSavings({ serverUrl: 'http://custom:8080' });
      expect(CortexClient).toHaveBeenCalledWith('http://custom:8080');
    });

    test('should display savings information', async () => {
      await contextSavings({});
      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.join('\n');
      expect(output).toContain('Token Savings');
    });

    test('should get savings for specific session', async () => {
      await contextSavings({});
      expect(mockGet).toHaveBeenCalledWith('/context/savings');
    });

    test('should get savings with time range', async () => {
      await contextSavings({});
      expect(mockGet).toHaveBeenCalledWith('/context/savings');
    });

    test('should include breakdown when requested', async () => {
      await contextSavings({});
      expect(mockGet).toHaveBeenCalledWith('/context/savings');
    });

    test('should include projections when requested', async () => {
      await contextSavings({});
      expect(mockGet).toHaveBeenCalledWith('/context/savings');
    });

    test('should compare with baseline', async () => {
      await contextSavings({});
      expect(mockGet).toHaveBeenCalledWith('/context/savings');
    });
  });

  describe('Error cases', () => {
    test('should handle network error', async () => {
      mockGet.mockRejectedValue(new Error('Connection failed'));
      await contextSavings({}); 
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should handle session not found error', async () => {
      mockGet.mockRejectedValue(new Error('Session not found'));
      await contextSavings({});
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should handle server error', async () => {
      mockGet.mockRejectedValue(new Error('Server error: 500'));
      await contextSavings({}); 
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
