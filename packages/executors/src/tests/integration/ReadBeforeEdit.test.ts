/**
 * Read-Before-Edit Protocol Tests
 *
 * Verifies the mandatory read-before-edit protocol with timestamp-based staleness detection
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { EditTool, FileReadTracker } from '../../implementations/file/EditTool.js';
import { ReadFileTool } from '../../implementations/file/ReadFileTool.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';

describe('Read-Before-Edit Protocol', () => {
  const testDir = path.join(process.cwd(), '.test-tmp-read-before-edit');
  const testFile = path.join(testDir, 'test.txt');

  const config: ExecutorConfig = {
    workingDirectory: testDir,
    debug: false,
  };

  const editTool = new EditTool(config);
  const readTool = new ReadFileTool(config);

  beforeEach(() => {
    // Create test directory
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    // Clear session state
    FileReadTracker.clearSession();
  });

  afterEach(() => {
    // Clean up
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Basic Read Requirement', () => {
    it('should reject edit without prior read', async () => {
      fs.writeFileSync(testFile, 'Hello World');

      const result = await editTool.execute(
        {
          file_path: testFile,
          old_string: 'Hello',
          new_string: 'Hi',
        },
        new AbortController().signal,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('You must read the file before editing it');
    });

    it('should allow edit after reading', async () => {
      fs.writeFileSync(testFile, 'Hello World');

      await readTool.execute(
        { file_path: testFile },
        new AbortController().signal,
      );

      const result = await editTool.execute(
        {
          file_path: testFile,
          old_string: 'Hello',
          new_string: 'Hi',
        },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(fs.readFileSync(testFile, 'utf-8')).toBe('Hi World');
    });

    it('should allow creating new files without prior read', async () => {
      const result = await editTool.execute(
        {
          file_path: testFile,
          old_string: '',
          new_string: 'New file content',
        },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(fs.readFileSync(testFile, 'utf-8')).toBe('New file content');
    });
  });

  describe('Multi-File Tracking', () => {
    it('should track multiple files independently', async () => {
      const file1 = path.join(testDir, 'file1.txt');
      const file2 = path.join(testDir, 'file2.txt');

      fs.writeFileSync(file1, 'Content 1');
      fs.writeFileSync(file2, 'Content 2');

      // Read only file1
      await readTool.execute({ file_path: file1 }, new AbortController().signal);

      // Edit file1 should work
      const edit1 = await editTool.execute(
        {
          file_path: file1,
          old_string: 'Content 1',
          new_string: 'Updated 1',
        },
        new AbortController().signal,
      );
      expect(edit1.success).toBe(true);

      // Edit file2 should fail (not read)
      const edit2 = await editTool.execute(
        {
          file_path: file2,
          old_string: 'Content 2',
          new_string: 'Updated 2',
        },
        new AbortController().signal,
      );
      expect(edit2.success).toBe(false);
      expect(edit2.error).toContain('You must read the file before editing it');
    });

    it('should track read files list', async () => {
      const file1 = path.join(testDir, 'file1.txt');
      const file2 = path.join(testDir, 'file2.txt');

      fs.writeFileSync(file1, 'Content 1');
      fs.writeFileSync(file2, 'Content 2');

      expect(FileReadTracker.getReadFiles()).toHaveLength(0);

      await readTool.execute({ file_path: file1 }, new AbortController().signal);
      expect(FileReadTracker.getReadFiles()).toHaveLength(1);
      expect(FileReadTracker.getReadFiles()).toContain(file1);

      await readTool.execute({ file_path: file2 }, new AbortController().signal);
      expect(FileReadTracker.getReadFiles()).toHaveLength(2);
      expect(FileReadTracker.getReadFiles()).toContain(file2);
    });
  });

  describe('Timestamp-Based Staleness', () => {
    it('should mark file as stale after edit', async () => {
      fs.writeFileSync(testFile, 'Line 1\nLine 2\nLine 3');

      // Initially not stale (not read)
      expect(FileReadTracker.isStale(testFile)).toBe(false);

      // Read file
      await readTool.execute({ file_path: testFile }, new AbortController().signal);
      expect(FileReadTracker.isStale(testFile)).toBe(false);

      // Edit file
      await editTool.execute(
        {
          file_path: testFile,
          old_string: 'Line 1',
          new_string: 'First Line',
        },
        new AbortController().signal,
      );

      // Now stale
      expect(FileReadTracker.isStale(testFile)).toBe(true);
    });

    it('should reject second edit without re-reading', async () => {
      fs.writeFileSync(testFile, 'Line 1\nLine 2\nLine 3');

      // Read and first edit
      await readTool.execute({ file_path: testFile }, new AbortController().signal);

      const edit1 = await editTool.execute(
        {
          file_path: testFile,
          old_string: 'Line 1',
          new_string: 'First Line',
        },
        new AbortController().signal,
      );
      expect(edit1.success).toBe(true);

      // File is now: "First Line\nLine 2\nLine 3"
      // Second edit should SUCCEED (brief read mode: allows up to MAX_CONSECUTIVE_EDITS=2)
      const edit2 = await editTool.execute(
        {
          file_path: testFile,
          old_string: 'Line 2',
          new_string: 'Second Line',
        },
        new AbortController().signal,
      );
      expect(edit2.success).toBe(true);

      // File is now: "First Line\nSecond Line\nLine 3"
      // Third edit should FAIL - exceeded MAX_CONSECUTIVE_EDITS
      const edit3 = await editTool.execute(
        {
          file_path: testFile,
          old_string: 'Line 3',
          new_string: 'Third Line',
        },
        new AbortController().signal,
      );

      expect(edit3.success).toBe(false);
      expect(edit3.error).toContain('File has been edited since you last read it');
      expect(edit3.error).toContain('re-read the file');
    });

    it('should allow second edit after re-reading', async () => {
      fs.writeFileSync(testFile, 'Line 1\nLine 2\nLine 3');

      // Read, edit, re-read, edit cycle
      await readTool.execute({ file_path: testFile }, new AbortController().signal);

      await editTool.execute(
        {
          file_path: testFile,
          old_string: 'Line 1',
          new_string: 'First Line',
        },
        new AbortController().signal,
      );

      // Re-read after edit
      await readTool.execute({ file_path: testFile }, new AbortController().signal);

      // Second edit should now work
      const edit2 = await editTool.execute(
        {
          file_path: testFile,
          old_string: 'Line 2',
          new_string: 'Second Line',
        },
        new AbortController().signal,
      );

      expect(edit2.success).toBe(true);
      expect(fs.readFileSync(testFile, 'utf-8')).toBe('First Line\nSecond Line\nLine 3');
    });

    it('should provide smart read suggestions', async () => {
      fs.writeFileSync(testFile, 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5');

      // Read specific section
      await readTool.execute(
        {
          file_path: testFile,
          offset: 1,
          limit: 2,
        },
        new AbortController().signal,
      );

      // First edit
      await editTool.execute(
        {
          file_path: testFile,
          old_string: 'Line 2',
          new_string: 'Second Line',
        },
        new AbortController().signal,
      );

      // Second edit (allowed by brief read mode)
      const edit2 = await editTool.execute(
        {
          file_path: testFile,
          old_string: 'Line 3',
          new_string: 'Third Line',
        },
        new AbortController().signal,
      );
      expect(edit2.success).toBe(true);

      // Third edit should fail (exceeded MAX_CONSECUTIVE_EDITS) and provide smart suggestions
      const edit3 = await editTool.execute(
        {
          file_path: testFile,
          old_string: 'Line 4',
          new_string: 'Fourth Line',
        },
        new AbortController().signal,
      );

      expect(edit3.success).toBe(false);
      expect(edit3.error).toContain('offset:');
      expect(edit3.error).toContain('limit:');
    });

    it('should clear staleness after re-reading', async () => {
      fs.writeFileSync(testFile, 'Content');

      await readTool.execute({ file_path: testFile }, new AbortController().signal);
      expect(FileReadTracker.isStale(testFile)).toBe(false);

      await editTool.execute(
        {
          file_path: testFile,
          old_string: 'Content',
          new_string: 'New Content',
        },
        new AbortController().signal,
      );
      expect(FileReadTracker.isStale(testFile)).toBe(true);

      // Re-read clears staleness
      await readTool.execute({ file_path: testFile }, new AbortController().signal);
      expect(FileReadTracker.isStale(testFile)).toBe(false);
    });
  });

  describe('Session Management', () => {
    it('should clear all state on clearSession', async () => {
      fs.writeFileSync(testFile, 'Content');

      await readTool.execute({ file_path: testFile }, new AbortController().signal);
      await editTool.execute(
        {
          file_path: testFile,
          old_string: 'Content',
          new_string: 'New Content',
        },
        new AbortController().signal,
      );

      expect(FileReadTracker.getReadFiles()).toHaveLength(1);
      expect(FileReadTracker.isStale(testFile)).toBe(true);

      FileReadTracker.clearSession();

      expect(FileReadTracker.getReadFiles()).toHaveLength(0);
      expect(FileReadTracker.isStale(testFile)).toBe(false);
      expect(FileReadTracker.hasBeenRead(testFile)).toBe(false);
    });
  });

  describe('Error Messages', () => {
    it('should provide helpful message for never-read files', async () => {
      fs.writeFileSync(testFile, 'Content');

      const result = await editTool.execute(
        {
          file_path: testFile,
          old_string: 'Content',
          new_string: 'New',
        },
        new AbortController().signal,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('You must read the file before editing it');
      // Smart suggestions now provide targeted Read() call with offset/limit when target is found
      expect(result.error).toMatch(/read\(file_path:|Use the Read tool first/i);
    });

    it('should provide different message for stale files', async () => {
      fs.writeFileSync(testFile, 'Line 1\nLine 2\nLine 3');

      await readTool.execute({ file_path: testFile }, new AbortController().signal);

      // First edit (success)
      await editTool.execute(
        {
          file_path: testFile,
          old_string: 'Line 1',
          new_string: 'First',
        },
        new AbortController().signal,
      );

      // Second edit (allowed by brief read mode)
      const edit2 = await editTool.execute(
        {
          file_path: testFile,
          old_string: 'Line 2',
          new_string: 'Second',
        },
        new AbortController().signal,
      );
      expect(edit2.success).toBe(true);

      // Third edit should fail with stale message
      const result = await editTool.execute(
        {
          file_path: testFile,
          old_string: 'Line 3',
          new_string: 'Third',
        },
        new AbortController().signal,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('File has been edited since you last read it');
      expect(result.error).not.toContain('You must read the file before editing it');
    });
  });
});
