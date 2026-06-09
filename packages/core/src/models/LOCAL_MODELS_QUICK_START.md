# Local Models - 5 Minute Quick Start

Get local models (LMStudio/Ollama) working with Nexus Cortex in 5 minutes.

---

## ✅ What You Need

**Already Created:**
- ✅ `LocalModelConfigurator.ts` - Configurator for local models
- ✅ `cards/local/llama-3-8b-local.ts` - Example LMStudio model
- ✅ `cards/local/mistral-7b-ollama.ts` - Example Ollama model
- ✅ `cards/local/codellama-13b-local.ts` - Example code model
- ✅ `cards/local/index.ts` - Export file

**You Need to Do:**
1. Install LMStudio or Ollama (2 min)
2. Integrate models into ModularModelRegistry (1 min)
3. Test it (2 min)

---

## Step 1: Install Local Server (2 min)

### Option A: LMStudio (Recommended for Beginners)

```bash
# 1. Download from: https://lmstudio.ai
# 2. Install the app
# 3. Open LMStudio
# 4. Search for "llama-3" in the model browser
# 5. Download "Llama 3 8B" (any quantization level)
# 6. Go to "Local Server" tab
# 7. Load the model
# 8. Click "Start Server"
# ✅ Server running on http://localhost:1234
```

### Option B: Ollama (Command Line)

```bash
# Install
curl -fsSL https://ollama.ai/install.sh | sh

# Pull a model
ollama pull llama3

# Server starts automatically on http://localhost:11434
# ✅ Done!
```

---

## Step 2: Integrate into ModularModelRegistry (1 min)

Edit: `src/models/registry/ModularModelRegistry.ts`

```typescript
// Add import at top
import * as localModels from '../cards/local/index.js';

// In loadModelCards() method, add to allModelCards array:
const allModelCards: ModelConfig[] = [
  // ... existing XAI models
  xaiModels.grok4,
  xaiModels.grok4Fast,
  // ... other existing models

  // Local models (3 models) ⬅️ ADD THIS
  localModels.llama38bLocal,          // LMStudio on port 1234
  localModels.mistral7bOllama,        // Ollama on port 11434
  localModels.codellama13bLocal,      // LMStudio on port 1234
];

// Update debug output to include local models:
if (this.options.debug) {
  console.log(`[ModularModelRegistry] Loaded ${this.models.size} models (100% modular)`);
  console.log(`  - XAI: 6 | DeepSeek: 3 | Anthropic: 7`);
  console.log(`  - Gemma: 4 | Google: 7 | OpenAI: 17`);
  console.log(`  - Local: 3`);  // ⬅️ ADD THIS
}
```

**That's it!** Now you have 47 models (44 cloud + 3 local).

---

## Step 3: Test It (2 min)

```bash
# Rebuild
npm run build

# Test the registry
npm test -- src/models/registry/__tests__/modular-registry-validation.test.ts
```

Or test programmatically:

```typescript
import { ModularModelRegistry } from './models/registry/ModularModelRegistry.js';

const registry = new ModularModelRegistry({ debug: true });

// Check local models exist
console.log(registry.hasModel('llama-3-8b-local'));        // true
console.log(registry.hasModel('mistral-7b-ollama'));       // true
console.log(registry.hasModel('codellama-13b-local'));     // true

// Get local models
const localModels = registry.getModelsByProvider('local');
console.log(`Found ${localModels.length} local models`);   // 3

// Use a local model
const llama = registry.getModel('llama-3-8b-local');
console.log(llama.displayName);                            // "Llama 3 8B (Local)"
console.log(llama.api.endpoint);                           // "http://localhost:1234/v1/chat/completions"
console.log(llama.cost.inputPerMillion);                   // 0.0 (FREE!)
```

---

## Usage Example

```typescript
import { CortexOrchestrator } from './orchestrator/CortexOrchestrator.js';

// Use local model (FREE, private, offline)
const orchestrator = new CortexOrchestrator({
  modelId: 'llama-3-8b-local',  // Your local model!
  messages: [
    { role: 'user', content: 'Write a hello world function in Python' }
  ]
});

const response = await orchestrator.execute();
console.log(response);
```

---

## Quick Reference

### Model IDs
| ID                      | Tool      | Port  | Endpoint                          |
|-------------------------|-----------|-------|-----------------------------------|
| `llama-3-8b-local`      | LMStudio  | 1234  | http://localhost:1234/v1          |
| `mistral-7b-ollama`     | Ollama    | 11434 | http://localhost:11434/v1         |
| `codellama-13b-local`   | LMStudio  | 1234  | http://localhost:1234/v1          |

### Common Commands

```bash
# LMStudio: Check if running
curl http://localhost:1234/v1/models

# Ollama: Check if running
curl http://localhost:11434/api/tags

# Ollama: Pull a model
ollama pull llama3
ollama pull mistral
ollama pull codellama

# Ollama: List models
ollama list
```

---

## Add Your Own Model (< 2 min)

Let's say you want to add **Mistral 7B** via LMStudio on a custom port:

1. **Create model card:**
```typescript
// src/models/cards/local/mistral-7b-lmstudio.ts
import { createLocalModelConfig } from '../../configurators/LocalModelConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const mistral7bLMStudio: ModelConfig = createLocalModelConfig({
  id: 'mistral-7b-lmstudio',
  displayName: 'Mistral 7B (LMStudio)',
  family: 'mistral',
  contextWindow: 8192,
  outputTokens: 4096,
  endpoint: 'http://localhost:1234/v1/chat/completions',  // Your port here
  apiKeyEnvVar: 'LOCAL_MODEL_API_KEY',
  supportsTools: false
});
```

2. **Export in index.ts:**
```typescript
// src/models/cards/local/index.ts
export { mistral7bLMStudio } from './mistral-7b-lmstudio.js';
```

3. **Add to ModularModelRegistry.ts:**
```typescript
localModels.mistral7bLMStudio,
```

4. **Build and test:**
```bash
npm run build
```

**Done in < 2 minutes!** ⚡

---

## Troubleshooting

### Issue: "Model not found: llama-3-8b-local"
**Fix**: Add local models to ModularModelRegistry (Step 2 above)

### Issue: "ECONNREFUSED 127.0.0.1:1234"
**Fix**: Make sure LMStudio/Ollama server is running
```bash
# LMStudio: Check UI shows "Server Running"
# Ollama: curl http://localhost:11434/api/tags
```

### Issue: Port conflict
**Fix**: Change port in model card endpoint:
```typescript
endpoint: 'http://localhost:YOUR_PORT/v1/chat/completions'
```

### Issue: Different endpoint structure
**Fix**: Some servers use `/api/chat` instead of `/v1/chat/completions`. Update endpoint in model card.

---

## Next Steps

✅ **Working?** Great! Try using it in your Cortex workflows

Want more models? Check the comprehensive guide:
- 📖 `LOCAL_MODELS_SETUP_GUIDE.md` - Full documentation
- 🔧 `src/models/configurators/LocalModelConfigurator.ts` - Configurator code
- 📁 `src/models/cards/local/` - Model card examples

---

## Benefits

✅ **FREE** - Zero API costs
✅ **Private** - Data never leaves your machine
✅ **Offline** - No internet required
✅ **Fast** - No network latency (for small prompts)
✅ **Control** - Full control over model versions

**Note**: Local models are generally lower quality than GPT-4/Claude, but great for:
- Privacy-sensitive tasks
- Offline development
- Cost-conscious workflows
- Learning and experimentation

---

**That's it!** You now have local models integrated with Nexus Cortex's modular architecture. 🚀
