# CreateAddonToolEnhanced - Real-World Examples

## 🎯 TradeStation Proxy with Real-Time Display

**User Request**: "Generate a proxy server that wraps a TradeStation instance and grabs the traffic feed inbound and outbound. Generate a dynamic display that I can see and interact with immediately."

### Implementation

```typescript
const result = await createAddonTool.execute({
  name: 'tradestation-proxy',
  description: 'Proxy server for TradeStation with real-time traffic monitoring',

  mode: 'dev',  // Hot reload for iterative development

  implementation: {
    language: 'javascript',
    packageManager: 'uv',  // Fast dependency installation
    dependencies: [
      'express',
      'http-proxy-middleware',
      'socket.io',
      'ws'
    ],
    code: `
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { Server } = require('socket.io');
const http = require('http');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Traffic log storage
const trafficLog = {
  inbound: [],
  outbound: []
};

// TradeStation API proxy
app.use('/api', createProxyMiddleware({
  target: 'https://api.tradestation.com',
  changeOrigin: true,
  onProxyReq: (proxyReq, req, res) => {
    // Capture outbound requests
    const request = {
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body
    };

    trafficLog.outbound.push(request);

    // Broadcast to all connected clients
    io.emit('traffic', {
      direction: 'outbound',
      data: request
    });

    console.log('📤 Outbound:', req.method, req.url);
  },
  onProxyRes: (proxyRes, req, res) => {
    // Capture inbound responses
    let body = '';
    proxyRes.on('data', (chunk) => {
      body += chunk;
    });

    proxyRes.on('end', () => {
      const response = {
        timestamp: new Date().toISOString(),
        statusCode: proxyRes.statusCode,
        headers: proxyRes.headers,
        body: body
      };

      trafficLog.inbound.push(response);

      // Broadcast to clients
      io.emit('traffic', {
        direction: 'inbound',
        data: response
      });

      console.log('📥 Inbound:', proxyRes.statusCode);
    });
  }
}));

// Real-time dashboard
app.get('/', (req, res) => {
  res.send(\`
<!DOCTYPE html>
<html>
<head>
  <title>TradeStation Traffic Monitor</title>
  <script src="/socket.io/socket.io.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0e27;
      color: #fff;
      padding: 20px;
    }
    h1 {
      text-align: center;
      margin-bottom: 30px;
      background: linear-gradient(90deg, #00d9ff, #00ff88);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .container {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      max-width: 1400px;
      margin: 0 auto;
    }
    .panel {
      background: #1a1f3a;
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    }
    .panel h2 {
      margin-bottom: 15px;
      font-size: 18px;
      opacity: 0.8;
    }
    .traffic-list {
      max-height: 600px;
      overflow-y: auto;
    }
    .traffic-item {
      background: #252b47;
      padding: 12px;
      margin-bottom: 10px;
      border-radius: 8px;
      border-left: 3px solid;
      animation: slideIn 0.3s ease;
    }
    .outbound { border-left-color: #ff6b6b; }
    .inbound { border-left-color: #51cf66; }
    .timestamp {
      font-size: 12px;
      opacity: 0.6;
      margin-bottom: 5px;
    }
    .method {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: bold;
      margin-right: 8px;
    }
    .GET { background: #51cf66; color: #000; }
    .POST { background: #ffd43b; color: #000; }
    .PUT { background: #74c0fc; color: #000; }
    .DELETE { background: #ff6b6b; color: #fff; }
    .url {
      font-family: 'Monaco', monospace;
      font-size: 13px;
      word-break: break-all;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 15px;
      margin-bottom: 20px;
    }
    .stat-card {
      background: #252b47;
      padding: 15px;
      border-radius: 8px;
      text-align: center;
    }
    .stat-value {
      font-size: 32px;
      font-weight: bold;
      margin-top: 5px;
    }
    .stat-label {
      font-size: 12px;
      opacity: 0.6;
      text-transform: uppercase;
    }
    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    ::-webkit-scrollbar {
      width: 8px;
    }
    ::-webkit-scrollbar-track {
      background: #1a1f3a;
    }
    ::-webkit-scrollbar-thumb {
      background: #444;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <h1>🔌 TradeStation Traffic Monitor</h1>

  <div class="stats">
    <div class="stat-card">
      <div class="stat-label">Total Requests</div>
      <div class="stat-value" id="total">0</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Outbound</div>
      <div class="stat-value" id="outbound">0</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Inbound</div>
      <div class="stat-value" id="inbound">0</div>
    </div>
  </div>

  <div class="container">
    <div class="panel">
      <h2>📤 Outbound Requests</h2>
      <div class="traffic-list" id="outbound-list"></div>
    </div>

    <div class="panel">
      <h2>📥 Inbound Responses</h2>
      <div class="traffic-list" id="inbound-list"></div>
    </div>
  </div>

  <script>
    const socket = io();

    let stats = { total: 0, outbound: 0, inbound: 0 };

    socket.on('traffic', (event) => {
      const { direction, data } = event;

      stats.total++;
      stats[direction]++;

      document.getElementById('total').textContent = stats.total;
      document.getElementById('outbound').textContent = stats.outbound;
      document.getElementById('inbound').textContent = stats.inbound;

      const listId = direction + '-list';
      const list = document.getElementById(listId);

      const item = document.createElement('div');
      item.className = \`traffic-item \${direction}\`;

      if (direction === 'outbound') {
        item.innerHTML = \`
          <div class="timestamp">\${data.timestamp}</div>
          <div>
            <span class="method \${data.method}">\${data.method}</span>
            <span class="url">\${data.url}</span>
          </div>
        \`;
      } else {
        item.innerHTML = \`
          <div class="timestamp">\${data.timestamp}</div>
          <div>
            Status: <strong>\${data.statusCode}</strong>
          </div>
        \`;
      }

      list.insertBefore(item, list.firstChild);

      // Keep only last 50 items
      while (list.children.length > 50) {
        list.removeChild(list.lastChild);
      }
    });
  </script>
</body>
</html>
  \`);
});

// WebSocket connection handler
io.on('connection', (socket) => {
  console.log('👤 Client connected');

  // Send existing traffic log to new clients
  trafficLog.outbound.forEach(req => {
    socket.emit('traffic', { direction: 'outbound', data: req });
  });

  trafficLog.inbound.forEach(res => {
    socket.emit('traffic', { direction: 'inbound', data: res });
  });

  socket.on('disconnect', () => {
    console.log('👤 Client disconnected');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(\`\n🚀 TradeStation Proxy running at http://localhost:\${PORT}\`);
  console.log(\`\n📊 Dashboard: http://localhost:\${PORT}\`);
  console.log(\`\n🔌 Proxy endpoint: http://localhost:\${PORT}/api\n\`);
});
`
  },

  devConfig: {
    hotReload: true,           // Auto-reload on code changes
    openBrowser: true,         // Opens browser immediately at localhost:3000
    liveBridge: true           // WebSocket for real-time updates
  },

  uiConfig: {
    type: 'web',
    framework: 'express',
    autoStart: true
  },

  sandboxConfig: {
    type: 'local',
    ports: [3000],
    env: {
      NODE_ENV: 'development'
    }
  }
});

// Output:
// 🚀 tradestation-proxy - DEV MODE
// Status: Running
// URL: http://localhost:3000
// Port: 3000
//
// Dev Mode Features:
// ✅ Hot reload enabled
// ✅ Browser auto-opened
// ✅ Live WebSocket updates
//
// Access:
// Open your browser at: http://localhost:3000
// Edit files in the sandbox to see live updates!
```

---

## 🎨 Real-Time HTML Landing Page Generator

**User Request**: "Create an HTML landing page for a product with live preview"

```typescript
const result = await createAddonTool.execute({
  name: 'landing-page-generator',
  description: 'Interactive landing page builder with live preview',

  mode: 'dev',

  implementation: {
    language: 'javascript',
    packageManager: 'npm',
    dependencies: ['express', 'socket.io', 'chokidar'],
    code: `
const express = require('express');
const { Server } = require('socket.io');
const http = require('http');
const chokidar = require('chokidar');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

// Serve editor interface
app.get('/', (req, res) => {
  res.send(\`
<!DOCTYPE html>
<html>
<head>
  <title>Landing Page Builder</title>
  <script src="/socket.io/socket.io.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      display: grid;
      grid-template-columns: 1fr 1fr;
      height: 100vh;
      font-family: system-ui, sans-serif;
    }
    .editor-pane {
      background: #1e1e1e;
      color: #d4d4d4;
      display: flex;
      flex-direction: column;
    }
    .preview-pane {
      background: white;
      overflow: auto;
    }
    .toolbar {
      background: #2d2d30;
      padding: 10px;
      border-bottom: 1px solid #454545;
    }
    .toolbar h1 {
      font-size: 16px;
      font-weight: normal;
      opacity: 0.8;
    }
    textarea {
      flex: 1;
      background: #1e1e1e;
      color: #d4d4d4;
      border: none;
      padding: 20px;
      font-family: 'Monaco', 'Courier New', monospace;
      font-size: 14px;
      resize: none;
      outline: none;
    }
    iframe {
      width: 100%;
      height: 100%;
      border: none;
    }
    .status {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #0066ff;
      color: white;
      padding: 10px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      opacity: 0;
      transition: opacity 0.3s;
    }
    .status.show {
      opacity: 1;
    }
  </style>
</head>
<body>
  <div class="editor-pane">
    <div class="toolbar">
      <h1>✏️ Edit HTML</h1>
    </div>
    <textarea id="editor" spellcheck="false"><!DOCTYPE html>
<html>
<head>
  <title>My Landing Page</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      line-height: 1.6;
    }
    .hero {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 100px 20px;
      text-align: center;
    }
    .hero h1 {
      font-size: 48px;
      margin-bottom: 20px;
    }
    .hero p {
      font-size: 20px;
      opacity: 0.9;
      margin-bottom: 30px;
    }
    .cta {
      display: inline-block;
      background: white;
      color: #667eea;
      padding: 15px 40px;
      border-radius: 50px;
      text-decoration: none;
      font-weight: bold;
      transition: transform 0.2s;
    }
    .cta:hover {
      transform: scale(1.05);
    }
    .features {
      padding: 80px 20px;
      max-width: 1200px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 40px;
    }
    .feature {
      text-align: center;
    }
    .feature-icon {
      font-size: 48px;
      margin-bottom: 20px;
    }
  </style>
</head>
<body>
  <div class="hero">
    <h1>🚀 Your Product Name</h1>
    <p>Transform the way you work with our innovative solution</p>
    <a href="#" class="cta">Get Started</a>
  </div>

  <div class="features">
    <div class="feature">
      <div class="feature-icon">⚡</div>
      <h3>Lightning Fast</h3>
      <p>Optimized for performance and speed</p>
    </div>
    <div class="feature">
      <div class="feature-icon">🔒</div>
      <h3>Secure</h3>
      <p>Enterprise-grade security built in</p>
    </div>
    <div class="feature">
      <div class="feature-icon">🎨</div>
      <h3>Beautiful</h3>
      <p>Stunning design out of the box</p>
    </div>
  </div>
</body>
</html></textarea>
  </div>

  <div class="preview-pane">
    <iframe id="preview"></iframe>
  </div>

  <div class="status" id="status">✅ Saved</div>

  <script>
    const socket = io();
    const editor = document.getElementById('editor');
    const preview = document.getElementById('preview');
    const status = document.getElementById('status');

    let saveTimeout;

    editor.addEventListener('input', () => {
      // Update preview immediately
      const doc = preview.contentDocument;
      doc.open();
      doc.write(editor.value);
      doc.close();

      // Debounced save
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        socket.emit('save', editor.value);
      }, 1000);
    });

    socket.on('saved', () => {
      status.classList.add('show');
      setTimeout(() => {
        status.classList.remove('show');
      }, 2000);
    });

    // Initial render
    const doc = preview.contentDocument;
    doc.open();
    doc.write(editor.value);
    doc.close();
  </script>
</body>
</html>
  \`);
});

// Save HTML endpoint
io.on('connection', (socket) => {
  socket.on('save', async (html) => {
    await fs.writeFile(path.join(__dirname, 'output.html'), html);
    socket.emit('saved');
    console.log('💾 Saved output.html');
  });
});

server.listen(3000, () => {
  console.log('🎨 Landing Page Builder: http://localhost:3000');
});
`
  },

  devConfig: {
    hotReload: true,
    openBrowser: true,
    watchFiles: ['*.html', '*.css', '*.js']
  }
});
```

---

## 🤖 Multi-Model Landing Page Generator

**Example from BaseToolRegistry**: "Send same prompt to 4 different models, collect responses, present options"

```typescript
const result = await createAddonTool.execute({
  name: 'multi-model-generator',
  description: 'Generate landing pages using 4 AI models and compare',

  mode: 'dev',

  implementation: {
    language: 'javascript',
    packageManager: 'uv',  // Fast installation
    dependencies: ['express', 'axios'],
    code: `
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// Models to use
const models = [
  { name: 'Claude 3.5 Sonnet', endpoint: '/v1/messages', model: 'claude-3-5-sonnet-20241022' },
  { name: 'GPT-4', endpoint: '/v1/chat/completions', model: 'gpt-4' },
  { name: 'Gemini Pro', endpoint: '/v1/generateContent', model: 'gemini-pro' },
  { name: 'Claude 3 Opus', endpoint: '/v1/messages', model: 'claude-3-opus-20240229' }
];

app.get('/', (req, res) => {
  res.send(\`
<!DOCTYPE html>
<html>
<head>
  <title>Multi-Model Landing Page Generator</title>
  <style>
    body {
      font-family: system-ui, sans-serif;
      max-width: 1400px;
      margin: 40px auto;
      padding: 0 20px;
    }
    h1 { text-align: center; margin-bottom: 40px; }
    .prompt-section {
      background: #f5f5f5;
      padding: 30px;
      border-radius: 12px;
      margin-bottom: 40px;
    }
    textarea {
      width: 100%;
      height: 100px;
      padding: 15px;
      border: 2px solid #ddd;
      border-radius: 8px;
      font-family: inherit;
      font-size: 16px;
      resize: vertical;
    }
    button {
      background: #0066ff;
      color: white;
      border: none;
      padding: 15px 40px;
      border-radius: 8px;
      font-size: 16px;
      cursor: pointer;
      margin-top: 15px;
    }
    button:hover {
      background: #0052cc;
    }
    button:disabled {
      background: #ccc;
      cursor: not-allowed;
    }
    .results {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 20px;
    }
    .result-card {
      background: white;
      border: 2px solid #e0e0e0;
      border-radius: 12px;
      padding: 20px;
      min-height: 400px;
    }
    .result-card h3 {
      margin-bottom: 15px;
      color: #333;
    }
    .result-card iframe {
      width: 100%;
      height: 350px;
      border: 1px solid #ddd;
      border-radius: 8px;
    }
    .loading {
      text-align: center;
      color: #666;
      padding: 40px;
    }
    .select-btn {
      background: #00cc66;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 6px;
      cursor: pointer;
      margin-top: 10px;
    }
  </style>
</head>
<body>
  <h1>🎨 Multi-Model Landing Page Generator</h1>

  <div class="prompt-section">
    <textarea id="prompt" placeholder="Describe your landing page... (e.g., 'A modern landing page for a SaaS project management tool with pricing section')">A sleek landing page for an AI-powered code review tool. Include hero section, 3 key features, and call-to-action button.</textarea>
    <button onclick="generate()">Generate with 4 Models</button>
  </div>

  <div id="results" class="results"></div>

  <script>
    async function generate() {
      const prompt = document.getElementById('prompt').value;
      const results = document.getElementById('results');
      results.innerHTML = '<div class="loading">🚀 Generating landing pages from 4 models...</div>';

      try {
        const response = await fetch('/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt })
        });

        const data = await response.json();

        results.innerHTML = data.map((result, index) => \`
          <div class="result-card">
            <h3>\${result.model}</h3>
            <iframe srcdoc="\${escapeHtml(result.html)}"></iframe>
            <button class="select-btn" onclick="selectResult(\${index})">
              ✅ Choose This One
            </button>
          </div>
        \`).join('');
      } catch (error) {
        results.innerHTML = '<div class="loading">❌ Error: ' + error.message + '</div>';
      }
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function selectResult(index) {
      alert(\`Selected result #\${index + 1}! In production, this would save to disk.\`);
    }
  </script>
</body>
</html>
  \`);
});

app.post('/generate', async (req, res) => {
  const { prompt } = req.body;

  const fullPrompt = \`
Generate complete HTML for a landing page based on this description:
\${prompt}

Requirements:
- Complete HTML5 document with inline CSS
- Modern, professional design
- Responsive layout
- Include all requested sections
- Production-ready code

Return ONLY the HTML code, no explanations.
  \`;

  // Call all 4 models in parallel
  const results = await Promise.all(
    models.map(async (modelConfig) => {
      try {
        // This would integrate with Task tool to call different models
        // For now, simulating with placeholders
        const html = \`
<!DOCTYPE html>
<html>
<head>
  <title>Landing Page - \${modelConfig.name}</title>
  <style>
    body {
      font-family: system-ui, sans-serif;
      margin: 0;
      padding: 40px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      text-align: center;
    }
    h1 { font-size: 48px; margin-bottom: 20px; }
    p { font-size: 20px; opacity: 0.9; }
  </style>
</head>
<body>
  <h1>Generated by \${modelConfig.name}</h1>
  <p>Based on prompt: \${prompt}</p>
</body>
</html>
        \`;

        return {
          model: modelConfig.name,
          html
        };
      } catch (error) {
        return {
          model: modelConfig.name,
          html: '<html><body><h1>Error generating</h1></body></html>',
          error: error.message
        };
      }
    })
  );

  res.json(results);
});

app.listen(3000, () => {
  console.log('🎨 Multi-Model Generator: http://localhost:3000');
});
`
  },

  devConfig: {
    hotReload: true,
    openBrowser: true
  }
});
```

---

## 📊 Python Data Analysis with UV

**Using UV for fast Python package management**:

```typescript
const result = await createAddonTool.execute({
  name: 'data-analyzer',
  description: 'Real-time data analysis dashboard',

  mode: 'dev',

  implementation: {
    language: 'python',
    packageManager: 'uv',  // 10-100x faster than pip!
    dependencies: [
      'fastapi',
      'uvicorn',
      'pandas',
      'matplotlib',
      'seaborn'
    ],
    code: `
from fastapi import FastAPI, WebSocket
from fastapi.responses import HTMLResponse
import uvicorn
import pandas as pd
import json

app = FastAPI()

@app.get("/")
async def root():
    return HTMLResponse('''
<!DOCTYPE html>
<html>
<head>
  <title>Data Analyzer</title>
  <style>
    body {
      font-family: system-ui, sans-serif;
      max-width: 1200px;
      margin: 40px auto;
      padding: 0 20px;
    }
    h1 { text-align: center; }
    .upload-section {
      background: #f5f5f5;
      padding: 30px;
      border-radius: 12px;
      text-align: center;
    }
    textarea {
      width: 100%;
      height: 200px;
      margin: 20px 0;
      padding: 15px;
      font-family: monospace;
    }
    button {
      background: #0066ff;
      color: white;
      border: none;
      padding: 15px 40px;
      border-radius: 8px;
      cursor: pointer;
    }
    #results {
      margin-top: 40px;
    }
  </style>
</head>
<body>
  <h1>📊 Data Analyzer</h1>
  <div class="upload-section">
    <textarea id="data" placeholder="Paste CSV data here...">name,age,salary
Alice,25,60000
Bob,30,75000
Charlie,35,90000</textarea>
    <button onclick="analyze()">Analyze Data</button>
  </div>
  <div id="results"></div>

  <script>
    async function analyze() {
      const data = document.getElementById('data').value;
      const response = await fetch('/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: data
      });
      const result = await response.json();
      document.getElementById('results').innerHTML = '<pre>' + JSON.stringify(result, null, 2) + '</pre>';
    }
  </script>
</body>
</html>
    ''')

@app.post("/analyze")
async def analyze(data: str):
    # Parse CSV
    from io import StringIO
    df = pd.read_csv(StringIO(data))

    # Generate statistics
    stats = {
        'shape': df.shape,
        'columns': list(df.columns),
        'dtypes': {col: str(dtype) for col, dtype in df.dtypes.items()},
        'describe': df.describe().to_dict(),
        'missing': df.isnull().sum().to_dict()
    }

    return stats

if __name__ == "__main__":
    print("🚀 Data Analyzer: http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)
`
  },

  devConfig: {
    hotReload: true,
    openBrowser: true
  },

  uiConfig: {
    type: 'web',
    framework: 'fastapi'
  }
});

// With UV, installation is 10-100x faster than pip!
// Traditional pip install: ~60 seconds
// UV install: ~3 seconds
```

---

## 🎯 Key Features Summary

1. **Package Managers**:
   - `npm` - JavaScript/Node.js
   - `pip` - Python (traditional)
   - `uv` - Python (10-100x faster!)
   - `nix` - Declarative, reproducible

2. **Execution Modes**:
   - `oneshot` - Run once, return result
   - `dev` - Hot reload, live editing
   - `persistent` - Keep alive, multi-step

3. **Dev Mode Features**:
   - Hot reload on file changes
   - Auto-open browser
   - WebSocket live updates
   - File watching

4. **UI Frameworks**:
   - `express` - Node.js web server
   - `fastapi` - Modern Python async
   - `flask` - Traditional Python
   - `nextjs` - React framework

5. **Sandbox Types**:
   - `local` - Fast, minimal isolation
   - `docker` - Maximum isolation
   - `nix` - Declarative environment

All tools spin up immediately with interactive UI that opens automatically in your browser! 🚀
