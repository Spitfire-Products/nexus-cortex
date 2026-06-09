/**
 * Unit tests for artifact/status command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { artifactStatus } from '../../../../src/commands/artifact/status.js';
import { CortexClient } from '../../../../src/client/CortexClient.js';

// Mock the CortexClient
vi.mock('../../../../src/client/CortexClient.js', () => {
  return {
    CortexClient: vi.fn()
  };
});

describe('artifactStatus command', () => {
  let mockGet: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockStatusData = {
    name: 'dashboard',
    type: 'react',
    mode: 'dev',
    status: 'running',
    port: 3000,
    url: 'http://localhost:3000',
    pid: 12345,
    uptime: '2h 30m',
    resources: {
      cpu: 15.5,
      memory: '128 MB',
      disk: '45 MB'
    },
    env: 'docker'
  };

  beforeEach(() => {
    mockGet = vi.fn().mockResolvedValue(mockStatusData);

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
    test('should show artifact status', async () => {
      await artifactStatus('artifact-123', {});

      expect(mockGet).toHaveBeenCalledWith('/artifact/status/artifact-123');
      expect(consoleLogSpy).toHaveBeenCalled();

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Artifact Status'))).toBe(true);
    });

    test('should display basic information', async () => {
      await artifactStatus('artifact-123', {});

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Basic Information'))).toBe(true);
      expect(calls.some(c => c.includes('dashboard'))).toBe(true);
      expect(calls.some(c => c.includes('react'))).toBe(true);
      expect(calls.some(c => c.includes('running'))).toBe(true);
    });

    test('should display runtime information', async () => {
      await artifactStatus('artifact-123', {});

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Runtime Information'))).toBe(true);
      expect(calls.some(c => c.includes('3000'))).toBe(true);
      expect(calls.some(c => c.includes('12345'))).toBe(true);
      expect(calls.some(c => c.includes('2h 30m'))).toBe(true);
    });

    test('should display resource usage', async () => {
      await artifactStatus('artifact-123', {});

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Resource Usage'))).toBe(true);
      expect(calls.some(c => c.includes('15.5'))).toBe(true);
      expect(calls.some(c => c.includes('128 MB'))).toBe(true);
    });

    test('should display environment', async () => {
      await artifactStatus('artifact-123', {});

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Environment'))).toBe(true);
      expect(calls.some(c => c.includes('docker'))).toBe(true);
    });

    test('should display management hints', async () => {
      await artifactStatus('artifact-123', {});

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('cortex artifact inspect'))).toBe(true);
      expect(calls.some(c => c.includes('cortex artifact modify'))).toBe(true);
      expect(calls.some(c => c.includes('cortex artifact view'))).toBe(true);
    });

    test('should output JSON format when requested', async () => {
      await artifactStatus('artifact-123', { json: true });

      expect(consoleLogSpy).toHaveBeenCalledOnce();

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.name).toBe('dashboard');
      expect(parsed.type).toBe('react');
      expect(parsed.status).toBe('running');
    });

    test('should use custom serverUrl when provided', async () => {
      await artifactStatus('artifact-123', { serverUrl: 'http://custom:8080' });

      expect(CortexClient).toHaveBeenCalledWith('http://custom:8080');
    });
  });

  describe('Error cases', () => {
    test('should error when id is missing', async () => {
      await artifactStatus(undefined, {});

      expect(mockGet).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);

      const calls = consoleErrorSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Artifact ID is required'))).toBe(true);
    });

    test('should handle network error', async () => {
      mockGet.mockRejectedValue(new Error('Connection failed'));

      await artifactStatus('artifact-123', {});

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
