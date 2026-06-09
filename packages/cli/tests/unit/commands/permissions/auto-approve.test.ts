/**
 * Unit tests for permissions/auto-approve command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { permissionsAutoApprove } from '../../../../src/commands/permissions/auto-approve.js';
import { CortexClient } from '../../../../src/client/CortexClient.js';

// Mock the CortexClient
vi.mock('../../../../src/client/CortexClient.js', () => {
  return {
    CortexClient: vi.fn()
  };
});

describe('permissionsAutoApprove command', () => {
  let mockGetApprovalMode: any;
  let mockSetApprovalMode: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockCurrentModeDisabled = {
    autoApproveActions: false,
    yoloMode: false,
    context: 'interactive'
  };

  const mockCurrentModeEnabled = {
    autoApproveActions: true,
    yoloMode: true,
    context: 'auto'
  };

  const mockSuccessResponse = {
    success: true,
    autoApproveActions: true,
    message: 'Auto-approve updated'
  };

  beforeEach(() => {
    mockGetApprovalMode = vi.fn().mockResolvedValue(mockCurrentModeDisabled);
    mockSetApprovalMode = vi.fn().mockResolvedValue(mockSuccessResponse);

    (CortexClient as any).mockImplementation(() => ({
      getApprovalMode: mockGetApprovalMode,
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
    test('should toggle from disabled to enabled', async () => {
      await permissionsAutoApprove({});

      expect(mockGetApprovalMode).toHaveBeenCalledOnce();
      expect(mockSetApprovalMode).toHaveBeenCalledWith(true);

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('enabled'))).toBe(true);
    });

    test('should toggle from enabled to disabled', async () => {
      mockGetApprovalMode.mockResolvedValue(mockCurrentModeEnabled);

      await permissionsAutoApprove({});

      expect(mockSetApprovalMode).toHaveBeenCalledWith(false);

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('disabled'))).toBe(true);
    });

    test('should enable when --enable flag provided', async () => {
      await permissionsAutoApprove({ enable: true });

      expect(mockSetApprovalMode).toHaveBeenCalledWith(true);
    });

    test('should disable when --disable flag provided', async () => {
      await permissionsAutoApprove({ disable: true });

      expect(mockSetApprovalMode).toHaveBeenCalledWith(false);
    });

    test('should use custom server URL', async () => {
      await permissionsAutoApprove({ serverUrl: 'http://custom:5000' });

      expect(CortexClient).toHaveBeenCalledWith('http://custom:5000');
    });
  });

  describe('Error cases', () => {
    test('should handle API errors', async () => {
      mockGetApprovalMode.mockRejectedValue(new Error('Connection failed'));

      await permissionsAutoApprove({});

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
