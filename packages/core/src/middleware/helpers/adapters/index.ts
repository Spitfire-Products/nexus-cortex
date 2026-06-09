/**
 * Helper Middleware Adapters
 * Phase 1.5: Week 2 - Independent Helper System
 *
 * Exports all helper adapters and provides default registration.
 * Supports ALL 5 API patterns for comprehensive model coverage.
 */

import { MessagesAPIHelperAdapter } from './MessagesAPIHelperAdapter.js';
import { ChatCompletionsAPIHelperAdapter } from './ChatCompletionsAPIHelperAdapter.js';
import { GoogleGenAPIHelperAdapter } from './GoogleGenAPIHelperAdapter.js';
import { GenerateContentAPIHelperAdapter } from './GenerateContentAPIHelperAdapter.js';
import { ResponsesAPIHelperAdapter } from './ResponsesAPIHelperAdapter.js';
import type { HelperModelMiddlewareRegistry } from '../HelperModelMiddlewareRegistry.js';

export {
  MessagesAPIHelperAdapter,
  ChatCompletionsAPIHelperAdapter,
  GoogleGenAPIHelperAdapter,
  GenerateContentAPIHelperAdapter,
  ResponsesAPIHelperAdapter
};

/**
 * Register default helper adapters
 *
 * This function registers ALL built-in helper adapters with the
 * HelperModelMiddlewareRegistry. Call this during system initialization.
 *
 * Registered Adapters:
 * 1. MessagesAPIHelperAdapter ('messages') - Anthropic Claude, XAI Grok
 * 2. ChatCompletionsAPIHelperAdapter ('chat/completions') - OpenAI, DeepSeek, Groq
 * 3. GoogleGenAPIHelperAdapter ('google-genai') - FREE Gemma models
 * 4. GenerateContentAPIHelperAdapter ('generateContent') - Paid Gemini models
 * 5. ResponsesAPIHelperAdapter ('responses') - OpenAI stateful API (GPT-5 Codex, etc.)
 *
 * @param registry - HelperModelMiddlewareRegistry instance
 */
export function registerDefaultHelperAdapters(registry: HelperModelMiddlewareRegistry): void {
  // Register all 5 adapters
  registry.register(new MessagesAPIHelperAdapter());
  registry.register(new ChatCompletionsAPIHelperAdapter());
  registry.register(new GoogleGenAPIHelperAdapter());
  registry.register(new GenerateContentAPIHelperAdapter());
  registry.register(new ResponsesAPIHelperAdapter());

  if (process.env.DEBUG === 'true') {
    console.log('[OK] Registered 5 helper adapters (messages, chat/completions, google-genai, generateContent, responses)');
  }
}
