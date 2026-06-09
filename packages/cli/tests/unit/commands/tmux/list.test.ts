/**
 * Unit tests for tmux/list command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmuxList } from '../../../../src/commands/tmux/list.js';
import { CortexClient } from '../../../../src/client/CortexClient.js';

// Mock the CortexClient
vi.mock('../../../../src/client/CortexClient.js', () => {
  return {
    CortexClient: vi.fn()
  };
});

describe('tmuxList command', () => {
  let mockGet: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockSessionsData = {
    sessions: [
      {
        id: 'session-1',
        name: 'dev-session',
        layout: 'tiled',
        panes: 4,
        createdAt: '2025-01-14T10:00:00Z',
        active: true
      },
      {
        id: 'session-2',
        name: 'test-session',
        layout: 'even-horizontal',
        panes: 2,
        createdAt: '2025-01-14T09:00:00Z',
        active: false
      }
    ]
  };

  beforeEach(() => {
    mockGet = vi.fn().mockResolvedValue(mockSessionsData);

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
    test('should list all tmux sessions', async () => {
      await tmuxList({});

      expect(mockGet).toHaveBeenCalledWith('/tmux/list');
      expect(consoleLogSpy).toHaveBeenCalled();

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));

      expect(calls.some(c => c.includes('Tmux Sessions (2)'))).toBe(true);
    });

    test('should display session details', async () => {
      await tmuxList({});

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));

      expect(calls.some(c => c.includes('session-1'))).toBe(true);
      expect(calls.some(c => c.includes('dev-session'))).toBe(true);
      expect(calls.some(c => c.includes('tiled'))).toBe(true);
    });

    test('should display active status', async () => {
      await tmuxList({});

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));

      expect(calls.some(c => c.includes('Active'))).toBe(true);
      expect(calls.some(c => c.includes('Inactive'))).toBe(true);
    });

    test('should display usage hints', async () => {
      await tmuxList({});

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));

      expect(calls.some(c => c.includes('cortex tmux send'))).toBe(true);
      expect(calls.some(c => c.includes('cortex tmux capture'))).toBe(true);
      expect(calls.some(c => c.includes('cortex tmux snapshot'))).toBe(true);
      expect(calls.some(c => c.includes('cortex tmux kill'))).toBe(true);
    });

    test('should handle empty sessions list', async () => {
      mockGet.mockResolvedValue({ sessions: [] });

      await tmuxList({});

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));

      expect(calls.some(c => c.includes('No active tmux sessions found'))).toBe(true);
      expect(calls.some(c => c.includes('cortex tmux create'))).toBe(true);
    });

    test('should output JSON format when requested', async () => {
      await tmuxList({ json: true });

      expect(consoleLogSpy).toHaveBeenCalledOnce();

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.sessions).toHaveLength(2);
      expect(parsed.sessions[0].id).toBe('session-1');
    });

    test('should use custom serverUrl when provided', async () => {
      await tmuxList({ serverUrl: 'http://custom:8080' });

      expect(CortexClient).toHaveBeenCalledWith('http://custom:8080');
    });
  });

  describe('Error cases', () => {
    test('should handle network error', async () => {
      mockGet.mockRejectedValue(new Error('Connection failed'));

      await tmuxList({});

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
