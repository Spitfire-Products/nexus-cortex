/**
 * Gemini 2.5 Computer Use Preview (gemini-2.5-computer-use-preview-10-2025)
 * Google's Gemini model with computer use capabilities
 *
 * Best for: Computer interaction, UI automation, browser control
 * Cost: $2.50 input / $10.00 output per million tokens (estimated, preview pricing)
 *
 * Features:
 * - Computer use capabilities (screen interaction, clicks, typing)
 * - Multimodal input (images, text)
 * - 128K context window
 * - 64K output tokens
 *
 * Note: Preview model - API and capabilities may change
 */

import { createGeminiModelConfig } from '../../configurators/GoogleConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gemini25ComputerUsePreview: ModelConfig = createGeminiModelConfig({
  id: 'gemini-2.5-computer-use-preview-10-2025',
  displayName: 'Gemini 2.5 Computer Use Preview',
  family: 'gemini-2.5',
  contextWindow: 128000,
  outputTokens: 64000,
  inputCost: 2.50,   // Preview pricing estimate
  outputCost: 10.0   // Preview pricing estimate
});
