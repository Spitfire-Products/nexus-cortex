/**
 * Unit tests for server/start command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { serverStart } from '../../../../src/commands/server/start.js';
import { CortexClient } from '../../../../src/client/CortexClient.js';

// Mock the CortexClient
vi.mock('../../../../src/client/CortexClient.js', () => {
  return {
    CortexClient: vi.fn()
  };
});

describe('serverStart command', () => {
  let mockHealth: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  beforeEach(() => {
    mockHealth = vi.fn();

    (CortexClient as any).mockImplementation(() => ({
      health: mockHealth
    }));

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('Server already running', () => {
    test('should detect when server is already running', async () => {
      mockHealth.mockResolvedValue({ status: 'ok' });

      await serverStart();

      expect(mockHealth).toHaveBeenCalledOnce();
      expect(consoleLogSpy).toHaveBeenCalled();
      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('already running'))).toBe(true);
    });

    test('should show server URL when already running', async () => {
      mockHealth.mockResolvedValue({ status: 'ok' });

      await serverStart({ serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('http://localhost:4000'))).toBe(true);
    });

    test('should not attempt to start if already running', async () => {
      mockHealth.mockResolvedValue({ status: 'ok' });

      await serverStart();

      // Should only check health, not show start instructions
      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('npm start'))).toBe(false);
    });
  });

  describe('Server not running', () => {
    test('should detect when server is not running', async () => {
      mockHealth.mockRejectedValue(new Error('Connection refused'));

      await serverStart();

      expect(mockHealth).toHaveBeenCalledOnce();
      expect(consoleLogSpy).toHaveBeenCalled();
      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('not running') || c.includes('starting'))).toBe(true);
    });

    test('should show manual start instructions', async () => {
      mockHealth.mockRejectedValue(new Error('Connection refused'));

      await serverStart();

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('not yet fully implemented'))).toBe(true);
      expect(calls.some(c => c.includes('npm start'))).toBe(true);
    });

    test('should mention OMNICLAUDE_SERVER_PATH', async () => {
      mockHealth.mockRejectedValue(new Error('Connection refused'));

      await serverStart();

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('OMNICLAUDE_SERVER_PATH'))).toBe(true);
    });
  });

  describe('Options', () => {
    test('should use custom server URL', async () => {
      mockHealth.mockResolvedValue({ status: 'ok' });

      await serverStart({ serverUrl: 'http://custom:5000' });

      expect(CortexClient).toHaveBeenCalledWith('http://custom:5000');
    });

    test('should accept port option', async () => {
      mockHealth.mockRejectedValue(new Error('Connection refused'));

      await serverStart({ port: 8080 });

      // Port option is accepted even if not used yet
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    test('should accept detach option', async () => {
      mockHealth.mockRejectedValue(new Error('Connection refused'));

      await serverStart({ detach: true });

      // Detach option is accepted even if not used yet
      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });

  describe('Error cases', () => {
    test('should handle unexpected errors during health check', async () => {
      // Mock health to reject with an error, then it shows instructions
      mockHealth.mockRejectedValue(new Error('Connection refused'));

      await serverStart();

      // Even with connection error, it shows manual start instructions
      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('not running') || c.includes('starting'))).toBe(true);
    });
  });
});
