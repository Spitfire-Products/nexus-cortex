# Models Directory - Documentation Index

Complete documentation for Nexus Cortex's modular model registry system.

---

## 📚 Documentation

### Main Guides

| Document | Description | When to Use |
|----------|-------------|-------------|
| **[ADDING_NEW_MODELS.md](./ADDING_NEW_MODELS.md)** | Complete guide for adding new models | Adding any new model (cloud or local) |
| **[MODEL_CARD_TEMPLATE.md](./MODEL_CARD_TEMPLATE.md)** ⭐ | Copy-paste templates for all providers | Quick reference when creating model cards |
| **[LOCAL_MODELS_QUICK_START.md](./LOCAL_MODELS_QUICK_START.md)** | 5-minute setup for local models | Setting up LMStudio/Ollama |
| **[LOCAL_MODELS_SETUP_GUIDE.md](./LOCAL_MODELS_SETUP_GUIDE.md)** | Comprehensive local models guide | Troubleshooting, advanced configs |
| **[LOCAL_MODELS_INTEGRATION_SNIPPET.md](./LOCAL_MODELS_INTEGRATION_SNIPPET.md)** | Exact code to integrate local models | Quick copy-paste integration |

### Architecture Documents

| Document | Description | Location |
|----------|-------------|----------|
| **Phase 3 Complete** | Modular architecture overview | `/home/runner/workspace/nexus-cortex/PHASE_3_COMPLETE_MODULAR_ARCHITECTURE.md` |
| **ModelConfig Interface** | TypeScript interface definition | `./ModelConfig.interface.ts` |

---

## 🚀 Quick Start

### Adding a New Model (< 2 minutes)

```typescript
// 1. Create model card: src/models/cards/openai/gpt-6.ts
import { createOpenAIModelConfig } from '../../configurators/OpenAIConfigurator.js';

export const gpt6: ModelConfig = createOpenAIModelConfig({
  id: 'gpt-6',
  displayName: 'GPT-6',
  family: 'gpt-6',
  contextWindow: 256000,
  outputTokens: 32768,
  inputCost: 5.0,
  outputCost: 15.0
});

// 2. Export in index.ts
export { gpt6 } from './gpt-6.js';

// 3. Import in ModularModelRegistry.ts
openaiModels.gpt6,

// Done! ✅
```

**Full instructions**: [ADDING_NEW_MODELS.md](./ADDING_NEW_MODELS.md)

### Setting Up Local Models (5 minutes)

```bash
# 1. Install LMStudio or Ollama
curl -fsSL https://ollama.ai/install.sh | sh
ollama pull llama3

# 2. Add to ModularModelRegistry.ts
import * as localModels from '../cards/local/index.js';
localModels.llama38bLocal,

# 3. Use it!
modelId: 'llama-3-8b-local'  // FREE, private, offline!
```

**Full instructions**: [LOCAL_MODELS_QUICK_START.md](./LOCAL_MODELS_QUICK_START.md)

---

## 📁 Directory Structure

```
src/models/
├── cards/                          # Model cards (one file per model)
│   ├── xai/                        # XAI (Grok) - 6 models
│   ├── anthropic/                  # Claude - 7 models
│   ├── openai/                     # OpenAI (GPT) - 18 models
│   ├── google/                     # Gemini - 8 models
│   ├── gemma/                      # Gemma (FREE) - 4 models
│   ├── deepseek/                   # DeepSeek - 6 models
│   ├── glm/                        # GLM (Zhipu AI) - 5 models
│   ├── qwen/                       # Qwen (Alibaba) - 5 models
│   ├── moonshot/                   # Moonshot (Kimi) - 4 models
│   └── minimax/                    # MiniMax - 2 models
├── configurators/                  # Factory functions
│   ├── XAIConfigurator.ts
│   ├── AnthropicConfigurator.ts
│   ├── OpenAIConfigurator.ts
│   ├── GoogleConfigurator.ts
│   ├── GemmaConfigurator.ts
│   ├── DeepSeekConfigurator.ts
│   ├── GLMConfigurator.ts
│   ├── QwenConfigurator.ts
│   ├── MoonshotConfigurator.ts
│   ├── MiniMaxConfigurator.ts
│   ├── OpenAIResponsesConfigurator.ts
│   └── LocalModelConfigurator.ts
├── registry/                       # Registry implementation
│   ├── ModularModelRegistry.ts     # Main registry (71 models)
│   └── __tests__/                  # Test suite (21 tests)
├── ModelConfig.interface.ts        # TypeScript interface
├── README.md                       # This file
├── ADDING_NEW_MODELS.md            # Complete guide
├── LOCAL_MODELS_QUICK_START.md     # 5-min local setup
├── LOCAL_MODELS_SETUP_GUIDE.md     # Comprehensive local guide
└── LOCAL_MODELS_INTEGRATION_SNIPPET.md  # Copy-paste code
```

---

## 🎯 Current Model Inventory

**Total: 71 models across 11 providers**

| Provider   | Models | Cost Range                    | Notes                          |
|------------|--------|-------------------------------|--------------------------------|
| XAI        | 7      | $0.20 - $5.00 input          | Grok models, large contexts    |
| DeepSeek   | 6      | $0.14 - $0.55 input          | Very cost-effective            |
| Anthropic  | 7      | $0.80 - $15.00 input         | Claude models, 200K context    |
| Gemma      | 4      | **FREE**                      | Google's free models           |
| Google     | 9      | $0.075 - $2.50 input         | Gemini, up to 2M context       |
| OpenAI     | 18     | $0.10 - $40.00 input         | GPT-4o, GPT-5, O-series        |
| GLM        | 5      | $0.10 - $0.50 input          | Chinese models, 128K context   |
| Qwen       | 5      | $0.28 - $1.20 input          | Alibaba models                 |
| Moonshot   | 5      | $0.50 - $2.00 input          | Kimi models, long context      |
| MiniMax    | 2      | $0.40 - $1.00 input          | Chinese provider               |
| OpenRouter | 3      | **FREE** - $10.00 input      | Unified API, multiple models   |

### Model Breakdown

**XAI (7)**
- grok-4-0709, grok-4.1, grok-4-fast, grok-4-fast-non-reasoning
- grok-3, grok-3-mini, grok-code-fast-1

**DeepSeek (6)**
- deepseek-chat, deepseek-reasoner, deepseek-coder
- deepseek-r1-0528, deepseek-v3-1, deepseek-v3-1-thinking

**Anthropic (7)**
- claude-sonnet-4-5, claude-sonnet-4, claude-sonnet-3-5
- claude-haiku-3, claude-opus-4-1, claude-haiku-3-5, claude-4-5-haiku

**Gemma (4 - FREE)**
- gemma-3-27b-it, gemma-3-12b-it, gemma-3-4b-it, gemma-3-1b-it

**Google Gemini (9)**
- gemini-3-pro-preview, gemini-2.0-flash, gemini-1.5-pro, gemini-2.5-pro
- gemini-2.5-flash, gemini-2.5-flash-lite
- gemini-1.5-flash, gemini-2.0-flash-lite, gemini-2.5-computer-use-preview

**OpenAI (18)**
- GPT-4o: gpt-4o, gpt-4o-mini
- O-series: o1, o1-mini, o1-pro, o3, o3-pro, o3-mini, o4-mini
- GPT-5: gpt-5, gpt-5-mini, gpt-5-nano, gpt-5-chat-latest, gpt-5-codex, gpt-5.1
- GPT-4.1: gpt-4.1, gpt-4.1-mini, gpt-4.1-nano

**GLM (5 - Zhipu AI)**
- glm-4.6, glm-4.5, glm-4.5-air, glm-4, glm-4-flash

**Qwen (5 - Alibaba)**
- qwen-3-coder, qwen-3-max-preview, qwen-turbo, qwen-plus, qwen-max

**Moonshot (5 - Kimi)**
- kimi-k2-instruct, kimi-k2-thinking, kimi-chat, kimi-chat-32k, kimi-chat-128k

**MiniMax (2)**
- minimax-m2, minimax-m2-stable

**OpenRouter (3)**
- claude-3-5-sonnet-openrouter, gpt-4o-openrouter, grok-4.1-fast-openrouter (FREE)

---

## 🏗️ Architecture Overview

### Modular Model Cards

Each model is defined in its own file:

```typescript
// One model = one file
export const gpt5: ModelConfig = createOpenAIModelConfig({
  id: 'gpt-5',
  displayName: 'GPT-5',
  family: 'gpt-5',
  contextWindow: 128000,
  outputTokens: 16384,
  inputCost: 2.5,
  outputCost: 10.0
});
```

**Benefits**:
- ✅ Clear git history (one model = one file)
- ✅ No merge conflicts
- ✅ Easy to add/modify (< 2 minutes)
- ✅ Self-documenting

### Configurators (Factory Pattern)

Configurators generate full ModelConfig objects:

```typescript
export function createOpenAIModelConfig(options: OpenAIModelOptions): ModelConfig {
  return {
    id: options.id,
    provider: 'openai',
    api: { /* boilerplate */ },
    tools: { /* boilerplate */ },
    parameters: { /* boilerplate */ },
    limits: { /* options */ },
    streaming: { /* boilerplate */ },
    compaction: { /* boilerplate */ },
    cost: { /* options */ }
  };
}
```

**Benefits**:
- ✅ DRY (Don't Repeat Yourself)
- ✅ Type-safe with TypeScript
- ✅ Consistent configuration
- ✅ Easy to update provider-wide settings

### ModularModelRegistry

Loads all models via static imports:

```typescript
const allModelCards: ModelConfig[] = [
  xaiModels.grok4,
  openaiModels.gpt5,
  // ... all 47 models
];
```

**Benefits**:
- ✅ No dynamic discovery complexity
- ✅ Tree-shakeable (unused models eliminated)
- ✅ Fast loading (no file system scanning)
- ✅ 100% type-safe

---

## 🧪 Testing

### Test Suite

**Location**: `registry/__tests__/modular-registry-validation.test.ts`

**Coverage**: 21 tests ✅
- Model loading (6 tests)
- Config validation (2 tests)
- ModelRegistry interface methods (9 tests)
- Modular architecture features (4 tests)

### Run Tests

```bash
# All tests
npm test

# Specific test file
npm test -- src/models/registry/__tests__/modular-registry-validation.test.ts

# With coverage
npm test -- --coverage
```

### Manual Testing

```typescript
import { ModularModelRegistry } from './registry/ModularModelRegistry.js';

// Debug mode shows all loaded models
const registry = new ModularModelRegistry({ debug: true });
// Output:
// [ModularModelRegistry] Loaded 71 models (100% modular)
//   - XAI: 7 | DeepSeek: 6 | Anthropic: 7 | Gemma: 4 | Google: 9
//   - OpenAI: 18 | GLM: 5 | Qwen: 5 | Moonshot: 5 | MiniMax: 2 | OpenRouter: 3

// Check model exists
console.log(registry.hasModel('gpt-5'));  // true

// Get model config
const gpt5 = registry.getModel('gpt-5');
console.log(gpt5.displayName);            // "GPT-5"
console.log(gpt5.cost.inputPerMillion);   // 2.5

// Get models by provider
const openaiModels = registry.getModelsByProvider('openai');
console.log(openaiModels.length);         // 17

// Get cheapest model for provider
const helper = registry.getHelperModel('openai');
console.log(helper.id);                   // "gpt-5-nano"
```

---

## 📖 Common Tasks

### I want to add a cloud model (e.g., GPT-6)

→ Read: **[ADDING_NEW_MODELS.md](./ADDING_NEW_MODELS.md)** (Section: "Adding a Model from Existing Provider")

### I want to add a local model (LMStudio/Ollama)

→ Read: **[LOCAL_MODELS_QUICK_START.md](./LOCAL_MODELS_QUICK_START.md)** (5 minutes)

### I want to add a new provider (e.g., Cohere)

→ Read: **[ADDING_NEW_MODELS.md](./ADDING_NEW_MODELS.md)** (Section: "Adding a Model from New Provider")

### I want to update model pricing

→ Edit the model card file, update `inputCost` and `outputCost`, rebuild

### I want to understand the architecture

→ Read: **Phase 3 Complete** (`/home/runner/workspace/nexus-cortex/PHASE_3_COMPLETE_MODULAR_ARCHITECTURE.md`)

### I'm getting "Model not found" errors

→ Read: **[ADDING_NEW_MODELS.md](./ADDING_NEW_MODELS.md)** (Section: "Troubleshooting")

### I want to see examples

→ Browse: **`cards/`** directory - each provider has example models

---

## 🎓 Key Concepts

### ModelConfig Interface

The core interface defining all model properties:

```typescript
interface ModelConfig {
  id: string;                    // Model ID (e.g., 'gpt-5')
  provider: string;              // Provider name (e.g., 'openai')
  displayName: string;           // Human-readable name
  family: string;                // Model family (e.g., 'gpt-5')
  api: APIConfig;                // API configuration
  tools: ToolsConfig;            // Tool/function calling support
  parameters: ParametersConfig;  // Supported parameters
  limits: LimitsConfig;          // Rate limits, context window
  streaming: StreamingConfig;    // Streaming support
  compaction: CompactionConfig;  // Context compaction strategy
  cost?: CostConfig;             // Pricing information
}
```

See `ModelConfig.interface.ts` for complete definition.

### Provider Patterns

Different providers use different API patterns:

| Provider   | API Pattern        | Endpoint Example                             |
|------------|--------------------|----------------------------------------------|
| OpenAI     | chat/completions   | https://api.openai.com/v1/chat/completions  |
| Anthropic  | messages           | https://api.anthropic.com/v1/messages       |
| Google     | generateContent    | (Vertex AI or direct API)                   |
| XAI        | chat/completions   | https://api.x.ai/v1/chat/completions        |
| DeepSeek   | chat/completions   | https://api.deepseek.com/v1/chat/completions|
| Local      | chat/completions   | http://localhost:PORT/v1/chat/completions   |

### Tool Support

Not all models support function/tool calling:

**Support Tools**: ✅
- OpenAI GPT-4o, GPT-5 (not O-series reasoning models)
- Anthropic Claude (all models)
- XAI Grok (all models)
- Google Gemini (most models)

**No Tool Support**: ❌
- OpenAI O-series reasoning models (o1, o3, o4)
- Most local models (Llama, Mistral, etc.)
- DeepSeek (check specific models)

Set `supportsTools: false` in configurator options.

---

## 🔧 Configuration

### Environment Variables

Set API keys in `.env` or environment:

```bash
# Cloud providers
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=AIza...        # Or use Vertex AI
X_API_KEY=xai-...
DEEPSEEK_API_KEY=sk-...

# Local models (optional, many don't need auth)
LOCAL_MODEL_API_KEY=dummy
OLLAMA_API_KEY=dummy
LMSTUDIO_API_KEY=dummy
```

### Registry Options

```typescript
const registry = new ModularModelRegistry({
  debug: true,  // Enable debug logging
  filter: (model) => model.cost.inputPerMillion < 1.0  // Only cheap models
});
```

---

## 📊 Performance

### Build Time

- **Initial build**: ~5 seconds
- **Incremental build**: ~1 second
- **Test suite**: ~18ms execution

### Runtime

- **Registry initialization**: < 1ms (static imports)
- **Model lookup**: O(1) hash map lookup
- **Memory**: ~100KB for 47 models

### Tree Shaking

Unused models are eliminated during bundling:

```typescript
// If you only import registry, unused model cards are tree-shaken
import { ModularModelRegistry } from './models/registry/ModularModelRegistry.js';
```

---

## 🆘 Support

### Questions?

1. Check this README
2. Check relevant guide in documentation
3. Look at example model cards in `cards/` directory
4. Check test suite for usage examples

### Found a Bug?

1. Check `ADDING_NEW_MODELS.md` troubleshooting section
2. Verify model card is properly exported and imported
3. Run `npm run build` to ensure latest code
4. Check test suite passes: `npm test`

### Want to Contribute?

1. Read `ADDING_NEW_MODELS.md`
2. Follow existing patterns in `cards/` directory
3. Add tests for new models
4. Keep configurators DRY
5. Document special cases in model card comments

---

## 📝 Summary

**Models Directory Overview**:
- 🏗️ **71 models** across 11 providers
- 📁 **Modular architecture** (one model = one file)
- ⚡ **< 2 minutes** to add new models
- ✅ **21 tests** validating all functionality
- 📚 **Complete documentation** for all use cases

**Key Files**:
- `ADDING_NEW_MODELS.md` - Start here for adding models
- `LOCAL_MODELS_QUICK_START.md` - 5-minute local setup
- `cards/` - Browse for examples
- `configurators/` - Factory functions
- `registry/ModularModelRegistry.ts` - Main registry

**Quick Links**:
- [Add a Cloud Model](./ADDING_NEW_MODELS.md#adding-a-model-from-existing-provider)
- [Add a Local Model](./LOCAL_MODELS_QUICK_START.md)
- [Add a New Provider](./ADDING_NEW_MODELS.md#adding-a-model-from-new-provider)
- [Templates](./ADDING_NEW_MODELS.md#templates)
- [Troubleshooting](./ADDING_NEW_MODELS.md#troubleshooting)

---

**Ready to add a model?** Start with [ADDING_NEW_MODELS.md](./ADDING_NEW_MODELS.md)! 🚀
