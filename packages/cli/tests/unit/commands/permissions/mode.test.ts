/**
 * Unit tests for permissions/mode command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { permissionsMode } from '../../../../src/commands/permissions/mode.js';
import { CortexClient } from '../../../../src/client/CortexClient.js';

// Mock the CortexClient
vi.mock('../../../../src/client/CortexClient.js', () => {
  return {
    CortexClient: vi.fn()
  };
});

describe('permissionsMode command', () => {
  let mockGetApprovalMode: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockApprovalModeInteractive = {
    autoApproveActions: false,
    yoloMode: false,
    context: 'interactive mode'
  };

  const mockApprovalModeAuto = {
    autoApproveActions: true,
    yoloMode: true,
    context: 'yolo mode active'
  };

  beforeEach(() => {
    mockGetApprovalMode = vi.fn().mockResolvedValue(mockApprovalModeInteractive);

    (CortexClient as any).mockImplementation(() => ({
      getApprovalMode: mockGetApprovalMode
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
    test('should display interactive mode', async () => {
      await permissionsMode({});

      expect(mockGetApprovalMode).toHaveBeenCalledOnce();
      expect(consoleLogSpy).toHaveBeenCalled();

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Current Permission Mode'))).toBe(true);
      expect(calls.some(c => c.includes('Auto-Approve Actions'))).toBe(true);
    });

    test('should display auto mode with warning', async () => {
      mockGetApprovalMode.mockResolvedValue(mockApprovalModeAuto);

      await permissionsMode({});

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('YOLO Mode active'))).toBe(true);
    });

    test('should output JSON format when requested', async () => {
      await permissionsMode({ json: true });

      expect(mockGetApprovalMode).toHaveBeenCalledOnce();
      expect(consoleLogSpy).toHaveBeenCalledOnce();

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed).toEqual(mockApprovalModeInteractive);
    });

    test('should use custom server URL', async () => {
      await permissionsMode({ serverUrl: 'http://custom:5000' });

      expect(CortexClient).toHaveBeenCalledWith('http://custom:5000');
    });
  });

  describe('Error cases', () => {
    test('should handle API errors', async () => {
      mockGetApprovalMode.mockRejectedValue(new Error('Connection failed'));

      await permissionsMode({});

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
