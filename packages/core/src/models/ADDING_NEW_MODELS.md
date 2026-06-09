# Adding New Models - Complete Guide

Complete guide for adding new models to Nexus Cortex's modular model registry.

**Time to add a new model: < 2 minutes** ⚡

---

## Table of Contents

1. [Quick Overview](#quick-overview)
2. [Architecture](#architecture)
3. [Step-by-Step Guide](#step-by-step-guide)
4. [Templates](#templates)
5. [Provider-Specific Guides](#provider-specific-guides)
6. [Testing](#testing)
7. [Troubleshooting](#troubleshooting)

---

## Quick Overview

The modular architecture makes adding models simple:

```
1. Create model card file (20 lines)
2. Export in index.ts (1 line)
3. Import in ModularModelRegistry.ts (1 line)
4. Build and test
```

**That's it!** No monolithic registry to maintain.

---

## Architecture

### Directory Structure

```
src/models/
├── cards/                          # All model cards (one file per model)
│   ├── xai/                        # Provider-specific directories
│   │   ├── index.ts
│   │   ├── grok-4.ts
│   │   └── ...
│   ├── anthropic/
│   ├── openai/
│   ├── google/
│   ├── gemma/
│   ├── deepseek/
│   └── local/
├── configurators/                  # Factory functions
│   ├── XAIConfigurator.ts
│   ├── ClaudeConfigurator.ts
│   ├── OpenAIConfigurator.ts
│   ├── GoogleConfigurator.ts
│   ├── GemmaConfigurator.ts
│   ├── DeepSeekConfigurator.ts
│   ├── OpenAIResponsesConfigurator.ts
│   └── LocalModelConfigurator.ts
└── registry/
    └── ModularModelRegistry.ts     # Imports and registers all models
```

### Key Concepts

**1. Model Card**: Single file defining one model
```typescript
export const gpt5: ModelConfig = createOpenAIModelConfig({
  id: 'gpt-5',
  displayName: 'GPT-5',
  // ... config
});
```

**2. Configurator**: Factory function that generates full ModelConfig
```typescript
export function createOpenAIModelConfig(options: OpenAIModelOptions): ModelConfig {
  // Returns complete ModelConfig with all boilerplate
}
```

**3. Registry**: Loads all model cards via static imports
```typescript
const allModelCards: ModelConfig[] = [
  openaiModels.gpt5,
  openaiModels.gpt5Mini,
  // ...
];
```

---

## Step-by-Step Guide

### Adding a Model from Existing Provider

**Example: Adding GPT-6 to OpenAI**

#### Step 1: Create Model Card

Create: `src/models/cards/openai/gpt-6.ts`

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

**Time: 30 seconds** ⚡

#### Step 2: Export in Index

Edit: `src/models/cards/openai/index.ts`

```typescript
// Add this line
export { gpt6 } from './gpt-6.js';
```

**Time: 10 seconds** ⚡

#### Step 3: Import in Registry

Edit: `src/models/registry/ModularModelRegistry.ts`

```typescript
// In the loadModelCards() method, add to OpenAI section:
// OpenAI models (19 models)  ⬅️ Update count
openaiModels.gpt4o,
openaiModels.gpt4oMini,
// ... existing models
openaiModels.gpt6,  // ⬅️ Add this line
```

**Time: 20 seconds** ⚡

#### Step 4: Update Debug Output

```typescript
if (this.options.debug) {
  console.log(`[ModularModelRegistry] Loaded ${this.models.size} models (100% modular)`);
  console.log(`  - XAI: 6 | DeepSeek: 6 | Anthropic: 7 | Gemma: 4 | Google: 8`);
  console.log(`  - OpenAI: 19 | GLM: 5 | Qwen: 5 | Moonshot: 4 | MiniMax: 2`);  // ⬅️ Update count: 18 → 19
}
```

**Time: 10 seconds** ⚡

#### Step 5: Build and Test

```bash
npm run build
npm test
```

**Time: 30 seconds** ⚡

**Total Time: ~2 minutes!** 🎉

---

### Adding a Model from New Provider

**Example: Adding Cohere Command R+**

#### Step 1: Create Configurator

Create: `src/models/configurators/CohereConfigurator.ts`

```typescript
/**
 * Cohere Model Configurator
 *
 * Factory function for creating Cohere model configurations.
 * Supports Command, Command R, Command R+ models.
 */

import type { ModelConfig } from '../ModelConfig.interface.js';

export interface CohereModelOptions {
  id: string;
  displayName: string;
  family: string;
  contextWindow: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  supportsTools?: boolean;
}

export function createCohereModelConfig(options: CohereModelOptions): ModelConfig {
  const supportsTools = options.supportsTools !== undefined ? options.supportsTools : true;

  return {
    id: options.id,
    provider: 'cohere',
    displayName: options.displayName,
    family: options.family,

    api: {
      pattern: 'chat',  // Cohere uses /chat endpoint
      endpoint: 'https://api.cohere.ai/v1/chat',
      apiKeyEnvVar: 'COHERE_API_KEY',
      authHeader: 'Authorization',
      authPrefix: 'Bearer'
    },

    tools: {
      supported: supportsTools,
      adapter: 'CohereAPIAdapter',  // You may need to create this adapter
      namingConvention: 'snake_case',
      maxTools: supportsTools ? 128 : 0,
      parallelToolCalls: supportsTools
    },

    parameters: {
      temperature: {
        supported: true,
        paramName: 'temperature',
        default: 0.7,
        min: 0.0,
        max: 1.0
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
        paramName: 'p',  // Cohere uses 'p' instead of 'top_p'
        default: 0.95,
        min: 0.0,
        max: 1.0
      }
    },

    limits: {
      contextWindow: options.contextWindow,
      outputTokens: options.outputTokens,
      requestsPerMinute: 10000,
      tokensPerMinute: 1000000
    },

    streaming: {
      supported: true,
      format: 'sse'
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
        helperModelId: supportsTools ? 'command-light' : undefined
      }
    },

    cost: {
      inputPerMillion: options.inputCost,
      outputPerMillion: options.outputCost
    }
  };
}
```

#### Step 2: Create Provider Directory

```bash
mkdir -p src/models/cards/cohere
```

#### Step 3: Create Model Cards

Create: `src/models/cards/cohere/command-r-plus.ts`

```typescript
/**
 * Command R+ (command-r-plus)
 * Cohere's most powerful model
 *
 * Best for: RAG, retrieval, complex reasoning
 * Cost: $3.00 input / $15.00 output per million tokens
 */

import { createCohereModelConfig } from '../../configurators/CohereConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const commandRPlus: ModelConfig = createCohereModelConfig({
  id: 'command-r-plus',
  displayName: 'Command R+',
  family: 'command-r',
  contextWindow: 128000,
  outputTokens: 4096,
  inputCost: 3.0,
  outputCost: 15.0
});
```

#### Step 4: Create Index File

Create: `src/models/cards/cohere/index.ts`

```typescript
/**
 * Cohere Model Cards
 *
 * Cohere models optimized for RAG and retrieval tasks.
 *
 * Total: 1 model (can add more later)
 */

export { commandRPlus } from './command-r-plus.js';
```

#### Step 5: Import in Registry

Edit: `src/models/registry/ModularModelRegistry.ts`

```typescript
// Add import at top
import * as cohereModels from '../cards/cohere/index.js';

// Add to allModelCards array
// Cohere models (1 model)
cohereModels.commandRPlus,

// Update debug output
console.log(`  - Cohere: 1`);
```

#### Step 6: Build and Test

```bash
npm run build
npm test
```

---

## Templates

### Basic Model Card Template

```typescript
/**
 * [Model Name] ([model-id])
 * [Provider] [description]
 *
 * Best for: [use cases]
 * Cost: $[input] input / $[output] output per million tokens
 */

import { create[Provider]ModelConfig } from '../../configurators/[Provider]Configurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const [modelVariableName]: ModelConfig = create[Provider]ModelConfig({
  id: '[model-id]',
  displayName: '[Display Name]',
  family: '[family]',
  contextWindow: [number],
  outputTokens: [number],
  inputCost: [number],
  outputCost: [number]
});
```

### Index.ts Template

```typescript
/**
 * [Provider] Model Cards
 *
 * [Description of provider models]
 *
 * Total: [count] models
 */

export { [model1] } from './[file1].js';
export { [model2] } from './[file2].js';
// ... more exports
```

### Configurator Template

```typescript
/**
 * [Provider] Model Configurator
 *
 * Factory function for creating [Provider] model configurations.
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
  // Add provider-specific options here
}

export function create[Provider]ModelConfig(options: [Provider]ModelOptions): ModelConfig {
  const supportsTools = options.supportsTools !== undefined ? options.supportsTools : true;

  return {
    id: options.id,
    provider: '[provider-name]',
    displayName: options.displayName,
    family: options.family,

    api: {
      pattern: '[api-pattern]',  // e.g., 'chat/completions', 'messages', 'chat'
      endpoint: '[api-endpoint]',
      apiKeyEnvVar: '[PROVIDER]_API_KEY',
      authHeader: '[header]',  // e.g., 'Authorization', 'x-api-key'
      authPrefix: '[prefix]'   // e.g., 'Bearer', omit if not needed
    },

    tools: {
      supported: supportsTools,
      adapter: '[AdapterName]',  // e.g., 'ChatCompletionsAPIAdapter'
      namingConvention: '[convention]',  // 'snake_case' or 'camelCase'
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
      requestsPerMinute: [rpm],
      tokensPerMinute: [tpm]
    },

    streaming: {
      supported: true,
      format: 'sse'  // or 'json' for JSON streaming
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

## Provider-Specific Guides

### OpenAI (GPT Models)

**Configurator**: `OpenAIConfigurator.ts`

**Example**:
```typescript
export const gpt4o: ModelConfig = createOpenAIModelConfig({
  id: 'gpt-4o',
  displayName: 'GPT-4o',
  family: 'gpt-4o',
  contextWindow: 128000,
  outputTokens: 16384,
  inputCost: 2.5,
  outputCost: 10.0,
  supportsTools: true  // GPT models support function calling
});
```

**Notes**:
- OpenAI uses `chat/completions` API pattern
- Set `supportsTools: false` for O-series reasoning models
- Use `OpenAIResponsesConfigurator` for models using Responses API (like gpt-5-codex)

### Anthropic (Claude Models)

**Configurator**: `ClaudeConfigurator.ts`

**Example**:
```typescript
export const claudeSonnet45: ModelConfig = createClaudeModelConfig({
  id: 'claude-sonnet-4-5-20250929',
  displayName: 'Claude Sonnet 4.5',
  family: 'claude-4.5',
  contextWindow: 200000,
  outputTokens: 8192,
  inputCost: 3.0,
  outputCost: 15.0
});
```

**Notes**:
- Claude uses `messages` API pattern
- All Claude models support tools
- Context window is typically 200K tokens

### Google (Gemini Models)

**Configurator**: `GoogleConfigurator.ts`

**Example**:
```typescript
export const gemini15Pro: ModelConfig = createGeminiModelConfig({
  id: 'gemini-1.5-pro',
  displayName: 'Gemini 1.5 Pro',
  family: 'gemini-1.5',
  contextWindow: 2097152,  // 2M tokens!
  outputTokens: 8192,
  inputCost: 1.25,
  outputCost: 5.0
});
```

**Notes**:
- Google/Gemini models support huge context windows (up to 2M tokens)
- Set `GOOGLE_API_KEY` or use Vertex AI with `GOOGLE_GENAI_USE_VERTEXAI=true`

### Gemma (FREE Google Models)

**Configurator**: `GemmaConfigurator.ts`

**Example**:
```typescript
export const gemma327bIt: ModelConfig = createGemmaModelConfig({
  id: 'gemma-3-27b-it',
  displayName: 'Gemma 3 27B IT (FREE)',
  family: 'gemma-3',
  contextWindow: 8192,
  outputTokens: 8192
  // No cost parameters - FREE!
});
```

**Notes**:
- Gemma models are FREE
- No input/output cost parameters
- Uses Google provider
- Smaller context windows than Gemini

### XAI (Grok Models)

**Configurator**: `XAIConfigurator.ts`

**Example**:
```typescript
export const grok4: ModelConfig = createXAIModelConfig({
  id: 'grok-4-0709',
  displayName: 'Grok 4',
  family: 'grok-4',
  contextWindow: 256000,
  outputTokens: 131072,
  inputCost: 5.0,
  outputCost: 15.0
});
```

**Notes**:
- XAI uses OpenAI-compatible API
- Large output token limits (131K)
- Set `X_API_KEY` environment variable

### DeepSeek

**Configurator**: `DeepSeekConfigurator.ts`

**Example**:
```typescript
export const deepseekChat: ModelConfig = createDeepSeekModelConfig({
  id: 'deepseek-chat',
  displayName: 'DeepSeek Chat',
  family: 'deepseek',
  contextWindow: 64000,
  outputTokens: 8192,
  inputCost: 0.14,
  outputCost: 0.28
});
```

**Notes**:
- Very cost-effective ($0.14 input)
- Good for coding tasks
- Set `DEEPSEEK_API_KEY` environment variable

### Local Models

**Configurator**: `LocalModelConfigurator.ts`

**Example**:
```typescript
export const llama38bLocal: ModelConfig = createLocalModelConfig({
  id: 'llama-3-8b-local',
  displayName: 'Llama 3 8B (Local)',
  family: 'llama-3',
  contextWindow: 8192,
  outputTokens: 4096,
  endpoint: 'http://localhost:1234/v1/chat/completions',
  apiKeyEnvVar: 'LOCAL_MODEL_API_KEY',
  supportsTools: false  // Most local models don't support tools yet
});
```

**Notes**:
- Zero cost (local inference)
- Custom endpoint support
- See `LOCAL_MODELS_SETUP_GUIDE.md` for full setup

---

## Testing

### Unit Tests

Update test expectations in `src/models/registry/__tests__/modular-registry-validation.test.ts`:

```typescript
// NOTE: Don't hardcode counts - use dynamic tests instead
it('should load models successfully', () => {
  const registry = new ModularModelRegistry();
  const models = registry.listModels();

  // Use dynamic check instead of hardcoded count
  expect(models.length).toBeGreaterThan(0);
  expect(models.every(id => typeof id === 'string' && id.length > 0)).toBe(true);
});

it('should load OpenAI models', () => {
  const registry = new ModularModelRegistry();
  const openaiModels = registry.getModelsByProvider('openai');

  // Dynamic check - resilient to adding/removing models
  expect(openaiModels.length).toBeGreaterThan(0);
  expect(openaiModels.every(m => m.provider === 'openai')).toBe(true);
});
```

### Manual Testing

```typescript
import { ModularModelRegistry } from './models/registry/ModularModelRegistry.js';

const registry = new ModularModelRegistry({ debug: true });

// Verify model exists
console.log(registry.hasModel('your-new-model-id'));  // true

// Get model config
const model = registry.getModel('your-new-model-id');
console.log(model.displayName);
console.log(model.api.endpoint);
console.log(model.cost);

// Test with orchestrator
import { CortexOrchestrator } from './orchestrator/CortexOrchestrator.js';

const orchestrator = new CortexOrchestrator({
  modelId: 'your-new-model-id',
  messages: [{ role: 'user', content: 'Hello!' }]
});

const response = await orchestrator.execute();
console.log(response);
```

### Run Tests

```bash
# Type check
npx tsc --noEmit

# Build
npm run build

# Run all tests
npm test

# Run specific test
npm test -- src/models/registry/__tests__/modular-registry-validation.test.ts
```

---

## Troubleshooting

### Model Not Found

**Error**: `Model not found: your-model-id`

**Solutions**:
1. Check model is exported in provider's `index.ts`
2. Check model is imported in `ModularModelRegistry.ts`
3. Rebuild: `npm run build`
4. Check model ID matches exactly (case-sensitive)

### TypeScript Errors

**Error**: `Property 'yourModel' does not exist on type ...`

**Solutions**:
1. Check export name matches variable name
2. Check import statement is correct
3. Run `npx tsc --noEmit` to see full error

### API Configuration Issues

**Error**: `Invalid endpoint` or authentication errors

**Solutions**:
1. Verify `api.endpoint` is correct for provider
2. Check `api.pattern` matches provider's API
3. Verify `apiKeyEnvVar` is set correctly
4. Test endpoint with curl:
   ```bash
   curl -H "Authorization: Bearer $YOUR_API_KEY" \
        https://api.provider.com/v1/endpoint
   ```

### Cost/Pricing Not Updating

**Issue**: Old prices showing

**Solutions**:
1. Update model card file
2. Rebuild: `npm run build`
3. Restart application
4. Clear any caching if applicable

---

## Best Practices

### 1. Naming Conventions

**Model IDs**: Use provider's official model ID
```typescript
id: 'gpt-4o'          // ✅ Official ID
id: 'gpt4o'           // ❌ Don't abbreviate
id: 'GPT-4o'          // ❌ Don't change case
```

**Variable Names**: camelCase, descriptive
```typescript
export const gpt4o                  // ✅ Clear
export const gpt4oModel             // ❌ Redundant
export const gptFourO               // ❌ Unclear
```

**Display Names**: Human-readable
```typescript
displayName: 'GPT-4o'               // ✅ Readable
displayName: 'gpt-4o'               // ❌ Not pretty
displayName: 'OpenAI GPT-4o'        // ❌ Redundant (provider in metadata)
```

### 2. Documentation

Always include:
- Description of model capabilities
- Best use cases
- Pricing information
- Special notes (e.g., "Does not support tools")

```typescript
/**
 * GPT-4o (gpt-4o)
 * OpenAI's flagship multimodal model
 *
 * Best for: Complex reasoning, vision, audio
 * Cost: $2.50 input / $10.00 output per million tokens
 *
 * Special: Supports vision and audio inputs
 */
```

### 3. Testing

Test every new model:
1. Unit test (add to test suite)
2. Integration test (actually call the API)
3. Cost validation (verify pricing is correct)

### 4. Git Commits

One model = one commit (unless adding related models together)

```bash
git add src/models/cards/openai/gpt-6.ts
git add src/models/cards/openai/index.ts
git add src/models/registry/ModularModelRegistry.ts
git commit -m "Add GPT-6 model card"
```

### 5. Keep Configurators DRY

Don't duplicate logic. If multiple models share config, use a configurator.

```typescript
// ✅ Good - Use configurator
export const gpt5 = createOpenAIModelConfig({ ... });
export const gpt5Mini = createOpenAIModelConfig({ ... });

// ❌ Bad - Duplicate config
export const gpt5: ModelConfig = { /* 100 lines */ };
export const gpt5Mini: ModelConfig = { /* 100 lines */ };
```

---

## Summary

Adding models to the modular registry is **fast and simple**:

1. ✅ Create model card file (30 sec)
2. ✅ Export in index.ts (10 sec)
3. ✅ Import in registry (20 sec)
4. ✅ Build and test (60 sec)

**Total: ~2 minutes per model** ⚡

**Benefits**:
- Clear git history (one model = one file)
- No merge conflicts
- Easy to review changes
- Type-safe with configurators
- Self-documenting code

---

## Additional Resources

- **ModelConfig Interface**: `src/models/ModelConfig.interface.ts`
- **Existing Configurators**: `src/models/configurators/`
- **Example Models**: `src/models/cards/`
- **Test Suite**: `src/models/registry/__tests__/`
- **Local Models Guide**: `LOCAL_MODELS_SETUP_GUIDE.md`
- **Phase 3 Complete**: `/home/runner/workspace/nexus-cortex/PHASE_3_COMPLETE_MODULAR_ARCHITECTURE.md`

---

**Questions?** Check the templates above or look at existing model cards for examples!
