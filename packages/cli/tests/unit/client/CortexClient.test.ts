/**
 * Unit tests for CortexClient
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { CortexClient } from '../../../src/client/CortexClient.js';
import {
  mockModels,
  mockHealthResponse,
  mockApprovalMode,
  mockMessageResponse,
  mockStreamChunks
} from '../../fixtures/mockResponses';

// Mock fetch globally
global.fetch = vi.fn();

describe('CortexClient', () => {
  let client: CortexClient;

  beforeEach(() => {
    client = new CortexClient('http://localhost:4000');
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Constructor', () => {
    test('should create client with default URL', () => {
      const defaultClient = new CortexClient();
      expect(defaultClient).toBeInstanceOf(CortexClient);
    });

    test('should create client with custom URL', () => {
      const customClient = new CortexClient('http://custom:8080');
      expect(customClient).toBeInstanceOf(CortexClient);
    });
  });

  describe('sendMessage', () => {
    test('should send non-streaming message successfully', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockMessageResponse
      });

      const messages = [{ role: 'user' as const, content: 'Hello' }];
      const result = await client.sendMessage(messages);

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:4000/v1/messages',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('"stream":false')
        })
      );

      expect(result).toEqual(mockMessageResponse);
    });

    test('should include options in request', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockMessageResponse
      });

      const messages = [{ role: 'user' as const, content: 'Hello' }];
      const options = {
        model: 'claude-sonnet-4-5',
        temperature: 0.7,
        max_tokens: 1024
      };

      await client.sendMessage(messages, options);

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:4000/v1/messages',
        expect.objectContaining({
          body: expect.stringContaining('"model":"claude-sonnet-4-5"')
        })
      );
    });

    test('should throw error on failed request', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: 'Invalid request' } })
      });

      const messages = [{ role: 'user' as const, content: 'Hello' }];

      await expect(client.sendMessage(messages)).rejects.toThrow('Invalid request');
    });

    test('should throw generic error when no error message', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        json: async () => ({})
      });

      const messages = [{ role: 'user' as const, content: 'Hello' }];

      await expect(client.sendMessage(messages)).rejects.toThrow('Request failed');
    });
  });

  describe('streamMessage', () => {
    test('should stream message successfully', async () => {
      const releaseLockSpy = vi.fn();
      const mockReader = {
        read: vi.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"type":"message_start"}\n\n')
          })
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"type":"content_block_delta","delta":{"text":"Hello"}}\n\n')
          })
          .mockResolvedValueOnce({
            done: true,
            value: undefined
          }),
        releaseLock: releaseLockSpy
      };

      const mockBody = {
        getReader: () => mockReader
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        body: mockBody
      });

      const messages = [{ role: 'user' as const, content: 'Test' }];
      const events: any[] = [];

      for await (const event of client.streamMessage(messages)) {
        events.push(event);
      }

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('message_start');
      expect(events[1].type).toBe('content_block_delta');
      expect(releaseLockSpy).toHaveBeenCalled();
    });

    test('should include stream:true in request', async () => {
      const mockBody = {
        getReader: () => ({
          read: vi.fn().mockResolvedValueOnce({ done: true, value: undefined }),
          releaseLock: vi.fn()
        })
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        body: mockBody
      });

      const messages = [{ role: 'user' as const, content: 'Test' }];
      const stream = client.streamMessage(messages);

      // Start the stream
      await stream.next();

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:4000/v1/messages',
        expect.objectContaining({
          body: expect.stringContaining('"stream":true')
        })
      );
    });

    test('should throw error on failed streaming request', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: 'Stream failed' } })
      });

      const messages = [{ role: 'user' as const, content: 'Test' }];
      const stream = client.streamMessage(messages);

      await expect(stream.next()).rejects.toThrow('Stream failed');
    });

    test('should throw error when no response body', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        body: null
      });

      const messages = [{ role: 'user' as const, content: 'Test' }];
      const stream = client.streamMessage(messages);

      await expect(stream.next()).rejects.toThrow('No response body');
    });

    test('should handle invalid JSON gracefully', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      const mockBody = {
        getReader: () => ({
          read: vi.fn()
            .mockResolvedValueOnce({
              done: false,
              value: new TextEncoder().encode('data: {invalid json}\n\n')
            })
            .mockResolvedValueOnce({
              done: true,
              value: undefined
            }),
          releaseLock: vi.fn()
        })
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        body: mockBody
      });

      const messages = [{ role: 'user' as const, content: 'Test' }];
      const events: any[] = [];

      for await (const event of client.streamMessage(messages)) {
        events.push(event);
      }

      expect(consoleError).toHaveBeenCalled();
      expect(events).toHaveLength(0); // Invalid JSON should be skipped

      consoleError.mockRestore();
    });
  });

  describe('listModels', () => {
    test('should fetch models successfully', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: mockModels.models })
      });

      const result = await client.listModels();

      expect(global.fetch).toHaveBeenCalledWith('http://localhost:4000/models');
      expect(result).toEqual(mockModels.models);
    });

    test('should throw error on failed fetch', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false
      });

      await expect(client.listModels()).rejects.toThrow('Failed to fetch models');
    });
  });

  describe('health', () => {
    test('should fetch health status successfully', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockHealthResponse
      });

      const result = await client.health();

      expect(global.fetch).toHaveBeenCalledWith('http://localhost:4000/health');
      expect(result).toEqual(mockHealthResponse);
    });

    test('should throw error on failed health check', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false
      });

      await expect(client.health()).rejects.toThrow('Health check failed');
    });
  });

  describe('getApprovalMode', () => {
    test('should fetch approval mode successfully', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockApprovalMode
      });

      const result = await client.getApprovalMode();

      expect(global.fetch).toHaveBeenCalledWith('http://localhost:4000/v1/approval-mode');
      expect(result).toEqual(mockApprovalMode);
    });

    test('should throw error on failed fetch', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false
      });

      await expect(client.getApprovalMode()).rejects.toThrow('Failed to get approval mode');
    });
  });

  describe('setApprovalMode', () => {
    test('should set approval mode successfully', async () => {
      const expectedResponse = { success: true, autoApproveActions: true };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => expectedResponse
      });

      const result = await client.setApprovalMode(true);

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:4000/v1/approval-mode',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"autoApproveActions":true')
        })
      );
      expect(result).toEqual(expectedResponse);
    });

    test('should throw error with message on failed request', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: 'Permission denied' } })
      });

      await expect(client.setApprovalMode(true)).rejects.toThrow('Permission denied');
    });

    test('should throw generic error when no message', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        json: async () => ({})
      });

      await expect(client.setApprovalMode(true)).rejects.toThrow('Failed to set approval mode');
    });
  });

  describe('get', () => {
    test('should perform GET request with relative path', async () => {
      const mockData = { data: 'test' };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockData
      });

      const result = await client.get('/test');

      expect(global.fetch).toHaveBeenCalledWith('http://localhost:4000/test');
      expect(result).toEqual(mockData);
    });

    test('should perform GET request with absolute URL', async () => {
      const mockData = { data: 'test' };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockData
      });

      const result = await client.get('http://other-server:5000/test');

      expect(global.fetch).toHaveBeenCalledWith('http://other-server:5000/test');
      expect(result).toEqual(mockData);
    });

    test('should throw error on failed GET', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: 'Not found' } })
      });

      await expect(client.get('/test')).rejects.toThrow('Not found');
    });

    test('should throw generic error when JSON parse fails', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        json: async () => { throw new Error('Parse error'); }
      });

      await expect(client.get('/test')).rejects.toThrow('GET /test failed');
    });
  });

  describe('post', () => {
    test('should perform POST request with relative path', async () => {
      const mockData = { success: true };
      const body = { key: 'value' };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockData
      });

      const result = await client.post('/test', body);

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:4000/test',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })
      );
      expect(result).toEqual(mockData);
    });

    test('should perform POST request with absolute URL', async () => {
      const mockData = { success: true };
      const body = { key: 'value' };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockData
      });

      const result = await client.post('http://other-server:5000/test', body);

      expect(global.fetch).toHaveBeenCalledWith('http://other-server:5000/test', expect.any(Object));
      expect(result).toEqual(mockData);
    });

    test('should throw error on failed POST', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: 'Invalid data' } })
      });

      await expect(client.post('/test', {})).rejects.toThrow('Invalid data');
    });

    test('should throw generic error when JSON parse fails', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        json: async () => { throw new Error('Parse error'); }
      });

      await expect(client.post('/test', {})).rejects.toThrow('POST /test failed');
    });
  });
});
