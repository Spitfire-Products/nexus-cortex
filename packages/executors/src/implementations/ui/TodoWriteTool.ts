/**
 * Split-Tool Todo Executors — TodoCreate, TodoUpdate, TodoList
 *
 * Three targeted tools matching the TaskCreate/TaskUpdate/TaskList.
 * Key design decisions:
 * - TodoCreate/TodoUpdate return ONLY the affected task (compact output)
 * - TodoList returns the full list (use it when you need the overview)
 * - TodoUpdate accepts multiple taskIds for batch status changes
 * - Shared in-memory state via module-level Map
 */

import { BaseTool, type ToolResult } from '../../base/index.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface TodoItem {
  id: string;
  content: string;
  description: string;
  activeForm: string;
  status: TodoStatus;
  createdAt: number;
  updatedAt: number;
}

// ── Shared State ─────────────────────────────────────────────────────────────

const todos = new Map<string, TodoItem>();
let nextId = 1;

/** Reset state (for testing) */
export function resetTodoState(): void {
  todos.clear();
  nextId = 1;
}

/** Get current todos (for SystemReminderInjector) */
export function getCurrentTodos(): TodoItem[] {
  return Array.from(todos.values()).sort(
    (a, b) => parseInt(a.id) - parseInt(b.id),
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_ICON: Record<string, string> = {
  pending: '○',
  in_progress: '▶',
  completed: '✓',
};

function formatTask(t: TodoItem): string {
  const icon = STATUS_ICON[t.status] ?? '?';
  let line = `${icon} #${t.id} [${t.status}] ${t.content}`;
  if (t.description) line += `\n    ${t.description}`;
  return line;
}

function formatSummary(): string {
  const sorted = getCurrentTodos();
  const pending = sorted.filter((t) => t.status === 'pending').length;
  const inProgress = sorted.filter((t) => t.status === 'in_progress').length;
  const completed = sorted.filter((t) => t.status === 'completed').length;
  return `${completed}/${todos.size} completed, ${inProgress} in progress, ${pending} pending`;
}

function formatTodoList(): string {
  if (todos.size === 0) return 'No tasks.';
  const sorted = getCurrentTodos();
  const lines = sorted.map(formatTask);
  lines.push('');
  lines.push(`Summary: ${formatSummary()}`);
  return lines.join('\n');
}

function cleanTaskId(raw: string): string {
  // Strip prefixes models commonly add: "#1" → "1"
  return raw.replace(/^#/, '');
}

// ── TodoCreate ───────────────────────────────────────────────────────────────

export interface TodoCreateParams {
  content: string;
  description?: string;
  activeForm?: string;
}

export class TodoCreateTool extends BaseTool<TodoCreateParams, ToolResult> {
  constructor(config: ExecutorConfig) {
    super(
      'TodoCreate',
      'TodoCreate',
      `Create a task for tracking multi-step work. Call once per task. All start as pending.

For each task you create, follow this lifecycle:
  TodoUpdate(taskId, status="in_progress") -> do the work -> TodoUpdate(taskId, status="completed")

WHEN TO USE: Tasks with 3+ steps. SKIP FOR: trivial single-step tasks.`,
      {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description:
              'Brief task title in imperative form (e.g., "Fix authentication bug")',
          },
          description: {
            type: 'string',
            description: 'Detailed description of what needs to be done',
          },
          activeForm: {
            type: 'string',
            description:
              'Present continuous form shown while in progress (e.g., "Fixing authentication bug")',
          },
        },
        required: ['content'],
      },
    );
  }

  validateToolParams(params: TodoCreateParams): string | null {
    if (!params.content || !params.content.trim()) {
      return 'content is required';
    }
    return null;
  }

  getDescription(params: TodoCreateParams): string {
    return `Creating task: ${params.content}`;
  }

  async execute(
    params: TodoCreateParams,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    const startTime = Date.now();

    if (signal.aborted) {
      return {
        ...this.createErrorResult('Cancelled'),
        metadata: { executionTime: Date.now() - startTime },
      };
    }

    const validationError = this.validateToolParams(params);
    if (validationError) {
      return {
        ...this.createErrorResult(validationError),
        metadata: { executionTime: Date.now() - startTime },
      };
    }

    const id = String(nextId++);
    const now = Date.now();

    const item: TodoItem = {
      id,
      content: params.content.trim(),
      description: params.description?.trim() ?? '',
      activeForm: params.activeForm?.trim() ?? params.content.trim(),
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    todos.set(id, item);

    // Compact output: just the created task + summary line
    const output = `Created task #${id}: ${item.content} [pending]\n${formatSummary()}`;

    return {
      ...this.createSuccessResult(output),
      metadata: {
        executionTime: Date.now() - startTime,
        taskId: id,
        todoCount: todos.size,
      },
    };
  }
}

// ── TodoUpdate ───────────────────────────────────────────────────────────────

export interface TodoUpdateParams {
  taskId: string;
  status?: TodoStatus;
  content?: string;
  description?: string;
  activeForm?: string;
}

export class TodoUpdateTool extends BaseTool<TodoUpdateParams, ToolResult> {
  constructor(config: ExecutorConfig) {
    super(
      'TodoUpdate',
      'TodoUpdate',
      `Update task status or details by ID.

LIFECYCLE — follow for every task:
  TodoUpdate(taskId, status="in_progress")  <- before starting work
  TodoUpdate(taskId, status="completed")    <- after finishing work

Supports batch: pass comma-separated IDs (e.g., taskId="1,2,3") to update multiple tasks at once.
Task IDs are plain numbers (e.g., "1", "2"). Do not include "#".`,
      {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            description:
              'Task ID(s) to update. Single: "1". Batch: "1,2,3".',
          },
          status: {
            type: 'string',
            enum: ['pending', 'in_progress', 'completed'],
            description: 'New status for the task(s)',
          },
          content: {
            type: 'string',
            description: 'New task title (single task only)',
          },
          description: {
            type: 'string',
            description: 'New description (single task only)',
          },
          activeForm: {
            type: 'string',
            description: 'New active form (single task only)',
          },
        },
        required: ['taskId'],
      },
    );
  }

  validateToolParams(params: TodoUpdateParams): string | null {
    if (!params.taskId) {
      return 'taskId is required';
    }
    if (
      params.status &&
      !['pending', 'in_progress', 'completed'].includes(params.status)
    ) {
      return `Invalid status: ${params.status}. Must be pending, in_progress, or completed.`;
    }
    return null;
  }

  getDescription(params: TodoUpdateParams): string {
    if (params.status) {
      return `Updating task #${params.taskId} -> ${params.status}`;
    }
    return `Updating task #${params.taskId}`;
  }

  async execute(
    params: TodoUpdateParams,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    const startTime = Date.now();

    if (signal.aborted) {
      return {
        ...this.createErrorResult('Cancelled'),
        metadata: { executionTime: Date.now() - startTime },
      };
    }

    const validationError = this.validateToolParams(params);
    if (validationError) {
      return {
        ...this.createErrorResult(validationError),
        metadata: { executionTime: Date.now() - startTime },
      };
    }

    // Parse batch IDs: "1,2,3" or "#1, #2" or just "1"
    const rawIds = params.taskId.split(',').map((s) => cleanTaskId(s.trim()));
    const ids = rawIds.filter((id) => id.length > 0);

    if (ids.length === 0) {
      return {
        ...this.createErrorResult('No valid task IDs provided.'),
        metadata: { executionTime: Date.now() - startTime },
      };
    }

    // Batch mode: only status updates
    if (ids.length > 1) {
      if (!params.status) {
        return {
          ...this.createErrorResult(
            'Batch update requires a status. Provide status to update multiple tasks.',
          ),
          metadata: { executionTime: Date.now() - startTime },
        };
      }

      const results: string[] = [];
      const notFound: string[] = [];
      for (const id of ids) {
        const item = todos.get(id);
        if (!item) {
          notFound.push(id);
          continue;
        }
        item.status = params.status;
        item.updatedAt = Date.now();
        results.push(`#${id}: ${item.content} -> ${params.status}`);
      }

      let output = `Updated ${results.length} task(s): ${params.status}`;
      if (notFound.length > 0) {
        output += `\nNot found: ${notFound.map((id) => '#' + id).join(', ')}`;
      }
      output += `\n${formatSummary()}`;

      return {
        ...this.createSuccessResult(output),
        metadata: {
          executionTime: Date.now() - startTime,
          updatedCount: results.length,
          todoCount: todos.size,
        },
      };
    }

    // Single task update
    const taskId = ids[0]!;
    const item = todos.get(taskId);
    if (!item) {
      return {
        ...this.createErrorResult(
          `Task #${taskId} not found. Use TodoList to see all tasks.`,
        ),
        metadata: { executionTime: Date.now() - startTime },
      };
    }

    // Warn (don't reject) if setting multiple in_progress
    let warning = '';
    if (params.status === 'in_progress') {
      const currentInProgress = Array.from(todos.values()).filter(
        (t) => t.status === 'in_progress' && t.id !== taskId,
      );
      if (currentInProgress.length > 0) {
        warning = ` (note: #${currentInProgress[0]!.id} also in_progress)`;
      }
    }

    // Apply updates
    if (params.status) item.status = params.status;
    if (params.content) item.content = params.content.trim();
    if (params.description !== undefined)
      item.description = params.description.trim();
    if (params.activeForm) item.activeForm = params.activeForm.trim();
    item.updatedAt = Date.now();

    // Compact output: just the affected task + summary
    const output = `${formatTask(item)}${warning}\n${formatSummary()}`;

    return {
      ...this.createSuccessResult(output),
      metadata: {
        executionTime: Date.now() - startTime,
        taskId: item.id,
        todoCount: todos.size,
      },
    };
  }
}

// ── TodoList ─────────────────────────────────────────────────────────────────

export interface TodoListParams {
  // No required params
}

export class TodoListTool extends BaseTool<TodoListParams, ToolResult> {
  constructor(config: ExecutorConfig) {
    super(
      'TodoList',
      'TodoList',
      `List all tasks with their current status, IDs, and progress summary.`,
      {
        type: 'object',
        properties: {},
        required: [],
      },
    );
  }

  validateToolParams(_params: TodoListParams): string | null {
    return null;
  }

  getDescription(_params: TodoListParams): string {
    return 'Listing tasks';
  }

  async execute(
    _params: TodoListParams,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    const startTime = Date.now();

    if (signal.aborted) {
      return {
        ...this.createErrorResult('Cancelled'),
        metadata: { executionTime: Date.now() - startTime },
      };
    }

    return {
      ...this.createSuccessResult(formatTodoList()),
      metadata: {
        executionTime: Date.now() - startTime,
        todoCount: todos.size,
        pendingCount: Array.from(todos.values()).filter(
          (t) => t.status === 'pending',
        ).length,
        inProgressCount: Array.from(todos.values()).filter(
          (t) => t.status === 'in_progress',
        ).length,
        completedCount: Array.from(todos.values()).filter(
          (t) => t.status === 'completed',
        ).length,
      },
    };
  }
}
