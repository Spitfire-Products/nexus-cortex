/**
 * FileReadTracker Unit Tests
 *
 * Tests for the enhanced read-before-edit protocol with:
 * - Section fingerprinting (hash-based freshness detection)
 * - Consecutive edit tracking (brief read mode)
 * - Batch read optimization
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileReadTracker, type SectionFingerprint } from '../EditTool.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('FileReadTracker', () => {
  let testDir: string;
  let testFile: string;

  beforeEach(() => {
    // Clear session state before each test
    FileReadTracker.clearSession();

    // Create temp directory and file for testing
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frt-test-'));
    testFile = path.join(testDir, 'test.txt');
    fs.writeFileSync(testFile, 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n');
  });

  afterEach(() => {
    // Cleanup
    FileReadTracker.clearSession();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('calculateSectionHash', () => {
    it('should return a 16-character hex string', () => {
      const hash = FileReadTracker.calculateSectionHash('test content');
      expect(hash).toHaveLength(16);
      expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
    });

    it('should return different hashes for different content', () => {
      const hash1 = FileReadTracker.calculateSectionHash('content A');
      const hash2 = FileReadTracker.calculateSectionHash('content B');
      expect(hash1).not.toBe(hash2);
    });

    it('should return the same hash for the same content', () => {
      const hash1 = FileReadTracker.calculateSectionHash('identical content');
      const hash2 = FileReadTracker.calculateSectionHash('identical content');
      expect(hash1).toBe(hash2);
    });

    it('should handle empty strings', () => {
      const hash = FileReadTracker.calculateSectionHash('');
      expect(hash).toHaveLength(16);
    });

    it('should handle multiline content', () => {
      const content = 'line1\nline2\nline3';
      const hash = FileReadTracker.calculateSectionHash(content);
      expect(hash).toHaveLength(16);
    });
  });

  describe('storeSectionFingerprint and isSectionFresh', () => {
    it('should store and verify a fresh section', () => {
      const content = 'line1\nline2\nline3';
      FileReadTracker.storeSectionFingerprint(testFile, 0, 3, content);

      // Write the same content to file
      fs.writeFileSync(testFile, content + '\nline4\nline5');

      expect(FileReadTracker.isSectionFresh(testFile, 0, 3)).toBe(true);
    });

    it('should detect stale section after content change', () => {
      const originalContent = 'line1\nline2\nline3';
      FileReadTracker.storeSectionFingerprint(testFile, 0, 3, originalContent);

      // Write different content
      fs.writeFileSync(testFile, 'modified line1\nline2\nline3\nline4\nline5');

      expect(FileReadTracker.isSectionFresh(testFile, 0, 3)).toBe(false);
    });

    it('should return false for non-existent fingerprint', () => {
      expect(FileReadTracker.isSectionFresh(testFile, 0, 3)).toBe(false);
    });

    it('should return false for non-existent file', () => {
      FileReadTracker.storeSectionFingerprint('/non/existent/file.txt', 0, 3, 'content');
      expect(FileReadTracker.isSectionFresh('/non/existent/file.txt', 0, 3)).toBe(false);
    });
  });

  describe('isRegionAdjacent', () => {
    it('should detect overlapping regions', () => {
      const range1 = { startLine: 0, endLine: 10 };
      const range2 = { startLine: 5, endLine: 15 };
      expect(FileReadTracker.isRegionAdjacent(range1, range2)).toBe(true);
    });

    it('should detect adjacent regions within tolerance', () => {
      const range1 = { startLine: 0, endLine: 10 };
      const range2 = { startLine: 15, endLine: 25 };
      expect(FileReadTracker.isRegionAdjacent(range1, range2, 10)).toBe(true);
    });

    it('should detect non-adjacent regions', () => {
      const range1 = { startLine: 0, endLine: 10 };
      const range2 = { startLine: 30, endLine: 40 };
      expect(FileReadTracker.isRegionAdjacent(range1, range2, 10)).toBe(false);
    });

    it('should handle contained regions', () => {
      const range1 = { startLine: 0, endLine: 100 };
      const range2 = { startLine: 20, endLine: 30 };
      expect(FileReadTracker.isRegionAdjacent(range1, range2)).toBe(true);
    });
  });

  describe('markAsRead with content fingerprinting', () => {
    it('should store fingerprint when content is provided', () => {
      const content = 'line1\nline2\nline3';
      FileReadTracker.markAsRead(testFile, 0, 3, content);

      // Write same content to file to verify fingerprint
      fs.writeFileSync(testFile, content + '\nline4\nline5');
      expect(FileReadTracker.isSectionFresh(testFile, 0, 3)).toBe(true);
    });

    it('should reset consecutive edit count on read', () => {
      // Simulate some edits
      FileReadTracker.markAsEdited(testFile, 0, 5);
      FileReadTracker.markAsEdited(testFile, 5, 10);

      expect(FileReadTracker.getConsecutiveEditCount(testFile)).toBe(2);

      // Read should reset count
      FileReadTracker.markAsRead(testFile, 0, 10, 'content');
      expect(FileReadTracker.getConsecutiveEditCount(testFile)).toBe(0);
    });
  });

  describe('markAsEdited with region tracking', () => {
    it('should increment consecutive edit count', () => {
      FileReadTracker.markAsRead(testFile, 0, 10);
      expect(FileReadTracker.getConsecutiveEditCount(testFile)).toBe(0);

      FileReadTracker.markAsEdited(testFile, 0, 5);
      expect(FileReadTracker.getConsecutiveEditCount(testFile)).toBe(1);

      FileReadTracker.markAsEdited(testFile, 5, 10);
      expect(FileReadTracker.getConsecutiveEditCount(testFile)).toBe(2);
    });

    it('should invalidate read timestamp', () => {
      FileReadTracker.markAsRead(testFile, 0, 10);
      expect(FileReadTracker.hasBeenRead(testFile)).toBe(true);

      FileReadTracker.markAsEdited(testFile, 0, 5);
      expect(FileReadTracker.hasBeenRead(testFile)).toBe(false);
      expect(FileReadTracker.isStale(testFile)).toBe(true);
    });
  });

  describe('canSkipReRead (brief read mode)', () => {
    it('should allow skip when under max edits and content fresh', () => {
      const content = 'line1\nline2\nline3\nline4\nline5';
      FileReadTracker.markAsRead(testFile, 0, 5, content);

      // Write same content to file
      fs.writeFileSync(testFile, content);

      // First edit
      FileReadTracker.markAsEdited(testFile, 0, 2);

      // Should allow second edit without re-read (content still fresh)
      expect(FileReadTracker.canSkipReRead(testFile, 2, 4)).toBe(true);
    });

    it('should deny skip when max edits exceeded', () => {
      const content = 'line1\nline2\nline3\nline4\nline5';
      FileReadTracker.markAsRead(testFile, 0, 5, content);
      fs.writeFileSync(testFile, content);

      // Use up all allowed consecutive edits
      const maxEdits = FileReadTracker.getMaxConsecutiveEdits();
      for (let i = 0; i < maxEdits; i++) {
        FileReadTracker.markAsEdited(testFile, 0, 5);
      }

      // Should deny skip - max edits reached
      expect(FileReadTracker.canSkipReRead(testFile, 0, 5)).toBe(false);
    });

    it('should deny skip when edit is in distant region', () => {
      const content = 'line1\nline2\nline3\nline4\nline5';
      FileReadTracker.markAsRead(testFile, 0, 5, content);
      fs.writeFileSync(testFile, content);

      // First edit in lines 0-2
      FileReadTracker.markAsEdited(testFile, 0, 2);

      // Try to edit in distant region (lines 100-110, way beyond tolerance)
      expect(FileReadTracker.canSkipReRead(testFile, 100, 110)).toBe(false);
    });

    it('should deny skip when content has changed externally', () => {
      const content = 'line1\nline2\nline3\nline4\nline5';
      FileReadTracker.markAsRead(testFile, 0, 5, content);

      // First edit
      FileReadTracker.markAsEdited(testFile, 0, 2);

      // External change to file content
      fs.writeFileSync(testFile, 'MODIFIED\nline2\nline3\nline4\nline5');

      // Should deny skip - content changed
      expect(FileReadTracker.canSkipReRead(testFile, 2, 4)).toBe(false);
    });
  });

  describe('updateFingerprintAfterEdit', () => {
    it('should update fingerprint after edit to enable consecutive edits', () => {
      // Initial content and read
      const content = 'line1\nline2\nline3\nline4\nline5';
      fs.writeFileSync(testFile, content);
      FileReadTracker.markAsRead(testFile, 0, 5, content);

      // First edit - modifies the file
      const newContent = 'MODIFIED1\nline2\nline3\nline4\nline5';
      fs.writeFileSync(testFile, newContent);
      FileReadTracker.markAsEdited(testFile, 0, 1);
      FileReadTracker.updateFingerprintAfterEdit(testFile, 0, 1, 'MODIFIED1');

      // Second edit attempt should succeed (fingerprint was updated)
      expect(FileReadTracker.canSkipReRead(testFile, 1, 3)).toBe(true);
    });

    it('should allow 2 consecutive edits with fingerprint updates', () => {
      // Initial content and read
      const content = 'line1\nline2\nline3\nline4\nline5';
      fs.writeFileSync(testFile, content);
      FileReadTracker.markAsRead(testFile, 0, 5, content);

      // First edit
      const afterEdit1 = 'EDIT1\nline2\nline3\nline4\nline5';
      fs.writeFileSync(testFile, afterEdit1);
      FileReadTracker.markAsEdited(testFile, 0, 1);
      FileReadTracker.updateFingerprintAfterEdit(testFile, 0, 1, 'EDIT1');

      expect(FileReadTracker.getConsecutiveEditCount(testFile)).toBe(1);

      // Second edit should be allowed
      expect(FileReadTracker.canSkipReRead(testFile, 1, 2)).toBe(true);

      // Simulate second edit
      const afterEdit2 = 'EDIT1\nEDIT2\nline3\nline4\nline5';
      fs.writeFileSync(testFile, afterEdit2);
      FileReadTracker.markAsEdited(testFile, 1, 2);
      FileReadTracker.updateFingerprintAfterEdit(testFile, 1, 2, 'EDIT2');

      expect(FileReadTracker.getConsecutiveEditCount(testFile)).toBe(2);

      // Third edit should be denied (max consecutive edits reached)
      expect(FileReadTracker.canSkipReRead(testFile, 2, 3)).toBe(false);
    });

    it('should detect external changes even after our edits', () => {
      // Initial content and read
      const content = 'line1\nline2\nline3\nline4\nline5';
      fs.writeFileSync(testFile, content);
      FileReadTracker.markAsRead(testFile, 0, 5, content);

      // First edit
      const afterEdit1 = 'EDIT1\nline2\nline3\nline4\nline5';
      fs.writeFileSync(testFile, afterEdit1);
      FileReadTracker.markAsEdited(testFile, 0, 1);
      FileReadTracker.updateFingerprintAfterEdit(testFile, 0, 1, 'EDIT1');

      // External process modifies the file
      fs.writeFileSync(testFile, 'EXTERNAL\nline2\nline3\nline4\nline5');

      // Second edit should be denied (content doesn't match our fingerprint)
      expect(FileReadTracker.canSkipReRead(testFile, 1, 2)).toBe(false);
    });
  });

  describe('suggestBatchRead', () => {
    it('should return null for empty targets array', () => {
      const result = FileReadTracker.suggestBatchRead(testFile, []);
      expect(result).toBeNull();
    });

    it('should find single target and suggest read', () => {
      fs.writeFileSync(testFile, 'line1\nline2\nTARGET\nline4\nline5');
      const result = FileReadTracker.suggestBatchRead(testFile, ['TARGET']);

      expect(result).not.toBeNull();
      expect(result!.coverage).toHaveLength(1);
      expect(result!.coverage[0]!.lineNumber).toBe(3); // 1-indexed
    });

    it('should find multiple targets and suggest bounding box', () => {
      fs.writeFileSync(testFile, 'TARGET_A\nline2\nline3\nline4\nTARGET_B\nline6');
      const result = FileReadTracker.suggestBatchRead(testFile, ['TARGET_A', 'TARGET_B']);

      expect(result).not.toBeNull();
      expect(result!.coverage).toHaveLength(2);
      // offset should be 0 (first target at line 0 minus context)
      expect(result!.offset).toBe(0);
      // limit should cover both targets plus context
      expect(result!.limit).toBeGreaterThan(4);
    });

    it('should return null if not all targets found', () => {
      fs.writeFileSync(testFile, 'TARGET_A\nline2\nline3');
      const result = FileReadTracker.suggestBatchRead(testFile, ['TARGET_A', 'NOT_FOUND']);

      expect(result).toBeNull();
    });

    it('should return null for non-existent file', () => {
      const result = FileReadTracker.suggestBatchRead('/non/existent/file.txt', ['target']);
      expect(result).toBeNull();
    });
  });

  describe('clearSession', () => {
    it('should clear all tracking data', () => {
      const content = 'test content';
      FileReadTracker.markAsRead(testFile, 0, 5, content);
      FileReadTracker.markAsEdited(testFile, 0, 2);

      expect(FileReadTracker.getReadFiles()).toContain(testFile);
      expect(FileReadTracker.getConsecutiveEditCount(testFile)).toBe(1);

      FileReadTracker.clearSession();

      expect(FileReadTracker.getReadFiles()).toHaveLength(0);
      expect(FileReadTracker.getConsecutiveEditCount(testFile)).toBe(0);
      expect(FileReadTracker.hasBeenRead(testFile)).toBe(false);
    });
  });

  describe('getMaxConsecutiveEdits', () => {
    it('should return the configured max', () => {
      const max = FileReadTracker.getMaxConsecutiveEdits();
      expect(max).toBe(2);
    });
  });

  describe('getExternallyChangedFiles (cross-agent staleness)', () => {
    it('returns nothing when a read file is untouched on disk', () => {
      FileReadTracker.markAsRead(testFile, 1, 10, 'unused');
      expect(FileReadTracker.getExternallyChangedFiles()).toEqual([]);
    });

    it('flags a file whose disk mtime advanced after it was read', () => {
      const readAt = Date.now();
      FileReadTracker.markAsRead(testFile, 1, 10, 'unused');
      // Simulate an external writer (the user or another agent) touching the
      // file AFTER our read — without relying on a real sleep.
      const future = new Date(readAt + 5000);
      fs.utimesSync(testFile, future, future);

      const changed = FileReadTracker.getExternallyChangedFiles();
      expect(changed).toHaveLength(1);
      expect(changed[0]).toEqual({ path: testFile, deleted: false });
    });

    it('flags a file deleted/moved after it was read', () => {
      FileReadTracker.markAsRead(testFile, 1, 10, 'unused');
      fs.rmSync(testFile);

      const changed = FileReadTracker.getExternallyChangedFiles();
      expect(changed).toHaveLength(1);
      expect(changed[0]).toEqual({ path: testFile, deleted: true });
    });

    it('ignores files that were never read', () => {
      // No markAsRead call at all.
      fs.utimesSync(testFile, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
      expect(FileReadTracker.getExternallyChangedFiles()).toEqual([]);
    });
  });
});
