# Model Card Templates

Quick copy-paste templates for adding new models.

---

## 🚀 Quick Template (Copy & Edit)

```typescript
/**
 * [MODEL NAME] ([model-id])
 * [Provider's description]
 *
 * Best for: [use cases]
 * Cost: $[X] input / $[Y] output per million tokens
 */

import { create[Provider]ModelConfig } from '../../configurators/[Provider]Configurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const [modelVariableName]: ModelConfig = create[Provider]ModelConfig({
  id: '[model-id]',
  displayName: '[Display Name]',
  family: '[family-name]',
  contextWindow: [number],
  outputTokens: [number],
  inputCost: [number],
  outputCost: [number]
});
```

---

## Provider-Specific Templates

### OpenAI (GPT Models)

```typescript
/**
 * GPT-6 (gpt-6)
 * OpenAI's GPT-6 flagship model
 *
 * Best for: Advanced reasoning and complex tasks
 * Cost: $5.00 input / $15.00 output per million tokens
 */

import { createOpenAIModelConfig } from '../../configurators/OpenAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gpt6: ModelConfig = createOpenAIModelConfig({
  id: 'gpt-6',
  displayName: 'GPT-6',
  family: 'gpt-6',
  contextWindow: 256000,
  outputTokens: 32768,
  inputCost: 5.0,
  outputCost: 15.0
});
```

**Special Cases**:

**O-series reasoning models** (no tool support, with reasoning):
```typescript
export const o5: ModelConfig = createOpenAIModelConfig({
  id: 'o5',
  displayName: 'O5',
  family: 'o5',
  contextWindow: 128000,
  outputTokens: 100000,
  inputCost: 50.0,
  outputCost: 200.0,
  supportsTools: false,  // ⬅️ No function calling
  reasoning: {
    supported: true,
    format: 'reasoning_content',
    extractionMethod: 'separate_field'
  }
});
```

**Responses API models**:
```typescript
import { createOpenAIResponsesModelConfig } from '../../configurators/OpenAIResponsesConfigurator.js';

export const gpt6Codex: ModelConfig = createOpenAIResponsesModelConfig({
  id: 'gpt-6-codex',
  displayName: 'GPT-6 Codex',
  family: 'gpt-6',
  contextWindow: 128000,
  outputTokens: 16384,
  inputCost: 5.0,
  outputCost: 15.0
});
```

### Anthropic (Claude Models)

```typescript
/**
 * Claude Opus 5 (claude-opus-5-20260101)
 * Anthropic's most powerful model
 *
 * Best for: Complex reasoning, long-form content
 * Cost: $20.00 input / $100.00 output per million tokens
 */

import { createClaudeModelConfig } from '../../configurators/ClaudeConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const claudeOpus5: ModelConfig = createClaudeModelConfig({
  id: 'claude-opus-5-20260101',
  displayName: 'Claude Opus 5',
  family: 'claude-5',
  contextWindow: 200000,
  outputTokens: 8192,
  inputCost: 20.0,
  outputCost: 100.0
});
```

### Google Gemini

```typescript
/**
 * Gemini 3.0 Pro (gemini-3.0-pro)
 * Google's latest flagship model
 *
 * Best for: Long context tasks (2M tokens)
 * Cost: $3.00 input / $12.00 output per million tokens
 */

import { createGeminiModelConfig } from '../../configurators/GoogleConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gemini30Pro: ModelConfig = createGeminiModelConfig({
  id: 'gemini-3.0-pro',
  displayName: 'Gemini 3.0 Pro',
  family: 'gemini-3.0',
  contextWindow: 2097152,  // 2M tokens
  outputTokens: 8192,
  inputCost: 3.0,
  outputCost: 12.0
});
```

### Gemma (FREE Google Models)

```typescript
/**
 * Gemma 4 9B IT (gemma-4-9b-it)
 * Google's Gemma 4 9B model (FREE)
 *
 * Best for: Cost-sensitive tasks, experimentation
 * Cost: FREE
 */

import { createGemmaModelConfig } from '../../configurators/GemmaConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const gemma49bIt: ModelConfig = createGemmaModelConfig({
  id: 'gemma-4-9b-it',
  displayName: 'Gemma 4 9B IT (FREE)',
  family: 'gemma-4',
  contextWindow: 16384,
  outputTokens: 8192
  // No cost parameters - FREE!
});
```

### XAI (Grok Models)

```typescript
/**
 * Grok 5 (grok-5)
 * XAI's Grok 5 model
 *
 * Best for: Real-time information, large contexts
 * Cost: $6.00 input / $18.00 output per million tokens
 */

import { createXAIModelConfig } from '../../configurators/XAIConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const grok5: ModelConfig = createXAIModelConfig({
  id: 'grok-5',
  displayName: 'Grok 5',
  family: 'grok-5',
  contextWindow: 256000,
  outputTokens: 131072,
  inputCost: 6.0,
  outputCost: 18.0
});
```

### DeepSeek

```typescript
/**
 * DeepSeek Chat V3 (deepseek-chat-v3)
 * DeepSeek's latest chat model
 *
 * Best for: Cost-effective general tasks
 * Cost: $0.20 input / $0.40 output per million tokens
 */

import { createDeepSeekModelConfig } from '../../configurators/DeepSeekConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const deepseekChatV3: ModelConfig = createDeepSeekModelConfig({
  id: 'deepseek-chat-v3',
  displayName: 'DeepSeek Chat V3',
  family: 'deepseek',
  contextWindow: 64000,
  outputTokens: 8192,
  inputCost: 0.20,
  outputCost: 0.40
});
```

### Local Models

```typescript
/**
 * Llama 4 70B (Local via LMStudio)
 * Running on localhost through LMStudio
 *
 * Best for: Privacy-sensitive tasks, offline work
 * Cost: FREE (local inference)
 *
 * Setup:
 * 1. Install LMStudio: https://lmstudio.ai
 * 2. Download Llama 4 70B model
 * 3. Start local server (port 1234)
 */

import { createLocalModelConfig } from '../../configurators/LocalModelConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const llama470bLocal: ModelConfig = createLocalModelConfig({
  id: 'llama-4-70b-local',
  displayName: 'Llama 4 70B (Local)',
  family: 'llama-4',
  contextWindow: 8192,
  outputTokens: 4096,
  endpoint: 'http://localhost:1234/v1/chat/completions',
  apiKeyEnvVar: 'LOCAL_MODEL_API_KEY',
  supportsTools: false
});
```

**Ollama variant** (different port):
```typescript
export const llama470bOllama: ModelConfig = createLocalModelConfig({
  id: 'llama-4-70b-ollama',
  displayName: 'Llama 4 70B (Ollama)',
  family: 'llama-4',
  contextWindow: 8192,
  outputTokens: 4096,
  endpoint: 'http://localhost:11434/v1/chat/completions',  // ⬅️ Ollama port
  apiKeyEnvVar: 'OLLAMA_API_KEY',
  supportsTools: false
});
```

---

## Index File Template

After creating model cards, update the provider's index.ts:

```typescript
/**
 * [Provider] Model Cards
 *
 * [Description of provider models]
 *
 * Total: [N] models
 */

// [Family 1] models
export { model1 } from './model1.js';
export { model2 } from './model2.js';

// [Family 2] models
export { model3 } from './model3.js';
export { model4 } from './model4.js';
```

---

## New Configurator Template

Creating a new provider? Here's the configurator template:

```typescript
/**
 * [Provider] Model Configurator
 *
 * Factory function for creating [Provider] model configurations.
 * Supports [model families].
 */

import type { ModelConfig } from '../ModelConfig.interface.js';

export interface [Provider]ModelOptions {
  id: string;
  displayName: string;
  family: string;
  contextWindow: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  supportsTools?: boolean;
}

export function create[Provider]ModelConfig(options: [Provider]ModelOptions): ModelConfig {
  const supportsTools = options.supportsTools !== undefined ? options.supportsTools : true;

  return {
    id: options.id,
    provider: '[provider-lowercase]',
    displayName: options.displayName,
    family: options.family,

    api: {
      pattern: '[api-pattern]',           // e.g., 'chat/completions', 'messages', 'chat'
      endpoint: '[https://api.provider.com/v1/endpoint]',
      apiKeyEnvVar: '[PROVIDER]_API_KEY',
      authHeader: '[Authorization]',       // e.g., 'Authorization', 'x-api-key'
      authPrefix: '[Bearer]'               // e.g., 'Bearer', or omit
    },

    tools: {
      supported: supportsTools,
      adapter: '[Provider]APIAdapter',     // May need to create this
      namingConvention: 'snake_case',      // or 'camelCase'
      maxTools: supportsTools ? 128 : 0,
      parallelToolCalls: supportsTools
    },

    parameters: {
      temperature: {
        supported: true,
        paramName: 'temperature',
        default: 1.0,
        min: 0.0,
        max: 2.0
      },
      maxTokens: {
        supported: true,
        paramName: 'max_tokens',
        default: 4096,
        min: 1,
        max: options.outputTokens
      },
      topP: {
        supported: true,
        paramName: 'top_p',
        default: 1.0,
        min: 0.0,
        max: 1.0
      }
    },

    limits: {
      contextWindow: options.contextWindow,
      outputTokens: options.outputTokens,
      requestsPerMinute: 500,              // Check provider docs
      tokensPerMinute: 150000              // Check provider docs
    },

    streaming: {
      supported: true,
      format: 'sse'                        // or 'json'
    },

    compaction: {
      strategy: 'auto',
      thresholdCalculation: {
        method: 'percentage',
        percentage: 0.8,
        safetyMargin: 4000
      },
      behavior: {
        preserveRecent: 10,
        compactOlder: true,
        useHelperModel: supportsTools,
        helperModelId: supportsTools ? '[cheapest-model-id]' : undefined
      }
    },

    cost: {
      inputPerMillion: options.inputCost,
      outputPerMillion: options.outputCost
    }
  };
}
```

---

## Registry Integration Template

After creating model cards, add to `ModularModelRegistry.ts`:

```typescript
// 1. Add import at top
import * as [provider]Models from '../cards/[provider]/index.js';

// 2. Add to allModelCards array
// [Provider] models ([N] models)
[provider]Models.model1,
[provider]Models.model2,
[provider]Models.model3,

// 3. Update debug output
if (this.options.debug) {
  console.log(`[ModularModelRegistry] Loaded ${this.models.size} models (100% modular)`);
  console.log(`  - XAI: 6 | DeepSeek: 3 | Anthropic: 7`);
  console.log(`  - Gemma: 4 | Google: 7 | OpenAI: 17`);
  console.log(`  - Local: 3 | [Provider]: [N]`);  // ⬅️ Add your provider
}

// 4. Update header comment
/**
 * - Total: [NEW_TOTAL] models across [NEW_PROVIDER_COUNT] providers
 */
```

---

## Common Variations

### Model Without Tools

```typescript
export const modelName: ModelConfig = createProviderModelConfig({
  // ... standard options
  supportsTools: false  // ⬅️ Add this
});
```

### Reasoning Models (Extended Thinking)

**OpenAI O-series** (upfront reasoning pattern):
```typescript
export const o5: ModelConfig = createOpenAIModelConfig({
  // ... standard options
  supportsTools: false,
  reasoning: {
    supported: true,
    format: 'reasoning_content',       // OpenAI uses separate field
    extractionMethod: 'separate_field',
    pattern: 'upfront'                 // All reasoning in one block at start
  }
});
```

**Claude/DeepSeek/Gemini** (interleaved reasoning pattern):
```typescript
export const modelName: ModelConfig = createProviderModelConfig({
  // ... standard options
  reasoning: {
    supported: true,
    format: 'thinking_block',          // Anthropic-style thinking blocks
    extractionMethod: 'content_block',
    pattern: 'interleaved'             // Thinking scattered throughout response
  }
});
```

**XAI Grok** (uses supportsReasoning flag, pattern auto-set):
```typescript
export const grokModel: ModelConfig = createXAIModelConfig({
  // ... standard options
  supportsReasoning: true  // ⬅️ XAI configurator sets pattern: 'interleaved' automatically
});
```

**When to use**:
- OpenAI O-series (o1, o3, o4, etc.) → `reasoning_content` + `separate_field` + `pattern: 'upfront'`
- Claude with extended thinking → `thinking_block` + `content_block` + `pattern: 'interleaved'`
- DeepSeek reasoning models → `thinking_block` + `content_block` + `pattern: 'interleaved'`
- Gemini 2.0+ with thinking → `thinking_block` + `content_block` + `pattern: 'interleaved'`
- XAI Grok models → `supportsReasoning: true` (pattern auto-set to 'interleaved')

**Pattern differences**:
- `'upfront'`: All reasoning happens in one block at the start, then final answer (O-series)
- `'interleaved'`: Thinking scattered throughout response, interwoven with tool calls (Claude/DeepSeek/Gemini/Grok)

### Free Model (Zero Cost)

```typescript
export const freeModel: ModelConfig = createProviderModelConfig({
  // ... standard options
  inputCost: 0.0,   // ⬅️ FREE
  outputCost: 0.0   // ⬅️ FREE
});
```

### Custom Endpoint (e.g., Proxy)

```typescript
// For LocalModelConfigurator or custom configurations
endpoint: 'http://my-proxy.com:8080/v1/chat/completions'
```

### Large Context Window

```typescript
contextWindow: 2097152,  // 2M tokens (Gemini)
contextWindow: 1048576,  // 1M tokens
contextWindow: 200000,   // 200K tokens (Claude)
contextWindow: 128000,   // 128K tokens (GPT-4)
```

### Large Output Tokens

```typescript
outputTokens: 131072,  // 131K (Grok)
outputTokens: 100000,  // 100K (O-series)
outputTokens: 32768,   // 32K
outputTokens: 16384,   // 16K
outputTokens: 8192,    // 8K (common)
outputTokens: 4096,    // 4K
```

---

## Checklist

After creating a new model card:

- [ ] Created model card file in `cards/[provider]/[model-name].ts`
- [ ] Added export in `cards/[provider]/index.ts`
- [ ] Imported in `registry/ModularModelRegistry.ts`
- [ ] Updated model count in `ModularModelRegistry.ts` comment
- [ ] Updated debug output in `ModularModelRegistry.ts`
- [ ] **If reasoning model**: Added `reasoning` config (see "Reasoning Models" section above)
- [ ] **If no tool support**: Set `supportsTools: false`
- [ ] Ran `npm run build` successfully
- [ ] Ran `npm test` successfully
- [ ] Manually tested model can be retrieved from registry
- [ ] Documented any special notes in model card comments
- [ ] Committed with clear message (e.g., "Add GPT-6 model card")

---

## Quick Reference

### File Locations

```
Model Card:         src/models/cards/[provider]/[model-name].ts
Provider Index:     src/models/cards/[provider]/index.ts
Configurator:       src/models/configurators/[Provider]Configurator.ts
Registry:           src/models/registry/ModularModelRegistry.ts
Tests:              src/models/registry/__tests__/modular-registry-validation.test.ts
```

### Variable Naming

```typescript
// Model ID (use official provider ID)
id: 'gpt-4o'

// Variable name (camelCase)
export const gpt4o

// Display name (human-readable)
displayName: 'GPT-4o'

// Family (for grouping)
family: 'gpt-4o'
```

### Common Costs (as of 2025)

| Model          | Input     | Output    | Notes               |
|----------------|-----------|-----------|---------------------|
| GPT-4o         | $2.50     | $10.00    | OpenAI flagship     |
| Claude Opus 4.1| $15.00    | $75.00    | Most expensive      |
| Gemini 2.5 Pro | $2.50     | $10.00    | 2M context          |
| DeepSeek Chat  | $0.14     | $0.28     | Very cheap          |
| Grok 4 Fast    | $0.20     | $0.50     | Cheapest with tools |
| Gemma (all)    | **FREE**  | **FREE**  | Google's gift       |
| Local (all)    | **FREE**  | **FREE**  | Your hardware       |

---

## Need Help?

- **Full Guide**: [ADDING_NEW_MODELS.md](./ADDING_NEW_MODELS.md)
- **Local Models**: [LOCAL_MODELS_QUICK_START.md](./LOCAL_MODELS_QUICK_START.md)
- **Examples**: Browse `cards/` directory for real examples
- **Main README**: [README.md](./README.md)

---

**Ready to create your model card?** Copy a template above and start editing! ⚡
