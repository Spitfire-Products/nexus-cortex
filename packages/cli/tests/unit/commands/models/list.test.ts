/**
 * Unit tests for models/list command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { listModels } from '../../../../src/commands/models/list.js';
import { OrchestratorClient } from '../../../../src/orchestrator/OrchestratorClient.js';

vi.mock('../../../../src/orchestrator/OrchestratorClient.js', () => ({
  OrchestratorClient: vi.fn()
}));

vi.mock('../../../../src/config/ConfigManager.js', () => ({
  ConfigManager: {
    get: vi.fn().mockReturnValue(undefined),
    load: vi.fn().mockResolvedValue({ serverUrl: 'http://localhost:4000' }),
    clearCache: vi.fn()
  }
}));

describe('listModels command', () => {
  let mockInitialize: any;
  let mockListModels: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockModelsData = [
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
    },
    {
      id: 'gemini-2-5-flash',
      owned_by: 'google',
      contextWindow: 1000000,
      inputCostPer1M: 0.075,
      outputCostPer1M: 0.30
    },
    {
      id: 'deepseek-chat',
      owned_by: 'deepseek',
      contextWindow: 64000,
      inputCostPer1M: 0.14,
      outputCostPer1M: 0.28
    }
  ];

  beforeEach(() => {
    mockInitialize = vi.fn().mockResolvedValue(undefined);
    mockListModels = vi.fn().mockResolvedValue(mockModelsData);

    (OrchestratorClient as any).mockImplementation(() => ({
      initialize: mockInitialize,
      listModels: mockListModels
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
    test('should list all models with formatted output', async () => {
      await listModels({});

      expect(mockListModels).toHaveBeenCalledOnce();
      expect(consoleLogSpy).toHaveBeenCalled();

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));
      const headerCall = calls.find((c: string) => c.includes('Available Models'));
      expect(headerCall).toBeTruthy();
      expect(headerCall).toContain('4 total');

      expect(calls.some((c: string) => c.includes('anthropic'))).toBe(true);
      expect(calls.some((c: string) => c.includes('openai'))).toBe(true);
      expect(calls.some((c: string) => c.includes('google'))).toBe(true);
      expect(calls.some((c: string) => c.includes('deepseek'))).toBe(true);

      expect(calls.some((c: string) => c.includes('claude-sonnet-4-5'))).toBe(true);
      expect(calls.some((c: string) => c.includes('gpt-4o'))).toBe(true);
    });

    test('should list models with JSON output', async () => {
      await listModels({ json: true });

      expect(mockListModels).toHaveBeenCalledOnce();
      expect(consoleLogSpy).toHaveBeenCalledOnce();

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(4);
      expect(parsed[0]).toMatchObject({
        id: 'claude-sonnet-4-5',
        owned_by: 'anthropic'
      });
    });

    test('should filter models by provider (case insensitive)', async () => {
      await listModels({ provider: 'Anthropic' });

      expect(mockListModels).toHaveBeenCalledOnce();

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      const headerCall = calls.find((c: string) => c.includes('Available Models'));
      expect(headerCall).toContain('1 total');

      expect(calls.some((c: string) => c.includes('claude-sonnet-4-5'))).toBe(true);

      expect(calls.some((c: string) => c.includes('gpt-4o'))).toBe(false);
      expect(calls.some((c: string) => c.includes('gemini-2-5-flash'))).toBe(false);
    });

    test('should filter models by provider with JSON output', async () => {
      await listModels({ provider: 'openai', json: true });

      expect(mockListModels).toHaveBeenCalledOnce();

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('gpt-4o');
      expect(parsed[0].owned_by).toBe('openai');
    });

    test('should use custom serverUrl when provided', async () => {
      await listModels({ serverUrl: 'http://custom:8080' });

      expect(OrchestratorClient).toHaveBeenCalledWith(
        expect.objectContaining({ serverUrl: 'http://custom:8080' })
      );
      expect(mockListModels).toHaveBeenCalledOnce();
    });

    test('should handle provider filter with no matches', async () => {
      await listModels({ provider: 'nonexistent' });

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));
      const headerCall = calls.find((c: string) => c.includes('Available Models'));
      expect(headerCall).toContain('0 total');
    });

    test('should group multiple models by same provider', async () => {
      mockListModels.mockResolvedValue([
        {
          id: 'claude-sonnet-4-5',
          owned_by: 'anthropic',
          contextWindow: 200000,
          inputCostPer1M: 3.0,
          outputCostPer1M: 15.0
        },
        {
          id: 'claude-opus-4-1',
          owned_by: 'anthropic',
          contextWindow: 200000,
          inputCostPer1M: 15.0,
          outputCostPer1M: 75.0
        }
      ]);

      await listModels({});

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      const anthropicHeader = calls.find((c: string) => c.includes('anthropic') && c.includes('2 models'));
      expect(anthropicHeader).toBeTruthy();

      expect(calls.some((c: string) => c.includes('claude-sonnet-4-5'))).toBe(true);
      expect(calls.some((c: string) => c.includes('claude-opus-4-1'))).toBe(true);
    });

    test('should format context window in thousands (K)', async () => {
      await listModels({});

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      const claudeCall = calls.find((c: string) => c.includes('claude-sonnet-4-5'));
      expect(claudeCall).toContain('200K ctx');

      const geminiCall = calls.find((c: string) => c.includes('gemini-2-5-flash'));
      expect(geminiCall).toContain('1M ctx');
    });

    test('should display input and output costs', async () => {
      await listModels({});

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      const claudeCall = calls.find((c: string) => c.includes('claude-sonnet-4-5'));
      expect(claudeCall).toContain('$3.00/$15.00');

      const geminiCall = calls.find((c: string) => c.includes('gemini-2-5-flash'));
      expect(geminiCall).toContain('$0.07/$0.30');
    });
  });

  describe('Error cases', () => {
    test('should handle network error', async () => {
      mockListModels.mockRejectedValue(new Error('Network timeout'));

      await listModels({});

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.anything(),
        'Network timeout'
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should handle API error', async () => {
      mockListModels.mockRejectedValue(new Error('Unauthorized'));

      await listModels({});

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.anything(),
        'Unauthorized'
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should handle empty error message', async () => {
      mockListModels.mockRejectedValue(new Error());

      await listModels({});

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
