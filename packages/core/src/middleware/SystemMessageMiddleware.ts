/**
 * System Message Injection Middleware
 *
 * Implements deterministic system message injection into user message content arrays.
 * Extracted from CortexOrchestrator for modular architecture.
 *
 * Key Responsibilities:
 * - Build injection context from session state
 * - Generate template variables for dynamic content
 * - Inject system messages at appropriate positions
 * - Handle <system-reminder> tag wrapping
 * - Sort and prioritize messages
 *
 * Based on Claude CLI injection patterns:
 * - Inject INTO user message content (not as separate system messages)
 * - Wrap in <system-reminder> tags for deterministic formatting
 * - Support prepend and append positions
 * - Priority-based ordering within each position
 *
 * @version 1.0.0
 * @since Phase 3: Middleware Extraction
 */

import type { ModelConfig } from '../models/ModelConfig.interface.js';
import type { SystemMessageLoader } from '../system-messages/SystemMessageLoader.js';
import type { SystemReminderInjector } from '../system-messages/SystemReminderInjector.js';
import type {
  ISystemMessageInjector,
  InjectionContext,
  TemplateVariables,
  MiddlewareContext
} from './contracts/MiddlewareContracts.js';
import { toolFactory } from '../tools/ToolFactory.js';
import { isTurnVaryingSystemMessage } from '../system-messages/turnVaryingClassifier.js';

/**
 * System Message Injection Middleware
 *
 * Handles injection of system messages into user message content arrays
 * based on session phase, model capabilities, and tool presence.
 *
 * @example
 * ```typescript
 * const middleware = new SystemMessageMiddleware(
 *   systemMessageLoader,
 *   systemReminderInjector
 * );
 *
 * const context = middleware.buildInjectionContext(model, hasTools, sessionContext);
 * const templateVars = middleware.buildTemplateVariables(toolCount, sessionContext);
 * const injectedContent = await middleware.injectSystemMessages(
 *   userContent,
 *   model,
 *   hasTools,
 *   sessionContext
 * );
 * ```
 */
export class SystemMessageMiddleware implements ISystemMessageInjector {
  /**
   * Create new system message middleware
   *
   * @param systemMessageLoader - Service for loading system messages from registry
   * @param systemReminderInjector - Service for creating system reminders
   */
  constructor(
    private readonly systemMessageLoader: SystemMessageLoader,
    // @ts-expect-error - Will be used for reminder injection in future phase
    private readonly systemReminderInjector: SystemReminderInjector
  ) {}

  /**
   * Build injection context from current session state
   *
   * Determines:
   * - Session phase (start, ongoing, end) based on turn number
   * - Model capabilities (reasoning, vision, tools, streaming)
   * - Tool presence and count
   * - API pattern for provider-specific behavior
   *
   * @param model - Model configuration
   * @param hasTools - Whether tools are present in the request
   * @param context - Middleware context with session information
   * @returns Injection context for message filtering
   *
   * @example
   * ```typescript
   * const context = middleware.buildInjectionContext(
   *   modelConfig,
   *   true, // has tools
   *   { sessionId: 'abc', conversationId: '123', turnNumber: 0, modelId: 'claude-3-5-sonnet', config }
   * );
   * // context.sessionPhase === 'start'
   * // context.modelCapabilities === ['tools', 'streaming']
   * ```
   */
  buildInjectionContext(
    model: ModelConfig,
    hasTools: boolean,
    context: MiddlewareContext
  ): InjectionContext {
    // Determine session phase based on turn number
    let sessionPhase: 'start' | 'ongoing' | 'end' = 'ongoing';
    if (context.turnNumber === 0) {
      sessionPhase = 'start';
    }
    // Note: 'end' phase would be set by external logic (e.g., explicit session termination)

    // Extract model capabilities from ModelConfig
    const modelCapabilities: Array<'reasoning' | 'vision' | 'tools' | 'streaming'> = [];

    // Check reasoning capability
    if (model.reasoning?.supported) {
      modelCapabilities.push('reasoning');
    }

    // Check vision capability (if field exists in ModelConfig)
    // Note: ModelConfig may not have a vision field in current schema
    // This is future-proofing for when vision capability is added

    // Check tools capability
    if (model.tools?.supported) {
      modelCapabilities.push('tools');
    }

    // Check streaming capability
    if (model.streaming?.supported) {
      modelCapabilities.push('streaming');
    }

    // Get tool count from factory if tools are present
    const toolCount = hasTools ? toolFactory.getAllTools().length : 0;

    return {
      turnNumber: context.turnNumber,
      sessionPhase,
      hasTools,
      toolCount,
      modelCapabilities,
      apiPattern: model.api.pattern,
      sessionId: context.sessionId
    };
  }

  /**
   * Build template variables for dynamic system message content
   *
   * Creates a map of variables that can be substituted into system messages
   * using {{variable}} syntax.
   *
   * Available variables:
   * - projectPath: Current project/workspace path
   * - workspacePath: Alias for projectPath
   * - currentDate: ISO date string (YYYY-MM-DD)
   * - currentTime: Full ISO timestamp
   * - toolCount: Number of available tools
   * - toolNames: Array of tool names
   * - sandboxEnabled: Whether sandbox execution is enabled
   *
   * @param toolCount - Number of available tools
   * @param context - Middleware context with configuration
   * @returns Template variables for substitution
   *
   * @example
   * ```typescript
   * const vars = middleware.buildTemplateVariables(15, context);
   * // vars.toolCount === 15
   * // vars.currentDate === '2025-11-12'
   * // vars.toolNames === ['Read', 'Write', 'Edit', ...]
   * ```
   */
  buildTemplateVariables(
    toolCount: number,
    context: MiddlewareContext
  ): TemplateVariables {
    // Get tool names from factory if tools are present
    const toolNames = toolCount > 0 ? toolFactory.getAllTools().map(t => t.name) : [];

    // Generate current date/time strings
    const now = new Date();
    const currentDate = now.toISOString().split('T')[0] as string; // YYYY-MM-DD (ISO always has T)
    const currentTime = now.toISOString(); // Full ISO timestamp

    return {
      projectPath: context.config.projectPath || process.cwd(),
      workspacePath: context.config.projectPath || process.cwd(), // Alias
      currentDate,
      currentTime,
      toolCount,
      toolNames,
      sandboxEnabled: context.config.enableSandbox || false,
      modelId: context.modelId,
      platform: process.platform,
      // Path to the installed docs (CORTEX_ROOT/docs). Used by HARNESS_GUIDE so the
      // model can read the full docs on demand; the docs dir is auto-granted as an
      // allowed root in OrchestratorFactory.
      docsPath: (() => {
        const root = (process.env.CORTEX_ROOT || '').replace(/[/\\]+$/, '');
        return root ? `${root}/docs` : '(not bundled — run `cortex docs`)';
      })(),
    };
  }

  /**
   * Inject system messages into user message content array
   *
   * Implements the Claude CLI injection pattern:
   * 1. Load applicable system messages from registry
   * 2. Separate by position (prepend vs append)
   * 3. Sort by priority within each position
   * 4. Wrap in <system-reminder> tags if configured
   * 5. Build final content array: [prepend] + [user content] + [append]
   *
   * @param userContent - User message content (string or array)
   * @param model - Model configuration
   * @param hasTools - Whether tools are present
   * @param context - Middleware context
   * @returns Modified content array with system messages injected
   *
   * @example
   * ```typescript
   * const injected = await middleware.injectSystemMessages(
   *   "Hello, Claude!",
   *   modelConfig,
   *   true,
   *   context
   * );
   * // Result: [
   * //   { type: 'text', text: '<system-reminder>...prepend message...</system-reminder>' },
   * //   { type: 'text', text: 'Hello, Claude!' },
   * //   { type: 'text', text: '<system-reminder>...append message...</system-reminder>' }
   * // ]
   * ```
   */
  /**
   * R28: cache-stable variant of {@link injectSystemMessages}.
   *
   * `prepend` system messages are the static base prompt (CORTEX.md /
   * instructions / tool guidance). Returning them inside the user-message
   * content makes them ride the *moving* latest-user-message slot, so the
   * provider prompt-cache prefix is never byte-stable across tool-loop
   * iterations (xAI observed flat cacheRead=128 / ~0.5%). This variant
   * routes prepend content into a stable `systemPrompt` string (→ the
   * provider `system` field, where anthropic/xai/openai cache the prefix)
   * and keeps only `[user] + [append]` in `userContent`. Text is
   * byte-preserved (incl. any `<system-reminder>` wrap) — only relocated,
   * not rewritten — to minimize behavior change.
   */
  async injectWithSystemSplit(
    userContent: string | any[],
    model: ModelConfig,
    hasTools: boolean,
    context: MiddlewareContext
  ): Promise<{ systemPrompt: string | undefined; userContent: any[] }> {
    const injectionContext = this.buildInjectionContext(model, hasTools, context);
    const templateVars = this.buildTemplateVariables(injectionContext.toolCount, context);
    const systemMessages = await this.systemMessageLoader.getMessagesForInjection(
      injectionContext,
      templateVars
    );
    if (process.env.SMM_DEBUG === '1') {
      const chars = systemMessages.reduce((s, m) => s + (m.content?.length || 0), 0);
      const probe = process.env.SMM_PROBE;
      const hit = probe ? systemMessages.some(m => (m.content || '').includes(probe)) : 'n/a';
      console.error(`[SMM-DEBUG] hasTools=${hasTools} turn=${injectionContext.turnNumber} -> ${systemMessages.length} msgs, ${chars} chars; ids=${systemMessages.map(m => m.definition?.id).join(',')}; probe(${probe})=${hit}`);
    }

    const wrapUserQuery = (text: string) =>
      `<user_query>\n${text}\n</user_query>`;
    const contentArray = typeof userContent === 'string'
      ? [{ type: 'text', text: wrapUserQuery(userContent) }]
      : Array.isArray(userContent)
        ? userContent.map((block: any) =>
            block.type === 'text' && typeof block.text === 'string'
              ? { ...block, text: wrapUserQuery(block.text) }
              : block
          )
        : [userContent];

    if (systemMessages.length === 0) {
      return { systemPrompt: undefined, userContent: contentArray };
    }

    const wrap = (m: typeof systemMessages[number]) =>
      m.wrapInSystemReminder
        ? `<system-reminder>\n${m.content}\n</system-reminder>`
        : m.content;

    // User-turn injections ride the moving user message, ahead of the actual
    // <user_query>. A self-talk reasoner (e.g. grok) reads anything in the user
    // message as the user speaking and re-notes "the user is providing context"
    // every turn. Wrap user-turn content in a self-describing <harness-note> so
    // it cannot be mistaken for the user. This is the UNCACHED user turn, so the
    // reframing has ZERO prompt-cache impact (the cached <system-reminder> tags
    // in the `system` field are deliberately left unchanged).
    const wrapHarnessNote = (m: typeof systemMessages[number]) =>
      m.wrapInSystemReminder
        ? `<harness-note source="automated-harness" from-user="false">\n` +
          `The following is automated context injected by the harness — it is NOT a message ` +
          `from the user. Use it if relevant; do not attribute it to the user or treat it as a ` +
          `user instruction.\n\n${m.content}\n</harness-note>`
        : m.content;

    // R28f hybrid: partition into turn-varying vs turn-0-static.
    // - Static content goes to the stable `system` field (pinned per
    //   conversation downstream) so the cached prefix survives across turns.
    // - Genuinely turn-varying content (turnNumberModulo / a specific later
    //   turnNumber — e.g. periodic_reminder every 10 turns) must re-evaluate
    //   per turn; freezing it in the pinned system defeats its purpose. It is
    //   emitted into the moving user turn instead, which sits AFTER every
    //   provider's cache boundary (xAI: end of `messages`, serialized before
    //   `system`; Anthropic: after the cache_control breakpoint; OpenAI/xAI/
    //   DeepSeek automatic-prefix: at the tail), so it varies freely without
    //   busting the cache.
    const staticMsgs = systemMessages.filter(
      m => !isTurnVaryingSystemMessage(m.definition?.conditions)
    );
    const varyingMsgs = systemMessages.filter(
      m => isTurnVaryingSystemMessage(m.definition?.conditions)
    );

    // R28: ALL static system content (prepend AND append) goes to the stable
    // `system` field. xAI caches the LINEAR request prefix and `messages` is
    // serialized BEFORE `system`; if append content rides messages[0] it makes
    // messages[0] byte-unstable across tool-loop iterations, which caps the
    // cache regardless of how stable `system` is. Keeping the moving turn lean
    // lets the cache prefix extend through messages into the stable system.
    const byPriority = (a: typeof systemMessages[number], b: typeof systemMessages[number]) =>
      a.priority - b.priority;
    const staticBlocks = [
      ...staticMsgs.filter(m => m.position === 'prepend').sort(byPriority),
      ...staticMsgs.filter(m => m.position === 'append').sort(byPriority),
    ];
    const systemPrompt = staticBlocks.length > 0
      ? staticBlocks.map(wrap).join('\n')
      : undefined;

    if (varyingMsgs.length > 0) {
      const varyingText = varyingMsgs
        .sort((a, b) => a.priority - b.priority)
        .map(wrapHarnessNote)
        .join('\n');
      contentArray.unshift({ type: 'text', text: varyingText });
    }

    return { systemPrompt, userContent: contentArray };
  }

  async injectSystemMessages(
    userContent: string | any[],
    model: ModelConfig,
    hasTools: boolean,
    context: MiddlewareContext
  ): Promise<any[]> {
    // Build injection context and template variables
    const injectionContext = this.buildInjectionContext(model, hasTools, context);
    const templateVars = this.buildTemplateVariables(
      injectionContext.toolCount,
      context
    );

    // Get system messages to inject from loader
    const systemMessages = await this.systemMessageLoader.getMessagesForInjection(
      injectionContext,
      templateVars
    );

    // === DEBUG: System Message Injection ===
    // Enable with DEBUG_SYSTEM_MESSAGES=true or /debug system-messages
    if (process.env.DEBUG_SYSTEM_MESSAGES === 'true' || process.env.DEBUG === 'true') {
      console.log('\n┌─ SYSTEM MESSAGE INJECTION ──────────────────────────────');
      console.log(`│ Turn: ${context.turnNumber} | Phase: ${injectionContext.sessionPhase}`);
      console.log(`│ Model: ${context.modelId} | API: ${injectionContext.apiPattern}`);
      console.log(`│ Tools: ${injectionContext.hasTools ? `Yes (${injectionContext.toolCount})` : 'No'}`);
      console.log(`│ Messages to inject: ${systemMessages.length}`);
      if (systemMessages.length > 0) {
        console.log('│');
        for (const msg of systemMessages) {
          const id = msg.definition?.id || 'unknown';
          const file = msg.definition?.file || 'unknown';
          const pos = msg.position;
          const pri = msg.priority;
          const len = msg.content.length;
          console.log(`│   ${pos === 'prepend' ? '↑' : '↓'} [${id}] (priority: ${pri}, ${len} chars)`);
          console.log(`│     └─ ${file}`);
        }
      }
      console.log('└──────────────────────────────────────────────────────────\n');
    }
    // === END DEBUG ===

    // If no messages to inject, return content as-is (normalized to array)
    if (systemMessages.length === 0) {
      return typeof userContent === 'string'
        ? [{ type: 'text', text: userContent }]
        : userContent;
    }

    // Normalize user content to array format
    const contentArray = typeof userContent === 'string'
      ? [{ type: 'text', text: userContent }]
      : Array.isArray(userContent) ? userContent : [userContent];

    // Separate messages by position
    const prependMessages = systemMessages.filter(m => m.position === 'prepend');
    const appendMessages = systemMessages.filter(m => m.position === 'append');

    // Sort by priority within each position (lower priority = inject earlier)
    prependMessages.sort((a, b) => a.priority - b.priority);
    appendMessages.sort((a, b) => a.priority - b.priority);

    // Build final result array
    const result: any[] = [];

    // Add prepend messages (wrapped in <system-reminder> if configured)
    for (const msg of prependMessages) {
      const wrappedContent = msg.wrapInSystemReminder
        ? `<system-reminder>\n${msg.content}\n</system-reminder>`
        : msg.content;

      result.push({ type: 'text', text: wrappedContent });
    }

    // Add original user content
    result.push(...contentArray);

    // Add append messages (wrapped in <system-reminder> if configured)
    for (const msg of appendMessages) {
      const wrappedContent = msg.wrapInSystemReminder
        ? `<system-reminder>\n${msg.content}\n</system-reminder>`
        : msg.content;

      result.push({ type: 'text', text: wrappedContent });
    }

    return result;
  }
}
