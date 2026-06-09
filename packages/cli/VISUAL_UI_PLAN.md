# Visual UI Plan: Complete Design System

**Architecture**: Hybrid Chalk (streaming) + Ink (interactive) with 13 theme system

**Based On**: Working demos in `themes/` directory

---

## Overview

Complete visual design system for Cortex CLI combining:
- **13 Chalk themes** (color palettes)
- **Ink React components** (interactive UIs)
- **Seamless mode switching** (Chalk ↔ Ink)
- **Responsive layouts** (adapt to terminal width)
- **Accessibility** (color contrast, keyboard navigation)

---

## Theme System Architecture

### Theme Structure

**File**: `src/themes/Theme.interface.ts`

```typescript
export interface Theme {
  name: string;                // 'default', 'cyberpunk', etc.
  displayName: string;         // 'Default Theme'
  colors: ThemeColors;
  fonts?: ThemeFonts;
  borders?: ThemeBorders;
}

export interface ThemeColors {
  // Primary palette
  primary: ChalkInstance;      // Main headings (bold, high contrast)
  secondary: ChalkInstance;    // Subheadings
  tertiary?: ChalkInstance;    // Less emphasis

  // Status colors
  success: ChalkInstance;      // ✓ confirmations, completed tasks
  error: ChalkInstance;        // ✗ failures, errors
  warning: ChalkInstance;      // ⚠ warnings, cautions
  info: ChalkInstance;         // ℹ informational messages

  // Text hierarchy
  highlight: ChalkInstance;    // Emphasized text, selections
  muted: ChalkInstance;        // Secondary text, hints
  dim?: ChalkInstance;         // Very low emphasis

  // UI elements
  border?: ChalkInstance;      // Box borders
  background?: ChalkInstance;  // Background fills (rare)
  link?: ChalkInstance;        // URLs, references
}

export interface ThemeFonts {
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

export interface ThemeBorders {
  style: 'single' | 'double' | 'round' | 'bold' | 'none';
  color?: ChalkInstance;
}
```

### 13 Included Themes

**1. Default** (GitHub-inspired)
```typescript
{
  name: 'default',
  colors: {
    primary: chalk.blue.bold,
    secondary: chalk.cyan,
    success: chalk.green,
    error: chalk.red,
    warning: chalk.yellow,
    info: chalk.blue,
    muted: chalk.gray,
    highlight: chalk.magenta.bold,
  }
}
```

**2. Minimal** (Plain text)
```typescript
{
  name: 'minimal',
  colors: {
    primary: chalk.white.bold,
    secondary: chalk.white,
    success: chalk.white,
    error: chalk.white,
    warning: chalk.white,
    info: chalk.white,
    muted: chalk.gray,
    highlight: chalk.white.bold,
  }
}
```

**3. Cyberpunk** (Neon colors)
```typescript
{
  name: 'cyberpunk',
  colors: {
    primary: chalk.magenta.bold,
    secondary: chalk.cyan.bold,
    success: chalk.greenBright,
    error: chalk.redBright,
    warning: chalk.yellowBright,
    info: chalk.cyanBright,
    muted: chalk.gray,
    highlight: chalk.hex('#FF00FF').bold,
  }
}
```

**4. Forest** (Nature greens)
```typescript
{
  name: 'forest',
  colors: {
    primary: chalk.green.bold,
    secondary: chalk.greenBright,
    success: chalk.green,
    error: chalk.red,
    warning: chalk.yellow,
    info: chalk.cyan,
    muted: chalk.gray,
    highlight: chalk.yellowGreen.bold,
  }
}
```

**5. Ocean** (Blues)
```typescript
{
  name: 'ocean',
  colors: {
    primary: chalk.blue.bold,
    secondary: chalk.blueBright,
    success: chalk.cyan,
    error: chalk.red,
    warning: chalk.yellow,
    info: chalk.blue,
    muted: chalk.gray,
    highlight: chalk.cyanBright.bold,
  }
}
```

**6. Sunset** (Warm oranges/pinks)
```typescript
{
  name: 'sunset',
  colors: {
    primary: chalk.hex('#FF6B6B').bold,
    secondary: chalk.hex('#FFA500'),
    success: chalk.green,
    error: chalk.red,
    warning: chalk.yellow,
    info: chalk.cyan,
    muted: chalk.gray,
    highlight: chalk.hex('#FF1493').bold,
  }
}
```

**7. Monochrome** (Black & white)
```typescript
{
  name: 'monochrome',
  colors: {
    primary: chalk.white.bold,
    secondary: chalk.white,
    success: chalk.white,
    error: chalk.white.inverse,
    warning: chalk.white.dim,
    info: chalk.white,
    muted: chalk.gray,
    highlight: chalk.white.underline,
  }
}
```

**8. Solarized Light**
```typescript
{
  name: 'solarized-light',
  colors: {
    primary: chalk.hex('#268BD2').bold,
    secondary: chalk.hex('#2AA198'),
    success: chalk.hex('#859900'),
    error: chalk.hex('#DC322F'),
    warning: chalk.hex('#B58900'),
    info: chalk.hex('#268BD2'),
    muted: chalk.hex('#93A1A1'),
    highlight: chalk.hex('#6C71C4').bold,
  }
}
```

**9. Solarized Dark**
```typescript
{
  name: 'solarized-dark',
  colors: {
    primary: chalk.hex('#268BD2').bold,
    secondary: chalk.hex('#2AA198'),
    success: chalk.hex('#859900'),
    error: chalk.hex('#DC322F'),
    warning: chalk.hex('#B58900'),
    info: chalk.hex('#268BD2'),
    muted: chalk.hex('#586E75'),
    highlight: chalk.hex('#6C71C4').bold,
  }
}
```

**10. Nord** (Arctic blues)
```typescript
{
  name: 'nord',
  colors: {
    primary: chalk.hex('#88C0D0').bold,
    secondary: chalk.hex('#81A1C1'),
    success: chalk.hex('#A3BE8C'),
    error: chalk.hex('#BF616A'),
    warning: chalk.hex('#EBCB8B'),
    info: chalk.hex('#5E81AC'),
    muted: chalk.hex('#4C566A'),
    highlight: chalk.hex('#B48EAD').bold,
  }
}
```

**11. Dracula** (Purple/pink)
```typescript
{
  name: 'dracula',
  colors: {
    primary: chalk.hex('#BD93F9').bold,
    secondary: chalk.hex('#FF79C6'),
    success: chalk.hex('#50FA7B'),
    error: chalk.hex('#FF5555'),
    warning: chalk.hex('#F1FA8C'),
    info: chalk.hex('#8BE9FD'),
    muted: chalk.hex('#6272A4'),
    highlight: chalk.hex('#FFB86C').bold,
  }
}
```

**12. Gruvbox** (Retro warm)
```typescript
{
  name: 'gruvbox',
  colors: {
    primary: chalk.hex('#FABD2F').bold,
    secondary: chalk.hex('#FE8019'),
    success: chalk.hex('#B8BB26'),
    error: chalk.hex('#FB4934'),
    warning: chalk.hex('#FABD2F'),
    info: chalk.hex('#83A598'),
    muted: chalk.hex('#928374'),
    highlight: chalk.hex('#D3869B').bold,
  }
}
```

**13. One Dark** (Atom editor)
```typescript
{
  name: 'one-dark',
  colors: {
    primary: chalk.hex('#61AFEF').bold,
    secondary: chalk.hex('#C678DD'),
    success: chalk.hex('#98C379'),
    error: chalk.hex('#E06C75'),
    warning: chalk.hex('#E5C07B'),
    info: chalk.hex('#61AFEF'),
    muted: chalk.hex('#5C6370'),
    highlight: chalk.hex('#56B6C2').bold,
  }
}
```

### Theme Manager

**File**: `src/themes/ThemeManager.ts`

```typescript
export class ThemeManager {
  private static themes: Map<string, Theme> = new Map();
  private static currentTheme: Theme = DefaultTheme;
  private static configPath = '.cortex/config.json';

  // Register theme
  static register(theme: Theme): void {
    this.themes.set(theme.name, theme);
  }

  // Get current theme
  static getTheme(): Theme {
    return this.currentTheme;
  }

  // Switch theme
  static setTheme(themeName: string): void {
    const theme = this.themes.get(themeName);
    if (!theme) {
      throw new Error(`Theme not found: ${themeName}`);
    }
    this.currentTheme = theme;
    this.saveToConfig();
  }

  // List all themes
  static listThemes(): Theme[] {
    return Array.from(this.themes.values());
  }

  // Load from config
  static async loadFromConfig(): Promise<void> {
    try {
      const config = await fs.readFile(this.configPath, 'utf-8');
      const { theme } = JSON.parse(config);
      if (theme) {
        this.setTheme(theme);
      }
    } catch {
      // Use default theme
    }
  }

  // Save to config
  private static async saveToConfig(): Promise<void> {
    const config = { theme: this.currentTheme.name };
    await fs.writeFile(this.configPath, JSON.stringify(config, null, 2));
  }

  // Auto-register all themes
  static initialize(): void {
    this.register(DefaultTheme);
    this.register(MinimalTheme);
    this.register(CyberpunkTheme);
    this.register(ForestTheme);
    this.register(OceanTheme);
    this.register(SunsetTheme);
    this.register(MonochromeTheme);
    this.register(SolarizedLightTheme);
    this.register(SolarizedDarkTheme);
    this.register(NordTheme);
    this.register(DraculaTheme);
    this.register(GruvboxTheme);
    this.register(OneDarkTheme);
  }
}

// Initialize on import
ThemeManager.initialize();
```

---

## Chalk Streaming UI

### Chat Interface

**Character-by-Character Streaming**:

```typescript
// src/commands/chat/interactive.ts
async function streamResponse(eventSource: EventSource) {
  const theme = ThemeManager.getTheme();

  eventSource.on('message', (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'content_block_delta') {
      // Stream text character by character
      const text = data.delta?.text || '';
      process.stdout.write(theme.colors.primary(text));
    }

    if (data.type === 'tool_use') {
      // Show tool execution
      console.log('\n');
      console.log(theme.colors.info(`🔧 Using tool: ${data.name}`));
      console.log(theme.colors.muted(`   Parameters: ${JSON.stringify(data.input)}`));
    }

    if (data.type === 'tool_result') {
      // Show tool completion
      console.log(theme.colors.success('   ✓ Tool completed'));
    }
  });
}
```

### Status Bar

**Inline Status Display**:

```typescript
// src/ui/StatusBar.ts
export class StatusBar {
  async render() {
    const theme = ThemeManager.getTheme();
    const health = await this.client.get('/health');

    const width = process.stdout.columns || 80;
    const separator = theme.colors.muted('─'.repeat(width));

    console.log(separator);

    // Model status
    const modelStatus = [
      theme.colors.info('Model:'),
      theme.colors.highlight(health.currentModel),
    ].join(' ');

    // Token status
    const tokenPct = (health.tokenCount / health.tokenLimit * 100).toFixed(1);
    const tokenStatus = [
      theme.colors.info('Tokens:'),
      theme.colors.highlight(`${health.tokenCount} / ${health.tokenLimit}`),
      theme.colors.muted(`(${tokenPct}%)`),
    ].join(' ');

    // MCP status
    const mcpStatus = [
      theme.colors.info('MCP:'),
      theme.colors.highlight(`${health.mcpServersActive} active`),
    ].join(' ');

    // Artifacts status
    const artifactStatus = [
      theme.colors.info('Artifacts:'),
      theme.colors.highlight(`${health.artifactsRunning} running`),
    ].join(' ');

    console.log(`${modelStatus}  |  ${tokenStatus}  |  ${mcpStatus}  |  ${artifactStatus}`);
    console.log(separator);
  }
}
```

### Progress Indicators

**Simple Progress Bar**:

```typescript
// src/ui/ProgressBar.ts
export class ProgressBar {
  private theme = ThemeManager.getTheme();

  render(current: number, total: number, label: string) {
    const width = 40;
    const percent = current / total;
    const filled = Math.floor(width * percent);
    const empty = width - filled;

    const bar = [
      this.theme.colors.success('█'.repeat(filled)),
      this.theme.colors.muted('░'.repeat(empty)),
    ].join('');

    const text = [
      this.theme.colors.info(label),
      bar,
      this.theme.colors.highlight(`${(percent * 100).toFixed(0)}%`),
      this.theme.colors.muted(`(${current}/${total})`),
    ].join(' ');

    // Clear line and write
    process.stdout.write(`\r${text}`);

    if (current === total) {
      process.stdout.write('\n');
    }
  }
}
```

---

## Ink Interactive Components

### Component Library (10 Components)

**1. SessionBrowser** - Browse and select sessions

```typescript
// src/ui/components/SessionBrowser.tsx
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import Spinner from 'ink-spinner';

interface Session {
  id: string;
  model: string;
  messageCount: number;
  created: string;
}

export const SessionBrowser: React.FC<Props> = ({ serverUrl, onSelect, onExit }) => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = new CortexClient(serverUrl);
    client.get('/sessions')
      .then(setSessions)
      .finally(() => setLoading(false));
  }, [serverUrl]);

  if (loading) {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" /> Loading sessions...
        </Text>
      </Box>
    );
  }

  const items = sessions.map(s => ({
    label: `${s.id.slice(0, 8)} - ${s.model} (${s.messageCount} messages)`,
    value: s,
  }));

  items.push({ label: '← Exit', value: null as any });

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">📋 Session Browser</Text>
      <Text color="gray">Use ↑/↓ to navigate, Enter to select, Esc to exit</Text>
      <Box marginTop={1}>
        <SelectInput items={items} onSelect={(item) => {
          item.value ? onSelect(item.value) : onExit();
        }} />
      </Box>
    </Box>
  );
};
```

**2. ModelPicker** - Select model with provider grouping

```typescript
// src/ui/components/ModelPicker.tsx
export const ModelPicker: React.FC<Props> = ({ serverUrl, onSelect, onExit }) => {
  const [models, setModels] = useState([]);
  const [provider, setProvider] = useState<string | null>(null);

  // Group models by provider
  const providers = useMemo(() => {
    const grouped = models.reduce((acc, model) => {
      const p = model.owned_by;
      if (!acc[p]) acc[p] = [];
      acc[p].push(model);
      return acc;
    }, {});
    return grouped;
  }, [models]);

  if (!provider) {
    // Show provider selection
    const providerItems = Object.keys(providers).map(p => ({
      label: `${p} (${providers[p].length} models)`,
      value: p,
    }));

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">🤖 Model Picker - Select Provider</Text>
        <SelectInput
          items={providerItems}
          onSelect={(item) => setProvider(item.value)}
        />
      </Box>
    );
  }

  // Show models for selected provider
  const modelItems = providers[provider].map(m => ({
    label: `${m.displayName} - ${m.contextWindow} tokens`,
    value: m,
  }));

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">🤖 Model Picker - {provider}</Text>
      <Text color="gray">← Back to providers</Text>
      <SelectInput
        items={modelItems}
        onSelect={(item) => onSelect(item.value)}
      />
    </Box>
  );
};
```

**3. ThemePicker** - Select theme with live preview

```typescript
// src/ui/components/ThemePicker.tsx
export const ThemePicker: React.FC<Props> = ({ onSelect, onExit }) => {
  const [selectedTheme, setSelectedTheme] = useState('default');
  const themes = ThemeManager.listThemes();

  const items = themes.map(t => ({
    label: `${t.displayName}`,
    value: t.name,
  }));

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">🎨 Theme Selector</Text>

      <Box marginTop={1}>
        <SelectInput
          items={items}
          onSelect={(item) => {
            setSelectedTheme(item.value);
            ThemeManager.setTheme(item.value);
          }}
          onHighlight={(item) => setSelectedTheme(item.value)}
        />
      </Box>

      {/* Live Preview */}
      <Box marginTop={1} borderStyle="round" paddingX={1}>
        <Box flexDirection="column">
          <Text bold>Preview: {selectedTheme}</Text>
          <Text color="blue">Primary text (headings)</Text>
          <Text color="green">Success messages</Text>
          <Text color="red">Error messages</Text>
          <Text color="yellow">Warnings</Text>
          <Text color="gray">Muted text</Text>
        </Box>
      </Box>
    </Box>
  );
};
```

**4. ArtifactDashboard** - View/manage artifacts

**5. TmuxBrowser** - Browse tmux sessions

**6. ConfigWizard** - Interactive configuration

**7. PermissionsBrowser** - Manage tool permissions

**8. MiddlewareDashboard** - View/configure middleware

**9. ContextViewer** - View context budget/compactions

**10. SystemMessageBrowser** - Browse/view system messages

---

## Mode Switching

### Chalk → Ink Transition

```typescript
// src/ui/utils/modeSwitch.ts
import { render } from 'ink';
import React from 'react';

export async function switchToInteractive<T>(
  Component: React.ComponentType<any>,
  props: any
): Promise<T> {
  return new Promise((resolve) => {
    const { waitUntilExit, clear } = render(
      React.createElement(Component, {
        ...props,
        onExit: (result: T) => {
          clear();
          resolve(result);
        },
      })
    );
  });
}
```

**Usage**:
```typescript
// In chat, user types /sessions
const session = await switchToInteractive(SessionBrowser, {
  serverUrl: 'http://localhost:4000',
});

// Back to Chalk streaming
console.log(theme.colors.success(`Selected: ${session.id}`));
```

---

## Responsive Layouts

### Terminal Width Detection

```typescript
const width = process.stdout.columns || 80;

if (width < 80) {
  // Compact layout
  renderCompact();
} else if (width < 120) {
  // Standard layout
  renderStandard();
} else {
  // Wide layout
  renderWide();
}
```

### Adaptive Tables

```typescript
import Table from 'ink-table';

const columns = width >= 120
  ? ['id', 'model', 'messages', 'created', 'tokens']  // All columns
  : ['id', 'model', 'messages'];                      // Essential only
```

---

## Accessibility

### Color Contrast

All themes meet WCAG AA standards:
- Primary/background: 4.5:1 minimum
- Success/error: High contrast
- Muted text: 3:1 minimum

### Keyboard Navigation

All Ink components support:
- ↑/↓ - Navigate items
- Enter - Select
- Esc - Exit/back
- Tab - Next section
- Shift+Tab - Previous section
- Ctrl+C - Force quit

### Screen Readers

Use semantic labels:
```typescript
<Text aria-label="Session list">Sessions (12)</Text>
```

---

## Working Demos

### Located in `themes/` Directory

**1. Hybrid Implementation Demo**
```bash
node themes/hybrid-implementation.cjs
```
- Complete Chalk + Ink hybrid
- Theme switching
- Mode transitions

**2. Chalk Themes Demo**
```bash
node themes/chalk/chalk-themes.cjs
```
- All 13 themes showcase
- Live theme switching

**3. Ink Interactive Demo**
```bash
node themes/ink/ink-theme-interactive.jsx
```
- Interactive menu
- Keyboard navigation
- Component examples

**4. SSE Streaming Demo**
```bash
node themes/hybrid-sse-client.cjs
```
- Server-sent events
- Character streaming
- Tool execution display

---

## Implementation Checklist

### Phase 1: Theme System (Week 5)
- [ ] Copy `themes/chalk/` to `src/themes/`
- [ ] Create `Theme.interface.ts`
- [ ] Implement `ThemeManager.ts`
- [ ] Register all 13 themes
- [ ] Add config persistence
- [ ] Test theme switching

### Phase 2: Chalk Integration (Week 5)
- [ ] Apply themes to all commands
- [ ] Implement `StatusBar.ts`
- [ ] Implement `ProgressBar.ts`
- [ ] Update chat streaming with themes
- [ ] Test all Chalk output

### Phase 3: Ink Components (Week 6)
- [ ] Install Ink dependencies
- [ ] Create component directory structure
- [ ] Implement 10 Ink components
- [ ] Add keyboard shortcuts
- [ ] Test responsive layouts

### Phase 4: Mode Switching (Week 6)
- [ ] Implement `modeSwitch.ts`
- [ ] Test Chalk → Ink transitions
- [ ] Test Ink → Chalk transitions
- [ ] Handle edge cases
- [ ] Add cleanup logic

### Phase 5: Polish (Week 8)
- [ ] Add loading states
- [ ] Improve error handling
- [ ] Test accessibility
- [ ] Optimize performance
- [ ] User testing

---

## Performance Targets

- **Startup**: <100ms
- **Theme switch**: <50ms
- **Chalk render**: <10ms per line
- **Ink render**: <50ms per frame
- **Mode switch**: <100ms
- **Memory**: <50MB (Chalk), <150MB (Ink)

---

## Browser Integration

### Opening Dashboards

```typescript
import open from 'open';

// Open artifact dashboard
await open('http://localhost:4001/');

// Open specific sandbox
await open(`http://localhost:4001/sandbox/${sandboxId}`);

// Open tmux viewer
await open(`http://localhost:4001/tmux/${sessionId}`);
```

### Inline Links

```typescript
const url = 'http://localhost:4001/sandbox/abc-123';
console.log(theme.colors.link(`View sandbox: ${url}`));

// With terminal link support
console.log(terminalLink('View sandbox', url));
```

---

## Future Enhancements

- **Custom themes**: User-defined color palettes
- **Theme marketplace**: Share/download themes
- **Animations**: Smooth transitions, fades
- **Rich media**: Images, charts (using terminal capabilities)
- **Split views**: Side-by-side layouts
- **Window management**: Multiple panes

---

## Resources

- **Working Demos**: `themes/` directory
- **Chalk Docs**: https://github.com/chalk/chalk
- **Ink Docs**: https://github.com/vadimdemedes/ink
- **React Docs**: https://react.dev
- **Terminal Capabilities**: https://github.com/chalk/supports-color

---

Last Updated: 2025-11-16
