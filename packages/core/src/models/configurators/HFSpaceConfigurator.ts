/**
 * HuggingFace Gradio Space Model Configurator
 *
 * Serve a model from a HuggingFace Gradio Space and use it in the harness natively.
 * The Space must expose a Gradio API named `/run` with the signature
 *   run(messages_json: str, tools_json: str, max_new_tokens: int, temperature: float) -> str
 * returning the model's raw text (native tool-call + <think> syntax). The harness calls
 * it via @gradio/client (provider 'hf-space', APIClient.sendHFSpaceAPI) and normalizes
 * the raw output to the OpenAI shape in-process (see models/hfSpace/normalize.ts).
 *
 * A ready-to-deploy Space template lives at scripts/hf-space-template/ (app.py etc.).
 * Non-streaming: the Gradio predict() call is blocking.
 */

import type { ModelConfig } from '../ModelConfig.interface.js';

export interface HFSpaceModelOptions {
  id: string;
  displayName: string;
  family: string;
  /** The Gradio Space id, e.g. "your-user/your-space". */
  spaceId: string;
  contextWindow: number;
  outputTokens: number;
  supportsTools?: boolean;
  /** Model exposes chain-of-thought (Qwen3/SmolLM3 thinking) -> reasoning_content. */
  supportsReasoning?: boolean;
  /**
   * The HF model repo this card expects the Space to be serving (e.g. "Qwen/Qwen3-0.6B").
   * The template Space prefixes every completion with [MODEL=<repo>]; when set, the
   * transport verifies the prefix and fails loudly on mismatch instead of silently
   * benchmarking/serving a mislabeled model.
   */
  expectedSpaceModel?: string;
  /**
   * Force this sampling temperature for the Space regardless of inherited request
   * defaults. Format-fragile tool callers (Phi-4-mini) emit clean structured calls
   * only near-greedy; at 0.7 they degenerate (language flips, prose instead of the
   * call array). The transport prefers this over the request's inherited value.
   */
  defaultTemperature?: number;
}

export function createHFSpaceModelConfig(options: HFSpaceModelOptions): ModelConfig {
  const supportsTools = options.supportsTools !== undefined ? options.supportsTools : true;

  return {
    id: options.id,
    provider: 'hf-space',
    displayName: options.displayName,
    family: options.family,

    api: {
      pattern: 'hf-space',        // APIClient -> sendHFSpaceAPI (Gradio transport)
      endpoint: options.spaceId,  // the Space id, NOT a URL
      apiKeyEnvVar: 'HF_TOKEN',
      authHeader: 'Authorization',
      authPrefix: 'Bearer',
    },

    tools: {
      supported: supportsTools,
      adapter: 'ChatCompletionsAPIAdapter', // request-building reuses the OpenAI adapter
      namingConvention: 'snake_case',
      maxTools: supportsTools ? 128 : 0,
      parallelToolCalls: supportsTools,
    },

    parameters: {
      temperature: {
        supported: true, paramName: 'temperature', min: 0.0, max: 2.0,
        ...(options.defaultTemperature !== undefined && { default: options.defaultTemperature }),
      },
      maxTokens: { supported: true, paramName: 'max_tokens', default: 2048, min: 1, max: options.outputTokens },
      topP: { supported: true, paramName: 'top_p', default: 1.0, min: 0.0, max: 1.0 },
    },

    limits: {
      contextWindow: options.contextWindow,
      outputTokens: options.outputTokens,
      requestsPerMinute: 60,
      tokensPerMinute: 100000,
    },

    // Non-streaming: the Gradio predict() call returns the full completion at once.
    streaming: { supported: false, format: 'sse' },

    compaction: {
      strategy: 'auto',
      thresholdCalculation: { method: 'percentage', percentage: 0.8, safetyMargin: 4000 },
      behavior: { preserveRecent: 10, compactOlder: true, useHelperModel: false },
    },

    cost: { inputPerMillion: 0.0, outputPerMillion: 0.0 },

    ...(options.expectedSpaceModel && {
      metadata: { hfSpaceExpectedModel: options.expectedSpaceModel },
    }),

    // DeepSeek/CF reasoner pattern: reasoning arrives as a separate reasoning_content field.
    ...(options.supportsReasoning && {
      reasoning: {
        supported: true,
        format: 'reasoning_content',
        extractionMethod: 'separate_field',
        pattern: 'interleaved',
      },
    }),
  };
}
