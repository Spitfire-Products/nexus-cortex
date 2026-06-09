/**
 * Grok 4.20 Multi-Agent (grok-4.20-multi-agent-0309)
 * xAI multi-agent fanout model — server-side agent orchestration
 *
 * NO client-side function tools. Built-in server tools + Remote MCP only.
 * reasoningEffort: low|medium → 4 agents, high|xhigh → 16 agents.
 *
 * Best for: Complex tasks requiring parallel agent decomposition
 * Routes through /v1/responses exclusively
 */

import { createXAIModelConfig } from '../../configurators/XAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const grok420MultiAgent: ModelConfig = createXAIModelConfig({
  id: 'grok-4.20-multi-agent-0309',
  displayName: 'Grok 4.20 Multi-Agent (Beta)',
  family: 'grok-4',
  contextWindow: 2000000,
  outputTokens: 131072,
  inputCost: 0.25,
  outputCost: 0.60,
  supportsReasoning: true,
  reasoningToggleable: false
});
