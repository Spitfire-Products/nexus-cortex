/**
 * /health endpoint - server status and diagnostics
 * HTML dashboard styled after Nexus Terminal holographic preset
 */
import { Router, Request, Response } from 'express';
import { ModularModelRegistry } from '@nexus-cortex/core';

export const healthRouter = Router();

healthRouter.get('/health', (req: Request, res: Response) => {
  const registry = new ModularModelRegistry();
  const modelIds = registry.listModels();

  const uptime = process.uptime();
  const uptimeFormatted = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`;

  // Group models by provider
  const modelsByProvider = modelIds.reduce((acc, modelId) => {
    const model = registry.getModel(modelId);
    if (!acc[model.provider]) acc[model.provider] = [];
    acc[model.provider].push({
      id: model.id,
      name: model.displayName,
      contextWindow: model.limits.contextWindow,
      apiPattern: model.api.pattern
    });
    return acc;
  }, {} as Record<string, any[]>);

  const data = {
    status: 'healthy',
    server: {
      name: 'Nexus Cortex',
      version: '4.0.0',
      uptime: uptimeFormatted,
      uptimeSeconds: Math.floor(uptime),
      nodeVersion: process.version,
      architecture: 'core-library'
    },
    availableProviders: Object.keys(modelsByProvider),
    totalModels: modelIds.length,
    models: modelsByProvider,
    environment: {
      hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
      hasOpenAIKey: !!process.env.OPENAI_API_KEY,
      hasGoogleKey: !!process.env.GOOGLE_API_KEY || !!process.env.GEMINI_API_KEY,
      hasXAIKey: !!process.env.XAI_API_KEY,
      hasDeepSeekKey: !!process.env.DEEPSEEK_API_KEY,
      hasHuggingFaceKey: !!process.env.HUGGINGFACE_API_KEY || !!process.env.HUGGINGFACE_TOKEN,
      hasNvidiaKey: !!process.env.NVIDIA_API_KEY
    },
    endpoints: {
      health: '/health',
      models: '/models',
      messages: '/v1/messages'
    }
  };

  const acceptsHtml = req.headers.accept?.includes('text/html');

  if (acceptsHtml) {
    const html = generateHolographicDashboard(data);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } else {
    res.json(data);
  }
});

/**
 * Nexus Terminal holographic-preset dashboard.
 *
 * Design tokens from nexus-terminal/theme/:
 *   Color: holographic preset (electric blue #00d4ff on near-black #050510)
 *   Style: holographic preset (thin border, subtle corners, pulsing glow,
 *          gradient dividers, holographic shimmer overlay, badge-outlined buttons)
 *   Typography: Oxygen Mono, 12px base
 */
function generateHolographicDashboard(data: any): string {
  const providerColors: Record<string, string> = {
    anthropic: '#d4a574',
    openai: '#00a67e',
    google: '#4285f4',
    xai: '#e8e8e8',
    deepseek: '#00d4ff',
    zhipu: '#6366f1',
    qwen: '#a855f7',
    moonshot: '#f59e0b',
    minimax: '#ec4899',
    openrouter: '#06b6d4',
    gemma: '#34d399',
    local: '#6b7280',
    huggingface: '#fbbf24',
  };

  const envKeys = [
    { key: 'hasAnthropicKey', label: 'ANTHROPIC', color: '#d4a574' },
    { key: 'hasOpenAIKey', label: 'OPENAI', color: '#00a67e' },
    { key: 'hasGoogleKey', label: 'GOOGLE', color: '#4285f4' },
    { key: 'hasXAIKey', label: 'XAI', color: '#e8e8e8' },
    { key: 'hasDeepSeekKey', label: 'DEEPSEEK', color: '#00d4ff' },
    { key: 'hasHuggingFaceKey', label: 'HUGGINGFACE', color: '#fbbf24' },
    { key: 'hasNvidiaKey', label: 'NVIDIA', color: '#76b900' },
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cortex Intelligence Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;700&family=Oxygen+Mono&display=swap" rel="stylesheet">
  <style>
    /* ═══════════════════════════════════════════════════════════════════════
       HOLOGRAPHIC THEME — Nexus Terminal Preset
       Colors: #00d4ff primary, #050510 bg, #e8f0ff text
       Style: thin borders, subtle corners, pulsing glow, gradient dividers
       ═══════════════════════════════════════════════════════════════════════ */

    :root {
      --holo-primary: #4a90d9;
      --holo-primary-rgb: 74, 144, 217;
      --holo-positive: #4ade80;
      --holo-positive-rgb: 74, 222, 128;
      --holo-negative: #f87171;
      --holo-negative-rgb: 248, 113, 113;
      --holo-bg: #0f172a;
      --holo-bg-secondary: #1e293b;
      --holo-bg-surface: #253347;
      --holo-bg-elevated: #2d3d53;
      --holo-text: #e2e8f0;
      --holo-text-secondary: #b0b8c4;
      --holo-text-muted: #94a3b8;
      --holo-text-heading: #f8fafc;
      --holo-border: #334155;
      --holo-border-subtle: #283548;
      --holo-glow: 0 0 20px rgba(var(--holo-primary-rgb), 0.15);
      --holo-glow-intense: 0 0 30px rgba(var(--holo-primary-rgb), 0.3), 0 0 60px rgba(var(--holo-primary-rgb), 0.1);
      --holo-radius: 6px;
      --holo-font: 'Oxygen Mono', monospace;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: var(--holo-font);
      font-size: 12px;
      line-height: 1.5;
      color: var(--holo-text);
      background: var(--holo-bg);
      min-height: 100vh;
      overflow-x: hidden;
    }

    /* ── Canvas background with subtle grid ── */
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background:
        radial-gradient(ellipse at 20% 50%, rgba(var(--holo-primary-rgb), 0.04) 0%, transparent 60%),
        radial-gradient(ellipse at 80% 20%, rgba(0, 255, 136, 0.02) 0%, transparent 50%),
        linear-gradient(180deg, var(--holo-bg) 0%, #080818 100%);
      pointer-events: none;
      z-index: 0;
    }

    body::after {
      content: '';
      position: fixed;
      inset: 0;
      background-image:
        linear-gradient(rgba(var(--holo-primary-rgb), 0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(var(--holo-primary-rgb), 0.03) 1px, transparent 1px);
      background-size: 60px 60px;
      pointer-events: none;
      z-index: 0;
    }

    /* ── Layout ── */
    .shell {
      position: relative;
      z-index: 1;
      max-width: 1440px;
      margin: 0 auto;
      padding: 24px 20px;
    }

    /* ═══════════════════════════════════════════════════════════════════════
       HEADER BAR — Nexus Terminal minimal header style
       ═══════════════════════════════════════════════════════════════════════ */
    .header-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: var(--holo-bg-secondary);
      border: 1px solid var(--holo-border);
      border-radius: var(--holo-radius);
      margin-bottom: 20px;
      position: relative;
      overflow: hidden;
    }

    /* Holographic shimmer overlay on header */
    .header-bar::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(
        135deg,
        transparent 0%,
        rgba(var(--holo-primary-rgb), 0.06) 25%,
        transparent 50%,
        rgba(var(--holo-primary-rgb), 0.06) 75%,
        transparent 100%
      );
      background-size: 200% 200%;
      animation: holo-shimmer 4s ease-in-out infinite;
      pointer-events: none;
    }

    @keyframes holo-shimmer {
      0%, 100% { background-position: 0% 0%; }
      50% { background-position: 100% 100%; }
    }

    .header-title {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .header-title h1 {
      font-family: 'Orbitron', var(--holo-font);
      font-size: 14px;
      font-weight: 500;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--holo-text-heading);
    }

    .header-title .version {
      font-size: 10px;
      color: var(--holo-text-muted);
      padding: 2px 8px;
      border: 1px solid var(--holo-border-subtle);
      border-radius: var(--holo-radius);
    }

    .header-status {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .status-indicator {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }

    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--holo-positive);
      box-shadow: 0 0 8px rgba(var(--holo-positive-rgb), 0.6);
      animation: pulse-dot 2s ease-in-out infinite;
    }

    @keyframes pulse-dot {
      0%, 100% { box-shadow: 0 0 8px rgba(var(--holo-positive-rgb), 0.6); }
      50% { box-shadow: 0 0 14px rgba(var(--holo-positive-rgb), 0.9); }
    }

    .status-dot.offline {
      background: var(--holo-negative);
      box-shadow: 0 0 8px rgba(var(--holo-negative-rgb), 0.6);
      animation: none;
    }

    .uptime-label {
      font-size: 10px;
      color: var(--holo-text-muted);
      letter-spacing: 0.05em;
    }

    /* ═══════════════════════════════════════════════════════════════════════
       PANEL GRID — 3-column data panels
       ═══════════════════════════════════════════════════════════════════════ */
    .panel-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 20px;
    }

    @media (max-width: 960px) {
      .panel-grid { grid-template-columns: 1fr; }
    }

    .panel {
      background: var(--holo-bg-secondary);
      border: 1px solid var(--holo-border);
      border-radius: var(--holo-radius);
      overflow: hidden;
      position: relative;
      transition: box-shadow 200ms ease;
    }

    .panel:hover {
      box-shadow: var(--holo-glow);
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border-bottom: 1px solid var(--holo-border-subtle);
      background: linear-gradient(90deg, rgba(var(--holo-primary-rgb), 0.04), transparent);
    }

    .panel-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--holo-text-muted);
    }

    .panel-badge {
      font-size: 9px;
      color: var(--holo-primary);
      border: 1px solid rgba(var(--holo-primary-rgb), 0.3);
      padding: 1px 6px;
      border-radius: var(--holo-radius);
      letter-spacing: 0.05em;
    }

    .panel-body {
      padding: 14px;
    }

    /* ── Data rows ── */
    .data-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 0;
    }

    .data-row + .data-row {
      border-top: 1px solid var(--holo-border-subtle);
    }

    .data-key {
      font-size: 11px;
      color: var(--holo-text-secondary);
    }

    .data-val {
      font-size: 11px;
      color: var(--holo-text);
    }

    .data-val.accent { color: var(--holo-primary); }

    /* ── Stat blocks (big numbers) ── */
    .stat-row {
      display: flex;
      gap: 16px;
    }

    .stat-block {
      flex: 1;
      text-align: center;
      padding: 12px 8px;
      background: var(--holo-bg-surface);
      border: 1px solid var(--holo-border-subtle);
      border-radius: var(--holo-radius);
    }

    .stat-num {
      font-family: 'Orbitron', var(--holo-font);
      font-size: 28px;
      font-weight: 500;
      color: var(--holo-primary);
      line-height: 1.1;
      text-shadow: 0 0 20px rgba(var(--holo-primary-rgb), 0.3);
    }

    .stat-label {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--holo-text-muted);
      margin-top: 6px;
    }

    /* ═══════════════════════════════════════════════════════════════════════
       API KEY MATRIX — horizontal bar indicators
       ═══════════════════════════════════════════════════════════════════════ */
    .key-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 5px 0;
    }

    .key-row + .key-row {
      border-top: 1px solid var(--holo-border-subtle);
    }

    .key-name {
      font-size: 10px;
      letter-spacing: 0.08em;
      color: var(--holo-text-secondary);
      width: 100px;
      flex-shrink: 0;
    }

    .key-bar {
      flex: 1;
      height: 4px;
      border-radius: 2px;
      background: var(--holo-bg-surface);
      position: relative;
      overflow: hidden;
    }

    .key-bar-fill {
      height: 100%;
      border-radius: 2px;
      transition: width 600ms ease;
    }

    .key-bar-fill.active {
      width: 100%;
      animation: bar-glow 2s ease-in-out infinite;
    }

    .key-bar-fill.inactive {
      width: 15%;
      background: rgba(var(--holo-negative-rgb), 0.3);
    }

    @keyframes bar-glow {
      0%, 100% { opacity: 0.7; }
      50% { opacity: 1; }
    }

    .key-status {
      font-size: 9px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      width: 36px;
      text-align: right;
      flex-shrink: 0;
    }

    .key-status.set { color: var(--holo-positive); }
    .key-status.missing { color: rgba(var(--holo-negative-rgb), 0.5); }

    /* ═══════════════════════════════════════════════════════════════════════
       MODEL REGISTRY — provider-grouped collapsible list
       ═══════════════════════════════════════════════════════════════════════ */
    .registry-panel {
      background: var(--holo-bg-secondary);
      border: 1px solid var(--holo-border);
      border-radius: var(--holo-radius);
      overflow: hidden;
    }

    .registry-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border-bottom: 1px solid var(--holo-border-subtle);
      background: linear-gradient(90deg, rgba(var(--holo-primary-rgb), 0.04), transparent);
    }

    .registry-body {
      max-height: 520px;
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: var(--holo-border) var(--holo-bg-secondary);
    }

    .registry-body::-webkit-scrollbar { width: 4px; }
    .registry-body::-webkit-scrollbar-track { background: var(--holo-bg-secondary); }
    .registry-body::-webkit-scrollbar-thumb {
      background: var(--holo-border);
      border-radius: 2px;
    }

    /* Provider group */
    .provider-group {
      border-bottom: 1px solid var(--holo-border-subtle);
    }

    .provider-group:last-child { border-bottom: none; }

    .provider-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 14px;
      cursor: pointer;
      user-select: none;
      transition: background 150ms ease;
    }

    .provider-head:hover {
      background: rgba(var(--holo-primary-rgb), 0.04);
    }

    .provider-info {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .provider-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .provider-name {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--holo-text-heading);
    }

    .provider-count {
      font-size: 9px;
      color: var(--holo-text-muted);
      padding: 1px 6px;
      border: 1px solid var(--holo-border-subtle);
      border-radius: var(--holo-radius);
    }

    .provider-chevron {
      font-size: 10px;
      color: var(--holo-text-muted);
      transition: transform 200ms ease;
    }

    .provider-group.open .provider-chevron {
      transform: rotate(90deg);
    }

    .provider-models {
      display: none;
      padding: 0 14px 8px 30px;
    }

    .provider-group.open .provider-models {
      display: block;
    }

    .model-entry {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      padding: 4px 0;
      border-top: 1px solid rgba(var(--holo-primary-rgb), 0.04);
    }

    .model-entry:first-child { border-top: none; }

    .model-id {
      font-size: 11px;
      color: var(--holo-text);
    }

    .model-meta {
      display: flex;
      gap: 12px;
      align-items: baseline;
    }

    .model-ctx {
      font-size: 9px;
      color: var(--holo-text-muted);
    }

    .model-api {
      font-size: 9px;
      color: var(--holo-primary);
      opacity: 0.6;
    }

    /* ═══════════════════════════════════════════════════════════════════════
       ENDPOINT QUICK-REF — bottom bar
       ═══════════════════════════════════════════════════════════════════════ */
    .endpoints-bar {
      display: flex;
      align-items: center;
      gap: 24px;
      padding: 10px 14px;
      margin-top: 20px;
      background: var(--holo-bg-secondary);
      border: 1px solid var(--holo-border);
      border-radius: var(--holo-radius);
    }

    .endpoint-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .endpoint-method {
      font-size: 9px;
      padding: 1px 5px;
      border-radius: var(--holo-radius);
      letter-spacing: 0.05em;
      font-weight: 400;
    }

    .endpoint-method.get {
      color: var(--holo-positive);
      border: 1px solid rgba(var(--holo-positive-rgb), 0.3);
    }

    .endpoint-method.post {
      color: var(--holo-primary);
      border: 1px solid rgba(var(--holo-primary-rgb), 0.3);
    }

    .endpoint-path {
      font-size: 11px;
      color: var(--holo-text-secondary);
    }

    /* ── Pulsing glow on focused panel ── */
    @keyframes glow-pulse {
      0%, 100% { box-shadow: 0 0 15px rgba(var(--holo-primary-rgb), 0.15); }
      50% { box-shadow: 0 0 25px rgba(var(--holo-primary-rgb), 0.3); }
    }

    /* ── Gradient divider ── */
    .gradient-divider {
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(var(--holo-primary-rgb), 0.3), transparent);
      margin: 16px 0;
    }

    /* ── Refresh button — badge-outlined style ── */
    .refresh-btn {
      position: fixed;
      bottom: 20px;
      right: 20px;
      font-family: var(--holo-font);
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--holo-primary);
      background: var(--holo-bg-secondary);
      border: 1px solid rgba(var(--holo-primary-rgb), 0.3);
      border-radius: var(--holo-radius);
      padding: 8px 16px;
      cursor: pointer;
      transition: all 200ms ease;
      z-index: 10;
    }

    .refresh-btn:hover {
      background: rgba(var(--holo-primary-rgb), 0.08);
      border-color: rgba(var(--holo-primary-rgb), 0.6);
      box-shadow: 0 0 15px rgba(var(--holo-primary-rgb), 0.2);
    }

    /* ── Auto-refresh countdown ── */
    .auto-refresh {
      font-size: 9px;
      color: var(--holo-text-muted);
      text-align: right;
      margin-top: 8px;
      letter-spacing: 0.05em;
    }

    /* ═══════════════════════════════════════════════════════════════════════
       DASHBOARD SERVICES — linked cards to port 4001
       ═══════════════════════════════════════════════════════════════════════ */
    .services-panel {
      background: var(--holo-bg-secondary);
      border: 1px solid var(--holo-border);
      border-radius: var(--holo-radius);
      margin-bottom: 20px;
      overflow: hidden;
    }

    .services-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 8px;
    }

    .service-card {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      background: var(--holo-bg-surface);
      border: 1px solid var(--holo-border-subtle);
      border-radius: var(--holo-radius);
      text-decoration: none;
      color: inherit;
      transition: all 200ms ease;
      cursor: pointer;
    }

    .service-card:hover {
      border-color: rgba(var(--holo-primary-rgb), 0.4);
      background: var(--holo-bg-elevated);
      box-shadow: 0 0 12px rgba(var(--holo-primary-rgb), 0.1);
    }

    .service-icon {
      font-size: 16px;
      color: var(--holo-primary);
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(var(--holo-primary-rgb), 0.06);
      border: 1px solid rgba(var(--holo-primary-rgb), 0.15);
      border-radius: var(--holo-radius);
      flex-shrink: 0;
    }

    .service-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      flex: 1;
      min-width: 0;
    }

    .service-name {
      font-size: 11px;
      color: var(--holo-text-heading);
      letter-spacing: 0.04em;
    }

    .service-desc {
      font-size: 9px;
      color: var(--holo-text-muted);
      letter-spacing: 0.02em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .service-arrow {
      font-size: 12px;
      color: var(--holo-text-muted);
      flex-shrink: 0;
      transition: color 200ms ease, transform 200ms ease;
    }

    .service-card:hover .service-arrow {
      color: var(--holo-primary);
      transform: translateX(2px);
    }

    /* ── Staggered entry animations ── */
    @keyframes fade-up {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .anim-in {
      animation: fade-up 400ms ease both;
    }

    .anim-d1 { animation-delay: 50ms; }
    .anim-d2 { animation-delay: 120ms; }
    .anim-d3 { animation-delay: 190ms; }
    .anim-d4 { animation-delay: 260ms; }
    .anim-d5 { animation-delay: 330ms; }
  </style>
</head>
<body>
  <div class="shell">

    <!-- ══════ HEADER BAR ══════ -->
    <div class="header-bar anim-in">
      <div class="header-title">
        <h1>Cortex Intelligence Dashboard</h1>
        <span class="version">v${data.server.version}</span>
      </div>
      <div class="header-status">
        <div class="status-indicator">
          <span class="status-dot"></span>
          <span style="color: var(--holo-positive);">${data.status.toUpperCase()}</span>
        </div>
        <span class="uptime-label">${data.server.uptime}</span>
      </div>
    </div>

    <!-- ══════ DASHBOARD SERVICES — Port 4001 ══════ -->
    <div class="services-panel anim-in anim-d1">
      <div class="panel-header">
        <span class="panel-label">Dashboard Services</span>
        <span class="panel-badge">:4001</span>
      </div>
      <div class="panel-body" style="padding: 10px 14px;">
        <div class="services-grid">
          <a href="#" data-dash-path="/" class="service-card" target="_blank">
            <div class="service-icon">&#9638;</div>
            <div class="service-info">
              <span class="service-name">Sandbox Dashboard</span>
              <span class="service-desc">Live artifact execution viewer</span>
            </div>
            <span class="service-arrow">&#8594;</span>
          </a>
          <a href="#" data-dash-path="/tmux" class="service-card" target="_blank">
            <div class="service-icon">&#9776;</div>
            <div class="service-info">
              <span class="service-name">Tmux Sessions</span>
              <span class="service-desc">Persistent terminal sessions &amp; agent monitoring</span>
            </div>
            <span class="service-arrow">&#8594;</span>
          </a>
          <a href="#" data-dash-path="/api/sandboxes" class="service-card" target="_blank">
            <div class="service-icon">{}</div>
            <div class="service-info">
              <span class="service-name">Sandboxes API</span>
              <span class="service-desc">GET /api/sandboxes — JSON listing</span>
            </div>
            <span class="service-arrow">&#8594;</span>
          </a>
          <a href="#" data-dash-path="/api/tmux/sessions" class="service-card" target="_blank">
            <div class="service-icon">{}</div>
            <div class="service-info">
              <span class="service-name">Tmux API</span>
              <span class="service-desc">GET /api/tmux/sessions — JSON listing</span>
            </div>
            <span class="service-arrow">&#8594;</span>
          </a>
          <a href="#" data-dash-path="/health" class="service-card" target="_blank">
            <div class="service-icon">&#9829;</div>
            <div class="service-info">
              <span class="service-name">Dashboard Health</span>
              <span class="service-desc">GET /health — service status</span>
            </div>
            <span class="service-arrow">&#8594;</span>
          </a>
        </div>
      </div>
    </div>

    <!-- ══════ 3-COLUMN PANELS ══════ -->
    <div class="panel-grid">

      <!-- Server Info -->
      <div class="panel anim-in anim-d1">
        <div class="panel-header">
          <span class="panel-label">System</span>
          <span class="panel-badge">CORE</span>
        </div>
        <div class="panel-body">
          <div class="data-row">
            <span class="data-key">Architecture</span>
            <span class="data-val accent">${data.server.architecture}</span>
          </div>
          <div class="data-row">
            <span class="data-key">Node</span>
            <span class="data-val">${data.server.nodeVersion}</span>
          </div>
          <div class="data-row">
            <span class="data-key">Uptime</span>
            <span class="data-val">${data.server.uptime}</span>
          </div>
          <div class="data-row">
            <span class="data-key">PID</span>
            <span class="data-val" style="color: var(--holo-text-muted);">${process.pid}</span>
          </div>
          <div class="data-row">
            <span class="data-key">Memory</span>
            <span class="data-val" style="color: var(--holo-text-muted);">${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB</span>
          </div>
        </div>
      </div>

      <!-- Stats -->
      <div class="panel anim-in anim-d2">
        <div class="panel-header">
          <span class="panel-label">Registry</span>
          <span class="panel-badge">LIVE</span>
        </div>
        <div class="panel-body">
          <div class="stat-row">
            <div class="stat-block">
              <div class="stat-num">${data.totalModels}</div>
              <div class="stat-label">Models</div>
            </div>
            <div class="stat-block">
              <div class="stat-num">${data.availableProviders.length}</div>
              <div class="stat-label">Providers</div>
            </div>
          </div>
          <div class="gradient-divider"></div>
          <div style="display: flex; flex-wrap: wrap; gap: 4px;">
            ${data.availableProviders.map((p: string) => `<span style="
              font-size: 9px;
              padding: 2px 6px;
              border: 1px solid ${providerColors[p] || 'var(--holo-border)'}40;
              color: ${providerColors[p] || 'var(--holo-text-muted)'};
              border-radius: var(--holo-radius);
              letter-spacing: 0.05em;
              text-transform: uppercase;
            ">${p}</span>`).join('')}
          </div>
        </div>
      </div>

      <!-- API Keys -->
      <div class="panel anim-in anim-d3">
        <div class="panel-header">
          <span class="panel-label">Credentials</span>
          <span class="panel-badge">${envKeys.filter(k => (data.environment as any)[k.key]).length}/${envKeys.length}</span>
        </div>
        <div class="panel-body">
          ${envKeys.map(k => {
            const active = (data.environment as any)[k.key];
            return `<div class="key-row">
              <span class="key-name">${k.label}</span>
              <div class="key-bar">
                <div class="key-bar-fill ${active ? 'active' : 'inactive'}" style="background: ${active ? k.color + '80' : ''}; ${active ? `box-shadow: 0 0 8px ${k.color}40;` : ''}"></div>
              </div>
              <span class="key-status ${active ? 'set' : 'missing'}">${active ? 'SET' : '---'}</span>
            </div>`;
          }).join('')}
        </div>
      </div>

    </div>

    <!-- ══════ MODEL REGISTRY ══════ -->
    <div class="registry-panel anim-in anim-d4">
      <div class="registry-header">
        <span class="panel-label">Model Registry</span>
        <span class="panel-badge">${data.totalModels} REGISTERED</span>
      </div>
      <div class="registry-body">
        ${(Object.entries(data.models) as [string, any[]][]).map(([provider, models]) => {
          const dotColor = providerColors[provider] || '#6080cc';
          return `<div class="provider-group">
            <div class="provider-head" onclick="this.parentElement.classList.toggle('open')">
              <div class="provider-info">
                <span class="provider-dot" style="background: ${dotColor}; box-shadow: 0 0 6px ${dotColor}60;"></span>
                <span class="provider-name">${provider}</span>
                <span class="provider-count">${models.length}</span>
              </div>
              <span class="provider-chevron">&#9654;</span>
            </div>
            <div class="provider-models">
              ${models.map((m: any) => `<div class="model-entry">
                <span class="model-id">${m.id}</span>
                <span class="model-meta">
                  <span class="model-ctx">${m.contextWindow ? (m.contextWindow / 1000).toFixed(0) + 'K' : '-'}</span>
                  <span class="model-api">${m.apiPattern}</span>
                </span>
              </div>`).join('')}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>

    <!-- ══════ ENDPOINTS BAR ══════ -->
    <div class="endpoints-bar anim-in anim-d5">
      <div class="endpoint-item">
        <span class="endpoint-method get">GET</span>
        <span class="endpoint-path">/health</span>
      </div>
      <div class="endpoint-item">
        <span class="endpoint-method get">GET</span>
        <span class="endpoint-path">/models</span>
      </div>
      <div class="endpoint-item">
        <span class="endpoint-method post">POST</span>
        <span class="endpoint-path">/v1/messages</span>
      </div>
      <div class="endpoint-item">
        <span class="endpoint-method get">GET</span>
        <span class="endpoint-path">/sessions</span>
      </div>
      <div class="endpoint-item" style="margin-left: auto;">
        <span class="auto-refresh" id="countdown"></span>
      </div>
    </div>

  </div>

  <button class="refresh-btn" onclick="location.reload()">Refresh</button>

  <script>
    // Auto-refresh every 30s
    let remaining = 30;
    const el = document.getElementById('countdown');
    setInterval(() => {
      remaining--;
      if (el) el.textContent = 'refresh in ' + remaining + 's';
      if (remaining <= 0) location.reload();
    }, 1000);
    if (el) el.textContent = 'refresh in 30s';

    // All provider groups closed by default

    // Resolve dashboard service links (port + 1 from current origin)
    (function() {
      const loc = window.location;
      const currentPort = parseInt(loc.port) || (loc.protocol === 'https:' ? 443 : 80);
      const dashPort = currentPort + 1;
      const dashBase = loc.protocol + '//' + loc.hostname + ':' + dashPort;
      document.querySelectorAll('[data-dash-path]').forEach(function(a) {
        a.setAttribute('href', dashBase + a.getAttribute('data-dash-path'));
      });
    })();
  </script>
</body>
</html>`;
}
