/**
 * Browse Tool — dispatches a nexus-browser subagent.
 *
 * Rationale: nexus-browser exposes 43 MCP tools (~12.5K input tokens). Injecting
 * them into every request bloats the parent's context for sessions that never
 * browse. Instead, `Browse` is a single small entry tool on the parent. When
 * invoked, it spawns a subagent that — and only that — gets MCP_AUTO_INJECT
 * enabled, picks up the full nexus-browser surface, completes the task, and
 * returns a concise result to the parent.
 *
 * The parent's tool/context surface never grows. The subagent runs in its own
 * forked process and its context window doesn't share with the parent.
 *
 * OSS boundary: nexus-browser is still reached only via MCP protocol with
 * auth gating. The subagent uses the same MCP client + API key validation as
 * any other MCP consumer; this tool just controls _when_ those tools are
 * exposed (subagent-scoped, not parent-scoped).
 */

import { BaseTool } from '../../base/BaseTool.js';
import type { ToolResult } from '../../base/ToolResult.js';

/**
 * Build a ToolResult that hands off to the orchestrator's subagent
 * dispatcher, configured for the browse-agent + nexus-browser MCP.
 *
 * Exported so WebSearchTool/WebFetchTool can reuse it for `mode: 'interactive'`
 * without duplicating the dispatch contract.
 */
export function buildBrowseSubagentDispatch(
  taskPrompt: string,
  startingUrl: string | undefined,
  llmDisplay: string,
  startTime?: number,
): ToolResult {
  const fullPrompt = startingUrl ? `Start at: ${startingUrl}\n\n${taskPrompt}` : taskPrompt;
  return {
    llmContent: llmDisplay,
    returnDisplay: llmDisplay,
    success: true,
    metadata: {
      agentDefinition: INLINE_BROWSE_AGENT,
      agentName: INLINE_BROWSE_AGENT.name,
      taskPrompt: fullPrompt,
      shouldSpawnSubAgent: true,
      envOverrides: { MCP_AUTO_INJECT: 'true' },
      description: llmDisplay.slice(0, 200),
      ...(startTime !== undefined ? { executionTime: Date.now() - startTime } : {}),
    },
  };
}

export interface BrowseParams {
  /** What the subagent should accomplish (e.g. "extract the top-5 stories from HN front page"). */
  task: string;
  /** Optional starting URL the subagent should browse to first. */
  url?: string;
  /** Optional model override (e.g. "sonnet"). Defaults to parent's current model. */
  model?: string;
}

/**
 * Inline agent definition used when no `.cortex/agents/browse-agent.md`
 * override is present on disk. Users can drop a file with the same name to
 * customize the system prompt or tool whitelist; the lookup happens through
 * AgentStore at dispatch time.
 *
 * Tool whitelist intentionally omits filesystem writers so the subagent can't
 * be coerced into writing to the parent's workspace. Read tools stay so the
 * subagent can save scraped content as artifacts via CreateArtifactTool.
 */
const INLINE_BROWSE_AGENT = {
  name: 'browse-agent',
  description: 'Headless-browser subagent — drives nexus-browser MCP tools to complete a web task.',
  systemPrompt: `You are a browser automation subagent. You have access to the nexus-browser MCP server,
which provides a full headless Chrome controlled through ~43 tools (browse, scan, click, type,
fill_form, extract_table, screenshot, etc.).

## How to work

1. Read the task carefully. Identify the success criterion — what result the parent agent needs back.
2. Open the starting URL (if provided) with \`nexus-browser__browse\`. Otherwise pick a starting page yourself.
3. Use the Scan → Act → Scan loop:
   - \`nexus-browser__scan({ filter: { isInteractive: true } })\` to find elements with CSS selectors
   - \`nexus-browser__click\` / \`nexus-browser__type\` / \`nexus-browser__select\` using the returned cssSelector
   - \`nexus-browser__scan\` again to verify
4. To read text from the page prefer \`nexus-browser__grab\` (cheap) over \`nexus-browser__screenshot\` (expensive).
5. For lists / structured data use \`nexus-browser__extract_table\`, \`nexus-browser__extract_links\`,
   or \`nexus-browser__scroll_and_collect\`.
6. If you hit a CAPTCHA or interstitial, \`nexus-browser__detect_challenge\` then \`nexus-browser__solve_challenge\`.
7. Always \`nexus-browser__close_session\` when done so the headless tab is released.

## Output discipline

Return ONE concise text reply to the parent containing exactly the information requested. Do not
narrate the steps you took. Do not include screenshots unless they are the requested output. If the
task asked for structured data, return it as a small JSON object or markdown table — not prose
describing the data.

## Failure modes

- If the page never loads, or stays blocked behind a challenge you cannot solve, return a one-line
  failure summary so the parent can decide whether to retry with a different approach.
- Don't browse off-task. If the page links somewhere irrelevant, don't follow it.
- Don't loop. If three consecutive scan/act cycles produce no new information, you're done.
`,
  // Whitelist: only browser tools + read/grep/glob for searching captured content. No write/edit/bash.
  tools: [
    'Read',
    'Grep',
    'Glob',
    'TodoCreate',
    'TodoUpdate',
    'TodoList',
    // nexus-browser tools are auto-injected by the subagent's MCP_AUTO_INJECT=true override;
    // the agent definition's tool list is a soft preference, the actual exposure is governed
    // by which MCP server is connected at fork time.
  ],
  model: 'inherit' as const,
  location: 'project' as const,
  filePath: '<inline:browse-agent>',
};

export class BrowseTool extends BaseTool<BrowseParams, ToolResult> {
  constructor() {
    super(
      'Browse',
      'Browse',
      `Drives a headless browser via a subagent. Use when you need to:
- interact with a page (click, fill forms, log in)
- scrape JS-rendered SPA content that plain HTTP fetch can't see
- bypass simple bot-protection or CAPTCHA
- collect data across multiple pages

The subagent runs in its own forked process with the full nexus-browser MCP toolset
(~43 tools). The parent's context stays clean — only this single tool definition is
visible here, not the 43-tool browser surface.

For static text search use WebSearch (faster, cheaper). For simple URL reads use WebFetch.
Reach for Browse only when those two won't work.`,
      {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description:
              'What the browser subagent should accomplish. Be specific about the success criterion — what data or outcome should it return?',
          },
          url: {
            type: 'string',
            description: 'Optional starting URL. If omitted, the subagent picks a starting page based on the task.',
          },
          model: {
            type: 'string',
            description: 'Optional model override (sonnet, opus, haiku). Defaults to parent\'s current model.',
          },
        },
        required: ['task'],
      },
    );
  }

  validateToolParams(params: BrowseParams): string | null {
    if (typeof params.task !== 'string' || params.task.trim().length === 0) {
      return 'task must be a non-empty string';
    }
    if (params.task.length > 4000) {
      return 'task must be 4000 characters or less';
    }
    if (params.url !== undefined) {
      if (typeof params.url !== 'string' || params.url.trim().length === 0) {
        return 'url, if provided, must be a non-empty string';
      }
      // Light validation — let the subagent handle proto-less URLs etc.
      if (params.url.length > 2048) {
        return 'url must be 2048 characters or less';
      }
    }
    if (params.model !== undefined) {
      if (!['sonnet', 'opus', 'haiku', 'inherit'].includes(params.model)) {
        return 'model must be one of: sonnet, opus, haiku, inherit';
      }
    }
    return null;
  }

  getDescription(params: BrowseParams): string {
    const target = params.url ? ` at ${params.url}` : '';
    return `Dispatching browser subagent: ${params.task.slice(0, 80)}${target}`;
  }

  async execute(params: BrowseParams): Promise<ToolResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return this.createErrorResult(validationError);
    }

    // Recursion guard: subagents must never spawn a child Browse subagent.
    // Without this, the browse-agent gets the parent's Browse tool definition,
    // calls it, spawns another browse-agent, and burns time + tokens. The
    // subagent already has the full nexus-browser MCP toolset via the fork's
    // env override — it should use those directly.
    if ((process.env.CORTEX_AGENT_MODE) === 'true') {
      return this.createErrorResult(
        'Browse is a parent-only tool. You are already running inside a subagent with direct access to nexus-browser__* tools. ' +
        'Use `nexus-browser__browse({ url })` to open a page, then `nexus-browser__scan` / `nexus-browser__grab` etc. to interact with it.',
      );
    }

    return buildBrowseSubagentDispatch(
      params.task,
      params.url,
      `Dispatching Browse subagent: ${params.task.slice(0, 160)}`,
    );
  }
}
