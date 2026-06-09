## New Providers Setup Guide

Complete guide for Hugging Face, OpenRouter, Moonshot, GLM (Zhipu AI), and Qwen (Alibaba Cloud).

---

## 📚 Providers Overview

| Provider | Models | Cost | Best For | API Docs |
|----------|--------|------|----------|----------|
| **Hugging Face** | 2 | FREE (rate-limited) | Open-source models, testing | [docs](https://huggingface.co/docs/api-inference) |
| **OpenRouter** | 2 | Pay-per-use | Unified API access | [docs](https://openrouter.ai/docs) |
| **Moonshot** (Kimi) | 3 | $0.84-$4.20/M | Chinese language | [docs](https://platform.moonshot.cn/docs) |
| **GLM** (Zhipu) | 2 | FREE-$7.00/M | Chinese + Vision | [docs](https://open.bigmodel.cn/dev/api) |
| **Qwen** (Alibaba) | 3 | $0.28-$2.80/M | Chinese language | [docs](https://help.aliyun.com/zh/dashscope/) |

---

## 🚀 Quick Start

### 1. Hugging Face

**Setup (2 minutes)**:
```bash
# 1. Get API token from: https://huggingface.co/settings/tokens
# 2. Set environment variable
export HUGGINGFACE_API_KEY="hf_..."

# 3. Use the model
modelId: 'llama-3-8b-instruct-hf'
```

**Available Models**:
- `llama-3-8b-instruct-hf` - Meta Llama 3 8B (FREE)
- `mistral-7b-instruct-hf` - Mistral 7B (FREE)

**Notes**:
- ✅ FREE (serverless API, rate-limited)
- ⏱️ First request may take 20-30 seconds (cold start)
- 📊 Good for testing, not production
- 🚀 For production, use dedicated endpoints

### 2. OpenRouter

**Setup (2 minutes)**:
```bash
# 1. Sign up at: https://openrouter.ai
# 2. Get API key from: https://openrouter.ai/keys
# 3. Set environment variable
export OPENROUTER_API_KEY="sk-or-..."

# 4. Use any model
modelId: 'claude-3-5-sonnet-openrouter'
```

**Available Models**:
- `claude-3-5-sonnet-openrouter` - Claude 3.5 Sonnet
- `gpt-4o-openrouter` - GPT-4o

**Benefits**:
- ✅ Single API key for all models
- ✅ Automatic fallbacks
- ✅ Unified billing
- ✅ No provider lock-in

### 3. Moonshot (Kimi)

**Setup (2 minutes)**:
```bash
# 1. Sign up at: https://platform.moonshot.cn
# 2. Get API key from dashboard
# 3. Set environment variable
export MOONSHOT_API_KEY="sk-..."

# 4. Use the model
modelId: 'moonshot-v1-8k'
```

**Available Models**:
- `moonshot-v1-8k` - Kimi Chat (8K context) - $0.84/M tokens
- `moonshot-v1-32k` - Kimi Chat (32K context) - $1.68/M tokens
- `moonshot-v1-128k` - Kimi Chat (128K context) - $4.20/M tokens

**Best For**:
- 🇨🇳 Chinese language tasks
- 📄 Long document processing
- 💰 Cost-effective alternative to GPT-4

### 4. GLM (Zhipu AI)

**Setup (2 minutes)**:
```bash
# 1. Sign up at: https://open.bigmodel.cn
# 2. Get API key from dashboard
# 3. Set environment variable
export ZHIPU_API_KEY="..."

# 4. Use the model
modelId: 'glm-4'
```

**Available Models**:
- `glm-4` - GLM-4 flagship (128K, vision) - $7.00/M tokens
- `glm-4-flash` - GLM-4 Flash (128K, fast) - FREE

**Features**:
- ✅ Vision support (images)
- ✅ 128K context window
- ✅ Strong Chinese language
- ✅ GLM-4 Flash is FREE

### 5. Qwen (Alibaba Cloud)

**Setup (2 minutes)**:
```bash
# 1. Sign up at: https://dashscope.console.aliyun.com
# 2. Get API key from dashboard
# 3. Set environment variable
export DASHSCOPE_API_KEY="sk-..."

# 4. Use the model
modelId: 'qwen-turbo'
```

**Available Models**:
- `qwen-turbo` - Fast & cheap - $0.28/M tokens
- `qwen-plus` - Balanced - $0.56/M tokens
- `qwen-max` - Flagship - $2.80/M tokens

**Best For**:
- 🇨🇳 Chinese language
- 💰 Very cost-effective ($0.28/M!)
- 🚀 Fast responses

---

## 🔧 Integration into ModularModelRegistry

To use these providers, add them to `ModularModelRegistry.ts`:

```typescript
// 1. Add imports at top
import * as huggingfaceModels from '../cards/huggingface/index.js';
import * as openrouterModels from '../cards/openrouter/index.js';
import * as moonshotModels from '../cards/moonshot/index.js';
import * as glmModels from '../cards/glm/index.js';
import * as qwenModels from '../cards/qwen/index.js';

// 2. Add to allModelCards array
const allModelCards: ModelConfig[] = [
  // ... existing models

  // Hugging Face models (2 models - FREE)
  huggingfaceModels.llama38bInstructHF,
  huggingfaceModels.mistral7bInstructHF,

  // OpenRouter models (2 models)
  openrouterModels.claude35SonnetOR,
  openrouterModels.gpt4oOR,

  // Moonshot models (3 models)
  moonshotModels.kimiChat,
  moonshotModels.kimiChat32k,
  moonshotModels.kimiChat128k,

  // GLM models (2 models)
  glmModels.glm4,
  glmModels.glm4Flash,

  // Qwen models (3 models)
  qwenModels.qwenTurbo,
  qwenModels.qwenPlus,
  qwenModels.qwenMax,
];

// 3. Update debug output
if (this.options.debug) {
  console.log(`[ModularModelRegistry] Loaded ${this.models.size} models (100% modular)`);
  console.log(`  - XAI: 6 | DeepSeek: 3 | Anthropic: 7`);
  console.log(`  - Gemma: 4 | Google: 7 | OpenAI: 17`);
  console.log(`  - Local: 3 | HuggingFace: 2 | OpenRouter: 2`);
  console.log(`  - Moonshot: 3 | GLM: 2 | Qwen: 3`);
}

// 4. Update header comment to reflect new total
// Total: 59 models across 12 providers
```

**New Totals**:
- Before: 47 models, 7 providers
- After: 59 models, 12 providers

---

## 📊 Cost Comparison

### Chinese Language Models

| Model | Input Cost | Output Cost | Context | Notes |
|-------|------------|-------------|---------|-------|
| Qwen Turbo | $0.28/M | $0.28/M | 8K | Cheapest! |
| Qwen Plus | $0.56/M | $0.56/M | 32K | Balanced |
| Moonshot 8K | $0.84/M | $0.84/M | 8K | Good value |
| Moonshot 32K | $1.68/M | $1.68/M | 32K | Long context |
| Qwen Max | $2.80/M | $2.80/M | 8K | Highest quality |
| Moonshot 128K | $4.20/M | $4.20/M | 128K | Very long |
| GLM-4 | $7.00/M | $7.00/M | 128K | Vision support |
| GLM-4 Flash | **FREE** | **FREE** | 128K | Best deal! |

### Western Models (via OpenRouter)

| Model | Input Cost | Output Cost | Notes |
|-------|------------|-------------|-------|
| GPT-4o | $2.50/M | $10.00/M | Unified API |
| Claude 3.5 Sonnet | $3.00/M | $15.00/M | Unified API |

### Open Source (via Hugging Face)

| Model | Cost | Notes |
|-------|------|-------|
| Llama 3 8B | **FREE** | Rate-limited, cold starts |
| Mistral 7B | **FREE** | Rate-limited, cold starts |

---

## 🌍 Use Cases

### For Chinese Language
**Best Choice**: Qwen Turbo ($0.28/M) or GLM-4 Flash (FREE)

```typescript
// Most cost-effective
modelId: 'qwen-turbo'

// FREE with vision support
modelId: 'glm-4-flash'

// Long context (128K)
modelId: 'moonshot-v1-128k'
```

### For Unified API Access
**Best Choice**: OpenRouter

```typescript
// Access Claude without Anthropic API key
modelId: 'claude-3-5-sonnet-openrouter'

// Access GPT-4o without OpenAI API key
modelId: 'gpt-4o-openrouter'
```

### For Testing/Prototyping
**Best Choice**: Hugging Face (FREE)

```typescript
// Free Llama 3
modelId: 'llama-3-8b-instruct-hf'

// Free Mistral
modelId: 'mistral-7b-instruct-hf'
```

---

## 🔐 API Keys Setup

### Environment Variables

Add to your `.env` file:

```bash
# Hugging Face
HUGGINGFACE_API_KEY="hf_..."

# OpenRouter
OPENROUTER_API_KEY="sk-or-..."

# Moonshot (Kimi)
MOONSHOT_API_KEY="sk-..."

# GLM (Zhipu AI)
ZHIPU_API_KEY="..."

# Qwen (Alibaba Cloud)
DASHSCOPE_API_KEY="sk-..."
```

### Getting API Keys

1. **Hugging Face**: https://huggingface.co/settings/tokens
   - Free account, no credit card required
   - Create "Read" token

2. **OpenRouter**: https://openrouter.ai/keys
   - Sign up, add credits
   - Pay-as-you-go pricing

3. **Moonshot**: https://platform.moonshot.cn
   - Chinese platform, may need VPN
   - Supports international credit cards

4. **GLM**: https://open.bigmodel.cn
   - Chinese platform
   - GLM-4 Flash is FREE

5. **Qwen**: https://dashscope.console.aliyun.com
   - Alibaba Cloud account required
   - International credit cards accepted

---

## ⚡ Quick Examples

### Example 1: Cost-Effective Chinese Chat

```typescript
import { ModularModelRegistry } from './models/registry/ModularModelRegistry.js';
import { CortexOrchestrator } from './orchestrator/CortexOrchestrator.js';

const registry = new ModularModelRegistry();

// Use cheapest Chinese model
const orchestrator = new CortexOrchestrator({
  modelId: 'qwen-turbo',  // Only $0.28 per million tokens!
  messages: [
    { role: 'user', content: '你好，请介绍一下你自己' }
  ]
});

const response = await orchestrator.execute();
console.log(response);
```

### Example 2: Unified API with OpenRouter

```typescript
// Access Claude without Anthropic API key
const orchestrator = new CortexOrchestrator({
  modelId: 'claude-3-5-sonnet-openrouter',
  messages: [
    { role: 'user', content: 'Write a Python function' }
  ]
});

const response = await orchestrator.execute();
```

### Example 3: FREE Testing with Hugging Face

```typescript
// Test with FREE Llama 3
const orchestrator = new CortexOrchestrator({
  modelId: 'llama-3-8b-instruct-hf',
  messages: [
    { role: 'user', content: 'Hello!' }
  ]
});

// Note: First request may take 20-30 seconds (cold start)
const response = await orchestrator.execute();
```

---

## 🐛 Troubleshooting

### Hugging Face

**Issue**: "Model is loading" or slow responses
**Solution**: Serverless API has cold starts (20-30s). Wait for model to load. For production, use dedicated endpoints.

**Issue**: Rate limit errors
**Solution**: Free tier is rate-limited. Upgrade to Pro or use dedicated endpoints.

### OpenRouter

**Issue**: "Insufficient credits"
**Solution**: Add credits at https://openrouter.ai/credits

**Issue**: Model not available
**Solution**: Check model availability at https://openrouter.ai/models

### Moonshot/GLM/Qwen

**Issue**: API key not working
**Solution**: Ensure you're using the correct environment variable:
- Moonshot: `MOONSHOT_API_KEY`
- GLM: `ZHIPU_API_KEY`
- Qwen: `DASHSCOPE_API_KEY`

**Issue**: Chinese characters garbled
**Solution**: Ensure UTF-8 encoding in your requests/responses.

---

## 📖 Adding More Models

Each provider supports many more models. To add them:

1. **Check provider's model list**:
   - Hugging Face: https://huggingface.co/models
   - OpenRouter: https://openrouter.ai/models
   - Moonshot: https://platform.moonshot.cn/docs
   - GLM: https://open.bigmodel.cn/dev/api
   - Qwen: https://help.aliyun.com/zh/dashscope/

2. **Create model card** using templates in `MODEL_CARD_TEMPLATE.md`

3. **Export in provider's index.ts**

4. **Import in ModularModelRegistry.ts**

**Time**: < 2 minutes per model! ⚡

---

## 🎯 Best Practices

### 1. Cost Optimization

For Chinese language:
```typescript
// Development: Use FREE model
modelId: 'glm-4-flash'  // FREE

// Production: Use cost-effective model
modelId: 'qwen-turbo'   // $0.28/M tokens
```

### 2. API Key Management

```typescript
// Check if API key is set before using
const hasKey = process.env.HUGGINGFACE_API_KEY;
if (!hasKey) {
  console.warn('HUGGINGFACE_API_KEY not set');
}
```

### 3. Fallback Strategy

```typescript
// Try Hugging Face first (FREE), fallback to paid
let modelId = 'llama-3-8b-instruct-hf';

if (needHighQuality) {
  modelId = 'gpt-4o-openrouter';
}
```

---

## 📚 Additional Resources

### Documentation
- **Hugging Face**: https://huggingface.co/docs/api-inference
- **OpenRouter**: https://openrouter.ai/docs
- **Moonshot**: https://platform.moonshot.cn/docs
- **GLM**: https://open.bigmodel.cn/dev/api
- **Qwen**: https://help.aliyun.com/zh/dashscope/

### Model Cards
- All in `src/models/cards/[provider]/`
- Templates in `MODEL_CARD_TEMPLATE.md`

### Support
- Main guide: `ADDING_NEW_MODELS.md`
- Templates: `MODEL_CARD_TEMPLATE.md`
- Architecture: `README.md`

---

## ✅ Summary

**5 New Providers Added**:
- ✅ Hugging Face (2 FREE models)
- ✅ OpenRouter (2 models, unified API)
- ✅ Moonshot (3 Chinese models)
- ✅ GLM/Zhipu (2 Chinese models, 1 FREE)
- ✅ Qwen/Alibaba (3 Chinese models, very cheap)

**Total Models**: 59 across 12 providers

**Cost Range**: FREE to $7.00 per million tokens

**Setup Time**: 2 minutes per provider

**Ready to use!** Just set the API keys and integrate into ModularModelRegistry! 🚀
