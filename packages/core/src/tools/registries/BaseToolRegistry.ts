/**
 * Base Tool Registry
 *
 * Immutable registry of all 25 hardcoded base tools in pure canonical format.
 * No provider-specific properties - adapters wrap these for each provider.
 *
 * Phase 1: Tool Architecture Refactor
 */

import type { CanonicalToolDefinition, ToolRegistry, ToolCategory } from '../types/CanonicalTool.js';

/**
 * All 25 base tools in pure canonical format
 */
const BASE_TOOLS: CanonicalToolDefinition[] = [
  // =====================================
  // FILE OPERATIONS
  // =====================================
  {
    name: 'Read',
    description: `Reads a file from the local filesystem. You can access any file directly by using this tool.

By default, it reads up to 2000 lines starting from the beginning of the file.
When you already know which part of the file you need, only read that part. This can be important for larger files.
Results are returned using cat -n format, with line numbers starting at 1.
This tool can read images (PNG, JPG, etc), PDFs (.pdf — for large PDFs provide the pages parameter, max 20 pages per request), and Jupyter notebooks (.ipynb — returns all cells with outputs).
Do NOT re-read a file you just edited to verify — Edit would have errored if the change failed, and the harness tracks file state for you.`,
    schema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to the file to read (relative or absolute)'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of lines to read'
        },
        offset: {
          type: 'number',
          description: 'Line number to start reading from'
        }
      },
      required: ['file_path']
    },
    category: 'base',
    discoveryTier: 'essential',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  {
    name: 'Write',
    description: `Writes a file to the local filesystem.

This tool will overwrite the existing file if there is one at the provided path.
If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.
NEVER create documentation files (*.md) or README files unless explicitly requested by the User.`,
    schema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'The absolute path to the file to write (must be absolute, not relative)'
        },
        content: {
          type: 'string',
          description: 'The content to write to the file'
        }
      },
      required: ['file_path', 'content']
    },
    category: 'base',
    discoveryTier: 'essential',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  {
    name: 'WriteBinary',
    description: `Write base64-encoded binary data to a file. Use for images, PDFs, and other binary formats.

GUIDANCE:
- Accepts raw base64 or data URIs (data:image/png;base64,...)
- Auto-detects MIME type from file extension if not provided
- Creates parent directories automatically
- Use for screenshots, generated PDFs, downloaded images`,
    schema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to write (parent directories created automatically)'
        },
        data: {
          type: 'string',
          description: 'Base64-encoded binary content or data URI'
        },
        mime_type: {
          type: 'string',
          description: 'MIME type (auto-detected from extension if omitted)'
        }
      },
      required: ['file_path', 'data']
    },
    category: 'base',
    discoveryTier: 'standard',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  {
    name: 'Edit',
    description: `Performs exact string replacements in files.

You must use your Read tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file.

When editing text from Read tool output, preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: line number + tab. Everything after that is the actual file content to match. Never include any part of the line number prefix in old_string or new_string.

ALWAYS prefer editing existing files over creating new ones.
The edit will FAIL if old_string is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use replace_all to change every instance.
Use replace_all for replacing and renaming strings across the file.`,
    schema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'The absolute path to the file to modify'
        },
        old_string: {
          type: 'string',
          description: 'The text to replace'
        },
        new_string: {
          type: 'string',
          description: 'The text to replace it with (must be different from old_string)'
        },
        replace_all: {
          type: 'boolean',
          description: 'Replace all occurrences of old_string (default false)'
        }
      },
      required: ['file_path', 'old_string', 'new_string']
    },
    category: 'base',
    discoveryTier: 'essential',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  // =====================================
  // SHELL OPERATIONS
  // =====================================
  {
    name: 'Bash',
    description: `Execute bash/shell commands. Working directory persists between calls. Default timeout: 120 seconds (configurable).

Avoid using bash to run cat, head, tail, sed, awk, or echo — use read, edit, or write instead. Reserve bash for actual shell operations that require execution (builds, tests, git, process management).

Always quote file paths containing spaces. Try to use absolute paths and avoid cd — if you must cd, it persists within this Bash call only, not across other tool calls.

DESTRUCTIVE COMMANDS — confirm with user first:
- Deleting: rm -rf, git branch -D, DROP TABLE
- Irreversible: git reset --hard, git push --force, git checkout -- (overwrites uncommitted changes)
- Broad impact: git clean -f, find -delete, pkill/killall
When in doubt, investigate before deleting. If a lock file exists, check what holds it rather than removing it. Resolve merge conflicts rather than discarding changes.

PARALLEL EXECUTION:
- Safe to parallel: ls, pwd, test -f, validation commands, independent greps
- Must be sequential: build→test→validate chains, file mutations, package installs
- Use && to chain sequential commands in a single call

For background execution, set run_in_background: true. Use bash_output to poll results.`,
    schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The bash command to execute. Can use relative paths in shell context.'
        },
        description: {
          type: 'string',
          description: 'Clear description of what this command does'
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 120000)'
        },
        run_in_background: {
          type: 'boolean',
          description: 'Set to true to run this command in the background. Use bash_output to read the output later.'
        },
        dangerouslyDisableSandbox: {
          type: 'boolean',
          description: 'Set this to true to dangerously disable sandbox mode and run commands without sandboxing.'
        },
        persistentSession: {
          type: 'boolean',
          description: 'Set to true to run command in a persistent tmux session. The session survives server restarts and can be inspected later. Requires tmux to be installed.'
        },
        sessionId: {
          type: 'string',
          description: 'ID of the persistent session to use or create. Auto-generated if not provided. Only used when persistentSession=true.'
        },
        captureHistory: {
          type: 'boolean',
          description: 'When using persistent sessions, capture entire scrollback history (not just visible output). Default: false.'
        }
      },
      required: ['command']
    },
    category: 'base',
    discoveryTier: 'essential',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  {
    name: 'BashOutput',
    description: `Retrieve output from a running or completed background bash shell started with run_in_background: true.

- Returns only NEW output since your last check (incremental reads)
- Shows process status: Running or Exited with exit code
- Use repeatedly to poll a long-running command until it completes
- Use filter to search output with regex (e.g., filter: "ERROR|WARN")

WORKFLOW:
1. Start: Bash({ command: "npm test", run_in_background: true }) → returns bash_id
2. Poll: bash_output({ bash_id }) → check status + read new output
3. Done: When status shows "Exited", all output has been captured
4. Cleanup: kill_shell({ shell_id: bash_id }) if process hangs`,
    schema: {
      type: 'object',
      properties: {
        bash_id: {
          type: 'string',
          description: 'The ID of the background shell (returned by Bash with run_in_background: true)'
        },
        filter: {
          type: 'string',
          description: 'Regex to filter output lines (e.g., "ERROR|FAIL" to show only errors)'
        }
      },
      required: ['bash_id']
    },
    category: 'base',
    discoveryTier: 'standard',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  {
    name: 'KillShell',
    description: `Stop a running background bash shell by its ID. Use when a background process hangs, takes too long, or is no longer needed. The shell ID is the same bash_id returned by Bash with run_in_background: true.`,
    schema: {
      type: 'object',
      properties: {
        shell_id: {
          type: 'string',
          description: 'The ID of the background shell to stop (same as bash_id from bash_output)'
        }
      },
      required: ['shell_id']
    },
    category: 'base',
    discoveryTier: 'standard',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  // =====================================
  // SEARCH OPERATIONS
  // =====================================
  {
    name: 'Grep',
    description: `Search for patterns in files using grep.

SEARCH STRATEGY — start narrow, broaden only on zero results:
1. First grep: exact string, current directory, no flags. If matches appear, Read those files — do not keep searching.
2. Match file types to the project language. TypeScript repo → glob:"**/*.ts". Python repo → glob:"**/*.py". Check project context (CORTEX.md) if unsure.
3. Stay in the current project directory. Never search parent directories or sibling projects — they are separate codebases.
4. If zero results: broaden the pattern OR the file type, not both at once. Do not repeat the same search from a different directory.

BEST PRACTICES:
- Accept user's relative paths (e.g., "./src", "tests/")
- Use glob parameter to filter by file type (e.g., "**/*.ts" for TypeScript, "**/*.py" for Python)
- Use output_mode='files_with_matches' to find files first, then Read specific ones
- For code searches: use exact strings or escape special regex chars
- For multi-line patterns, escape newlines properly in regex

CASE SENSITIVITY (important):
- Default is case-sensitive (no -i flag). Keep it that way for:
  - Convention-based patterns that are uppercase by tradition: TODO, FIXME, XXX, HACK, BUG, NOTE
  - Exact symbol/identifier searches (class names, function names, env vars)
  - JSON keys, most config keys, most code tokens
- Only use -i:true when the user explicitly asks OR you're matching free-form natural-language content
- A case-insensitive search for "TODO" will also match "Todo" in identifiers like TodoItem, TodoWrite, todomethod — inflating counts dramatically. If counts seem unexpectedly high, re-run case-sensitive and verify.

VERIFY AGGREGATES:
- When output_mode='count' returns large numbers (>20 per file or >50 total), sample one match with output_mode='content' -n:true to confirm the pattern is matching what was intended. This catches case-insensitive over-matching and ambiguous regexes before you report the result.`,
    schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'The regex pattern to search for'
        },
        path: {
          type: 'string',
          description: 'File or directory to search in. Use "." or a relative/project-absolute path — never "/" or parent directories outside the project.'
        },
        glob: {
          type: 'string',
          description: 'Glob pattern to filter files'
        },
        output_mode: {
          type: 'string',
          enum: ['content', 'files_with_matches', 'count'],
          description: 'Output mode'
        },
        '-A': {
          type: 'number',
          description: 'Number of lines to show after each match (rg -A). Requires output_mode: "content"'
        },
        '-B': {
          type: 'number',
          description: 'Number of lines to show before each match (rg -B). Requires output_mode: "content"'
        },
        '-C': {
          type: 'number',
          description: 'Number of lines to show before and after each match (rg -C). Requires output_mode: "content"'
        },
        '-n': {
          type: 'boolean',
          description: 'Show line numbers in output (rg -n). Requires output_mode: "content"'
        },
        '-i': {
          type: 'boolean',
          description: 'Case insensitive search (rg -i)'
        },
        type: {
          type: 'string',
          description: 'File type to search (rg --type). Common types: ts, js, py, rust, go, java'
        },
        head_limit: {
          type: 'number',
          description: 'Limit output to first N lines/entries, equivalent to "| head -N"'
        },
        multiline: {
          type: 'boolean',
          description: 'Enable multiline mode where . matches newlines and patterns can span lines (rg -U --multiline-dotall)'
        }
      },
      required: ['pattern']
    },
    category: 'base',
    discoveryTier: 'essential',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  {
    name: 'Glob',
    description: `Find files matching a pattern.

BEST PRACTICES:
- Accept user's relative paths for 'path' parameter
- Match file type to project language: "**/*.ts" (TypeScript), "**/*.js" (JavaScript), "**/*.py" (Python)
- Pattern examples: "*.test.ts", "**/config.json", "src/**/*.ts"
- Returns files sorted by modification time (newest first)
- Stay in the current project directory — never glob parent or sibling directories`,
    schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'The glob pattern to match'
        },
        path: {
          type: 'string',
          description: 'Directory to search in'
        }
      },
      required: ['pattern']
    },
    category: 'base',
    discoveryTier: 'essential',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  // =====================================
  // WEB OPERATIONS
  // =====================================
  {
    name: 'WebSearch',
    description: `Search the web for current information. Use when you need facts, documentation, API references, or recent events beyond your training data.

WHEN TO USE: verifying claims, finding library docs, checking current versions, looking up error messages, researching APIs or services.
WHEN NOT TO USE: if the answer is in the codebase (use grep/read), or if you need to interact with the page (use browse).

Results are text snippets from search engines. May not include full page content — use web_fetch to read a specific URL from the results.`,
    schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query'
        },
        allowed_domains: {
          type: 'array',
          items: { type: 'string' },
          description: 'Only include results from these domains'
        },
        blocked_domains: {
          type: 'array',
          items: { type: 'string' },
          description: 'Never include results from these domains'
        },
        mode: {
          type: 'string',
          enum: ['fast', 'interactive'],
          description: "Default 'fast' uses the provider's native search. Set to 'interactive' to dispatch a nexus-browser subagent that can navigate, scroll, and interact with pages — slower but works when provider-native search isn't enough."
        }
      },
      required: ['query']
    },
    category: 'base',
    discoveryTier: 'essential',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  {
    name: 'WebFetch',
    description: `Fetch and read content from a specific URL. Returns the page's text content (HTML stripped).

WHEN TO USE: reading documentation pages, API references, blog posts, changelogs, or any URL you already have.
WHEN NOT TO USE: if the page requires JavaScript rendering, login, or interaction (use browse instead). If you need to search first and don't have a URL (use web_search).

The 'prompt' parameter guides what to extract — use it to focus on specific sections rather than getting the entire page.`,
    schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to fetch content from'
        },
        prompt: {
          type: 'string',
          description: 'Instructions for analyzing the content'
        },
        mode: {
          type: 'string',
          enum: ['fast', 'interactive'],
          description: "Default 'fast' uses the provider's native fetch. Set to 'interactive' to dispatch a nexus-browser subagent for JS-rendered SPAs, auth-gated pages, or anything that needs interaction."
        }
      },
      required: ['url', 'prompt']
    },
    category: 'base',
    discoveryTier: 'essential',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  {
    name: 'Browse',
    description: 'Drive a headless browser via a nexus-browser subagent. Use for interactive page work (click, form-fill, login), JS-rendered SPA scraping, or anti-bot bypass. For static text search prefer web_search; for plain URL reads prefer web_fetch.',
    schema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'What the browser subagent should accomplish. Be specific about the success criterion — what data or outcome should it return?'
        },
        url: {
          type: 'string',
          description: 'Optional starting URL. If omitted, the subagent picks a starting page based on the task.'
        },
        model: {
          type: 'string',
          description: "Optional model override. Defaults to parent's current model. Accepts Claude aliases (sonnet, opus, haiku), 'inherit', or any registered model ID (e.g. deepseek-v4-pro, grok-4.3) for cross-provider dispatch."
        }
      },
      required: ['task']
    },
    category: 'base',
    discoveryTier: 'essential',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  {
    name: 'SandboxTransfer',
    description: 'Run a command in a remote sandbox (via MCP run_command) and save its stdout to a local file. Use for transferring PDFs, images, or data generated in the sandbox to the local filesystem.',
    schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Shell command to run in the sandbox. Stdout is captured and written to local_path.'
        },
        local_path: {
          type: 'string',
          description: 'Local file path to write the output to.'
        },
        encoding: {
          type: 'string',
          enum: ['base64', 'utf8'],
          description: 'How to decode stdout: "base64" (default) for binary, "utf8" for text.'
        },
        mime_type: {
          type: 'string',
          description: 'MIME type. Auto-detected from extension if omitted.'
        },
        timeout: {
          type: 'number',
          description: 'Command timeout in milliseconds (default: 60000).'
        },
        server: {
          type: 'string',
          description: 'MCP server name (default: "nexus-browser").'
        }
      },
      required: ['command', 'local_path']
    },
    category: 'base',
    discoveryTier: 'standard',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  // =====================================
  // AGENT OPERATIONS
  // =====================================
  {
    name: 'Task',
    description: `Launch a sub-agent or list available agents. Use subagent_type "list" to discover agents before dispatching.

When to use: broad codebase exploration (3+ queries), parallelizable independent work, tasks matching a specialized agent profile, or protecting main context from excessive output.

When NOT to use: single targeted lookups (use read/grep directly), tasks where you need the result to inform your very next step (use tools directly), or when you'd be delegating understanding instead of doing synthesis yourself.

WRITING THE PROMPT — Brief the agent like a colleague who just walked in:
- Explain what you're trying to accomplish and WHY
- Describe what you've already learned or ruled out
- Give enough context that the agent can make judgment calls
- Include file paths, line numbers, what specifically to change
- If you need a short response, say so ("report in under 200 words")

PARALLELISM: When launching multiple agents for independent work, make all calls in the same response so they run concurrently.`,
    schema: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'A short (3-5 word) description of what the agent will do'
        },
        prompt: {
          type: 'string',
          description: 'The task for the agent to perform. Must be self-contained — the agent has no memory of this conversation.'
        },
        subagent_type: {
          type: 'string',
          description: 'Use "list" to discover available agents, or pass an agent name to launch it'
        },
        model: {
          type: 'string',
          description: "Optional model override. Defaults to parent's current model ('inherit'). Accepts Claude aliases (sonnet, opus, haiku), 'inherit', any registered model ID (e.g. deepseek-v4-pro, grok-4.3, gemini-2.5-flash) for cross-provider dispatch, OR 'auto' to let the model router pick the most efficient model for the task. 'auto' delegates the choice to the router (works even when global routing is off), but only routes when the router has trustworthy benchmark data for the task type — otherwise it safely inherits the parent model. Use for cross-model benchmarks, cheap-model fanout, capability-tier routing, or hands-off auto-optimization via 'auto'."
        },
        resume: {
          type: 'string',
          description: 'Optional session ID to resume a previous sub-agent session'
        }
      },
      required: ['description', 'prompt', 'subagent_type']
    },
    category: 'base',
    discoveryTier: 'essential',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  // =====================================
  // UI/UX OPERATIONS
  // =====================================
  {
    name: 'TodoCreate',
    description: `Create a task for tracking multi-step work. All start as pending. Follow lifecycle: todo_update(in_progress) -> work -> todo_update(completed).`,
    schema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Brief task title in imperative form (e.g., "Fix authentication bug")'
        },
        description: {
          type: 'string',
          description: 'Detailed description of what needs to be done'
        },
        activeForm: {
          type: 'string',
          description: 'Present continuous form shown while in progress (e.g., "Fixing authentication bug")'
        }
      },
      required: ['content']
    },
    category: 'base',
    discoveryTier: 'standard',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '2.0.0'
    }
  },
  {
    name: 'TodoUpdate',
    description: `Update task status or details by ID. Lifecycle: in_progress before work, completed after. Batch: comma-separated IDs (e.g., "1,2,3").`,
    schema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID(s) to update. Single: "1". Batch: "1,2,3".'
        },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed'],
          description: 'New status for the task'
        },
        content: {
          type: 'string',
          description: 'New task title (optional)'
        },
        description: {
          type: 'string',
          description: 'New description (optional)'
        },
        activeForm: {
          type: 'string',
          description: 'New active form (optional)'
        }
      },
      required: ['taskId']
    },
    category: 'base',
    discoveryTier: 'standard',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '2.0.0'
    }
  },
  {
    name: 'TodoList',
    description: 'List all tasks with their current status. Use to check progress, find task IDs, or review what is pending.',
    schema: {
      type: 'object',
      properties: {},
      required: []
    },
    category: 'base',
    discoveryTier: 'standard',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '2.0.0'
    }
  },

  {
    name: 'AskUserQuestion',
    description: `Present structured multiple-choice questions to the user. Use to gather preferences, clarify ambiguous instructions, get decisions on implementation choices, or offer direction options.

Users can always select "Other" for custom input — you don't need to include it. If you recommend a specific option, make it the first in the list and add "(Recommended)" to the label. Use multiSelect: true when choices aren't mutually exclusive.

Do NOT use this to ask "should I proceed?" — just proceed. Use it for genuine decisions where you need the user's judgment.`,
    schema: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          minLength: 1,
          maxLength: 4,
          items: {
            type: 'object',
            properties: {
              question: {
                type: 'string',
                description: 'The complete question to ask the user'
              },
              header: {
                type: 'string',
                maxLength: 12,
                description: 'Very short label displayed as a chip/tag (max 12 chars)'
              },
              options: {
                type: 'array',
                minLength: 2,
                maxLength: 4,
                items: {
                  type: 'object',
                  properties: {
                    label: {
                      type: 'string',
                      description: 'The display text for this option (1-5 words)'
                    },
                    description: {
                      type: 'string',
                      description: 'Explanation of what this option means'
                    }
                  },
                  required: ['label', 'description']
                },
                description: 'The available choices for this question'
              },
              multiSelect: {
                type: 'boolean',
                description: 'Allow multiple options to be selected',
                default: false
              }
            },
            required: ['question', 'header', 'options', 'multiSelect']
          },
          description: 'Questions to ask the user (1-4 questions)'
        }
      },
      required: ['questions']
    },
    category: 'base',
    discoveryTier: 'essential',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  {
    name: 'ExitPlanMode',
    description: `Exit planning mode and present a plan for the user to approve before implementation begins.

Use plan mode for tasks with genuine ambiguity — multiple reasonable architectures, unclear requirements, or high-impact restructuring. Skip it for straightforward changes, obvious bug fixes, or when the user's request already implies a clear path. When in doubt, start working and use ask_user_question for narrow clarifications rather than entering a full planning phase.`,
    schema: {
      type: 'object',
      properties: {
        plan: {
          type: 'string',
          description: 'The plan to present to the user'
        }
      },
      required: ['plan']
    },
    category: 'base',
    discoveryTier: 'standard',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  // =====================================
  // NOTEBOOK OPERATIONS
  // =====================================
  {
    name: 'NotebookEdit',
    description: 'Edit Jupyter notebook (.ipynb) cells. Supports replacing, inserting, or deleting cells. Read the notebook first to get cell IDs.',
    schema: {
      type: 'object',
      properties: {
        notebook_path: {
          type: 'string',
          description: 'Path to the Jupyter notebook'
        },
        cell_id: {
          type: 'string',
          description: 'ID of the cell to edit'
        },
        cell_type: {
          type: 'string',
          enum: ['code', 'markdown'],
          description: 'Type of cell'
        },
        edit_mode: {
          type: 'string',
          enum: ['replace', 'insert', 'delete'],
          description: 'Edit operation type'
        },
        new_source: {
          type: 'string',
          description: 'New content for the cell'
        }
      },
      required: ['notebook_path', 'new_source']
    },
    category: 'base',
    discoveryTier: 'standard',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  // =====================================
  // EXTENSION OPERATIONS
  // =====================================
  {
    name: 'SlashCommand',
    description: 'Execute a registered slash command. Slash commands are user-defined or built-in shortcuts invoked with /name syntax. Only invoke commands that are listed as available — do not guess or invent command names.',
    schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The slash command to execute with its arguments (e.g., "/review-pr 123")'
        }
      },
      required: ['command']
    },
    category: 'base',
    discoveryTier: 'standard',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  {
    name: 'Skill',
    description: 'List or invoke specialized skills. Skills are text instruction files that provide step-by-step guidance for specific tasks. Use command "list" to see all available skills, or pass a skill name to load it.',
    schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Use "list" to see all available skills, or a skill name to load it. E.g., "list", "pdf-documents", "spacetimedb-rust"'
        }
      },
      required: ['command']
    },
    category: 'base',
    discoveryTier: 'essential',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },
  {
    name: 'ResearchBacklog',
    description: "Track & triage harness deficiencies for recursive auto-research self-improvement. During benchmarking, AUTO-ADD every harness deficiency found (action:add — auto-triages + prioritizes). Walk each through open→triaged→in_progress→fixed→verified→closed. OVERFITTING GUARD: action:fixed means it passes the discovery task; action:verified means it ALSO held on held-out tasks — only verify after held-out confirmation. Use action:next to get the highest-priority deficiency to work on.",
    schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['add', 'triage', 'list', 'next', 'in_progress', 'fixed', 'verified', 'close', 'wont_fix', 'regressed'],
          description: 'add (auto-triages) | triage | list | next | in_progress | fixed (discovery task) | verified (held-out — overfitting-cleared) | close | wont_fix | regressed'
        },
        title: { type: 'string', description: 'add: short deficiency title (dedupe key)' },
        description: { type: 'string', description: 'add: what is wrong + how found' },
        bugClass: { type: 'string', description: 'Adapter|Streaming|Caching|Loop control|Routing|Config|Model card|State|Infrastructure|TUI|Other' },
        severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        impact: { type: 'number', description: '1-5 harness degradation' },
        effort: { type: 'number', description: '1-5 fix cost' },
        confidence: { type: 'number', description: '0-1 real-deficiency vs model-noise' },
        discoveredRound: { type: 'string' },
        affectedModels: { type: 'array', items: { type: 'string' } },
        id: { type: 'string', description: 'target deficiency id for triage/lifecycle ops' },
        experimentTag: { type: 'string', description: 'in_progress: worktree experiment tag' },
        ref: { type: 'string', description: 'fixed: commit · verified: held-out round · wont_fix: reason' },
        status: { type: 'string', description: 'list: filter by status' }
      },
      required: ['action']
    },
    category: 'base',
    discoveryTier: 'standard',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },
  {
    name: 'EndTurn',
    description: `MANDATORY final step when your turn used any tool. You MUST call end_turn before your user-facing answer — the turn cannot complete until you do. It requires RECONSTRUCTING the evidence for your work, not ticking boxes:

- citations: list EACH specific reference in your draft with the exact verbatim source you copied it from this turn. If you cannot produce the verbatim source, the reference is unverified — delete it from your answer and do not list it (quote the code instead of asserting a coordinate). Inventing one is a failed answer, exactly like a non-matching edit old_string.
- verification: list each build/test/lint command you actually ran with the real result line you saw. Do not list a command you did not run.
- self_review: re-read your draft as a skeptical reviewer — what you did NOT check, what is assumed/possibly wrong, what one more tool call would verify. This pass exists to catch your own mistakes before they ship.
- summary / open_items: what you delivered and any gaps — do not hide them.

After end_turn returns, act on your own self_review, then produce your final plain-text answer and call no more tools.`,
    schema: {
      type: 'object',
      properties: {
        citations: {
          type: 'array',
          description: "Every specific reference in your draft (file:line, line numbers, URLs, API/function signatures, quotes). One entry each with the exact transcribed source. Empty array = you cited none.",
          items: {
            type: 'object',
            properties: {
              reference: { type: 'string', description: 'The claim/reference as it appears in your answer.' },
              verbatim_source: { type: 'string', description: "The EXACT text copied from this turn's tool output that grounds it (a quoted code line, a URL from a fetched page) — character-for-character, like an edit old_string." }
            },
            required: ['reference', 'verbatim_source']
          }
        },
        verification: {
          type: 'array',
          description: 'Every build/test/lint command you actually ran this turn. Empty array = none asked.',
          items: {
            type: 'object',
            properties: {
              command: { type: 'string', description: 'The command you ran.' },
              observed_result: { type: 'string', description: "The actual result line you saw in this turn's tool output." }
            },
            required: ['command', 'observed_result']
          }
        },
        summary: {
          type: 'string',
          description: 'One sentence: what you delivered this turn.'
        },
        open_items: {
          type: 'array',
          items: { type: 'string' },
          description: 'Anything unverified/assumed/incomplete. Empty array if nothing.'
        },
        self_review: {
          type: 'string',
          description: 'Skeptical re-read of your draft: what you did NOT check, what is assumed or possibly wrong, what surface you may have missed, what one more tool call would verify. Be specific.'
        }
      },
      required: ['citations', 'verification', 'summary', 'open_items', 'self_review']
    },
    category: 'base',
    discoveryTier: 'standard',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  // =====================================
  // HISTORICAL RETRIEVAL TOOLS
  // =====================================
  {
    name: 'SearchConversationHistory',
    description: `Search conversation history across ALL previous sessions and current session.

Use this tool to:
- Find messages from previous conversations/sessions
- Search across all historical session data (default behavior)
- Locate specific topics or information from past interactions

By default searches ALL sessions. Use searchScope parameter to limit to current session only.`,
    schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query string'
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results to return',
          default: 10
        },
        timeRange: {
          type: 'object',
          properties: {
            start: { type: 'string', format: 'date-time' },
            end: { type: 'string', format: 'date-time' }
          },
          description: 'Optional time range filter'
        },
        includeCompacted: {
          type: 'boolean',
          description: 'Include compacted messages in search',
          default: true
        },
        searchScope: {
          type: 'string',
          description: 'Search scope: "current" (current session only), "all" (all sessions), or array of specific session IDs. Defaults to "all" to search across all sessions.',
          default: 'all'
        }
      },
      required: ['query']
    },
    category: 'historical',
    discoveryTier: 'standard',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  {
    name: 'GetConversationSegment',
    description: `Retrieve a specific segment of conversation history at different detail levels.

Can retrieve by turn range or checkpoint ID in full, summary, or compressed format.`,
    schema: {
      type: 'object',
      properties: {
        turnRange: {
          type: 'object',
          properties: {
            start: {
              type: 'number',
              description: 'Starting turn number (1-based)'
            },
            end: {
              type: 'number',
              description: 'Ending turn number (inclusive)'
            }
          },
          description: 'Turn range to retrieve'
        },
        checkpointId: {
          type: 'string',
          description: 'Checkpoint ID to retrieve from'
        },
        format: {
          type: 'string',
          enum: ['full', 'summary', 'compressed'],
          description: 'Format of the returned segment',
          default: 'summary'
        }
      }
    },
    category: 'historical',
    discoveryTier: 'standard',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  {
    name: 'ListCompactionBoundaries',
    description: `List all compaction boundaries (conversation summaries) with IDs.

Shows where conversation has been compacted with token savings and metadata.`,
    schema: {
      type: 'object',
      properties: {
        includeMetadata: {
          type: 'boolean',
          description: 'Include detailed metadata in response',
          default: true
        }
      }
    },
    category: 'historical',
    discoveryTier: 'standard',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  {
    name: 'RequestHistoricalContext',
    description: `Request historical context using cheap helper model. Cost-effective for accessing archived context.

Uses FREE Gemma models to generate context from historical conversation data.`,
    schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Query describing what historical context is needed'
        },
        detailLevel: {
          type: 'string',
          enum: ['brief', 'standard', 'detailed'],
          description: 'Detail level for the response',
          default: 'standard'
        },
        maxTokens: {
          type: 'number',
          description: 'Maximum tokens for the response',
          default: 1000
        },
        useHelperModel: {
          type: 'boolean',
          description: 'Whether to use helper model (vs main model)',
          default: true
        }
      },
      required: ['query']
    },
    category: 'historical',
    discoveryTier: 'standard',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  {
    name: 'ListSessions',
    description: `List all available conversation sessions to discover and browse past conversations.

Use this tool to:
- Browse all previous conversation sessions
- Find sessions by age (recent or old)
- See session metadata (message count, creation date, last activity)
- Get session IDs for use with load_session tool

Returns sessions sorted by most recent activity by default.`,
    schema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of sessions to return',
          default: 50
        },
        minAgeDays: {
          type: 'number',
          description: 'Filter sessions older than N days'
        },
        maxAgeDays: {
          type: 'number',
          description: 'Filter sessions newer than N days'
        },
        sortBy: {
          type: 'string',
          enum: ['newest', 'oldest'],
          description: 'Sort order by last activity',
          default: 'newest'
        }
      }
    },
    category: 'historical',
    discoveryTier: 'standard',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  {
    name: 'LoadSession',
    description: `Load full message history from a specific previous session.

Use this tool to:
- Load complete conversation context from a past session
- Access detailed message history beyond search results
- Continue analysis from a previous conversation
- Bring full context from identified sessions (via list_sessions or search_conversation_history)

Returns actual messages with full content. Use pagination (limit/offset) for large sessions.`,
    schema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session ID to load (from list_sessions or search_conversation_history results)'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of messages to return',
          default: 100
        },
        offset: {
          type: 'number',
          description: 'Start from message offset (for pagination)',
          default: 0
        },
        includeSystemMessages: {
          type: 'boolean',
          description: 'Include system messages in results',
          default: false
        }
      },
      required: ['sessionId']
    },
    category: 'historical',
    discoveryTier: 'standard',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  // =====================================
  // ARTIFACT CREATION (formerly "addon")
  // =====================================
  {
    name: 'CreateArtifactTool',
    description: `Create artifacts in ANY language with flexible execution - the ultimate workspace for self-development and validation.

NOTE: "Artifact" and "sandbox" mean the same thing - your isolated runtime environment.
Use the returned artifact ID with inspect_sandbox, interact_with_sandbox, modify_sandbox, stop_sandbox.

SUPPORTED LANGUAGES:
- JavaScript/Node.js: Web servers, APIs, scripts
- Python: Data processing, ML, web scrapers, Flask/FastAPI apps
- Rust: High-performance tools, web scrapers, system utilities
- Go: Concurrent services, APIs, CLI tools
- Shell: Bash/sh scripts for automation
- HTML: Static sites (auto-served with http-server)
- Other: Any language with custom command parameter

EXECUTION MODES:
- "oneshot": Run once then cleanup (default) - for one-time scripts
- "dev": Hot reload on changes - for iterative development
- "persistent": Keep running in tmux - for servers, long-running services

FLEXIBLE EXECUTION:
Use 'command' parameter for custom execution:
- Rust: "cargo run --release" or "cargo build && ./target/release/app"
- Go: "go run main.go" or "go build && ./scraper"
- Shell: "./script.sh" (auto-chmod +x)
- Compiled: "./my-binary --args"

VISUAL FEEDBACK & ITERATION:
- Set enableVisualFeedback=true for screenshots, DOM, console, network logs
- Use to see and validate your creations
- Perfect for iterative UI development and debugging

WORKFLOW FOR ITERATIVE DEVELOPMENT:
1. Create artifact with enableVisualFeedback=true
2. Use inspect_sandbox to observe runtime state (console logs, DOM, etc.)
3. Use modify_sandbox for quick code edits (automatic hot reload)
4. Use interact_with_sandbox to test user interactions (click, type, navigate)
5. Use stop_sandbox to cleanup when finished

ARTIFACT LIFECYCLE:
- Artifacts persist in memory until explicitly stopped with stop_sandbox
- Use mode="dev" for rapid iteration with automatic hot reload
- Use mode="persistent" for long-running servers (survives restarts via tmux)
- Artifacts keep running in background until you stop them

EXAMPLES:

Rust Web Scraper (persistent):
{
  "name": "rust-scraper",
  "mode": "persistent",
  "implementation": {
    "language": "rust",
    "code": "use reqwest::blocking::get; ...",
    "command": "cargo run --release"
  }
}

Python Data Dashboard:
{
  "name": "data-viz",
  "mode": "persistent",
  "implementation": {
    "language": "python",
    "code": "from flask import Flask ...",
    "fileName": "app.py"
  }
}

Go API Server:
{
  "name": "go-api",
  "mode": "persistent",
  "implementation": {
    "language": "go",
    "code": "package main ...",
    "command": "go run main.go"
  }
}`,
    schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Unique name for the addon tool'
        },
        description: {
          type: 'string',
          description: 'What the tool does'
        },
        parameters: {
          type: 'object',
          description: 'JSON Schema for tool parameters'
        },
        implementation: {
          type: 'object',
          description: 'Code implementation object. Required fields: "language" (javascript/python/rust/go/shell/html/other) and "code" (source code string). Optional: "fileName" (e.g., main.rs), "command" (custom run command like "cargo run"), "buildCommand" (pre-execution build), "dependencies" (package names array).',
          properties: {
            language: {
              type: 'string',
              enum: ['javascript', 'python', 'rust', 'go', 'shell', 'html', 'other'],
              description: 'Programming language: javascript, python, rust, go, shell, html, or other for custom runtimes'
            },
            code: {
              type: 'string',
              description: 'Source code that implements the tool. Can call other tools like Task. For web apps, include full HTML with embedded CSS/JS.'
            },
            fileName: {
              type: 'string',
              description: 'Optional: Specific filename (e.g., "main.rs", "app.go", "scraper.sh"). Auto-detected if not provided.'
            },
            command: {
              type: 'string',
              description: 'Optional: Custom command to run the artifact (e.g., "cargo run --release", "go build && ./app", "./scraper.sh"). Use for languages beyond javascript/python or custom build/run workflows.'
            },
            buildCommand: {
              type: 'string',
              description: 'Optional: Build command to run before executing (e.g., "cargo build --release", "go build -o app"). Automatically runs before the main command.'
            },
            dependencies: {
              type: 'array',
              items: { type: 'string' },
              description: 'Required packages (npm, pip, cargo dependencies, etc.)'
            }
          },
          required: ['language', 'code']
        },
        mode: {
          type: 'string',
          enum: ['oneshot', 'dev', 'persistent'],
          description: 'Execution mode: "oneshot" for one-time scripts, "dev" for hot reload development, "persistent" for long-running web servers and services',
          default: 'oneshot'
        },
        enableVisualFeedback: {
          type: 'boolean',
          description: 'Capture screenshots, DOM structure, console logs, and network activity. Use this to see your creation and iterate on the UI.',
          default: false
        },
        enableReactIntrospection: {
          type: 'boolean',
          description: 'Include a framework report (React/Vue/Svelte detection, React version) in the initial visual snapshot. sandbox_scan/sandbox_grab/sandbox_detect_framework work regardless of this flag.',
          default: false
        },
        uiConfig: {
          type: 'object',
          description: 'UI / framework options. For a REACT artifact, set framework="react" and put a component (define or default-export `App`) in implementation.code — it is built into a static, introspectable page (no need to hand-write index.html).',
          properties: {
            framework: {
              type: 'string',
              enum: ['express', 'fastapi', 'flask', 'nextjs', 'react'],
              description: "Web framework. 'react' builds a React artifact from implementation.code; introspect it with sandbox_scan/sandbox_grab/sandbox_detect_framework."
            },
            reactMode: {
              type: 'string',
              enum: ['cdn', 'bundled'],
              description: "React only. 'bundled' (default when available): esbuild + real source maps (sandbox_grab returns real src/App.tsx:line). 'cdn': zero-install in-browser Babel, faster start."
            },
            additionalFiles: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  path: { type: 'string', description: "Path under src/, e.g. 'components/Button.tsx'" },
                  code: { type: 'string', description: 'Module source' }
                },
                required: ['path', 'code']
              },
              description: 'React bundled mode only: extra source modules importable from App.'
            }
          }
        },
        testCases: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              input: { type: 'object' },
              expectedOutput: { type: 'object' }
            }
          },
          description: 'Optional test cases for validation'
        }
      },
      required: ['name', 'description', 'parameters', 'implementation']
    },
    category: 'base',
    discoveryTier: 'standard',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  {
    name: 'InteractWithSandbox',
    description: `Interact with sandbox/artifact UI programmatically using Playwright.

WHEN TO USE: Test user interactions on artifacts created with create_artifact_tool.

Supports various interactions:
- Click buttons, links, elements
- Type into inputs and textareas
- Navigate to different URLs
- Scroll, hover, select elements
- Press keyboard shortcuts (Ctrl+V, Ctrl+S, Escape, etc.)
- Zoom in/out for visual inspection
- Wait for animations and UI updates

COMMON USE CASES:
- Test form submissions (type → click submit → verify)
- Navigate multi-page flows
- Paste code with Ctrl+V
- Test interactive UI elements
- Visual regression testing

TIP: Chain multiple actions in one call (click → type → click submit → wait).

WORKFLOW: create_artifact_tool → interact_with_sandbox → inspect_sandbox (see results)`,
    schema: {
      type: 'object',
      properties: {
        sandboxId: {
          type: 'string',
          description: 'ID of the sandbox to interact with'
        },
        actions: {
          type: 'array',
          description: 'Array of UI actions to execute sequentially. Each action requires "type" (click/type/navigate/scroll/hover/select/wait/keypress/zoom). Add "selector" for element targeting, "value" for text/URLs, "duration" for wait (ms), "key" for keypress (e.g., "Ctrl+V"), or "zoomLevel" for zoom (1.0=100%).',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['click', 'type', 'navigate', 'scroll', 'hover', 'select', 'wait', 'keypress', 'zoom'],
                description: 'Type of interaction'
              },
              selector: { type: 'string', description: 'CSS selector for the element' },
              value: { type: 'string', description: 'Value to type or select' },
              key: { type: 'string', description: 'Key to press (e.g., "Enter", "Ctrl+V")' },
              zoomLevel: { type: 'number', description: 'Zoom level (1.0 = 100%)' },
              duration: { type: 'number', description: 'Wait duration in milliseconds' },
              deltaX: { type: 'number', description: 'Horizontal scroll delta' },
              deltaY: { type: 'number', description: 'Vertical scroll delta' }
            },
            required: ['type']
          }
        },
        captureAfterEachAction: {
          type: 'boolean',
          description: 'Capture screenshot after each action'
        },
        returnFinalSnapshot: {
          type: 'boolean',
          description: 'Return final screenshot'
        }
      },
      required: ['sandboxId', 'actions']
    },
    category: 'base',
    discoveryTier: 'standard',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  {
    name: 'ModifySandbox',
    description: `Modify sandbox/artifact code with automatic hot-reload.

WHEN TO USE: Edit artifact code without recreation (faster than create_artifact_tool for iterations).

Allows updating sandbox HTML/CSS/JS without recreating the sandbox.
Changes are applied immediately and the browser reloads automatically.

COMMON USE CASES:
- Fix bugs in artifact code
- Add new features iteratively
- Test different implementations quickly
- Refine UI based on visual feedback
- Quick typo fixes or styling tweaks

TIP: Changes apply immediately - no need to restart artifact.

WORKFLOW: create_artifact_tool → inspect_sandbox → modify_sandbox → inspect_sandbox (loop)`,
    schema: {
      type: 'object',
      properties: {
        sandboxId: {
          type: 'string',
          description: 'ID of the sandbox to modify'
        },
        code: {
          type: 'object',
          properties: {
            html: { type: 'string', description: 'Updated HTML content' },
            css: { type: 'string', description: 'Updated CSS content' },
            javascript: { type: 'string', description: 'Updated JavaScript content' }
          },
          description: 'Code to update (provide only what needs to change)'
        },
        reload: {
          type: 'boolean',
          description: 'Reload the sandbox after modification (default: true)'
        }
      },
      required: ['sandboxId', 'code']
    },
    category: 'base',
    discoveryTier: 'standard',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  {
    name: 'InspectSandbox',
    description: `Query sandbox/artifact state and extract information.

WHEN TO USE: After creating or modifying an artifact to observe its current runtime state.

Can retrieve:
- Current URL
- Page title
- DOM structure (check element visibility, content)
- Console logs (errors, warnings, info)
- Network requests (API calls, resources)
- Computed styles
- JavaScript state via evaluation
- Performance metrics
- Screenshots

COMMON USE CASES:
- Check console errors after modify_sandbox
- Verify element visibility or text content
- Extract data from the page
- Debug runtime issues
- Validate state after interactions

WORKFLOW: create_artifact_tool → inspect_sandbox → modify_sandbox → inspect_sandbox (loop)`,
    schema: {
      type: 'object',
      properties: {
        sandboxId: {
          type: 'string',
          description: 'ID of the sandbox to inspect'
        },
        query: {
          type: 'object',
          properties: {
            url: { type: 'boolean', description: 'Get current URL' },
            title: { type: 'boolean', description: 'Get page title' },
            dom: {
              type: 'object',
              properties: {
                selector: { type: 'string', description: 'CSS selector to query' },
                attribute: { type: 'string', description: 'Attribute to extract' }
              },
              description: 'Query DOM elements'
            },
            console: { type: 'boolean', description: 'Get console logs' },
            network: { type: 'boolean', description: 'Get network requests' },
            evaluate: { type: 'string', description: 'JavaScript expression to evaluate' },
            screenshot: { type: 'boolean', description: 'Take screenshot' }
          },
          description: 'What to query from the sandbox'
        }
      },
      required: ['sandboxId', 'query']
    },
    category: 'base',
    discoveryTier: 'standard',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  {
    name: 'SandboxScan',
    description: `Discover elements in a running sandbox/artifact. Same contract as the nexus-browser scan tool: each element carries a unique cssSelector (reuse it with InteractWithSandbox), isInteractive, relevanceScore — and componentName on React artifacts.

WORKFLOW (scan -> act -> scan): sandbox_scan -> interact_with_sandbox(click/type with cssSelector) -> sandbox_scan to verify.

FILTERS: tagName, hasText, isInteractive, id, className, placeholder, name, componentName (React).`,
    schema: {
      type: 'object',
      properties: {
        sandboxId: { type: 'string', description: 'ID of the sandbox to scan' },
        filter: {
          type: 'object',
          properties: {
            tagName: { type: 'string', description: "Exact lowercase tag, e.g. 'button'" },
            hasText: { type: 'string', description: 'Case-insensitive text substring' },
            isInteractive: { type: 'boolean', description: 'Only interactive elements' },
            id: { type: 'string', description: 'Exact id attribute' },
            className: { type: 'string', description: 'classList contains' },
            placeholder: { type: 'string', description: 'Placeholder substring' },
            name: { type: 'string', description: 'Exact name attribute' },
            componentName: { type: 'string', description: 'React component name' }
          },
          description: 'Optional element filters (AND-combined)'
        },
        limit: { type: 'number', description: 'Max elements (default 30, max 100)' },
        includeOffscreen: { type: 'boolean', description: 'Include offscreen elements' }
      },
      required: ['sandboxId']
    },
    category: 'base',
    discoveryTier: 'standard',
    metadata: { immutable: true, executionEnvironment: 'client', version: '1.0.0' }
  },

  {
    name: 'SandboxGrab',
    description: `Query ONE element in a running sandbox by cssSelector or coordinates. Same contract as the nexus-browser grab tool. Returns DOM detail (attributes, rect, computed style, parent chain, HTML preview) and — on React artifacts — react: { componentName, componentStack, props, sourceLocation }.

WHEN TO USE: after sandbox_scan to drill into a specific element, or with x/y after a click to learn WHICH component you hit.`,
    schema: {
      type: 'object',
      properties: {
        sandboxId: { type: 'string', description: 'ID of the sandbox' },
        selector: { type: 'string', description: 'CSS selector (use cssSelector from sandbox_scan)' },
        x: { type: 'number', description: 'X coordinate (alternative to selector)' },
        y: { type: 'number', description: 'Y coordinate (alternative to selector)' },
        maxLength: { type: 'number', description: 'Max text length (default 500)' }
      },
      required: ['sandboxId']
    },
    category: 'base',
    discoveryTier: 'standard',
    metadata: { immutable: true, executionEnvironment: 'client', version: '1.0.0' }
  },

  {
    name: 'SandboxDetectFramework',
    description: `Detect the frontend framework of a running sandbox/artifact. Same schema as the nexus-browser detect_framework tool: react, reactVersion, next, remix, gatsby, vue, svelte, angular, compiler, hasDevTools, rendererCount, heavyLibraries.

WHEN TO USE: once after creating an artifact — if react=true, prefer sandbox_scan/sandbox_grab for component-level verification instead of screenshot-only inspection.`,
    schema: {
      type: 'object',
      properties: {
        sandboxId: { type: 'string', description: 'ID of the sandbox' }
      },
      required: ['sandboxId']
    },
    category: 'base',
    discoveryTier: 'standard',
    metadata: { immutable: true, executionEnvironment: 'client', version: '1.0.0' }
  },

  {
    name: 'SandboxComponentTree',
    description: `Return the React component hierarchy of a running sandbox (host elements collapsed, components only). Same role as the nexus-sense 'tree' tool.

WHEN TO USE: understand a React artifact's structure — which components nest where, and (when available) each component's source file. Use after sandbox_detect_framework reports react:true.`,
    schema: {
      type: 'object',
      properties: {
        sandboxId: { type: 'string', description: 'ID of the sandbox' },
        rootSelector: { type: 'string', description: 'CSS selector for the tree root (default #root/#app)' },
        maxDepth: { type: 'number', description: 'Max component depth (default 8)' }
      },
      required: ['sandboxId']
    },
    category: 'base',
    discoveryTier: 'standard',
    metadata: { immutable: true, executionEnvironment: 'client', version: '1.0.0' }
  },

  {
    name: 'SandboxRenderTrace',
    description: `Trace React re-renders in a running sandbox — react-scan's role: which components re-rendered, how often, and total render time. Catches wasted re-renders (unstable props, context churn).

WORKFLOW: sandbox_render_trace(action:'start') -> interact_with_sandbox (click/type to drive renders) -> sandbox_render_trace(action:'stop') returns per-component render counts/timings, most-rendered first. Requires a React artifact in development build (the default).`,
    schema: {
      type: 'object',
      properties: {
        sandboxId: { type: 'string', description: 'ID of the sandbox' },
        action: { type: 'string', enum: ['start', 'stop'], description: "'start' resets+enables tracing; 'stop' returns the report" }
      },
      required: ['sandboxId', 'action']
    },
    category: 'base',
    discoveryTier: 'standard',
    metadata: { immutable: true, executionEnvironment: 'client', version: '1.0.0' }
  },

  {
    name: 'StopSandbox',
    description: `Stop a running sandbox/artifact and cleanup resources.

WHEN TO USE: Cleanup when finished, free resources, or start fresh. Artifacts persist until stopped.

Stops the artifact process and cleans up resources:
- Kills the running process (Node.js/Python/Rust/Go/etc.)
- Closes file watchers (hot reload in dev mode)
- Optionally captures final snapshot
- Optionally deletes artifact directory
- Closes Playwright browser if no other artifacts need it

COMMON USE CASES:
- Finished development and testing
- Free memory and resources
- Start over from scratch
- Recover from errors
- Cleanup before creating new version

NOTE: Artifacts keep running in background until explicitly stopped. Only stop if you need to free resources or restart.`,
    schema: {
      type: 'object',
      properties: {
        sandboxId: {
          type: 'string',
          description: 'Unique ID of the sandbox to stop'
        },
        cleanup: {
          type: 'boolean',
          description: 'Delete sandbox directory after stopping (default: false)'
        },
        captureFinalSnapshot: {
          type: 'boolean',
          description: 'Capture final visual snapshot before stopping (default: false)'
        }
      },
      required: ['sandboxId']
    },
    category: 'base',
    discoveryTier: 'standard',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },
  // =====================================
  // WORKSPACE MANAGEMENT
  // =====================================
  {
    name: 'WorkspaceManager',
    description: `Manage isolated git worktrees for multi-agent parallel development.

Use this tool to create, inspect, diff, and clean up git worktrees that give each agent
an isolated copy of the codebase. Supports both local repos and external clones.

MODES:
- create: Create a worktree from the current repo on a new branch
- clone: Clone an external repo and optionally create a worktree branch
- status: List all active worktrees
- diff: Get diff between a worktree and its base branch (requires worktreePath)
- cleanup: Remove a worktree, the branch it created, and (if cloned) its clone directory

WORKFLOW:
1. workspace_manager(mode=create, branch=feature-x) → returns { worktreePath, branch, cloneDir? }
2. Assign worktreePath to sub-agent via task tool prompt
3. Agent works in isolated worktree (no conflicts with main)
4. workspace_manager(mode=diff, worktreePath=<path>) → review changes
5. workspace_manager(mode=cleanup, worktreePath=<path>, cloneDir=<dir if from clone>) → remove worktree + branch + clone dir`,
    schema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['create', 'clone', 'status', 'diff', 'cleanup'],
          description: 'Operation mode'
        },
        repo: {
          type: 'string',
          description: 'For clone: "owner/repo" or full URL. For create: local repo path (defaults to project root).'
        },
        branch: {
          type: 'string',
          description: 'Branch name for worktree (create/clone). Auto-generated if not provided.'
        },
        baseBranch: {
          type: 'string',
          description: 'Base branch for diff comparison (default: main)'
        },
        worktreePath: {
          type: 'string',
          description: 'Path to specific worktree (required for diff/cleanup)'
        },
        cloneDir: {
          type: 'string',
          description: 'For cleanup: the clone directory to also remove (from a prior clone result)'
        },
        maxDiffLines: {
          type: 'number',
          description: 'Maximum diff lines to return (default: 5000)'
        }
      },
      required: ['mode']
    },
    category: 'base',
    discoveryTier: 'standard',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  // =====================================
  // PR MANAGEMENT
  // =====================================
  {
    name: 'PRAgent',
    description: `Manage GitHub pull requests — review, create, list, and post reviews.

MODES:
- review: Fetch a PR's diff + metadata for analysis (read-only; does NOT check out the branch)
- create: Set up workspace for creating a new PR
- list: List open PRs for a repository
- post-review: Post review comments (approve, request-changes, comment)

Returns structured context for the LLM to dispatch Task calls to specialized agents.
Does NOT auto-spawn sub-agents — returns data for orchestrator to decide next steps.

WORKFLOW (PR Review):
1. pr_agent(mode=review, repo=owner/repo, prNumber=42) → diff + metadata
2. LLM dispatches parallel task agents for security, quality, architecture review
3. pr_agent(mode=post-review, action=approve/request-changes, body=findings)

REQUIRES: gh CLI authenticated and available in PATH.`,
    schema: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repository in "owner/repo" format'
        },
        mode: {
          type: 'string',
          enum: ['review', 'create', 'list', 'post-review'],
          description: 'Operation mode'
        },
        prNumber: {
          type: 'number',
          description: 'PR number (for review/post-review)'
        },
        branch: {
          type: 'string',
          description: 'Branch name (for create mode)'
        },
        action: {
          type: 'string',
          enum: ['approve', 'request-changes', 'comment'],
          description: 'Review action (for post-review mode)'
        },
        body: {
          type: 'string',
          description: 'Comment body (for post-review mode)'
        },
        diffOptions: {
          type: 'object',
          properties: {
            pathFilter: {
              type: 'string',
              description: 'Filter diff to specific path pattern'
            },
            maxLines: {
              type: 'number',
              description: 'Maximum diff lines to return (default: 5000)'
            }
          },
          description: 'Options for diff extraction'
        }
      },
      required: ['repo', 'mode']
    },
    category: 'base',
    discoveryTier: 'standard',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  {
    name: 'TmuxSession',
    description: `Manage persistent terminal sessions with tmux. Supports creating sessions, sending commands, capturing output, and taking visual screenshots.

Use cases:
- Create persistent terminal sessions that survive disconnects
- Run long-running commands in the background
- Capture terminal output and history
- Manage multiple concurrent terminal sessions
- Execute commands in specific working directories
- Set custom environment variables per session

Actions:
- create: Create a new tmux session
- send: Send command to existing session
- capture: Capture session output/history
- list: List all active sessions
- kill: Terminate a session
- snapshot: Capture visual screenshot (if supported)

Graceful degradation: Returns error if tmux is not installed.`,
    schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'send', 'capture', 'list', 'kill', 'snapshot'],
          description: 'Action to perform on tmux session'
        },
        sessionId: {
          type: 'string',
          description: 'Session identifier (required for send, capture, kill, snapshot actions)'
        },
        command: {
          type: 'string',
          description: 'Command to send to session (required for send action)'
        },
        cwd: {
          type: 'string',
          description: 'Working directory for new session (optional for create action)'
        },
        env: {
          type: 'object',
          description: 'Environment variables for new session (optional for create action)',
          additionalProperties: { type: 'string' }
        },
        captureHistory: {
          type: 'boolean',
          description: 'Capture entire scrollback history (optional for capture action)',
          default: false
        },
        includeScreenshot: {
          type: 'boolean',
          description: 'Include visual screenshot (optional for snapshot action)',
          default: false
        }
      },
      required: ['action']
    },
    category: 'base',
    discoveryTier: 'standard',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  // =====================================
  // CODE EXECUTION & TOOL DISCOVERY
  // =====================================
  {
    name: 'CodeExecute',
    description: `Execute JavaScript code for token-efficient tool chaining. Only console.log() output enters the context window. Write code that calls multiple tools in sequence, processes results, and outputs only what matters. Top-level await supported.`,
    schema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'JavaScript code to execute. Use console.log() to output results.'
        },
        timeout: {
          type: 'number',
          description: 'Execution timeout in ms (default 5000, max 30000)'
        }
      },
      required: ['code']
    },
    category: 'base',
    discoveryTier: 'standard',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  },

  {
    name: 'SearchTools',
    description: `Search the tool registry to discover available tools by name, description, or category. Use when you need a capability not in the current tool list — deferred tool loading means not all tools are immediately visible.

Query forms: keyword search ("notebook jupyter"), category filter ("execution"), or direct name lookup. Returns tool schemas so you can call discovered tools immediately.`,
    schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query to match tool names and descriptions'
        },
        category: {
          type: 'string',
          description: 'Filter by tool category'
        }
      }
    },
    category: 'base',
    discoveryTier: 'essential',
    metadata: {
      immutable: true,
      executionEnvironment: 'client',
      version: '1.0.0'
    }
  }
];

/**
 * Immutable registry of base tools
 */
export class BaseToolRegistry implements ToolRegistry {
  private readonly tools: Map<string, CanonicalToolDefinition>;

  constructor() {
    this.tools = new Map();
    BASE_TOOLS.forEach(tool => {
      this.tools.set(tool.name, tool);
    });
  }

  /**
   * Get all base tools
   */
  getAllTools(): CanonicalToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get a specific tool by name
   */
  getTool(name: string): CanonicalToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool exists
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get tools by category
   */
  getToolsByCategory(category: ToolCategory): CanonicalToolDefinition[] {
    return Array.from(this.tools.values()).filter(tool => tool.category === category);
  }

  /**
   * Get count of tools
   */
  getToolCount(): number {
    return this.tools.size;
  }
}

// Export singleton instance
export const baseToolRegistry = new BaseToolRegistry();
