/**
 * Split-Tool Todo Integration Tests
 *
 * Tests TodoCreate, TodoUpdate, TodoList with shared in-memory state
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TodoCreateTool,
  TodoUpdateTool,
  TodoListTool,
  resetTodoState,
  getCurrentTodos,
  type TodoItem,
} from '../../implementations/ui/TodoWriteTool.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';

describe('Split-Tool Todo Integration', () => {
  let createTool: TodoCreateTool;
  let updateTool: TodoUpdateTool;
  let listTool: TodoListTool;
  let config: ExecutorConfig;

  beforeEach(() => {
    config = {
      workingDirectory: process.cwd(),
      allowFileSystem: true,
    };

    createTool = new TodoCreateTool(config);
    updateTool = new TodoUpdateTool(config);
    listTool = new TodoListTool(config);

    resetTodoState();
  });

  describe('TodoCreate', () => {
    it('should create a task with auto-incrementing ID', async () => {
      const result = await createTool.execute(
        { content: 'Task 1' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('#1');
      expect(result.llmContent).toContain('Task 1');
      expect(result.metadata?.taskId).toBe('1');
      expect(result.metadata?.todoCount).toBe(1);
    });

    it('should create multiple tasks with sequential IDs', async () => {
      await createTool.execute(
        { content: 'Task 1' },
        new AbortController().signal,
      );
      const result = await createTool.execute(
        { content: 'Task 2', description: 'Details for task 2' },
        new AbortController().signal,
      );

      expect(result.metadata?.taskId).toBe('2');
      expect(result.metadata?.todoCount).toBe(2);
      expect(result.llmContent).toContain('Task 2');
    });

    it('should start all tasks as pending', async () => {
      await createTool.execute(
        { content: 'Task 1' },
        new AbortController().signal,
      );

      const items = getCurrentTodos();
      expect(items[0].status).toBe('pending');
    });

    it('should use content as activeForm fallback', async () => {
      await createTool.execute(
        { content: 'Fix the bug' },
        new AbortController().signal,
      );

      const items = getCurrentTodos();
      expect(items[0].activeForm).toBe('Fix the bug');
    });

    it('should use custom activeForm when provided', async () => {
      await createTool.execute(
        { content: 'Fix the bug', activeForm: 'Fixing the bug' },
        new AbortController().signal,
      );

      const items = getCurrentTodos();
      expect(items[0].activeForm).toBe('Fixing the bug');
    });

    it('should reject empty content', async () => {
      const result = await createTool.execute(
        { content: '' },
        new AbortController().signal,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('content is required');
    });

    it('should handle abort signal', async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await createTool.execute(
        { content: 'Task 1' },
        controller.signal,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cancelled');
    });

    it('should report correct tool name', () => {
      expect(createTool.name).toBe('TodoCreate');
    });
  });

  describe('TodoUpdate', () => {
    beforeEach(async () => {
      // Create some tasks to update
      await createTool.execute(
        { content: 'Task 1', activeForm: 'Doing Task 1' },
        new AbortController().signal,
      );
      await createTool.execute(
        { content: 'Task 2', activeForm: 'Doing Task 2' },
        new AbortController().signal,
      );
    });

    it('should update task status', async () => {
      const result = await updateTool.execute(
        { taskId: '1', status: 'in_progress' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('in_progress');
      expect(getCurrentTodos().find(t => t.id === '1')?.status).toBe('in_progress');
    });

    it('should strip # prefix from taskId', async () => {
      const result = await updateTool.execute(
        { taskId: '#1', status: 'in_progress' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(getCurrentTodos().find(t => t.id === '1')?.status).toBe('in_progress');
    });

    it('should update task content', async () => {
      const result = await updateTool.execute(
        { taskId: '1', content: 'Updated Task 1' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(getCurrentTodos().find(t => t.id === '1')?.content).toBe('Updated Task 1');
    });

    it('should reject unknown task ID', async () => {
      const result = await updateTool.execute(
        { taskId: '999', status: 'completed' },
        new AbortController().signal,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('#999 not found');
    });

    it('should reject invalid status', async () => {
      const result = await updateTool.execute(
        { taskId: '1', status: 'invalid' as any },
        new AbortController().signal,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid status');
    });

    it('should warn on multiple in_progress', async () => {
      await updateTool.execute(
        { taskId: '1', status: 'in_progress' },
        new AbortController().signal,
      );

      const result = await updateTool.execute(
        { taskId: '2', status: 'in_progress' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true); // warns, doesn't reject
      expect(result.llmContent).toContain('also in_progress');
    });

    it('should track completion', async () => {
      await updateTool.execute(
        { taskId: '1', status: 'in_progress' },
        new AbortController().signal,
      );
      const result = await updateTool.execute(
        { taskId: '1', status: 'completed' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(getCurrentTodos().find(t => t.id === '1')?.status).toBe('completed');
    });

    it('should handle abort signal', async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await updateTool.execute(
        { taskId: '1', status: 'completed' },
        controller.signal,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cancelled');
    });

    it('should report correct tool name', () => {
      expect(updateTool.name).toBe('TodoUpdate');
    });

    describe('Batch Updates', () => {
      beforeEach(async () => {
        // Add a third task for batch testing
        await createTool.execute(
          { content: 'Task 3' },
          new AbortController().signal,
        );
      });

      it('should update multiple tasks by comma-separated IDs', async () => {
        const result = await updateTool.execute(
          { taskId: '1,2,3', status: 'completed' },
          new AbortController().signal,
        );

        expect(result.success).toBe(true);
        expect(result.llmContent).toContain('Updated 3 task(s)');
        expect(result.metadata?.updatedCount).toBe(3);
        expect(getCurrentTodos().every(t => t.status === 'completed')).toBe(true);
      });

      it('should handle batch with # prefixes and spaces', async () => {
        const result = await updateTool.execute(
          { taskId: '#1, #2, #3', status: 'in_progress' },
          new AbortController().signal,
        );

        expect(result.success).toBe(true);
        expect(result.metadata?.updatedCount).toBe(3);
      });

      it('should report not-found IDs in batch', async () => {
        const result = await updateTool.execute(
          { taskId: '1,999,2', status: 'completed' },
          new AbortController().signal,
        );

        expect(result.success).toBe(true);
        expect(result.llmContent).toContain('Updated 2 task(s)');
        expect(result.llmContent).toContain('Not found');
        expect(result.llmContent).toContain('#999');
      });

      it('should reject batch without status', async () => {
        const result = await updateTool.execute(
          { taskId: '1,2', content: 'nope' },
          new AbortController().signal,
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Batch update requires a status');
      });
    });
  });

  describe('TodoList', () => {
    it('should show empty list', async () => {
      const result = await listTool.execute(
        {},
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('No tasks');
      expect(result.metadata?.todoCount).toBe(0);
    });

    it('should show all tasks with status icons', async () => {
      await createTool.execute(
        { content: 'Task 1' },
        new AbortController().signal,
      );
      await createTool.execute(
        { content: 'Task 2' },
        new AbortController().signal,
      );
      await updateTool.execute(
        { taskId: '1', status: 'in_progress' },
        new AbortController().signal,
      );

      const result = await listTool.execute(
        {},
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('▶ #1'); // in_progress
      expect(result.llmContent).toContain('○ #2'); // pending
      expect(result.metadata?.inProgressCount).toBe(1);
      expect(result.metadata?.pendingCount).toBe(1);
    });

    it('should show summary counts', async () => {
      await createTool.execute(
        { content: 'Task 1' },
        new AbortController().signal,
      );
      await createTool.execute(
        { content: 'Task 2' },
        new AbortController().signal,
      );
      await createTool.execute(
        { content: 'Task 3' },
        new AbortController().signal,
      );
      await updateTool.execute(
        { taskId: '1', status: 'completed' },
        new AbortController().signal,
      );
      await updateTool.execute(
        { taskId: '2', status: 'in_progress' },
        new AbortController().signal,
      );

      const result = await listTool.execute(
        {},
        new AbortController().signal,
      );

      // Summary format: "1/3 completed, 1 in progress, 1 pending"
      expect(result.llmContent).toContain('1/3 completed');
      expect(result.llmContent).toContain('1 in progress');
      expect(result.llmContent).toContain('1 pending');
      expect(result.metadata?.completedCount).toBe(1);
      expect(result.metadata?.inProgressCount).toBe(1);
      expect(result.metadata?.pendingCount).toBe(1);
    });

    it('should handle abort signal', async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await listTool.execute({}, controller.signal);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cancelled');
    });

    it('should report correct tool name', () => {
      expect(listTool.name).toBe('TodoList');
    });
  });

  describe('Shared State', () => {
    it('should share state across all three tools', async () => {
      // Create via TodoCreate
      await createTool.execute(
        { content: 'Shared task' },
        new AbortController().signal,
      );

      // Update via TodoUpdate
      await updateTool.execute(
        { taskId: '1', status: 'in_progress' },
        new AbortController().signal,
      );

      // Verify via TodoList
      const result = await listTool.execute(
        {},
        new AbortController().signal,
      );

      expect(result.llmContent).toContain('▶ #1');
      expect(result.llmContent).toContain('Shared task');
      expect(result.metadata?.inProgressCount).toBe(1);
    });

    it('should reset cleanly between tests', () => {
      // This test relies on beforeEach resetTodoState
      expect(getCurrentTodos()).toHaveLength(0);
    });

    it('getCurrentTodos should return sorted by ID', async () => {
      await createTool.execute(
        { content: 'First' },
        new AbortController().signal,
      );
      await createTool.execute(
        { content: 'Second' },
        new AbortController().signal,
      );
      await createTool.execute(
        { content: 'Third' },
        new AbortController().signal,
      );

      const items = getCurrentTodos();
      expect(items).toHaveLength(3);
      expect(items[0].content).toBe('First');
      expect(items[1].content).toBe('Second');
      expect(items[2].content).toBe('Third');
    });
  });
});
