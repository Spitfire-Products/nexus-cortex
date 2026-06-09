/**
 * CodeLlama 13B (Local)
 * Code-specialized model running locally
 *
 * Best for: Code generation, code completion, technical tasks
 * Cost: FREE (local inference)
 *
 * Setup Instructions:
 * 1. Use LMStudio or Ollama
 * 2. LMStudio: Download CodeLlama 13B
 * 3. Ollama: ollama pull codellama:13b
 * 4. Start server on default port
 *
 * This card assumes LMStudio (port 1234).
 * For Ollama, change endpoint to http://localhost:11434/v1/chat/completions
 */

import { createLocalModelConfig } from '../../configurators/LocalModelConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const codellama13bLocal: ModelConfig = createLocalModelConfig({
  id: 'codellama-13b-local',
  displayName: 'CodeLlama 13B (Local)',
  family: 'codellama',
  contextWindow: 16384,
  outputTokens: 4096,
  endpoint: 'http://localhost:1234/v1/chat/completions',
  apiKeyEnvVar: 'LOCAL_MODEL_API_KEY',
  supportsTools: false
});
