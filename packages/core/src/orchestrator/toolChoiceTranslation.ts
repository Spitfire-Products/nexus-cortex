/**
 * toolChoiceTranslation — normalized forced-tool-choice → per-provider wire shape
 * (MENTORSHIP_ASK_FOR_ADVICE_SPEC §3). UNIVERSAL: one normalized `toolChoice` on
 * PreparedRequest fans out here to every provider's shape, so forced tool selection
 * works for ALL models/patterns, not one. Pure + unit-testable; APIClient's per-pattern
 * body-builders call this and place {key: value} on the outgoing body (a body-level
 * control — NOT the cached tools/prefix, so it is cache-safe).
 *
 * `name` must be the WIRE tool name (snake_case) — naming conversion already happened at
 * the gateway (ToolNamingHandler) before the request reached APIClient.
 */

export interface NormalizedToolChoice {
  /** 'auto' = model decides; 'required'/'any' = must call SOME tool; 'tool' = force `name`. */
  type: 'auto' | 'required' | 'tool';
  /** Wire tool name to force (required when type === 'tool'). */
  name?: string;
}

/** The body key + value to set on the outgoing request for a given provider pattern. */
export interface WireToolChoice {
  key: 'tool_choice' | 'tool_config';
  value: unknown;
}

/**
 * Translate a normalized tool choice to the wire shape for `apiPattern`.
 * Returns undefined when there is nothing to emit (no choice, unknown pattern, or a
 * malformed force-with-no-name) — the caller then leaves the provider default (auto).
 */
export function translateToolChoice(
  tc: NormalizedToolChoice | undefined,
  apiPattern: string,
): WireToolChoice | undefined {
  if (!tc) return undefined;
  // A 'tool' force with no name is meaningless — degrade to 'required' (must call something)
  // rather than emit a broken body.
  const type: NormalizedToolChoice['type'] =
    tc.type === 'tool' && !tc.name ? 'required' : tc.type;
  const name = tc.name;

  switch (apiPattern) {
    // Anthropic + xAI + MiniMax (Messages API). Vocabulary: any = required.
    case 'messages':
      if (type === 'auto') return { key: 'tool_choice', value: { type: 'auto' } };
      if (type === 'required') return { key: 'tool_choice', value: { type: 'any' } };
      return { key: 'tool_choice', value: { type: 'tool', name } };

    // OpenAI / DeepSeek / Groq / GLM / Qwen / Moonshot / Mercury / HF / Cloudflare / Local.
    case 'chat/completions':
    case 'hf-space':
      if (type === 'auto') return { key: 'tool_choice', value: 'auto' };
      if (type === 'required') return { key: 'tool_choice', value: 'required' };
      return { key: 'tool_choice', value: { type: 'function', function: { name } } };

    // OpenAI Responses API (gpt-5-codex, xAI stateful). Flat function shape.
    case 'responses':
      if (type === 'auto') return { key: 'tool_choice', value: 'auto' };
      if (type === 'required') return { key: 'tool_choice', value: 'required' };
      return { key: 'tool_choice', value: { type: 'function', name } };

    // Google Gemini (REST + SDK + free Gemma). Uses tool_config, not tool_choice.
    case 'generateContent':
    case 'google-sdk':
    case 'google-genai':
      if (type === 'auto')
        return { key: 'tool_config', value: { function_calling_config: { mode: 'AUTO' } } };
      if (type === 'required')
        return { key: 'tool_config', value: { function_calling_config: { mode: 'ANY' } } };
      return {
        key: 'tool_config',
        value: { function_calling_config: { mode: 'ANY', allowed_function_names: [name] } },
      };

    default:
      return undefined; // unknown pattern → emit nothing (safe default)
  }
}
