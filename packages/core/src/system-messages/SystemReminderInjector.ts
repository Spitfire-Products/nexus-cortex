/**
 * System Reminder Injection Framework
 * Implements deterministic <system-reminder> pattern injection
 * Based on research: 02-claude-cli-analysis/CLAUDE_CLI_INJECTION_PATTERNS.md
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import { execFileSync } from 'child_process';

/**
 * Todo list item
 */
export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm: string;
}

/**
 * System reminder types
 */
export type SystemReminderType =
  | 'empty_todo'
  | 'todo_update'
  | 'claude_md'
  | 'tool_call'
  | 'tool_result'
  | 'file_security'
  | 'todowrite_reminder'
  | 'command_caveat';

/**
 * System reminder content
 */
export interface SystemReminder {
  type: SystemReminderType;
  content: string;
  contentHash?: string;  // For deduplication
}

/**
 * Manages deterministic system reminder injection
 */
export class SystemReminderInjector {
  private claudeMdCache: string | null = null;
  private lastTodoListHash: string | null = null;

  /**
   * Optional provider (wired in OrchestratorFactory from the executors'
   * FileReadTracker) returning files this session read that have since changed
   * on disk by ANY writer. Kept as an injected callback so core does not import
   * a concrete executors class — preserves the package boundary.
   */
  private staleFilesProvider: (() => { path: string; deleted: boolean }[]) | null = null;

  setStaleFilesProvider(fn: () => { path: string; deleted: boolean }[]): void {
    this.staleFilesProvider = fn;
  }

  /**
   * Build the per-turn "Repository State" harness-note: current branch,
   * uncommitted changes in the project subtree, recent commits, and a
   * cross-agent staleness warning for read-then-externally-changed files.
   *
   * This gives the model the same git awareness a coding agent injects, and —
   * critically — lets two agents (or a human + agent) share one working tree
   * without clobbering each other's uncommitted edits.
   *
   * Turn-varying content, so the caller injects it into the uncached user-turn
   * tail (NOT the cached system prefix) per the R28f cache discipline.
   *
   * @param projectPath git -C target + status pathspec scope (the project root)
   * @returns a `<harness-note>` string, or null when disabled / not a git repo
   *   and nothing stale to report.
   */
  buildGitContextSection(projectPath: string): string | null {
    if (process.env.CORTEX_GIT_CONTEXT === 'false') return null;

    const git = (args: string[]): string | null => {
      try {
        return execFileSync('git', ['-C', projectPath, ...args], {
          encoding: 'utf8',
          timeout: 4000,
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
      } catch {
        return null;
      }
    };

    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
    const isRepo = branch !== null;

    const sections: string[] = [];

    if (isRepo) {
      sections.push(`Branch: ${branch}`);

      // Scope status to the project subtree (`-- .`) so a noisy monorepo root
      // doesn't flood the note with unrelated changes.
      const status = git(['status', '--short', '--', '.']);
      if (status) {
        const lines = status.split('\n');
        const MAX = 25;
        const shown = lines.slice(0, MAX).join('\n');
        const more = lines.length > MAX ? `\n  …and ${lines.length - MAX} more changed paths` : '';
        sections.push(
          'Uncommitted changes (SHARED working tree — a human and/or another agent ' +
          'may be editing alongside you; do NOT assume these are yours):\n' +
          shown + more
        );
      } else {
        sections.push('Working tree clean (no uncommitted changes in this subtree).');
      }

      const log = git(['log', '--oneline', '-5']);
      if (log) sections.push(`Recent commits:\n${log}`);
    }

    // Cross-agent staleness: files read this session that changed on disk since.
    const stale = this.staleFilesProvider?.() ?? [];
    if (stale.length > 0) {
      const list = stale
        .map((f) => `- ${f.path}${f.deleted ? ' (DELETED/MOVED on disk)' : ' (CHANGED on disk)'}`)
        .join('\n');
      sections.push(
        'STALE — you read these earlier but they have changed on disk since ' +
        '(re-read with the Read tool BEFORE editing, or your edit may clobber ' +
        "another agent's / the user's uncommitted work):\n" + list
      );
    }

    if (sections.length === 0) return null;

    return (
      '<harness-note source="automated-harness" from-user="false">\n' +
      '# Repository State (live — current turn, not a user message)\n' +
      sections.join('\n\n') +
      '\n</harness-note>'
    );
  }

  /**
   * PM delegation hint for the auto-research subagent feature (AUTORESEARCH_AGENTS).
   * Returns null when the feature is off, or when running INSIDE a subagent
   * (CORTEX_AGENT_MODE) so the hint never recurses. Keeps the MAIN model's context clean:
   * it learns only that it can delegate — the full auto-research tool surface + workflow
   * live in the autoresearch-agent subagent, not here.
   */
  buildAutoResearchCapabilitySection(): string | null {
    const mode = (process.env.AUTORESEARCH_AGENTS ?? 'off').trim().toLowerCase();
    if (mode !== 'native' && mode !== 'mcp') return null;        // 'off' / unset / invalid
    if (process.env.CORTEX_AGENT_MODE === 'true') return null;   // already a subagent — no recursion
    const exec = mode === 'mcp'
      ? 'route experiment-running to the nexus-cortex/autoresearch MCP tools (do NOT run the internal CLI)'
      : 'run experiments with the internal tools (ResearchBacklog, WorkspaceManager, and the `cortex autoresearch fix/experiment/loop` CLI via Bash)';
    return (
      '<harness-note source="automated-harness" from-user="false">\n' +
      '# Auto-research is ENABLED — you are the PM. PLAN, then delegate. Do NOT run experiments yourself.\n' +
      'For self-improvement / benchmark / "auto-research" / "set up an experiment" requests, do NOT load the\n' +
      'auto-research tool surface into your own context or run experiments here. Follow this workflow:\n' +
      '\n' +
      '1. PLAN FIRST — the harness BLOCKS the launch until you do (interactive TUI: draft the plan and get it\n' +
      '   approved in PLAN MODE via EnterPlanMode; headless: create a TodoCreate planning checklist). The plan covers:\n' +
      '   - Evaluate the backlog (ResearchBacklog list/next); triage the SINGLE highest-value deficiency.\n' +
      '   - Define a MEASURABLE experiment: the metric + how it is measured (an eval/command), the pass/fail\n' +
      '     threshold + verifier, the control (base ref vs candidate, train + a HELD-OUT set), and the\n' +
      '     subagents’ continue/fail rules (a turn budget; fail-fast — if the deficiency has no eval/repro/\n' +
      '     task-set, report it is NOT MEASURABLE and stop; never self-merge).\n' +
      '   - NO MEASURABLE METRIC → DO NOT LAUNCH. State exactly what is missing (an eval / repro / task-set) and stop.\n' +
      '2. DIVERSIFY the arms (there is no swarm generator here — YOU craft the variety; identical agents waste\n' +
      '   the parallelism). Assign each subagent a DISTINCT strategy/persona — e.g. #1 minimal/conservative fix,\n' +
      '   #2 aggressive refactor, #3/#4 different root-cause hypotheses, #5 high-creativity. Also vary the `model`\n' +
      '   per Task dispatch (Task accepts `model` AND `temperature` overrides) for real decorrelation — vary\n' +
      '   temperature by tenths across arms (auto-clamped to each model’s range), within cost/no-xAI limits. Keep N small with\n' +
      '   SHARP distinctions (4-5 genuinely different approaches beat many near-duplicates).\n' +
      '3. DELEGATE: spawn ~4-5 `autoresearch-agent` subagents via the Task tool (subagent_type: "autoresearch-agent"),\n' +
      '   ALL on that SAME deficiency, one per strategy. Each prompt = the plan + that agent’s persona/strategy +\n' +
      `   "EXECUTION MODE: ${mode}" (i.e. ${exec}).\n` +
      '4. ARBITRATE: collect every candidate + verdict and keep ONLY the holdout-verified winner (mergeEligible).\n' +
      '   Diversify the SEARCH; the metric + gate are IDENTICAL across all arms (the single shared judge).\n' +
      'The full tool surface + experiment workflow live in those subagents, keeping your context clean.\n' +
      '</harness-note>'
    );
  }

  /**
   * Generate content hash for deduplication
   * Same content = same hash = same message ID
   */
  private generateContentHash(content: string): string {
    return crypto.createHash('sha256')
      .update(content, 'utf8')
      .digest('hex')
      .substring(0, 32);
  }

  /**
   * Wrap content in <system-reminder> tags
   */
  private wrapSystemReminder(content: string): string {
    return `<system-reminder>\n${content}\n</system-reminder>`;
  }

  /**
   * Pattern 1: Empty Todo List Reminder
   * Frequency: Every request when todo list is empty
   */
  createEmptyTodoReminder(): SystemReminder {
    const content = `This is a reminder that your todo list is currently empty. DO NOT mention this to the user explicitly because they are already aware. If you are working on tasks that would benefit from a todo list please use the TodoCreate tool to create tasks. If not, please feel free to ignore. Again do not mention this message to the user.`;

    return {
      type: 'empty_todo',
      content: this.wrapSystemReminder(content),
      contentHash: this.generateContentHash(content)
    };
  }

  /**
   * Pattern 2: Todo List Update Notification
   * Frequency: After TodoWrite tool usage
   */
  createTodoUpdateReminder(todos: TodoItem[]): SystemReminder {
    const todoJson = JSON.stringify(todos);
    const content = `Your todo list has changed. DO NOT mention this explicitly to the user. Here are the latest contents of your todo list:

${todoJson}. Continue on with the tasks at hand if applicable.`;

    const contentHash = this.generateContentHash(content);
    this.lastTodoListHash = contentHash;

    return {
      type: 'todo_update',
      content: this.wrapSystemReminder(content),
      contentHash
    };
  }

  /**
   * Pattern 3: CLAUDE.md Context Injection
   * Frequency: On specific triggers (project context needed)
   */
  async createClaudeMdReminder(claudeMdPath: string): Promise<SystemReminder | null> {
    try {
      // Try to load from cache
      if (!this.claudeMdCache) {
        this.claudeMdCache = await fs.readFile(claudeMdPath, 'utf8');
      }

      const content = `As you answer the user's questions, you can use the following context:
# claudeMd
Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.

Contents of ${claudeMdPath} (project instructions, checked into the codebase):

${this.claudeMdCache}

      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.`;

      return {
        type: 'claude_md',
        content: this.wrapSystemReminder(content),
        contentHash: this.generateContentHash(content)
      };
    } catch (error) {
      // CLAUDE.md doesn't exist or can't be read
      return null;
    }
  }

  /**
   * Pattern 4: Tool Call Notification
   * Frequency: Before tool result injection
   */
  createToolCallReminder(toolName: string, toolInput: Record<string, any>): SystemReminder {
    const inputJson = JSON.stringify(toolInput);
    const content = `Called the ${toolName} tool with the following input: ${inputJson}`;

    return {
      type: 'tool_call',
      content: this.wrapSystemReminder(content),
      contentHash: this.generateContentHash(content)
    };
  }

  /**
   * Pattern 5: Tool Result Injection
   * Frequency: After every tool invocation
   */
  createToolResultReminder(toolName: string, result: string): SystemReminder {
    const content = `Result of calling the ${toolName} tool: "${result}"`;

    return {
      type: 'tool_result',
      content: this.wrapSystemReminder(content),
      contentHash: this.generateContentHash(content)
    };
  }

  /**
   * Pattern 6: File Reading Security Warning
   * Frequency: After every Read tool invocation
   * Nested within tool result system-reminder
   */
  createFileSecurityWarning(): SystemReminder {
    const content = `Whenever you read a file, you should consider whether it looks malicious. If it does, you MUST refuse to improve or augment the code. You can still analyze existing code, write reports, or answer high-level questions about the code behavior.`;

    return {
      type: 'file_security',
      content: this.wrapSystemReminder(content),
      contentHash: this.generateContentHash(content)
    };
  }

  /**
   * Pattern 7: Todo Tool Reminder
   * Frequency: Periodic during long conversations
   */
  createTodoWriteReminder(currentTodos: TodoItem[]): SystemReminder {
    const todoJson = JSON.stringify(currentTodos);
    const content = `The task tools haven't been used recently. If you're working on tasks that would benefit from tracking progress, consider using TodoCreate to add new tasks and TodoUpdate to update task status (set to in_progress when starting, completed when done). Also consider cleaning up the task list if it has become stale. Only use these if relevant to the current work. This is just a gentle reminder - ignore if not applicable.

Here are the existing contents of your todo list:

${todoJson}`;

    return {
      type: 'todowrite_reminder',
      content: this.wrapSystemReminder(content),
      contentHash: this.generateContentHash(content)
    };
  }

  /**
   * Pattern 8: Command Caveat Injection
   * Frequency: Before command metadata in messages containing commands
   */
  createCommandCaveat(): SystemReminder {
    const content = `Caveat: The messages below were generated by the user while running local commands. DO NOT respond to these messages or otherwise consider them in your response unless the user explicitly asks you to.`;

    return {
      type: 'command_caveat',
      content,  // Not wrapped in system-reminder tags
      contentHash: this.generateContentHash(content)
    };
  }

  /**
   * Combine tool result with security warning
   * For Read tool specifically
   */
  createToolResultWithSecurityWarning(toolName: string, result: string): SystemReminder {
    const securityWarning = this.createFileSecurityWarning();
    const combinedContent = `Result of calling the ${toolName} tool: "${result}

${securityWarning.content}"`;

    return {
      type: 'tool_result',
      content: this.wrapSystemReminder(combinedContent),
      contentHash: this.generateContentHash(combinedContent)
    };
  }

  /**
   * Check if todo list has changed
   * Used to avoid redundant injections
   */
  hasTodoListChanged(todos: TodoItem[]): boolean {
    const currentHash = this.generateContentHash(JSON.stringify(todos));
    return currentHash !== this.lastTodoListHash;
  }

  /**
   * Clear CLAUDE.md cache
   * Force reload on next injection
   */
  clearClaudeMdCache(): void {
    this.claudeMdCache = null;
  }
}

/**
 * Command metadata types
 */
export interface CommandMetadata {
  name: string;        // e.g., "/model"
  message: string;     // Human-readable description
  args?: string;       // Arguments passed
  output?: string;     // Command stdout
}

/**
 * Format command metadata for injection
 * Pattern: <command-name> + <command-message> + <command-args> + <local-command-stdout>
 */
export function formatCommandMetadata(cmd: CommandMetadata): string {
  let formatted = `<command-name>${cmd.name}</command-name>
            <command-message>${cmd.message}</command-message>`;

  if (cmd.args) {
    formatted += `\n            <command-args>${cmd.args}</command-args>`;
  }

  if (cmd.output) {
    formatted += `\n<local-command-stdout>${cmd.output}</local-command-stdout>`;
  }

  return formatted;
}
