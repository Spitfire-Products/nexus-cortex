/**
 * Tests for JSONLHistoryStore metadata persistence
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JSONLHistoryStore } from '../JSONLHistoryStore.js';
import { SessionMetadata } from '../MessageTypes.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';

describe('JSONLHistoryStore - Metadata Persistence', () => {
  let store: JSONLHistoryStore;
  let testDir: string;
  const sessionId = 'test-session-123';

  beforeEach(async () => {
    // Create temporary directory for tests
    testDir = path.join(tmpdir(), `jsonl-metadata-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    store = new JSONLHistoryStore({
      baseDir: testDir
    });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should save and load metadata', async () => {
    const metadata: Partial<SessionMetadata> = {
      sessionId,
      projectPath: '/test/project',
      startTime: new Date().toISOString(),
      messageCount: 10,
      currentModel: 'claude-sonnet-4-5-20250929'
    };

    await store.saveMetadata(sessionId, metadata);
    const loaded = await store.loadMetadata(sessionId);

    expect(loaded).not.toBeNull();
    expect(loaded?.sessionId).toBe(sessionId);
    expect(loaded?.projectPath).toBe('/test/project');
    expect(loaded?.currentModel).toBe('claude-sonnet-4-5-20250929');
  });

  it('should save and load cache metrics', async () => {
    const cacheMetrics = {
      requestCount: 5,
      totalInputTokens: 10000,
      totalOutputTokens: 2000,
      totalCacheCreationTokens: 3000,
      totalCacheReadTokens: 5000,
      totalUncachedInputTokens: 2000,
      overallCacheHitRate: 0.5,
      overallCostSavingsRatio: 0.375,
      requestsWithCacheHits: 3,
      byProvider: {
        anthropic: {
          provider: 'anthropic',
          requestCount: 5,
          cacheReadTokens: 5000,
          cacheCreationTokens: 3000,
          totalInputTokens: 10000,
          cacheHitRate: 0.5
        }
      }
    };

    await store.saveMetadata(sessionId, { cacheMetrics });
    const loaded = await store.loadMetadata(sessionId);

    expect(loaded?.cacheMetrics).toBeDefined();
    expect(loaded?.cacheMetrics?.requestCount).toBe(5);
    expect(loaded?.cacheMetrics?.overallCacheHitRate).toBe(0.5);
    expect(loaded?.cacheMetrics?.byProvider?.anthropic).toBeDefined();
    expect(loaded?.cacheMetrics?.byProvider?.anthropic?.cacheReadTokens).toBe(5000);
  });

  it('should merge metadata on multiple saves', async () => {
    // First save
    await store.saveMetadata(sessionId, {
      sessionId,
      projectPath: '/test/project',
      currentModel: 'claude-sonnet-4-5-20250929'
    });

    // Second save with cache metrics
    await store.saveMetadata(sessionId, {
      cacheMetrics: {
        requestCount: 1,
        totalInputTokens: 1000,
        totalOutputTokens: 200,
        totalCacheCreationTokens: 300,
        totalCacheReadTokens: 500,
        totalUncachedInputTokens: 200,
        overallCacheHitRate: 0.5,
        overallCostSavingsRatio: 0.375,
        requestsWithCacheHits: 1,
        byProvider: {}
      }
    });

    const loaded = await store.loadMetadata(sessionId);

    // Both pieces of metadata should be present
    expect(loaded?.projectPath).toBe('/test/project');
    expect(loaded?.currentModel).toBe('claude-sonnet-4-5-20250929');
    expect(loaded?.cacheMetrics?.requestCount).toBe(1);
  });

  it('should return null for non-existent metadata', async () => {
    const loaded = await store.loadMetadata('non-existent-session');
    expect(loaded).toBeNull();
  });

  it('should update lastModified timestamp on save', async () => {
    const before = new Date();
    await store.saveMetadata(sessionId, {
      sessionId,
      projectPath: '/test/project'
    });

    const loaded = await store.loadMetadata(sessionId);
    const after = new Date();

    expect(loaded?.lastModified).toBeDefined();
    const modifiedTime = new Date(loaded!.lastModified);
    expect(modifiedTime.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(modifiedTime.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('should get correct metadata file path', () => {
    const sessionPath = store.getSessionPath(sessionId);
    const metadataPath = store.getMetadataPath(sessionId);

    expect(metadataPath).toContain('.meta.json');
    expect(metadataPath).not.toContain('.jsonl');
    expect(metadataPath.replace('.meta.json', '.jsonl')).toBe(sessionPath);
  });
});
