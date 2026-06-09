/**
 * Integration tests for utilities
 * Tests ThemeManager and formatters working together in commands
 * Target: End-to-end validation of utility integration
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { ThemeManager } from '../../src/themes/ThemeManager.js';
import { formatDate, formatPrice, formatContextWindow } from '../../src/utils/formatters.js';
import { listModels } from '../../src/commands/models/list.js';
import { listSessions } from '../../src/commands/session/list.js';
import { OrchestratorClient } from '../../src/orchestrator/OrchestratorClient.js';

vi.mock('../../src/orchestrator/OrchestratorClient.js', () => ({
  OrchestratorClient: vi.fn()
}));

vi.mock('../../src/config/ConfigManager.js', () => {
  let mockServerUrl: string | undefined = undefined;
  return {
    ConfigManager: {
      get: vi.fn((key: string) => {
        if (key === 'serverUrl') return mockServerUrl;
        return undefined;
      }),
      load: vi.fn().mockResolvedValue({ serverUrl: 'http://localhost:4000' }),
      clearCache: vi.fn(() => { mockServerUrl = undefined; }),
      __setServerUrl: (url: string | undefined) => { mockServerUrl = url; },
    }
  };
});

import { ConfigManager } from '../../src/config/ConfigManager.js';

describe('Utilities Integration Tests', () => {
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    (ConfigManager as any).__setServerUrl?.(undefined);
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (ConfigManager as any).__setServerUrl?.(undefined);
  });

  describe('ConfigManager → Commands Integration', () => {
    test('should use ConfigManager serverUrl when no option provided', async () => {
      (ConfigManager.get as any).mockReturnValue('http://config-test:5000');

      const mockListModels = vi.fn().mockResolvedValue([
        {
          id: 'test-model',
          owned_by: 'test',
          contextWindow: 1000,
          inputCostPer1M: 1.0,
          outputCostPer1M: 2.0
        }
      ]);
      (OrchestratorClient as any).mockImplementation(() => ({
        initialize: vi.fn().mockResolvedValue(undefined),
        listModels: mockListModels
      }));

      await listModels({});

      expect(OrchestratorClient).toHaveBeenCalledWith(
        expect.objectContaining({ serverUrl: 'http://config-test:5000' })
      );
    });

    test('should override ConfigManager serverUrl with CLI option', async () => {
      (ConfigManager.get as any).mockReturnValue('http://config-test:5000');

      const mockListModels = vi.fn().mockResolvedValue([]);
      (OrchestratorClient as any).mockImplementation(() => ({
        initialize: vi.fn().mockResolvedValue(undefined),
        listModels: mockListModels
      }));

      await listModels({ serverUrl: 'http://override:6000' });

      expect(OrchestratorClient).toHaveBeenCalledWith(
        expect.objectContaining({ serverUrl: 'http://override:6000' })
      );
    });

    test('should use undefined serverUrl when ConfigManager returns nothing', async () => {
      (ConfigManager.get as any).mockReturnValue(undefined);

      const mockListModels = vi.fn().mockResolvedValue([]);
      (OrchestratorClient as any).mockImplementation(() => ({
        initialize: vi.fn().mockResolvedValue(undefined),
        listModels: mockListModels
      }));

      await listModels({});

      expect(OrchestratorClient).toHaveBeenCalledWith(
        expect.objectContaining({ serverUrl: undefined })
      );
    });

    test('should work across multiple commands with same ConfigManager', async () => {
      (ConfigManager.get as any).mockReturnValue('http://shared:7000');

      const mockInitialize = vi.fn().mockResolvedValue(undefined);
      const mockListModels = vi.fn().mockResolvedValue([]);
      const mockListSessions = vi.fn().mockResolvedValue({ sessions: [] });
      (OrchestratorClient as any).mockImplementation(() => ({
        initialize: mockInitialize,
        listModels: mockListModels,
        listSessions: mockListSessions
      }));

      await listModels({});
      await listSessions({});

      expect(OrchestratorClient).toHaveBeenCalledTimes(2);
      const firstCall = (OrchestratorClient as any).mock.calls[0][0];
      const secondCall = (OrchestratorClient as any).mock.calls[1][0];
      expect(firstCall.serverUrl).toBe('http://shared:7000');
      expect(secondCall.serverUrl).toBe('http://shared:7000');
    });
  });

  describe('ThemeManager → Commands Integration', () => {
    test('should use default theme when no config specified', async () => {
      const mockListModels = vi.fn().mockResolvedValue([
        {
          id: 'test-model',
          owned_by: 'test',
          contextWindow: 1000,
          inputCostPer1M: 1.0,
          outputCostPer1M: 2.0
        }
      ]);
      (OrchestratorClient as any).mockImplementation(() => ({
        initialize: vi.fn().mockResolvedValue(undefined),
        listModels: mockListModels
      }));

      await listModels({});

      const output = consoleLogSpy.mock.calls.map((c: any) => c.join(' ')).join('\n');
      expect(output).toContain('Available Models');
      expect(output).toContain('test-model');
    });

    test('should apply theme consistently across all command outputs', async () => {
      const mockListModels = vi.fn().mockResolvedValue([
        {
          id: 'claude-sonnet-4-5',
          owned_by: 'anthropic',
          contextWindow: 200000,
          inputCostPer1M: 3.0,
          outputCostPer1M: 15.0
        }
      ]);
      (OrchestratorClient as any).mockImplementation(() => ({
        initialize: vi.fn().mockResolvedValue(undefined),
        listModels: mockListModels
      }));

      await listModels({});

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));
      const output = calls.join('\n');

      expect(output).toContain('Available Models');
      expect(output).toContain('anthropic');
      expect(output).toContain('claude-sonnet-4-5');
      expect(output).toContain('ctx');
    });
  });

  describe('Formatters → Commands Integration', () => {
    test('should use formatContextWindow in models list command', async () => {
      const mockListModels = vi.fn().mockResolvedValue([
        {
          id: 'small-model',
          owned_by: 'test',
          contextWindow: 8000,
          inputCostPer1M: 1.0,
          outputCostPer1M: 2.0
        },
        {
          id: 'medium-model',
          owned_by: 'test',
          contextWindow: 128000,
          inputCostPer1M: 1.0,
          outputCostPer1M: 2.0
        },
        {
          id: 'large-model',
          owned_by: 'test',
          contextWindow: 1000000,
          inputCostPer1M: 1.0,
          outputCostPer1M: 2.0
        }
      ]);
      (OrchestratorClient as any).mockImplementation(() => ({
        initialize: vi.fn().mockResolvedValue(undefined),
        listModels: mockListModels
      }));

      await listModels({});

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('small-model') && c.includes('8K ctx'))).toBe(true);
      expect(calls.some((c: string) => c.includes('medium-model') && c.includes('128K ctx'))).toBe(true);
      expect(calls.some((c: string) => c.includes('large-model') && c.includes('1M ctx'))).toBe(true);
    });

    test('should use formatPrice consistently in models list command', async () => {
      const mockListModels = vi.fn().mockResolvedValue([
        {
          id: 'cheap-model',
          owned_by: 'test',
          contextWindow: 8000,
          inputCostPer1M: 0.075,
          outputCostPer1M: 0.15
        },
        {
          id: 'expensive-model',
          owned_by: 'test',
          contextWindow: 8000,
          inputCostPer1M: 15.0,
          outputCostPer1M: 75.0
        }
      ]);
      (OrchestratorClient as any).mockImplementation(() => ({
        initialize: vi.fn().mockResolvedValue(undefined),
        listModels: mockListModels
      }));

      await listModels({});

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('cheap-model') && c.includes('$0.07/$0.15'))).toBe(true);
      expect(calls.some((c: string) => c.includes('expensive-model') && c.includes('$15.00/$75.00'))).toBe(true);
    });

    test('should use formatDate in session list command', async () => {
      const testDate = new Date('2025-01-14T20:00:00Z');
      const mockListSessions = vi.fn().mockResolvedValue({
        sessions: [
          {
            sessionId: 'test-session-123',
            metadata: {
              startTime: testDate.toISOString()
            },
            messageCount: 10,
            fileSize: 1024
          }
        ]
      });
      (OrchestratorClient as any).mockImplementation(() => ({
        initialize: vi.fn().mockResolvedValue(undefined),
        listSessions: mockListSessions
      }));

      await listSessions({});

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));
      const sessionOutput = calls.find((c: string) => c.includes('Created:'));

      expect(sessionOutput).toBeTruthy();
      expect(sessionOutput).toContain('2025');
    });

    test('should handle edge cases in formatters', async () => {
      const mockListModels = vi.fn().mockResolvedValue([
        {
          id: 'edge-case-model',
          owned_by: 'test',
          contextWindow: 999,
          inputCostPer1M: 0.0,
          outputCostPer1M: 0.001
        }
      ]);
      (OrchestratorClient as any).mockImplementation(() => ({
        initialize: vi.fn().mockResolvedValue(undefined),
        listModels: mockListModels
      }));

      await listModels({});

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));
      const modelCall = calls.find((c: string) => c.includes('edge-case-model'));

      expect(modelCall).toBeTruthy();
      expect(modelCall).toContain('999 ctx');
      expect(modelCall).toContain('$0.00');
    });
  });

  describe('Full Integration: ConfigManager + Theme + Formatters', () => {
    test('should work together in complete command execution', async () => {
      (ConfigManager.get as any).mockReturnValue('http://full-test:8000');

      const mockListModels = vi.fn().mockResolvedValue([
        {
          id: 'claude-sonnet-4-5',
          owned_by: 'anthropic',
          contextWindow: 200000,
          inputCostPer1M: 3.0,
          outputCostPer1M: 15.0
        },
        {
          id: 'gpt-4o',
          owned_by: 'openai',
          contextWindow: 128000,
          inputCostPer1M: 2.5,
          outputCostPer1M: 10.0
        }
      ]);
      (OrchestratorClient as any).mockImplementation(() => ({
        initialize: vi.fn().mockResolvedValue(undefined),
        listModels: mockListModels
      }));

      await listModels({});

      expect(OrchestratorClient).toHaveBeenCalledWith(
        expect.objectContaining({ serverUrl: 'http://full-test:8000' })
      );

      const output = consoleLogSpy.mock.calls.map((c: any) => c.join(' ')).join('\n');
      expect(output).toContain('Available Models');
      expect(output).toContain('anthropic');
      expect(output).toContain('openai');

      expect(output).toContain('200K ctx');
      expect(output).toContain('128K ctx');
      expect(output).toContain('$3.00/$15.00');
      expect(output).toContain('$2.50/$10.00');

      expect(processExitSpy).not.toHaveBeenCalled();
    });

    test('should handle errors gracefully with all utilities', async () => {
      (ConfigManager.get as any).mockReturnValue('http://error-test:9000');

      const mockListModels = vi.fn().mockRejectedValue(new Error('Connection failed'));
      (OrchestratorClient as any).mockImplementation(() => ({
        initialize: vi.fn().mockResolvedValue(undefined),
        listModels: mockListModels
      }));

      await listModels({});

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorOutput = consoleErrorSpy.mock.calls.map((c: any) => c.join(' ')).join(' ');
      expect(errorOutput).toContain('Connection failed');

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('Cross-Command Consistency', () => {
    test('should use same ConfigManager across multiple commands', async () => {
      (ConfigManager.get as any).mockReturnValue('http://consistent:10000');

      const mockInitialize = vi.fn().mockResolvedValue(undefined);
      const mockListModels = vi.fn().mockResolvedValue([]);
      const mockListSessions = vi.fn().mockResolvedValue({ sessions: [] });
      (OrchestratorClient as any).mockImplementation(() => ({
        initialize: mockInitialize,
        listModels: mockListModels,
        listSessions: mockListSessions
      }));

      await listModels({});
      await listSessions({});

      expect(OrchestratorClient).toHaveBeenCalledTimes(2);
      const calls = (OrchestratorClient as any).mock.calls;
      expect(calls[0][0].serverUrl).toBe('http://consistent:10000');
      expect(calls[1][0].serverUrl).toBe('http://consistent:10000');
    });

    test('should maintain theme consistency across commands', async () => {
      const mockListModels = vi.fn().mockResolvedValue([
        {
          id: 'test-model',
          owned_by: 'test',
          contextWindow: 1000,
          inputCostPer1M: 1.0,
          outputCostPer1M: 2.0
        }
      ]);
      const mockListSessions = vi.fn().mockResolvedValue({
        sessions: [
          {
            sessionId: 'test-session',
            metadata: { startTime: new Date().toISOString() },
            messageCount: 1,
            fileSize: 100
          }
        ]
      });
      (OrchestratorClient as any).mockImplementation(() => ({
        initialize: vi.fn().mockResolvedValue(undefined),
        listModels: mockListModels,
        listSessions: mockListSessions
      }));

      consoleLogSpy.mockClear();
      await listModels({});
      const modelsOutput = consoleLogSpy.mock.calls.map((c: any) => c.join(' ')).join('\n');

      consoleLogSpy.mockClear();
      await listSessions({});
      const sessionsOutput = consoleLogSpy.mock.calls.map((c: any) => c.join(' ')).join('\n');

      expect(modelsOutput).toContain('test-model');
      expect(sessionsOutput).toContain('test-ses');
    });
  });
});
