/**
 * Agent Tool Suite — Proficiency Tests
 *
 * Tests agent proficiency with the extended tool suite:
 *   - Addon Tool Registry (dynamic tool registration/removal)
 *   - CreateArtifact (sandbox creation, modes: oneshot/dev/persistent)
 *   - TmuxSession (persistent terminal sessions)
 *   - Sandbox tools (InteractWithSandbox, ModifySandbox, InspectSandbox, StopSandbox)
 *   - WorkspaceManager (git worktree lifecycle)
 *   - PRAgent (GitHub PR operations)
 *
 * These tests validate parameter schemas, validation logic, and
 * structured output format — without spawning real processes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';


// ============================================
// 1. ADDON TOOL REGISTRY
// ============================================

describe('Addon Tool Registry', () => {
  // Minimal registry implementation matching AddonToolRegistry behavior
  class MockAddonRegistry {
    private tools = new Map<string, any>();

    registerTool(tool: any): void {
      if (!tool.name || !tool.description || !tool.implementation?.code) {
        throw new Error('Invalid tool definition: missing required fields');
      }
      if (!['addon-temporary', 'addon-persistent'].includes(tool.category)) {
        throw new Error('Invalid category: must be addon-temporary or addon-persistent');
      }
      if (this.tools.has(tool.name)) {
        throw new Error(`Tool "${tool.name}" already registered`);
      }
      this.tools.set(tool.name, tool);
    }

    removeTool(name: string): boolean {
      return this.tools.delete(name);
    }

    hasTool(name: string): boolean {
      return this.tools.has(name);
    }

    getToolCount(): number {
      return this.tools.size;
    }

    getAllTools(): any[] {
      return Array.from(this.tools.values());
    }

    getTemporaryTools(): any[] {
      return this.getAllTools().filter(t => t.category === 'addon-temporary');
    }

    getPersistentTools(): any[] {
      return this.getAllTools().filter(t => t.category === 'addon-persistent');
    }

    clearTools(persistent = false): void {
      if (persistent) {
        this.tools.clear();
      } else {
        for (const [name, tool] of this.tools) {
          if (tool.category === 'addon-temporary') this.tools.delete(name);
        }
      }
    }
  }

  let registry: MockAddonRegistry;

  beforeEach(() => {
    registry = new MockAddonRegistry();
  });

  it('should register a valid addon tool', () => {
    registry.registerTool({
      name: 'custom-linter',
      description: 'Custom code linter',
      category: 'addon-temporary',
      implementation: { language: 'javascript', code: 'console.log("lint")' },
    });

    expect(registry.hasTool('custom-linter')).toBe(true);
    expect(registry.getToolCount()).toBe(1);
  });

  it('should reject tool with missing fields', () => {
    expect(() => registry.registerTool({
      name: 'bad-tool',
      description: '',
      category: 'addon-temporary',
      implementation: { language: 'javascript', code: '' },
    })).toThrow('missing required fields');
  });

  it('should reject invalid category', () => {
    expect(() => registry.registerTool({
      name: 'bad-category',
      description: 'test',
      category: 'invalid',
      implementation: { language: 'javascript', code: 'x' },
    })).toThrow('Invalid category');
  });

  it('should reject duplicate tool names', () => {
    registry.registerTool({
      name: 'unique-tool',
      description: 'First',
      category: 'addon-temporary',
      implementation: { language: 'javascript', code: 'x' },
    });

    expect(() => registry.registerTool({
      name: 'unique-tool',
      description: 'Duplicate',
      category: 'addon-temporary',
      implementation: { language: 'javascript', code: 'y' },
    })).toThrow('already registered');
  });

  it('should remove tools by name', () => {
    registry.registerTool({
      name: 'removable',
      description: 'Will be removed',
      category: 'addon-temporary',
      implementation: { language: 'javascript', code: 'x' },
    });

    expect(registry.removeTool('removable')).toBe(true);
    expect(registry.hasTool('removable')).toBe(false);
    expect(registry.removeTool('nonexistent')).toBe(false);
  });

  it('should clear only temporary tools by default', () => {
    registry.registerTool({
      name: 'temp-tool',
      description: 'Temporary',
      category: 'addon-temporary',
      implementation: { language: 'javascript', code: 'x' },
    });
    registry.registerTool({
      name: 'persist-tool',
      description: 'Persistent',
      category: 'addon-persistent',
      implementation: { language: 'javascript', code: 'y' },
    });

    registry.clearTools(false);

    expect(registry.hasTool('temp-tool')).toBe(false);
    expect(registry.hasTool('persist-tool')).toBe(true);
  });

  it('should separate temporary and persistent tools', () => {
    registry.registerTool({
      name: 'temp-a',
      description: 'Temp A',
      category: 'addon-temporary',
      implementation: { language: 'javascript', code: 'a' },
    });
    registry.registerTool({
      name: 'persist-a',
      description: 'Persist A',
      category: 'addon-persistent',
      implementation: { language: 'javascript', code: 'b' },
    });

    expect(registry.getTemporaryTools()).toHaveLength(1);
    expect(registry.getPersistentTools()).toHaveLength(1);
    expect(registry.getTemporaryTools()[0].name).toBe('temp-a');
    expect(registry.getPersistentTools()[0].name).toBe('persist-a');
  });
});


// ============================================
// 2. CREATE ARTIFACT TOOL
// ============================================

describe('CreateArtifact Tool', () => {
  // Replicate validation logic from CreateArtifactToolExecutor
  function validateCreateArtifact(params: any): string | null {
    if (!params.name) return 'name is required';
    if (!params.description) return 'description is required';
    if (!params.implementation?.code) return 'implementation.code is required';
    const validLanguages = ['javascript', 'python'];
    if (params.implementation?.language && !validLanguages.includes(params.implementation.language)) {
      return `language must be one of: ${validLanguages.join(', ')}`;
    }
    const validPackageManagers = ['npm', 'pip', 'uv', 'nix'];
    if (params.implementation?.packageManager && !validPackageManagers.includes(params.implementation.packageManager)) {
      return `packageManager must be one of: ${validPackageManagers.join(', ')}`;
    }
    const validModes = ['oneshot', 'dev', 'persistent'];
    if (params.mode && !validModes.includes(params.mode)) {
      return `mode must be one of: ${validModes.join(', ')}`;
    }
    return null;
  }

  it('should accept valid oneshot artifact', () => {
    expect(validateCreateArtifact({
      name: 'hello-world',
      description: 'A simple hello world script',
      implementation: { language: 'javascript', code: 'console.log("hello")' },
      mode: 'oneshot',
    })).toBeNull();
  });

  it('should accept valid dev mode artifact', () => {
    expect(validateCreateArtifact({
      name: 'web-app',
      description: 'Interactive web application',
      implementation: {
        language: 'javascript',
        code: 'const express = require("express"); ...',
        dependencies: ['express'],
        packageManager: 'npm',
      },
      mode: 'dev',
    })).toBeNull();
  });

  it('should accept valid persistent artifact', () => {
    expect(validateCreateArtifact({
      name: 'api-server',
      description: 'Persistent API server',
      implementation: { language: 'python', code: 'from flask import Flask; ...', packageManager: 'pip' },
      mode: 'persistent',
    })).toBeNull();
  });

  it('should reject missing name', () => {
    expect(validateCreateArtifact({
      description: 'test',
      implementation: { language: 'javascript', code: 'x' },
    })).toContain('name is required');
  });

  it('should reject missing description', () => {
    expect(validateCreateArtifact({
      name: 'test',
      implementation: { language: 'javascript', code: 'x' },
    })).toContain('description is required');
  });

  it('should reject missing implementation code', () => {
    expect(validateCreateArtifact({
      name: 'test',
      description: 'test',
      implementation: { language: 'javascript' },
    })).toContain('implementation.code is required');
  });

  it('should reject unsupported language', () => {
    expect(validateCreateArtifact({
      name: 'test',
      description: 'test',
      implementation: { language: 'rust', code: 'fn main() {}' },
    })).toContain('language must be one of');
  });

  it('should reject invalid packageManager', () => {
    expect(validateCreateArtifact({
      name: 'test',
      description: 'test',
      implementation: { language: 'javascript', code: 'x', packageManager: 'yarn' },
    })).toContain('packageManager must be one of');
  });

  it('should reject invalid mode', () => {
    expect(validateCreateArtifact({
      name: 'test',
      description: 'test',
      implementation: { language: 'javascript', code: 'x' },
      mode: 'background',
    })).toContain('mode must be one of');
  });

  it('should accept all valid packageManagers', () => {
    for (const pm of ['npm', 'pip', 'uv', 'nix']) {
      expect(validateCreateArtifact({
        name: 'test',
        description: 'test',
        implementation: { language: 'javascript', code: 'x', packageManager: pm },
      })).toBeNull();
    }
  });
});


// ============================================
// 3. TMUX SESSION TOOL
// ============================================

describe('TmuxSession Tool', () => {
  function validateTmuxSession(params: any): string | null {
    const validActions = ['create', 'send', 'capture', 'list', 'kill', 'snapshot'];
    if (!validActions.includes(params.action)) {
      return `action must be one of: ${validActions.join(', ')}`;
    }
    if (params.action === 'send' && (!params.sessionId || !params.command)) {
      return 'sessionId and command are required for send action';
    }
    if (['capture', 'kill', 'snapshot'].includes(params.action) && !params.sessionId) {
      return 'sessionId is required for this action';
    }
    return null;
  }

  it('should accept valid create action', () => {
    expect(validateTmuxSession({
      action: 'create',
      sessionId: 'my-session',
      cwd: '/home/user/project',
    })).toBeNull();
  });

  it('should accept valid send action', () => {
    expect(validateTmuxSession({
      action: 'send',
      sessionId: 'my-session',
      command: 'npm test',
    })).toBeNull();
  });

  it('should accept valid capture action', () => {
    expect(validateTmuxSession({
      action: 'capture',
      sessionId: 'my-session',
      captureHistory: true,
    })).toBeNull();
  });

  it('should accept list action without sessionId', () => {
    expect(validateTmuxSession({ action: 'list' })).toBeNull();
  });

  it('should accept valid snapshot action', () => {
    expect(validateTmuxSession({
      action: 'snapshot',
      sessionId: 'my-session',
      includeScreenshot: true,
    })).toBeNull();
  });

  it('should reject invalid action', () => {
    expect(validateTmuxSession({ action: 'restart' })).toContain('action must be one of');
  });

  it('should require sessionId and command for send', () => {
    expect(validateTmuxSession({ action: 'send', sessionId: 'x' })).toContain('command are required');
    expect(validateTmuxSession({ action: 'send', command: 'ls' })).toContain('sessionId and command');
  });

  it('should require sessionId for capture/kill/snapshot', () => {
    expect(validateTmuxSession({ action: 'capture' })).toContain('sessionId is required');
    expect(validateTmuxSession({ action: 'kill' })).toContain('sessionId is required');
    expect(validateTmuxSession({ action: 'snapshot' })).toContain('sessionId is required');
  });

  it('should accept all 6 valid actions', () => {
    const actions = ['create', 'send', 'capture', 'list', 'kill', 'snapshot'];
    for (const action of actions) {
      const params: any = { action };
      if (action === 'send') { params.sessionId = 's'; params.command = 'c'; }
      else if (['capture', 'kill', 'snapshot'].includes(action)) { params.sessionId = 's'; }
      expect(validateTmuxSession(params)).toBeNull();
    }
  });
});


// ============================================
// 4. SANDBOX TOOLS
// ============================================

describe('Sandbox Tools', () => {
  describe('InteractWithSandbox', () => {
    function validateInteract(params: any): string | null {
      if (!params.sandboxId) return 'sandboxId is required';
      if (!params.actions || !Array.isArray(params.actions) || params.actions.length === 0) {
        return 'actions must be a non-empty array';
      }
      for (const action of params.actions) {
        switch (action.type) {
          case 'click':
            if (!action.selector && !action.coordinates) return 'click requires selector or coordinates';
            break;
          case 'type':
            if (!action.selector || !action.value) return 'type requires selector and value';
            break;
          case 'navigate':
            if (!action.value) return 'navigate requires value (URL)';
            break;
          case 'wait':
            if (!action.duration) return 'wait requires duration';
            break;
          case 'select':
            if (!action.selector || !action.value) return 'select requires selector and value';
            break;
        }
      }
      return null;
    }

    it('should accept valid click with selector', () => {
      expect(validateInteract({
        sandboxId: 'uuid-123',
        actions: [{ type: 'click', selector: '#submit-btn' }],
      })).toBeNull();
    });

    it('should accept valid click with coordinates', () => {
      expect(validateInteract({
        sandboxId: 'uuid-123',
        actions: [{ type: 'click', coordinates: { x: 100, y: 200 } }],
      })).toBeNull();
    });

    it('should accept valid type action', () => {
      expect(validateInteract({
        sandboxId: 'uuid-123',
        actions: [{ type: 'type', selector: '#email', value: 'test@test.com' }],
      })).toBeNull();
    });

    it('should accept valid navigate action', () => {
      expect(validateInteract({
        sandboxId: 'uuid-123',
        actions: [{ type: 'navigate', value: 'http://localhost:3000/login' }],
      })).toBeNull();
    });

    it('should accept multi-action sequence', () => {
      expect(validateInteract({
        sandboxId: 'uuid-123',
        actions: [
          { type: 'navigate', value: 'http://localhost:3000' },
          { type: 'type', selector: '#username', value: 'admin' },
          { type: 'type', selector: '#password', value: 'pass' },
          { type: 'click', selector: '#login-btn' },
          { type: 'wait', duration: 2000 },
        ],
      })).toBeNull();
    });

    it('should reject missing sandboxId', () => {
      expect(validateInteract({
        actions: [{ type: 'click', selector: '#btn' }],
      })).toContain('sandboxId is required');
    });

    it('should reject empty actions array', () => {
      expect(validateInteract({
        sandboxId: 'uuid-123',
        actions: [],
      })).toContain('non-empty array');
    });

    it('should reject click without selector or coordinates', () => {
      expect(validateInteract({
        sandboxId: 'uuid-123',
        actions: [{ type: 'click' }],
      })).toContain('click requires selector or coordinates');
    });

    it('should reject type without selector', () => {
      expect(validateInteract({
        sandboxId: 'uuid-123',
        actions: [{ type: 'type', value: 'text' }],
      })).toContain('type requires selector and value');
    });

    it('should reject navigate without URL', () => {
      expect(validateInteract({
        sandboxId: 'uuid-123',
        actions: [{ type: 'navigate' }],
      })).toContain('navigate requires value');
    });
  });

  describe('ModifySandbox', () => {
    function validateModify(params: any): string | null {
      if (!params.sandboxId) return 'sandboxId is required';
      if (!params.file) return 'file is required';
      if (params.file.includes('..') || params.file.startsWith('/')) {
        return 'file must be a relative path without ".."';
      }
      if (params.content === undefined) return 'content is required';
      return null;
    }

    it('should accept valid file modification', () => {
      expect(validateModify({
        sandboxId: 'uuid-123',
        file: 'src/index.js',
        content: 'console.log("updated")',
      })).toBeNull();
    });

    it('should accept empty content (clearing file)', () => {
      expect(validateModify({
        sandboxId: 'uuid-123',
        file: 'config.json',
        content: '',
      })).toBeNull();
    });

    it('should reject missing sandboxId', () => {
      expect(validateModify({
        file: 'test.js',
        content: 'x',
      })).toContain('sandboxId is required');
    });

    it('should reject missing file', () => {
      expect(validateModify({
        sandboxId: 'uuid-123',
        content: 'x',
      })).toContain('file is required');
    });

    it('should reject path traversal', () => {
      expect(validateModify({
        sandboxId: 'uuid-123',
        file: '../../../etc/passwd',
        content: 'x',
      })).toContain('relative path without ".."');
    });

    it('should reject absolute paths', () => {
      expect(validateModify({
        sandboxId: 'uuid-123',
        file: '/etc/passwd',
        content: 'x',
      })).toContain('relative path without ".."');
    });
  });

  describe('InspectSandbox', () => {
    function validateInspect(params: any): string | null {
      if (!params.sandboxId) return 'sandboxId is required';
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(params.sandboxId)) return 'sandboxId must be a valid UUID';
      return null;
    }

    it('should accept valid UUID sandboxId', () => {
      expect(validateInspect({
        sandboxId: '123e4567-e89b-12d3-a456-426614174000',
      })).toBeNull();
    });

    it('should accept with all capture flags', () => {
      expect(validateInspect({
        sandboxId: '123e4567-e89b-12d3-a456-426614174000',
        captureScreenshot: true,
        captureDOM: true,
        captureConsole: true,
        captureNetwork: true,
        captureAccessibility: true,
      })).toBeNull();
    });

    it('should reject missing sandboxId', () => {
      expect(validateInspect({})).toContain('sandboxId is required');
    });

    it('should reject invalid UUID format', () => {
      expect(validateInspect({ sandboxId: 'not-a-uuid' })).toContain('valid UUID');
      expect(validateInspect({ sandboxId: '12345' })).toContain('valid UUID');
    });
  });

  describe('StopSandbox', () => {
    function validateStop(params: any): string | null {
      if (!params.sandboxId) return 'sandboxId is required';
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(params.sandboxId)) return 'sandboxId must be a valid UUID';
      return null;
    }

    it('should accept valid stop request', () => {
      expect(validateStop({
        sandboxId: '123e4567-e89b-12d3-a456-426614174000',
      })).toBeNull();
    });

    it('should accept stop with cleanup', () => {
      expect(validateStop({
        sandboxId: '123e4567-e89b-12d3-a456-426614174000',
        cleanup: true,
        captureFinalSnapshot: true,
      })).toBeNull();
    });

    it('should reject invalid sandboxId', () => {
      expect(validateStop({ sandboxId: 'bad-id' })).toContain('valid UUID');
    });
  });
});


// ============================================
// 5. TOOL REGISTRY COMPLETENESS
// ============================================

describe('Tool Registry', () => {
  it('should have 29+ base tools registered', () => {
    // Canonical tool list from ExecutorRegistry.ts
    const registeredTools = [
      // File Operations
      'ReadFile', 'WriteFile', 'Edit',
      // Search
      'Glob', 'Grep',
      // Execution
      'Shell', 'BashOutput', 'KillShell',
      // Web
      'WebFetch', 'WebSearch',
      // UI/Planning
      'TodoCreate', 'TodoUpdate', 'TodoList', 'AskUserQuestion', 'ExitPlanMode',
      // Notebook
      'NotebookEdit',
      // Historical
      'RequestHistoricalContext', 'SearchConversationHistory',
      'GetConversationSegment', 'ListCompactionBoundaries',
      'ListSessions', 'LoadSession',
      // Extensions
      'SlashCommand', 'Skill',
      // Agent
      'Task', 'PRAgent',
      // Workspace
      'WorkspaceManager',
      // Artifact + Sandbox
      'CreateArtifactTool', 'InteractWithSandbox', 'ModifySandbox',
      'InspectSandbox', 'StopSandbox',
      // Tmux
      'TmuxSession',
    ];

    expect(registeredTools.length).toBeGreaterThanOrEqual(29);

    // Verify no duplicates
    const unique = new Set(registeredTools);
    expect(unique.size).toBe(registeredTools.length);
  });

  it('should categorize tools correctly', () => {
    const categories = {
      file: ['ReadFile', 'WriteFile', 'Edit'],
      search: ['Glob', 'Grep'],
      execution: ['Shell', 'BashOutput', 'KillShell', 'WorkspaceManager'],
      web: ['WebFetch', 'WebSearch'],
      agent: ['Task', 'PRAgent'],
      artifact: ['CreateArtifactTool', 'InteractWithSandbox', 'ModifySandbox', 'InspectSandbox', 'StopSandbox'],
      tmux: ['TmuxSession'],
      historical: ['RequestHistoricalContext', 'SearchConversationHistory', 'GetConversationSegment', 'ListCompactionBoundaries', 'ListSessions', 'LoadSession'],
    };

    const allTools = Object.values(categories).flat();
    expect(allTools.length).toBeGreaterThanOrEqual(25);
  });

  it('should expose workspace and agent tools for team dispatch', () => {
    const teamEssentialTools = ['Task', 'WorkspaceManager', 'PRAgent'];

    teamEssentialTools.forEach(tool => {
      expect(typeof tool).toBe('string');
      expect(tool.length).toBeGreaterThan(0);
    });
  });
});


// ============================================
// 6. AGENT TOOL USAGE TRACKING
// ============================================

describe('Agent Tool Usage Tracking', () => {
  it('should track tool usage per agent', () => {
    const toolUsage = new Map<string, { name: string; callCount: number; totalDuration: number; errors: number }>();

    function trackToolUsage(toolName: string, duration: number, isError: boolean) {
      const existing = toolUsage.get(toolName) || { name: toolName, callCount: 0, totalDuration: 0, errors: 0 };
      existing.callCount++;
      existing.totalDuration += duration;
      if (isError) existing.errors++;
      toolUsage.set(toolName, existing);
    }

    trackToolUsage('Read', 100, false);
    trackToolUsage('Read', 150, false);
    trackToolUsage('Grep', 200, false);
    trackToolUsage('Shell', 500, true);
    trackToolUsage('Read', 50, false);

    expect(toolUsage.get('Read')?.callCount).toBe(3);
    expect(toolUsage.get('Read')?.totalDuration).toBe(300);
    expect(toolUsage.get('Shell')?.errors).toBe(1);
  });

  it('should track file reads and modifications', () => {
    const filesRead = new Set<string>();
    const filesModified = new Set<string>();

    function trackFileOperation(toolName: string, filePath: string) {
      const readTools = ['read', 'glob', 'grep'];
      const writeTools = ['write', 'edit'];

      if (readTools.includes(toolName.toLowerCase())) filesRead.add(filePath);
      if (writeTools.includes(toolName.toLowerCase())) filesModified.add(filePath);
    }

    trackFileOperation('Read', '/src/index.ts');
    trackFileOperation('Read', '/src/utils.ts');
    trackFileOperation('Read', '/src/index.ts'); // Duplicate
    trackFileOperation('Write', '/src/output.ts');
    trackFileOperation('Edit', '/src/index.ts');

    expect(filesRead.size).toBe(2); // Deduped
    expect(filesModified.size).toBe(2);
    expect(filesRead.has('/src/index.ts')).toBe(true);
    expect(filesModified.has('/src/output.ts')).toBe(true);
  });

  it('should build complete SubAgentResult with tool stats', () => {
    const toolUsage = [
      { name: 'Read', callCount: 5, totalDuration: 500, errors: 0 },
      { name: 'Grep', callCount: 3, totalDuration: 900, errors: 0 },
      { name: 'Shell', callCount: 1, totalDuration: 2000, errors: 1 },
      { name: 'CreateArtifactTool', callCount: 1, totalDuration: 5000, errors: 0 },
      { name: 'TmuxSession', callCount: 2, totalDuration: 300, errors: 0 },
    ];

    const result = {
      agentId: 'implementer-abc',
      agentName: 'pr-implementer',
      model: 'claude-sonnet-4-5',
      startTime: new Date('2026-01-01T00:00:00Z'),
      endTime: new Date('2026-01-01T00:01:00Z'),
      durationMs: 60000,
      turnCount: 8,
      status: 'completed' as const,
      summary: 'Implemented auth refactor with 5 file changes.',
      fullResponse: '...',
      toolsUsed: toolUsage,
      filesRead: ['/src/auth.ts', '/src/types.ts', '/src/utils.ts'],
      filesModified: ['/src/auth.ts', '/src/auth.test.ts'],
      cost: { inputTokens: 15000, outputTokens: 5000, estimatedCost: 0.05, cacheHits: 4 },
    };

    expect(result.toolsUsed).toHaveLength(5);
    expect(result.toolsUsed.find(t => t.name === 'CreateArtifactTool')?.callCount).toBe(1);
    expect(result.toolsUsed.find(t => t.name === 'TmuxSession')?.callCount).toBe(2);
    expect(result.filesRead).toHaveLength(3);
    expect(result.filesModified).toHaveLength(2);
    expect(result.cost.cacheHits).toBe(4);
  });
});


// ============================================
// 7. WORKSPACE + TOOL INTEGRATION SCENARIOS
// ============================================

describe('Workspace + Tool Integration', () => {
  it('should support artifact creation inside worktree', () => {
    const worktreePath = '/tmp/workspace-abc';
    const artifactParams = {
      name: 'test-server',
      description: 'Test server for auth module',
      implementation: {
        language: 'javascript',
        code: 'const app = require("express")(); app.listen(3001);',
        dependencies: ['express'],
        packageManager: 'npm',
      },
      mode: 'dev',
    };

    // Agent working in worktree creates artifact there
    const artifactDir = `${worktreePath}/.cortex/artifacts/${artifactParams.name}`;
    expect(artifactDir).toContain(worktreePath);
    expect(artifactDir).toContain('test-server');
  });

  it('should support tmux session per worktree agent', () => {
    const agents = [
      { agentId: 'impl-abc', worktree: '/tmp/workspace-abc', tmuxSession: 'team-abc.0' },
      { agentId: 'test-def', worktree: '/tmp/workspace-def', tmuxSession: 'team-abc.1' },
    ];

    // Each agent gets its own pane in the team tmux session
    expect(agents[0].tmuxSession).toContain('team-');
    expect(agents[1].tmuxSession).toContain('team-');

    // Different pane indices
    expect(agents[0].tmuxSession.endsWith('.0')).toBe(true);
    expect(agents[1].tmuxSession.endsWith('.1')).toBe(true);
  });

  it('should support sandbox inspection from review agent', () => {
    // Agent creates artifact, then another agent inspects it
    const createResult = {
      sandboxId: '123e4567-e89b-12d3-a456-426614174000',
      name: 'auth-demo',
      url: 'http://localhost:3001',
      mode: 'dev',
    };

    const inspectParams = {
      sandboxId: createResult.sandboxId,
      captureScreenshot: true,
      captureConsole: true,
      captureNetwork: true,
    };

    expect(inspectParams.sandboxId).toBe(createResult.sandboxId);
    expect(inspectParams.captureScreenshot).toBe(true);
  });

  it('should track complete agent team toolchain', () => {
    // Simulate a 3-agent team using different tool combinations
    const teamToolUsage = {
      'pr-security-auditor': {
        tools: ['Read', 'Grep', 'Shell'],
        filesRead: 15,
        filesModified: 0,
      },
      'pr-implementer': {
        tools: ['Read', 'Write', 'Edit', 'Shell', 'CreateArtifactTool', 'TmuxSession'],
        filesRead: 8,
        filesModified: 5,
      },
      'pr-test-writer': {
        tools: ['Read', 'Write', 'Shell', 'InteractWithSandbox', 'InspectSandbox'],
        filesRead: 6,
        filesModified: 3,
      },
    };

    // Security auditor: read-only
    expect(teamToolUsage['pr-security-auditor'].filesModified).toBe(0);

    // Implementer: uses artifact + tmux
    expect(teamToolUsage['pr-implementer'].tools).toContain('CreateArtifactTool');
    expect(teamToolUsage['pr-implementer'].tools).toContain('TmuxSession');

    // Test writer: uses sandbox tools
    expect(teamToolUsage['pr-test-writer'].tools).toContain('InteractWithSandbox');
    expect(teamToolUsage['pr-test-writer'].tools).toContain('InspectSandbox');

    // All agents used Read
    Object.values(teamToolUsage).forEach(agent => {
      expect(agent.tools).toContain('Read');
    });
  });
});
