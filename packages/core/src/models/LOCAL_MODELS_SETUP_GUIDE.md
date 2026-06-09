# Local Models Setup Guide

Complete guide for using local models (LMStudio, Ollama, LocalAI) with Nexus Cortex.

---

## Quick Start

### 1. Install Local Model Server

Choose one:

**LMStudio** (Recommended for beginners)
```bash
# Download from: https://lmstudio.ai
# GUI-based, easy to use
# Default port: 1234
```

**Ollama** (Recommended for command line)
```bash
# macOS/Linux
curl -fsSL https://ollama.ai/install.sh | sh

# Pull a model
ollama pull llama3
ollama pull mistral

# Server runs automatically on port 11434
```

**LocalAI** (Advanced, Docker-based)
```bash
docker run -p 8080:8080 --name local-ai -ti localai/localai:latest
```

### 2. Start the Server

**LMStudio:**
1. Open LMStudio
2. Click "Local Server" tab
3. Load a model (e.g., Llama 3 8B)
4. Click "Start Server"
5. Server runs on http://localhost:1234

**Ollama:**
```bash
# Server starts automatically
# Test it:
curl http://localhost:11434/api/tags
```

### 3. Add Model Cards to Registry

Edit `ModularModelRegistry.ts`:

```typescript
// Import local models
import * as localModels from '../cards/local/index.js';

// Add to loadModelCards():
const allModelCards: ModelConfig[] = [
  // ... existing models

  // Local models (3 models)
  localModels.llama38bLocal,
  localModels.mistral7bOllama,
  localModels.codellama13bLocal,
];
```

### 4. (Optional) Set API Key

Most local servers don't require authentication, but you may need to set a dummy value:

```bash
# .env file
LOCAL_MODEL_API_KEY="dummy"
OLLAMA_API_KEY="dummy"
```

### 5. Use the Model

```typescript
import { ModularModelRegistry } from './models/registry/ModularModelRegistry.js';

const registry = new ModularModelRegistry();

// Get local model
const model = registry.getModel('llama-3-8b-local');

// Use with your orchestrator
const orchestrator = new CortexOrchestrator({
  modelId: 'llama-3-8b-local',
  // ... other config
});
```

---

## Creating Custom Local Model Cards

### Example: Adding Your Own Model

1. **Create the model card file:**

```typescript
// src/models/cards/local/my-custom-model.ts
import { createLocalModelConfig } from '../../configurators/LocalModelConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const myCustomModel: ModelConfig = createLocalModelConfig({
  id: 'my-custom-model',
  displayName: 'My Custom Model',
  family: 'custom',
  contextWindow: 4096,
  outputTokens: 2048,
  endpoint: 'http://localhost:1234/v1/chat/completions',  // Your endpoint
  apiKeyEnvVar: 'MY_MODEL_API_KEY',
  supportsTools: false  // Set true if your model supports function calling
});
```

2. **Export in index.ts:**

```typescript
// src/models/cards/local/index.ts
export { myCustomModel } from './my-custom-model.js';
```

3. **Add to ModularModelRegistry:**

```typescript
// src/models/registry/ModularModelRegistry.ts
localModels.myCustomModel,
```

**Time to add: < 2 minutes!** ⚡

---

## Configuration Options

### LocalModelConfigurator Options

```typescript
interface LocalModelOptions {
  id: string;                    // Model ID (e.g., 'llama-3-8b-local')
  displayName: string;           // Human-readable name
  family: string;                // Model family (e.g., 'llama-3')
  contextWindow: number;         // Context window size
  outputTokens: number;          // Max output tokens
  endpoint?: string;             // Custom endpoint URL
  apiKeyEnvVar?: string;         // API key env var name
  supportsTools?: boolean;       // Function calling support
  provider?: string;             // Provider name (default: 'local')
}
```

### Default Values

```typescript
{
  endpoint: 'http://localhost:1234/v1/chat/completions',
  apiKeyEnvVar: 'LOCAL_MODEL_API_KEY',
  supportsTools: true,
  provider: 'local'
}
```

---

## Common Endpoints

| Tool      | Default Endpoint                                  | Port  |
|-----------|---------------------------------------------------|-------|
| LMStudio  | http://localhost:1234/v1/chat/completions        | 1234  |
| Ollama    | http://localhost:11434/v1/chat/completions       | 11434 |
| LocalAI   | http://localhost:8080/v1/chat/completions        | 8080  |
| Custom    | http://localhost:PORT/v1/chat/completions        | Any   |

---

## Model Examples

### LMStudio Models

```typescript
// Llama 3 8B
createLocalModelConfig({
  id: 'llama-3-8b-local',
  displayName: 'Llama 3 8B (Local)',
  family: 'llama-3',
  contextWindow: 8192,
  outputTokens: 4096,
  endpoint: 'http://localhost:1234/v1/chat/completions'
});

// Llama 3 70B (if you have the resources!)
createLocalModelConfig({
  id: 'llama-3-70b-local',
  displayName: 'Llama 3 70B (Local)',
  family: 'llama-3',
  contextWindow: 8192,
  outputTokens: 4096,
  endpoint: 'http://localhost:1234/v1/chat/completions'
});
```

### Ollama Models

```typescript
// Mistral 7B
createLocalModelConfig({
  id: 'mistral-7b-ollama',
  displayName: 'Mistral 7B (Ollama)',
  family: 'mistral',
  contextWindow: 8192,
  outputTokens: 4096,
  endpoint: 'http://localhost:11434/v1/chat/completions'
});

// Mixtral 8x7B
createLocalModelConfig({
  id: 'mixtral-8x7b-ollama',
  displayName: 'Mixtral 8x7B (Ollama)',
  family: 'mixtral',
  contextWindow: 32768,
  outputTokens: 4096,
  endpoint: 'http://localhost:11434/v1/chat/completions'
});
```

### Code-Specialized Models

```typescript
// CodeLlama 13B
createLocalModelConfig({
  id: 'codellama-13b-local',
  displayName: 'CodeLlama 13B (Local)',
  family: 'codellama',
  contextWindow: 16384,
  outputTokens: 4096,
  supportsTools: false
});

// DeepSeek Coder (local)
createLocalModelConfig({
  id: 'deepseek-coder-local',
  displayName: 'DeepSeek Coder (Local)',
  family: 'deepseek-coder',
  contextWindow: 16384,
  outputTokens: 4096,
  supportsTools: false
});
```

---

## Troubleshooting

### Connection Issues

**Problem**: Cannot connect to local model
```
Error: connect ECONNREFUSED 127.0.0.1:1234
```

**Solutions**:
1. Verify server is running:
   ```bash
   # LMStudio: Check UI shows "Server Running"
   # Ollama: curl http://localhost:11434/api/tags
   ```

2. Check port number matches endpoint in model card

3. Verify firewall allows localhost connections

### Authentication Issues

**Problem**: 401 Unauthorized or API key errors

**Solutions**:
1. Set dummy API key:
   ```bash
   export LOCAL_MODEL_API_KEY="dummy"
   ```

2. Or modify the model card to not require auth:
   ```typescript
   apiKeyEnvVar: 'LOCAL_MODEL_API_KEY'  // Will be checked but not validated
   ```

### Tool/Function Calling Issues

**Problem**: Model doesn't support function calling

**Solutions**:
1. Set `supportsTools: false` in model card:
   ```typescript
   createLocalModelConfig({
     // ...
     supportsTools: false  // Disable function calling
   });
   ```

2. Most local models don't support OpenAI-style function calling yet

### Model Not Found

**Problem**: `Model not found: llama-3-8b-local`

**Solutions**:
1. Verify model card is imported in `ModularModelRegistry.ts`
2. Check model ID matches exactly
3. Rebuild: `npm run build`

---

## Performance Tips

### 1. Choose Right Model Size

| Model Size | RAM Needed | Speed    | Quality  |
|------------|------------|----------|----------|
| 7B         | 8-12 GB    | Fast ⚡   | Good     |
| 13B        | 16-20 GB   | Medium   | Better   |
| 34B        | 32-40 GB   | Slow     | Great    |
| 70B        | 80+ GB     | Very Slow| Best     |

### 2. Use Quantized Models

LMStudio/Ollama support quantized models (Q4, Q5, Q8) that use less RAM:
- Q4: 4-bit quantization (smallest, fastest)
- Q5: 5-bit quantization (balanced)
- Q8: 8-bit quantization (larger, higher quality)

### 3. GPU Acceleration

**NVIDIA GPUs**:
- LMStudio: Automatically uses GPU
- Ollama: Uses GPU by default if CUDA available

**Apple Silicon (M1/M2/M3)**:
- Both LMStudio and Ollama use Metal acceleration

### 4. Context Window Management

Local models are slower with large contexts:
- Use smaller context windows (4K-8K)
- Enable aggressive compaction
- Use `preserveRecent: 5` in compaction config

---

## Advanced: Multiple Endpoints

You can run multiple local models simultaneously:

```typescript
// Port 1234: Llama 3 8B (general tasks)
createLocalModelConfig({
  id: 'llama-3-8b-general',
  displayName: 'Llama 3 8B (General)',
  family: 'llama-3',
  contextWindow: 8192,
  outputTokens: 4096,
  endpoint: 'http://localhost:1234/v1/chat/completions'
});

// Port 1235: CodeLlama 13B (code tasks)
createLocalModelConfig({
  id: 'codellama-13b-code',
  displayName: 'CodeLlama 13B (Code)',
  family: 'codellama',
  contextWindow: 16384,
  outputTokens: 4096,
  endpoint: 'http://localhost:1235/v1/chat/completions'
});
```

Start multiple LMStudio instances or use Ollama's multi-model support.

---

## Benefits of Local Models

✅ **Privacy**: All data stays on your machine
✅ **Cost**: Zero API costs (FREE!)
✅ **Latency**: No network round-trip (faster for small prompts)
✅ **Offline**: Works without internet
✅ **Control**: Full control over model versions

**Tradeoffs**:
⚠️ **Quality**: Generally lower quality than GPT-4/Claude
⚠️ **Speed**: Slower for large contexts (unless you have powerful GPU)
⚠️ **Resources**: Requires significant RAM/VRAM
⚠️ **Tools**: Most don't support function calling

---

## Example Use Cases

### 1. Privacy-Sensitive Development
```typescript
// Use local model for sensitive code review
const orchestrator = new CortexOrchestrator({
  modelId: 'llama-3-8b-local',  // Private, stays on your machine
  // ... config
});
```

### 2. Offline Development
```typescript
// Work on plane/train without internet
const orchestrator = new CortexOrchestrator({
  modelId: 'codellama-13b-local',  // Works offline
  // ... config
});
```

### 3. Cost Optimization
```typescript
// Use local model for cheap tasks, cloud for complex ones
const cheapModel = 'llama-3-8b-local';    // FREE
const smartModel = 'gpt-4o';               // $2.50/$10.00

if (task.isSimple) {
  modelId = cheapModel;
} else {
  modelId = smartModel;
}
```

---

## Next Steps

1. ✅ Install LMStudio or Ollama
2. ✅ Download a model
3. ✅ Start local server
4. ✅ Add model cards to registry
5. ✅ Test with a simple query
6. 🚀 Use in your Cortex workflows!

**Questions?** Check the troubleshooting section or create an issue.

---

## Resources

- **LMStudio**: https://lmstudio.ai
- **Ollama**: https://ollama.ai
- **LocalAI**: https://localai.io
- **Model Cards**: `/home/runner/workspace/nexus-cortex/packages/core/src/models/cards/local/`
- **Configurator**: `/home/runner/workspace/nexus-cortex/packages/core/src/models/configurators/LocalModelConfigurator.ts`
