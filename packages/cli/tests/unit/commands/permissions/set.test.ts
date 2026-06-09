/**
 * Unit tests for permissions/set command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { permissionsSet } from '../../../../src/commands/permissions/set.js';
import { CortexClient } from '../../../../src/client/CortexClient.js';

// Mock the CortexClient
vi.mock('../../../../src/client/CortexClient.js', () => {
  return {
    CortexClient: vi.fn()
  };
});

describe('permissionsSet command', () => {
  let mockSetApprovalMode: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockSuccessResponse = {
    success: true,
    autoApproveActions: false,
    message: 'Permission mode updated'
  };

  beforeEach(() => {
    mockSetApprovalMode = vi.fn().mockResolvedValue(mockSuccessResponse);

    (CortexClient as any).mockImplementation(() => ({
      setApprovalMode: mockSetApprovalMode
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
    test('should set interactive mode', async () => {
      await permissionsSet('interactive', {});

      expect(mockSetApprovalMode).toHaveBeenCalledWith(false);
      expect(consoleLogSpy).toHaveBeenCalled();

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('interactive'))).toBe(true);
    });

    test('should set auto mode with warning', async () => {
      await permissionsSet('auto', {});

      expect(mockSetApprovalMode).toHaveBeenCalledWith(true);

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('auto-approved'))).toBe(true);
    });

    test('should set disabled mode', async () => {
      await permissionsSet('disabled', {});

      expect(mockSetApprovalMode).toHaveBeenCalledWith(true);

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('disabled'))).toBe(true);
    });

    test('should use custom server URL', async () => {
      await permissionsSet('interactive', { serverUrl: 'http://custom:5000' });

      expect(CortexClient).toHaveBeenCalledWith('http://custom:5000');
    });
  });

  describe('Error cases', () => {
    test('should reject invalid mode', async () => {
      await permissionsSet('invalid' as any, {});

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);

      const calls = consoleErrorSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Invalid mode'))).toBe(true);
    });

    test('should handle API errors', async () => {
      mockSetApprovalMode.mockRejectedValue(new Error('Connection failed'));

      await permissionsSet('interactive', {});

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
