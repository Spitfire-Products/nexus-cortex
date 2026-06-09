/**
 * Local Model Cards
 *
 * Models running on localhost via LMStudio, Ollama, LocalAI, etc.
 * All models use OpenAI-compatible API endpoints.
 *
 * Common Ports:
 * - LMStudio: http://localhost:1234
 * - Ollama: http://localhost:11434
 * - LocalAI: http://localhost:8080
 *
 * Total: 3 example models
 */

export { llama38bLocal } from './llama-3-8b-local.js';
export { mistral7bOllama } from './mistral-7b-ollama.js';
export { codellama13bLocal } from './codellama-13b-local.js';
