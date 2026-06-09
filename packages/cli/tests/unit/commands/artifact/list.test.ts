/**
 * Unit tests for artifact/list command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { artifactList } from '../../../../src/commands/artifact/list.js';
import { CortexClient } from '../../../../src/client/CortexClient.js';

// Mock the CortexClient
vi.mock('../../../../src/client/CortexClient.js', () => {
  return {
    CortexClient: vi.fn()
  };
});

describe('artifactList command', () => {
  let mockGet: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockArtifacts = {
    artifacts: [
      {
        id: 'artifact-1',
        name: 'dashboard',
        type: 'react',
        mode: 'dev',
        port: 3000,
        url: 'http://localhost:3000',
        status: 'running',
        created: '2024-01-15T10:00:00Z'
      },
      {
        id: 'artifact-2',
        name: 'api',
        type: 'nodejs',
        mode: 'persistent',
        status: 'stopped',
        created: '2024-01-14T09:00:00Z'
      }
    ]
  };

  beforeEach(() => {
    mockGet = vi.fn().mockResolvedValue(mockArtifacts);

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
    test('should list all artifacts', async () => {
      await artifactList({});

      expect(mockGet).toHaveBeenCalledWith('/artifact/list');
      expect(consoleLogSpy).toHaveBeenCalled();

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Artifacts'))).toBe(true);
      expect(calls.some(c => c.includes('dashboard'))).toBe(true);
      expect(calls.some(c => c.includes('api'))).toBe(true);
    });

    test('should filter by status', async () => {
      await artifactList({ status: 'running' });

      expect(mockGet).toHaveBeenCalledWith('/artifact/list?status=running');
    });

    test('should filter by type', async () => {
      await artifactList({ type: 'react' });

      expect(mockGet).toHaveBeenCalledWith('/artifact/list?type=react');
    });

    test('should filter by status and type', async () => {
      await artifactList({ status: 'running', type: 'react' });

      expect(mockGet).toHaveBeenCalledWith('/artifact/list?status=running&type=react');
    });

    test('should display summary with counts', async () => {
      await artifactList({});

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));

      expect(calls.some(c => c.includes('Summary'))).toBe(true);
      expect(calls.some(c => c.includes('Total'))).toBe(true);
      expect(calls.some(c => c.includes('Running'))).toBe(true);
      expect(calls.some(c => c.includes('Stopped'))).toBe(true);
    });

    test('should handle empty artifact list', async () => {
      mockGet.mockResolvedValue({ artifacts: [] });

      await artifactList({});

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('No artifacts found'))).toBe(true);
    });

    test('should output JSON format when requested', async () => {
      await artifactList({ json: true });

      expect(consoleLogSpy).toHaveBeenCalledOnce();

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.artifacts).toBeDefined();
      expect(parsed.artifacts.length).toBe(2);
    });

    test('should use custom serverUrl when provided', async () => {
      await artifactList({ serverUrl: 'http://custom:8080' });

      expect(CortexClient).toHaveBeenCalledWith('http://custom:8080');
    });
  });

  describe('Error cases', () => {
    test('should handle network error', async () => {
      mockGet.mockRejectedValue(new Error('Connection failed'));

      await artifactList({});

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
