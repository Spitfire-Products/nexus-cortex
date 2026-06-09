/**
 * Unit tests for models/info command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { modelInfo } from '../../../../src/commands/models/info.js';
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

describe('modelInfo command', () => {
  let mockInitialize: any;
  let mockListModels: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockModels = [
    {
      id: 'claude-sonnet-4-5',
      object: 'model',
      owned_by: 'anthropic',
      displayName: 'Claude Sonnet 4.5',
      apiPattern: 'messages',
      contextWindow: 200000,
      maxOutputTokens: 8192,
      inputCostPer1M: 3.00,
      outputCostPer1M: 15.00
    },
    {
      id: 'gpt-4o',
      object: 'model',
      owned_by: 'openai',
      displayName: 'GPT-4o',
      apiPattern: 'chat/completions',
      contextWindow: 128000,
      maxOutputTokens: 16384,
      inputCostPer1M: 2.50,
      outputCostPer1M: 10.00
    },
    {
      id: 'gemini-2-5-flash',
      object: 'model',
      owned_by: 'google',
      displayName: 'Gemini 2.5 Flash',
      apiPattern: 'generateContent',
      contextWindow: 1000000,
      maxOutputTokens: 8192,
      inputCostPer1M: 0.075,
      outputCostPer1M: 0.30
    }
  ];

  beforeEach(() => {
    mockInitialize = vi.fn().mockResolvedValue(undefined);
    mockListModels = vi.fn().mockResolvedValue(mockModels);

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
    test('should display model info for valid model ID', async () => {
      await modelInfo('claude-sonnet-4-5');

      expect(mockListModels).toHaveBeenCalledOnce();
      expect(consoleLogSpy).toHaveBeenCalled();

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));
      expect(calls.some((c: string) => c.includes('Claude Sonnet 4.5'))).toBe(true);
      expect(calls.some((c: string) => c.includes('claude-sonnet-4-5'))).toBe(true);
      expect(calls.some((c: string) => c.includes('anthropic'))).toBe(true);
    });

    test('should show context window info', async () => {
      await modelInfo('gemini-2-5-flash');

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));
      expect(calls.some((c: string) => c.includes('Context Window'))).toBe(true);
      expect(calls.some((c: string) => c.includes('1M') || c.includes('1.0M'))).toBe(true);
    });

    test('should show pricing information', async () => {
      await modelInfo('gpt-4o');

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));
      expect(calls.some((c: string) => c.includes('Pricing'))).toBe(true);
      expect(calls.some((c: string) => c.includes('Input'))).toBe(true);
      expect(calls.some((c: string) => c.includes('Output'))).toBe(true);
    });

    test('should output JSON when requested', async () => {
      await modelInfo('claude-sonnet-4-5', { json: true });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.id).toBe('claude-sonnet-4-5');
      expect(parsed.displayName).toBe('Claude Sonnet 4.5');
    });

    test('should use custom server URL', async () => {
      await modelInfo('claude-sonnet-4-5', { serverUrl: 'http://custom:5000' });

      expect(OrchestratorClient).toHaveBeenCalledWith(
        expect.objectContaining({ serverUrl: 'http://custom:5000' })
      );
    });
  });

  describe('Error cases', () => {
    test('should error when model not found', async () => {
      await modelInfo('nonexistent-model');

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
      const calls = consoleErrorSpy.mock.calls.map((c: any) => c.join(' '));
      expect(calls.some((c: string) => c.includes('Model not found'))).toBe(true);
    });

    test('should show helpful message when model not found', async () => {
      await modelInfo('invalid-id');

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));
      expect(calls.some((c: string) => c.includes('cortex models list'))).toBe(true);
    });

    test('should handle API errors', async () => {
      mockListModels.mockRejectedValue(new Error('Connection failed'));

      await modelInfo('claude-sonnet-4-5');

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should handle empty model list', async () => {
      mockListModels.mockResolvedValue([]);

      await modelInfo('claude-sonnet-4-5');

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
