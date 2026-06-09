# Phase 3: Interactive Components (Ink React UI)

**Date Started**: 2025-11-16
**Status**: 🚧 In Progress
**Duration**: Weeks 5-6 (estimated)

---

## Overview

Phase 3 focuses on implementing **10 Ink React components** for interactive terminal UIs. These components will provide rich, user-friendly interfaces for complex operations that are difficult to express via command-line arguments.

**Architecture**: Hybrid Chalk (streaming) + Ink (interactive)
- **Chalk**: Used for streaming chat responses, tool execution, and simple output
- **Ink**: Used for interactive browsing, selection, and configuration UIs

---

## Dependencies Installed

✅ Installed (2025-11-16):
- `ink` - React for terminal UIs
- `ink-select-input` - Selection component
- `ink-spinner` - Loading spinners
- `react` - Core React library

---

## Components to Implement

### Priority 1 (Core Functionality)

#### 1. ✅ SessionBrowser
**File**: `src/ui/components/SessionBrowser.tsx`

**Purpose**: Browse and select from available chat sessions

**Features**:
- List all sessions with metadata (model, message count, created date)
- Keyboard navigation (↑/↓ arrows)
- Search/filter capabilities
- Displays session preview

**API**: `GET /sessions`

#### 2. ✅ ModelPicker
**File**: `src/ui/components/ModelPicker.tsx`

**Purpose**: Select AI model with provider grouping

**Features**:
- Two-level selection (provider → model)
- Shows context window and pricing
- Groups models by provider (Anthropic, OpenAI, Google, etc.)
- Highlights currently selected model

**API**: `GET /models`

#### 3. ✅ ThemePicker
**File**: `src/ui/components/ThemePicker.tsx`

**Purpose**: Select visual theme with live preview

**Features**:
- Lists all 13 available themes
- Live preview of colors as you navigate
- Shows current theme
- Saves selection to config

**API**: Local (ThemeManager)

---

### Priority 2 (Management Tools)

#### 4. ConfigWizard
**File**: `src/ui/components/ConfigWizard.tsx`

**Purpose**: Interactive configuration setup

**Features**:
- Step-by-step configuration
- API key entry with validation
- Provider setup
- Default model selection

**API**: `GET /config`, `POST /config`

#### 5. PermissionsBrowser
**File**: `src/ui/components/PermissionsBrowser.tsx`

**Purpose**: Manage tool permissions

**Features**:
- List all available tools
- Show granted/denied status
- Toggle permissions interactively
- Bulk operations (grant all, revoke all)

**API**: `GET /permissions/tools`, `POST /permissions/tool/:name`

---

### Priority 3 (Advanced Features)

#### 6. ArtifactDashboard
**File**: `src/ui/components/ArtifactDashboard.tsx`

**Purpose**: View and manage running artifacts

**Features**:
- List all artifacts (running, stopped)
- Show artifact details (type, port, status)
- Actions: stop, restart, view, inspect
- Real-time status updates

**API**: `GET /artifacts`

#### 7. MiddlewareDashboard
**File**: `src/ui/components/MiddlewareDashboard.tsx`

**Purpose**: View and configure middleware systems

**Features**:
- List all middleware (retry, permissions, etc.)
- Show enabled/disabled status
- View configuration per middleware
- Toggle middleware on/off

**API**: `GET /middleware/config`, `POST /middleware/:name/enable`

#### 8. ContextViewer
**File**: `src/ui/components/ContextViewer.tsx`

**Purpose**: View context budget and compaction history

**Features**:
- Shows current token usage vs budget
- Displays compaction boundaries
- Shows token savings from compaction
- Visual progress bar for budget

**API**: `GET /sessions/:id/context`, `GET /sessions/:id/compaction/boundaries`

---

### Priority 4 (Optional Enhancements)

#### 9. TmuxBrowser
**File**: `src/ui/components/TmuxBrowser.tsx`

**Purpose**: Browse and manage tmux sessions

**Features**:
- List all tmux sessions
- Show session details
- Attach to session
- Kill sessions

**API**: `GET /tmux`

#### 10. SystemMessageBrowser
**File**: `src/ui/components/SystemMessageBrowser.tsx`

**Purpose**: Browse and view system messages

**Features**:
- List all system messages
- Show message previews
- Full message view
- Apply to current session

**API**: `GET /system-messages`, `GET /system-messages/:id`

---

## Implementation Strategy

### Phase 3A: Foundation (Priority 1 - Days 1-2)
1. Create component directory structure
2. Implement SessionBrowser
3. Implement ModelPicker
4. Implement ThemePicker

### Phase 3B: Management (Priority 2 - Days 3-4)
1. Implement ConfigWizard
2. Implement PermissionsBrowser

### Phase 3C: Advanced (Priority 3 - Days 5-6)
1. Implement ArtifactDashboard
2. Implement MiddlewareDashboard
3. Implement ContextViewer

### Phase 3D: Optional (Priority 4 - Day 7)
1. Implement remaining components if time allows

---

## Integration Points

### Command Integration

Each component will be accessible via:

1. **Standalone Command**:
```bash
cortex ui sessions    # Launch SessionBrowser
cortex ui models      # Launch ModelPicker
cortex ui themes      # Launch ThemePicker
cortex ui config      # Launch ConfigWizard
cortex ui permissions # Launch PermissionsBrowser
cortex ui artifacts   # Launch ArtifactDashboard
cortex ui middleware  # Launch MiddlewareDashboard
cortex ui context     # Launch ContextViewer
```

2. **Interactive Chat Shortcuts**:
```
/ui sessions
/ui models
/ui themes
/ui config
```

---

## Testing Checklist

### Per Component
- [ ] Component renders without errors
- [ ] Keyboard navigation works (↑/↓, Enter, Esc)
- [ ] API calls succeed
- [ ] Loading states display properly
- [ ] Error states handle gracefully
- [ ] Selection callback works
- [ ] Exit/cancel works

### Integration
- [ ] Components integrate with interactive chat
- [ ] Theme system applies to components
- [ ] Server communication works
- [ ] User can launch components from commands

---

## Success Criteria

1. **User Experience**:
   - All 10 components render correctly
   - Smooth keyboard navigation
   - Clear visual feedback

2. **Functionality**:
   - All API integrations work
   - Components update based on server state
   - Actions (select, toggle, configure) persist

3. **Code Quality**:
   - TypeScript types for all components
   - Proper error handling
   - Reusable component patterns

---

## Files to Create

**Components** (~100 lines each):
- `src/ui/components/SessionBrowser.tsx`
- `src/ui/components/ModelPicker.tsx`
- `src/ui/components/ThemePicker.tsx`
- `src/ui/components/ConfigWizard.tsx`
- `src/ui/components/PermissionsBrowser.tsx`
- `src/ui/components/ArtifactDashboard.tsx`
- `src/ui/components/MiddlewareDashboard.tsx`
- `src/ui/components/ContextViewer.tsx`
- `src/ui/components/TmuxBrowser.tsx`
- `src/ui/components/SystemMessageBrowser.tsx`

**Commands** (~50 lines each):
- `src/commands/ui/sessions.ts`
- `src/commands/ui/models.ts`
- `src/commands/ui/themes.ts`
- `src/commands/ui/config.ts`
- `src/commands/ui/permissions.ts`
- `src/commands/ui/artifacts.ts`
- `src/commands/ui/middleware.ts`
- `src/commands/ui/context.ts`

**Total New Code**: ~1,500 lines

---

## Current Status

✅ **Completed**:
- Dependencies installed (ink, ink-select-input, ink-spinner, react)
- Component directory structure created

⏳ **In Progress**:
- Implementing Priority 1 components

🔜 **Upcoming**:
- Priority 2-4 components
- Command integration
- Testing and documentation

---

**Next Session**: Implement SessionBrowser, ModelPicker, and ThemePicker components
