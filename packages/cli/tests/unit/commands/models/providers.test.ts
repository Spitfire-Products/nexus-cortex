import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { modelsProviders } from '../../../../src/commands/models/providers.js';
import { CortexClient } from '../../../../src/client/CortexClient.js';

vi.mock('../../../../src/client/CortexClient.js', () => {
  return { CortexClient: vi.fn() };
});

describe('modelsProviders command', () => {
  let mockGet: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockData = {
    providers: [
      { name: 'anthropic', models: 5, status: 'active' },
      { name: 'openai', models: 8, status: 'active' },
      { name: 'google', models: 3, status: 'active' }
    ],
    total: 3
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
    test('should list all providers', async () => {
      await modelsProviders({});
      expect(mockGet).toHaveBeenCalledWith('/models/providers');
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    test('should output JSON format when requested', async () => {
      await modelsProviders({ json: true });
      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed).toBeDefined();
      expect(parsed.total).toBe(3);
    });

    test('should use custom serverUrl when provided', async () => {
      await modelsProviders({ serverUrl: 'http://custom:8080' });
      expect(CortexClient).toHaveBeenCalledWith('http://custom:8080');
    });

    test('should display provider information', async () => {
      await modelsProviders({});
      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.join('\n');
      expect(output).toContain('Providers');
    });
  });

  describe('Error cases', () => {
    test('should handle network error', async () => {
      mockGet.mockRejectedValue(new Error('Connection failed'));
      await modelsProviders({});
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should handle server error', async () => {
      mockGet.mockRejectedValue(new Error('Server error: 500'));
      await modelsProviders({});
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
