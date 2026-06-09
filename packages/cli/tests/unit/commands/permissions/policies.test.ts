import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { permissionsPolicies } from '../../../../src/commands/permissions/policies.js';
import { OrchestratorClient } from '../../../../src/orchestrator/OrchestratorClient.js';

vi.mock('../../../../src/orchestrator/OrchestratorClient.js', () => ({
  OrchestratorClient: vi.fn()
}));

vi.mock('../../../../src/config/ConfigManager.js', () => ({
  ConfigManager: {
    load: vi.fn().mockResolvedValue({ serverUrl: 'http://localhost:4000' }),
    get: vi.fn().mockReturnValue(undefined),
    clearCache: vi.fn()
  }
}));

import { ConfigManager } from '../../../../src/config/ConfigManager.js';

describe('permissionsPolicies command', () => {
  let mockGetPolicies: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockPolicies = [
    { id: 'policy-1', name: 'default', priority: 1, enabled: true },
    { id: 'policy-2', name: 'strict', priority: 2, enabled: false }
  ];

  beforeEach(() => {
    (ConfigManager.load as any).mockResolvedValue({ serverUrl: 'http://localhost:4000' });
    mockGetPolicies = vi.fn().mockResolvedValue(mockPolicies);
    (OrchestratorClient as any).mockImplementation(() => ({
      getPolicies: mockGetPolicies
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
    test('should list all permission policies', async () => {
      await permissionsPolicies({});
      expect(mockGetPolicies).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    test('should output JSON format when requested', async () => {
      await permissionsPolicies({ json: true });
      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed).toBeDefined();
      expect(parsed.policies).toHaveLength(2);
    });

    test('should use custom serverUrl when provided', async () => {
      await permissionsPolicies({ serverUrl: 'http://custom:8080' });
      expect(OrchestratorClient).toHaveBeenCalledWith(
        expect.objectContaining({ serverUrl: 'http://custom:8080' })
      );
    });

    test('should display policies list', async () => {
      await permissionsPolicies({});
      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.join('\n');
      expect(output).toContain('Policies');
    });
  });

  describe('Error cases', () => {
    test('should handle network error', async () => {
      mockGetPolicies.mockRejectedValue(new Error('Connection failed'));
      await permissionsPolicies({});
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should handle empty policies list', async () => {
      mockGetPolicies.mockResolvedValue([]);
      await permissionsPolicies({});
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    test('should handle server error', async () => {
      mockGetPolicies.mockRejectedValue(new Error('Server error: 500'));
      await permissionsPolicies({});
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
