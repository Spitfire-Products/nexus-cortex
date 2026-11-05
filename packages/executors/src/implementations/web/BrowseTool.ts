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
      // MCP_AUTO_INJECT enables injection; CORTEX_MCP_AUTOCONNECT connects the
      // built-in nexus-browser registry entry with NO MCP_CONFIG.md required, so
      // `browse` works zero-config / one-shot on a clean install. Scoped to this
      // subagent — the parent's lean tool surface is unaffected.
      // R266: the delegate is a role agent — never the parent's turn-0 narrow frame (explicit, in case
      // the orchestrator-level CORTEX_AGENT_MODE guard is ever bypassed).
      // CORTEX_BROWSE_AGENT marks this delegate: it is never offered, and is refused, any sub-agent-spawning tool (core toolAllowlist.ts).
      // CORTEX_PROMPT_MASS=minimal (2026-11-02): the delegate's system prompt was 49 KB on EVERY request — its own browse prompt (~2.2 KB)
      // plus the whole static corpus a coding session gets (tool guide, grounded-research, examples, work-quality/TDD, memory) and the
      // project's CLAUDE.md (~30 KB here). Minimal keeps only the core prompt, which the browse-agent definition replaces.
      envOverrides: { MCP_AUTO_INJECT: 'true', CORTEX_MCP_AUTOCONNECT: 'nexus-browser', CORTEX_TOOL_ANCHOR: 'none', CORTEX_BROWSE_AGENT: 'true', CORTEX_PROMPT_MASS: 'minimal' },
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
  /** 'delegate' (default): a browse sub-agent · 'direct': the orchestrator connects the browser tools into the caller's own session. */
  mode?: 'delegate' | 'direct';
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
3. Scan, then act in batches:
   - \`nexus-browser__scan({ filter: { isInteractive: true } })\` to find elements with CSS selectors
   - When you know the next few actions, run them in ONE \`nexus-browser__steps\` call — e.g. click the store chooser, type the ZIP,
     press search, then scan the results — instead of one call each. Every call you save is a model round saved (5–30 s each).
   - Single \`nexus-browser__click\` / \`nexus-browser__type\` / \`nexus-browser__select\` calls are for one action whose outcome
     decides the next.
   - Click with \`click\` (or a click step), not \`element.click()\` inside \`evaluate\`: many React/Vue sites ignore script clicks
     without any error.
   - Check the outcome ONCE with \`nexus-browser__page_state\`: the URL, the heading, the active filters and the MAIN result count in
     one read (end a \`steps\` call with it). It flags count labels in suggestion, carousel, sidebar or footer areas — those describe
     other searches, never report one as the answer. Re-check only what a later action could have changed.
4. To read text from the page prefer \`nexus-browser__grab\` (cheap) over \`nexus-browser__screenshot\` (expensive).
5. For lists / structured data use \`nexus-browser__extract_table\`, \`nexus-browser__extract_links\`,
   or \`nexus-browser__scroll_and_collect\`.
6. If you hit a CAPTCHA or interstitial, \`nexus-browser__detect_challenge\` then \`nexus-browser__solve_challenge\`.
7. Always \`nexus-browser__close_session\` when done so the headless tab is released.

## Check the answer before you report it

Before EndTurn, check that your answer fits what was asked — the page showing a number does not make it the answer:
- **Scope.** If the task names a place, store, date range, price limit or other filter, confirm on the page that the RESULTS are
  limited to it (a distance / radius / "nearby" / "this store" filter, the result cards' locations, the URL's parameters). A store or
  location shown in the header is a preference, not proof the list was filtered. Set the filter if one exists — setting it IS part of
  the task: leave it set in the final state you report, never switch it back to "verify" or to restore a default. For "near <place>"
  pick the smallest offered radius that covers the place's own store/area (e.g. 25–50 miles, or "this store" when offered) and name it.
- **Scale.** Ask whether the number is plausible for that scope (one store does not stock thousands of cars of two makes). A total that
  equals the sum of the site-wide facet counts is unfiltered.
- If you cannot confirm the scope, say so plainly in your reply ("the count shown is site-wide; the local results are …") — never
  present an unfiltered total as the scoped answer.
- The user's scope outranks procedural detail in your instructions: if following a step as written would leave the result unscoped
  (e.g. "leave the radius alone" when the task asks for cars near a place), apply the scope filter anyway and say that you did.
- If one entry page is blocked (a bot wall on the home page), try the site's deeper pages (its search or listing URL) before reporting
  failure, and say which entry worked.

## Output discipline

Return ONE concise text reply to the parent containing exactly the information requested. Do not
narrate the steps you took. When you call EndTurn, each citation must be an EXACT substring of a tool
output you saw this turn (copy the text verbatim, including quotes and braces) — paraphrased citations are
rejected and cost you a re-browse. Do not include screenshots unless they are the requested output. If the
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
    // nexus-browser tools are auto-injected by the subagent's MCP_AUTO_INJECT=true override. This list IS enforced
    // (agent-mode.ts → allowedBaseTools): it governs the offered tools, the SearchTools catalog and execution.
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

Two modes. Default (delegate): a subagent runs in its own forked process with the full
nexus-browser MCP toolset (~43 tools) and returns the result — your context stays clean.
mode "direct": you drive the browser yourself — those tools are connected into your own
session (costs their definitions in context); use it for step-by-step work.

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
          mode: {
            type: 'string',
            enum: ['delegate', 'direct'],
            description: 'How to browse. "delegate" (default): a browse sub-agent does the whole task and returns the result — your context only sees the outcome. "direct": you drive the browser yourself — the ~43 nexus-browser tools (browse, scan, click, type, get_content, …) are connected into YOUR session for the rest of it; use for back-and-forth work where you need to see each page.',
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
    if (params.mode !== undefined && params.mode !== 'delegate' && params.mode !== 'direct') {
      return 'mode must be "delegate" or "direct"';
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

    if (params.mode === 'direct') {
      return this.createErrorResult('mode "direct" is handled by the orchestrator (it connects the browser tools into your session); this runtime did not intercept it — use Browse without mode.');
    }
    // Recursion guard (last line of defence): no sub-agent starts a Browse sub-agent (the 2026-10-19 design, restored 2026-11-03).
    // Delegates are not offered Browse/Task/WebSearch at the default CORTEX_MAX_AGENT_DEPTH=1 (core toolAllowlist.ts) and the
    // orchestrator refuses any spawn there; a delegate that needs a browser drives the nexus-browser MCP itself (`mcp: nexus-browser`).
    if (process.env.CORTEX_AGENT_MODE === 'true') {
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
