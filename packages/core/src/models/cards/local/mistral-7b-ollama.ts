/**
 * Mistral 7B (Local via Ollama)
 * Running on localhost through Ollama
 *
 * Best for: Fast local inference, low memory usage
 * Cost: FREE (local inference)
 *
 * Setup Instructions:
 * 1. Install Ollama: https://ollama.ai
 * 2. Pull model: ollama pull mistral
 * 3. Server starts automatically on port 11434
 * 4. Model available at: http://localhost:11434/v1
 *
 * Note: Ollama uses different port (11434) than LMStudio (1234)
 */

import { createLocalModelConfig } from '../../configurators/LocalModelConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const mistral7bOllama: ModelConfig = createLocalModelConfig({
  id: 'mistral-7b-ollama',
  displayName: 'Mistral 7B (Ollama)',
  family: 'mistral',
  contextWindow: 8192,
  outputTokens: 4096,
  endpoint: 'http://localhost:11434/v1/chat/completions',
  apiKeyEnvVar: 'OLLAMA_API_KEY',  // Ollama doesn't need auth
  supportsTools: false
});
