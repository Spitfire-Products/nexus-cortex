# Hybrid UI Implementation Plan

**Architecture:** Chalk (Primary Streaming) + Ink (Interactive Components)
**Status:** Not yet implemented in CLI package
**Reference:** `/themes/` directory contains working demos

---

## Current State vs. Target State

### Current State ❌

**package.json Dependencies:**
- ✅ chalk: ^4.1.2
- ❌ No Ink dependencies
- ❌ No React dependencies

**Implementation:**
- ✅ Theme system (Chalk-based, static)
- ❌ No streaming output
- ❌ No interactive components
- ❌ No mode switching
- ❌ Commands output plain text, not streaming

**User Experience:**
- Commands print static output
- No interactivity beyond readline
- No visual components
- No real-time updates

### Target State ✅

**package.json Dependencies:**
- ✅ chalk: ^5.3.0 (upgrade)
- ✅ ink: ^4.4.1
- ✅ ink-select-input: ^5.0.0
- ✅ ink-spinner: ^5.0.0
- ✅ ink-text-input: ^5.0.0
- ✅ react: ^18.2.0
- ✅ eventsource: ^2.0.2 (for SSE)

**Implementation:**
- ✅ Chalk streaming for LLM responses
- ✅ Ink interactive components (sessions, themes, artifacts, config)
- ✅ Event-driven mode switching
- ✅ Clean state transitions

**User Experience:**
- Character-by-character streaming for AI responses
- Tool execution shown in real-time
- Interactive menus with keyboard navigation
- Visual dashboards and browsers
- Smooth transitions between modes

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│           CLI Main Process                      │
│  ┌───────────────────────────────────────────┐  │
│  │  Commander.js - Command Parser            │  │
│  └───────────────┬───────────────────────────┘  │
│                  │                               │
│                  ▼                               │
│  ┌───────────────────────────────────────────┐  │
│  │  Mode Router                              │  │
│  │  • Streaming mode (Chalk)                 │  │
│  │  • Interactive mode (Ink)                 │  │
│  │  • Detects which to use                   │  │
│  └───┬────────────────────────────┬──────────┘  │
│      │                            │              │
│      ▼                            ▼              │
│  ┌────────────────┐    ┌──────────────────────┐ │
│  │ Chalk Streaming│    │ Ink Interactive      │ │
│  │                │    │                      │ │
│  │ • Chat output  │    │ • Session browser   │ │
│  │ • Tool display │    │ • Theme picker      │ │
│  │ • Status msgs  │    │ • Artifact viewer   │ │
│  │ • Progress bar │    │ • Config wizard     │ │
│  └────────────────┘    └──────────────────────┘ │
└─────────────────────────────────────────────────┘
```

---

## Implementation Steps

### Step 1: Install Dependencies

```bash
cd /home/runner/workspace/nexus-cortex/packages/cli

# Upgrade chalk to v5
npm install chalk@5.3.0

# Install Ink ecosystem
npm install ink@4.4.1
npm install ink-select-input@5.0.0
npm install ink-spinner@5.0.0
npm install ink-text-input@5.0.0
npm install react@18.2.0

# Install SSE client for streaming
npm install eventsource@2.0.2

# Install additional UI helpers
npm install ink-box@3.0.0  # For boxes/panels
npm install ink-table@3.1.0  # For tables
npm install ink-gradient@3.0.0  # For gradient text
```

### Step 2: Create UI Components Directory

```bash
mkdir -p src/ui
mkdir -p src/ui/components
mkdir -p src/ui/hooks
mkdir -p src/ui/utils
```

**Directory Structure:**
```
src/ui/
├── components/
│   ├── SessionBrowser.tsx      # Interactive session list
│   ├── ThemePicker.tsx          # Theme selector with preview
│   ├── ArtifactDashboard.tsx    # Artifact viewer/manager
│   ├── ConfigWizard.tsx         # Configuration form
│   ├── ProgressBar.tsx          # Progress indicator
│   ├── ToolExecutionView.tsx    # Tool execution display
│   └── StreamingOutput.tsx      # Chalk-based streaming wrapper
├── hooks/
│   ├── useKeyboard.ts           # Keyboard navigation
│   ├── useTheme.ts              # Theme context
│   └── useState.ts              # Component state helpers
├── utils/
│   ├── modeSwitch.ts            # Mode switching logic
│   └── eventBus.ts              # Event communication
└── index.ts                     # Export all components
```

### Step 3: Implement Core Components

#### 3.1: SessionBrowser Component

**File:** `src/ui/components/SessionBrowser.tsx`

```typescript
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import Spinner from 'ink-spinner';
import { CortexClient } from '../../client/CortexClient.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

interface Session {
  id: string;
  created: string;
  model: string;
  messageCount: number;
  lastActivity: string;
}

interface Props {
  serverUrl: string;
  onSelect: (session: Session) => void;
  onExit: () => void;
}

export const SessionBrowser: React.FC<Props> = ({ serverUrl, onSelect, onExit }) => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const theme = ThemeManager.getTheme();

  useEffect(() => {
    const client = new CortexClient(serverUrl);
    client.get('/sessions')
      .then((data) => {
        setSessions(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [serverUrl]);

  if (loading) {
    return (
      <Box>
        <Text>
          <Spinner type="dots" /> Loading sessions...
        </Text>
      </Box>
    );
  }

  const items = sessions.map((session) => ({
    label: `${session.id.slice(0, 8)} - ${session.model} (${session.messageCount} messages)`,
    value: session,
  }));

  items.push({ label: 'Exit', value: null as any });

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">📋 Session Browser</Text>
      <Text color="gray">Use ↑/↓ to navigate, Enter to select, Esc to exit</Text>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          onSelect={(item) => {
            if (item.value === null) {
              onExit();
            } else {
              onSelect(item.value);
            }
          }}
        />
      </Box>
    </Box>
  );
};
```

#### 3.2: ThemePicker Component

**File:** `src/ui/components/ThemePicker.tsx`

```typescript
import React, { useState } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { DefaultTheme } from '../../themes/DefaultTheme.js';
import { MinimalTheme } from '../../themes/MinimalTheme.js';

interface Props {
  onSelect: (themeName: string) => void;
  onExit: () => void;
}

export const ThemePicker: React.FC<Props> = ({ onSelect, onExit }) => {
  const currentTheme = ThemeManager.getTheme();
  const [selectedTheme, setSelectedTheme] = useState(currentTheme.name);

  const themes = [
    { label: '🎨 Default (Colorful)', value: 'default', theme: DefaultTheme },
    { label: '⚪ Minimal (Plain)', value: 'minimal', theme: MinimalTheme },
    { label: 'Exit', value: 'exit', theme: null as any },
  ];

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">🎨 Theme Selector</Text>
      <Text color="gray">Preview themes and select one</Text>

      <Box marginTop={1} flexDirection="column">
        <SelectInput
          items={themes}
          onSelect={(item) => {
            if (item.value === 'exit') {
              onExit();
            } else {
              setSelectedTheme(item.value);
              onSelect(item.value);
            }
          }}
        />
      </Box>

      {selectedTheme !== 'exit' && (
        <Box marginTop={1} flexDirection="column" borderStyle="round" paddingX={1}>
          <Text>Preview:</Text>
          <Text color="cyan">Primary text (headers)</Text>
          <Text color="green">Success messages</Text>
          <Text color="red">Error messages</Text>
          <Text color="yellow">Warnings</Text>
          <Text color="gray">Muted text</Text>
        </Box>
      )}
    </Box>
  );
};
```

#### 3.3: ArtifactDashboard Component

**File:** `src/ui/components/ArtifactDashboard.tsx`

```typescript
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import Spinner from 'ink-spinner';
import { CortexClient } from '../../client/CortexClient.js';

interface Artifact {
  id: string;
  title: string;
  type: string;
  status: 'running' | 'stopped' | 'error';
  url?: string;
  created: string;
}

interface Props {
  serverUrl: string;
  onSelect: (artifact: Artifact) => void;
  onExit: () => void;
}

export const ArtifactDashboard: React.FC<Props> = ({ serverUrl, onSelect, onExit }) => {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Note: This would use natural language via POST /v1/messages
    // with ListArtifacts tool, but for demo purposes:
    const client = new CortexClient(serverUrl);
    client.post('/v1/messages', {
      messages: [{ role: 'user', content: 'list all artifacts' }],
      tools: [],  // Auto-enable tools
    })
      .then((response: any) => {
        // Parse tool_use response to get artifacts
        // Simplified for example:
        setArtifacts(response.artifacts || []);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [serverUrl]);

  if (loading) {
    return (
      <Box>
        <Text>
          <Spinner type="dots" /> Loading artifacts...
        </Text>
      </Box>
    );
  }

  const items = artifacts.map((artifact) => {
    const statusIcon = artifact.status === 'running' ? '🟢' :
                       artifact.status === 'stopped' ? '⚪' : '🔴';
    return {
      label: `${statusIcon} ${artifact.title} (${artifact.type})`,
      value: artifact,
    };
  });

  items.push({ label: 'Exit', value: null as any });

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">🎨 Artifact Dashboard</Text>
      <Text color="gray">Select an artifact to interact with</Text>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          onSelect={(item) => {
            if (item.value === null) {
              onExit();
            } else {
              onSelect(item.value);
            }
          }}
        />
      </Box>

      {artifacts.length === 0 && (
        <Box marginTop={1}>
          <Text color="gray">No artifacts found. Create one by chatting!</Text>
        </Box>
      )}
    </Box>
  );
};
```

#### 3.4: ConfigWizard Component

**File:** `src/ui/components/ConfigWizard.tsx`

```typescript
import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import { ConfigManager } from '../../config/ConfigManager.js';

interface Props {
  onComplete: () => void;
  onExit: () => void;
}

type Step = 'serverUrl' | 'theme' | 'defaultModel' | 'confirm';

export const ConfigWizard: React.FC<Props> = ({ onComplete, onExit }) => {
  const [step, setStep] = useState<Step>('serverUrl');
  const [serverUrl, setServerUrl] = useState('http://localhost:4000');
  const [theme, setTheme] = useState('default');
  const [defaultModel, setDefaultModel] = useState('claude-sonnet-4');

  const handleServerUrlSubmit = (value: string) => {
    setServerUrl(value);
    setStep('theme');
  };

  const handleThemeSelect = (item: any) => {
    setTheme(item.value);
    setStep('defaultModel');
  };

  const handleModelSubmit = (value: string) => {
    setDefaultModel(value);
    setStep('confirm');
  };

  const handleConfirm = async (item: any) => {
    if (item.value === 'save') {
      await ConfigManager.set('serverUrl', serverUrl);
      await ConfigManager.set('theme', theme);
      await ConfigManager.set('defaultModel', defaultModel);
      onComplete();
    } else {
      onExit();
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">⚙️  Configuration Wizard</Text>
      <Box marginTop={1} flexDirection="column">
        {step === 'serverUrl' && (
          <>
            <Text>Server URL:</Text>
            <TextInput
              value={serverUrl}
              onChange={setServerUrl}
              onSubmit={handleServerUrlSubmit}
            />
          </>
        )}

        {step === 'theme' && (
          <>
            <Text>Select Theme:</Text>
            <SelectInput
              items={[
                { label: 'Default (Colorful)', value: 'default' },
                { label: 'Minimal (Plain)', value: 'minimal' },
              ]}
              onSelect={handleThemeSelect}
            />
          </>
        )}

        {step === 'defaultModel' && (
          <>
            <Text>Default Model:</Text>
            <TextInput
              value={defaultModel}
              onChange={setDefaultModel}
              onSubmit={handleModelSubmit}
            />
            <Text color="gray">
              Examples: claude-sonnet-4, gpt-4o, gemini-pro
            </Text>
          </>
        )}

        {step === 'confirm' && (
          <>
            <Text bold>Review Configuration:</Text>
            <Box marginTop={1} flexDirection="column">
              <Text>Server URL: <Text color="cyan">{serverUrl}</Text></Text>
              <Text>Theme: <Text color="cyan">{theme}</Text></Text>
              <Text>Default Model: <Text color="cyan">{defaultModel}</Text></Text>
            </Box>
            <Box marginTop={1}>
              <SelectInput
                items={[
                  { label: 'Save', value: 'save' },
                  { label: 'Cancel', value: 'cancel' },
                ]}
                onSelect={handleConfirm}
              />
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
};
```

### Step 4: Implement Streaming Output

#### 4.1: Chat Command with Streaming

**File:** `src/commands/chat/interactive.ts`

```typescript
import EventSource from 'eventsource';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { CortexClient } from '../../client/CortexClient.js';
import readline from 'readline';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export async function chatInteractive(options: any = {}): Promise<void> {
  const serverUrl = options.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  const messages: Message[] = [];

  console.log(theme.colors.primary('\n🤖 Cortex Chat (Interactive Mode)\n'));
  console.log(theme.colors.muted('Type your message and press Enter. Type "exit" to quit.\n'));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: theme.colors.highlight('You: '),
  });

  rl.prompt();

  rl.on('line', async (input: string) => {
    const userInput = input.trim();

    if (userInput.toLowerCase() === 'exit') {
      console.log(theme.colors.success('\nGoodbye!\n'));
      rl.close();
      process.exit(0);
      return;
    }

    if (!userInput) {
      rl.prompt();
      return;
    }

    // Add user message
    messages.push({ role: 'user', content: userInput });

    // Stream AI response
    console.log(theme.colors.secondary('\nAssistant: '));

    try {
      // Use SSE streaming
      const url = `${serverUrl}/v1/messages`;
      const eventSource = new EventSource(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages,
          tools: [],  // Enable all tools
          stream: true,
        }),
      } as any);

      let assistantMessage = '';

      eventSource.on('message', (event: any) => {
        const data = JSON.parse(event.data);

        if (data.type === 'content_block_delta') {
          // Stream character by character
          const text = data.delta?.text || '';
          process.stdout.write(theme.colors.primary(text));
          assistantMessage += text;
        }

        if (data.type === 'tool_use') {
          // Show tool execution
          console.log(theme.colors.info(`\n\n🔧 Using tool: ${data.name}`));
        }

        if (data.type === 'tool_result') {
          // Show tool result
          console.log(theme.colors.success(`✓ Tool completed\n`));
        }

        if (data.type === 'message_stop') {
          eventSource.close();
          messages.push({ role: 'assistant', content: assistantMessage });
          console.log('\n');
          rl.prompt();
        }

        if (data.type === 'error') {
          eventSource.close();
          console.error(theme.colors.error(`\nError: ${data.error.message}\n`));
          rl.prompt();
        }
      });

      eventSource.on('error', () => {
        eventSource.close();
        console.error(theme.colors.error('\nConnection error\n'));
        rl.prompt();
      });
    } catch (error: any) {
      console.error(theme.colors.error(`Error: ${error.message}\n`));
      rl.prompt();
    }
  });

  rl.on('close', () => {
    console.log(theme.colors.success('\nGoodbye!\n'));
    process.exit(0);
  });
}
```

### Step 5: Implement Mode Switching

#### 5.1: Mode Switch Utility

**File:** `src/ui/utils/modeSwitch.ts`

```typescript
import { render, RenderOptions } from 'ink';
import React from 'react';

/**
 * Switch from Chalk streaming mode to Ink interactive mode
 */
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

/**
 * Switch from Ink interactive mode back to Chalk streaming mode
 */
export function switchToStreaming(): void {
  // Clean up Ink rendering
  // Terminal is now ready for Chalk output
}
```

#### 5.2: Enhanced Commands with Mode Switching

**File:** `src/commands/sessions/list.ts`

```typescript
import { switchToInteractive } from '../../ui/utils/modeSwitch.js';
import { SessionBrowser } from '../../ui/components/SessionBrowser.js';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { CortexClient } from '../../client/CortexClient.js';

interface SessionListOptions {
  serverUrl?: string;
  json?: boolean;
  interactive?: boolean;  // NEW: launch Ink UI
}

export async function sessionsList(options: SessionListOptions = {}): Promise<void> {
  const serverUrl = options.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  // If interactive mode requested, launch Ink UI
  if (options.interactive) {
    const selectedSession = await switchToInteractive(SessionBrowser, {
      serverUrl,
      onSelect: (session: any) => session,
    });

    if (selectedSession) {
      console.log(theme.colors.success(`\nSelected session: ${selectedSession.id}\n`));
      // Could auto-launch session view or resume
    }
    return;
  }

  // Otherwise, use Chalk output (existing implementation)
  try {
    const sessions = await client.get('/sessions');

    if (options.json) {
      console.log(JSON.stringify(sessions, null, 2));
      return;
    }

    // Formatted output with theme
    console.log(theme.colors.primary(`\n📋 Sessions (${sessions.length})\n`));
    sessions.forEach((session: any) => {
      console.log(theme.colors.highlight(session.id));
      console.log(theme.colors.muted(`  Model: ${session.model}`));
      console.log(theme.colors.muted(`  Messages: ${session.messageCount}`));
      console.log(theme.colors.muted(`  Created: ${session.created}\n`));
    });
  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
```

**Usage:**
```bash
# Chalk output (current)
cortex sessions list

# Ink interactive browser (new)
cortex sessions list --interactive
# or shorthand:
cortex sessions
```

### Step 6: Update index.ts to Register Interactive Commands

```typescript
// Add interactive flags to existing commands
const sessions = program.command('sessions').description('Session management');

sessions
  .command('list')
  .description('List all sessions')
  .option('-i, --interactive', 'Launch interactive browser')
  .action(async () => {
    const globalOpts = program.opts();
    const cmdOpts = sessions.opts();
    await sessionsList({
      serverUrl: globalOpts.server,
      json: globalOpts.json,
      interactive: cmdOpts.interactive,
    });
  });

// Add standalone interactive commands
program
  .command('sessions')
  .description('Interactive session browser')
  .action(async () => {
    const globalOpts = program.opts();
    await sessionsList({
      serverUrl: globalOpts.server,
      interactive: true,  // Always interactive
    });
  });

program
  .command('themes')
  .description('Interactive theme picker')
  .action(async () => {
    const theme = await switchToInteractive(ThemePicker, {});
    console.log(`Theme changed to: ${theme}`);
  });

program
  .command('artifacts')
  .description('Interactive artifact dashboard')
  .action(async () => {
    const globalOpts = program.opts();
    await switchToInteractive(ArtifactDashboard, {
      serverUrl: globalOpts.server,
    });
  });

program
  .command('config-wizard')
  .description('Interactive configuration wizard')
  .action(async () => {
    await switchToInteractive(ConfigWizard, {});
    console.log('Configuration saved!');
  });
```

---

## Testing the Implementation

### Test 1: Streaming Chat
```bash
npm run build
cortex chat
> "hello, enable the postgres MCP server"
# Should see character-by-character streaming
# Should see tool execution: "🔧 Using tool: EnableMcpServer"
# Should see tool result: "✓ Tool completed"
```

### Test 2: Interactive Session Browser
```bash
cortex sessions
# Should launch Ink UI
# Should show list of sessions
# Should allow keyboard navigation (↑/↓)
# Should select on Enter
```

### Test 3: Theme Picker
```bash
cortex themes
# Should launch Ink UI
# Should show theme options
# Should preview selected theme
# Should save on selection
```

### Test 4: Mode Switching
```bash
cortex chat
> "/sessions"  # Trigger interactive mode from chat
# Should switch to Ink SessionBrowser
# Should return to chat after selection
```

---

## Performance Considerations

### Lazy Loading Ink

```typescript
// Only import Ink when needed
export async function launchInteractive() {
  const { render } = await import('ink');
  const { SessionBrowser } = await import('./ui/components/SessionBrowser.js');
  // ... rest of code
}
```

**Benefits:**
- Fast startup time (~50ms base)
- Low memory footprint (30MB base)
- Ink only loaded when interactive mode used
- Keeps CLI responsive

### Bundle Size

**Before (Chalk only):**
- Dependencies: ~200KB
- No React/Ink

**After (Hybrid):**
- Chalk: ~200KB
- Ink + React: ~2.5MB (lazy loaded)
- Total bundle: ~2.7MB
- Base CLI: Still ~200KB (Ink not loaded until needed)

---

## Reference Files

**Working Demos in `themes/` directory:**
- `hybrid-implementation.cjs` - Complete hybrid demo
- `hybrid-sse-client.cjs` - SSE streaming client
- `chalk/chalk-themes.cjs` - Theme library (13 themes)
- `ink/ink-theme-interactive.jsx` - Interactive menu example

**Study these files for implementation patterns!**

---

## Migration Checklist

### Phase 1: Foundation
- [ ] Install dependencies (Ink, React, eventsource)
- [ ] Create `src/ui/` directory structure
- [ ] Copy theme library from `themes/chalk/`
- [ ] Set up TypeScript for JSX/TSX

### Phase 2: Core Components
- [ ] Implement SessionBrowser component
- [ ] Implement ThemePicker component
- [ ] Implement ArtifactDashboard component
- [ ] Implement ConfigWizard component

### Phase 3: Streaming
- [ ] Implement SSE streaming for chat
- [ ] Add tool execution display
- [ ] Add progress indicators
- [ ] Enhance with Chalk themes

### Phase 4: Mode Switching
- [ ] Implement mode switch utility
- [ ] Add interactive flags to commands
- [ ] Create standalone interactive commands
- [ ] Test transitions

### Phase 5: Polish
- [ ] Add keyboard shortcuts
- [ ] Add help overlays
- [ ] Improve error handling
- [ ] Add loading states
- [ ] Performance optimization

---

## Timeline Estimate

**Week 1: Foundation**
- Day 1-2: Install deps, set up structure
- Day 3-4: Implement SessionBrowser
- Day 5: Testing and refinement

**Week 2: Interactivity**
- Day 1-2: Implement ThemePicker
- Day 3-4: Implement ArtifactDashboard
- Day 5: Implement ConfigWizard

**Week 3: Streaming**
- Day 1-3: SSE streaming for chat
- Day 4-5: Tool execution display

**Week 4: Integration**
- Day 1-2: Mode switching
- Day 3-4: Polish and testing
- Day 5: Documentation

**Total: 4 weeks for complete hybrid UI implementation**

---

## Success Criteria

✅ Chat command streams character-by-character with Chalk
✅ Tool execution shown in real-time
✅ Interactive session browser (Ink) works smoothly
✅ Theme picker allows live preview and selection
✅ Artifact dashboard provides visual management
✅ Config wizard guides setup interactively
✅ Mode switching is seamless (no visual glitches)
✅ Performance: <100ms startup, <50ms for mode switch
✅ Bundle size optimized (lazy loading)
✅ All existing tests still pass

---

## Next Steps

1. Review this plan with team
2. Approve implementation approach
3. Begin Phase 1 (Foundation)
4. Iterate based on user feedback
5. Complete full hybrid UI in 4 weeks

**Status:** Ready to implement
**Outcome:** Production-ready hybrid Chalk + Ink CLI
