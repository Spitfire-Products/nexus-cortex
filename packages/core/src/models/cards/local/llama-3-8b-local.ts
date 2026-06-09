/**
 * Llama 3 8B (Local via LMStudio)
 * Running on localhost through LMStudio
 *
 * Best for: Local development, privacy-sensitive tasks, offline work
 * Cost: FREE (local inference)
 *
 * Setup Instructions:
 * 1. Install LMStudio: https://lmstudio.ai
 * 2. Download Llama 3 8B model in LMStudio
 * 3. Start local server:
 *    - Click "Local Server" tab
 *    - Click "Start Server" (default port: 1234)
 * 4. (Optional) Set environment variable:
 *    export LOCAL_MODEL_API_KEY="dummy"
 *    Note: LMStudio doesn't require authentication, but some code may check for it
 * 5. Model will be available at: http://localhost:1234/v1
 *
 * Alternative Tools:
 * - Ollama: Change endpoint to http://localhost:11434/v1
 * - LocalAI: Change endpoint to http://localhost:8080/v1
 */

import { createLocalModelConfig } from '../../configurators/LocalModelConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const llama38bLocal: ModelConfig = createLocalModelConfig({
  id: 'llama-3-8b-local',
  displayName: 'Llama 3 8B (Local)',
  family: 'llama-3',
  contextWindow: 8192,
  outputTokens: 4096,
  endpoint: 'http://localhost:1234/v1/chat/completions',
  apiKeyEnvVar: 'LOCAL_MODEL_API_KEY',
  supportsTools: false  // Most local models don't support function calling yet
});
