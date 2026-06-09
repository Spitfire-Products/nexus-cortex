/**
 * System Message Middleware Tests
 *
 * Comprehensive test suite for SystemMessageMiddleware extracted from orchestrator.
 * Tests cover all aspects of system message injection functionality.
 *
 * Test Coverage:
 * - Injection context building
 * - Template variable expansion
 * - Message injection at different positions
 * - Priority sorting
 * - System reminder wrapping
 * - String vs array content handling
 * - Model capability detection
 * - Session phase determination
 *
 * @version 1.0.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SystemMessageMiddleware } from '../SystemMessageMiddleware.js';
import type { ModelConfig } from '../../models/ModelConfig.interface.js';
import type {
  MiddlewareContext,
  InjectionContext,
  TemplateVariables
} from '../contracts/MiddlewareContracts.js';
import type { SystemMessageForInjection } from '../../system-messages/SystemMessageRegistry.interface.js';

// Mock dependencies
const mockSystemMessageLoader = {
  getMessagesForInjection: vi.fn(),
  loadRegistry: vi.fn(),
  clearCache: vi.fn(),
  reload: vi.fn()
};

const mockSystemReminderInjector = {
  createEmptyTodoReminder: vi.fn(),
  createTodoUpdateReminder: vi.fn(),
  createClaudeMdReminder: vi.fn(),
  createToolCallReminder: vi.fn(),
  createToolResultReminder: vi.fn(),
  createFileSecurityWarning: vi.fn(),
  createTodoWriteReminder: vi.fn(),
  createCommandCaveat: vi.fn()
};

// Mock toolFactory
vi.mock('../../tools/ToolFactory.js', () => ({
  toolFactory: {
    getAllTools: vi.fn(() => [
      { name: 'Read' },
      { name: 'Write' },
      { name: 'Edit' },
      { name: 'Bash' },
      { name: 'Grep' }
    ])
  }
}));

describe('SystemMessageMiddleware', () => {
  let middleware: SystemMessageMiddleware;
  let mockContext: MiddlewareContext;
  let mockModel: ModelConfig;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create middleware instance with mocked dependencies
    middleware = new SystemMessageMiddleware(
      mockSystemMessageLoader as any,
      mockSystemReminderInjector as any
    );

    // Setup common mock context
    mockContext = {
      sessionId: 'test-session-123',
      conversationId: 'test-conversation-456',
      turnNumber: 0,
      modelId: 'claude-sonnet-4-5-20250929',
      config: {
        projectPath: '/tmp/test-workspace',
        enableSandbox: true
      } as any
    };

    // Setup common mock model
    mockModel = {
      id: 'claude-sonnet-4-5-20250929',
      provider: 'anthropic',
      displayName: 'Claude 3.5 Sonnet',
      family: 'claude-3-5',
      api: {
        pattern: 'messages',
        endpoint: 'https://api.anthropic.com/v1/messages',
        apiKeyEnvVar: 'ANTHROPIC_API_KEY',
        authHeader: 'x-api-key'
      },
      tools: {
        supported: true,
        adapter: 'MessagesAPIAdapter',
        namingConvention: 'snake_case',
        maxTools: 64,
        parallelToolCalls: true
      },
      reasoning: {
        supported: true
      },
      streaming: {
        supported: true
      }
    } as any;
  });

  // ============================================
  // INJECTION CONTEXT BUILDING TESTS
  // ============================================

  describe('buildInjectionContext', () => {
    it('should build context with start phase for turn 0', () => {
      mockContext.turnNumber = 0;

      const context = middleware.buildInjectionContext(mockModel, true, mockContext);

      expect(context).toMatchObject({
        turnNumber: 0,
        sessionPhase: 'start',
        hasTools: true,
        toolCount: 5, // From mocked toolFactory
        apiPattern: 'messages',
        sessionId: 'test-session-123'
      });
    });

    it('should build context with ongoing phase for turn > 0', () => {
      mockContext.turnNumber = 5;

      const context = middleware.buildInjectionContext(mockModel, true, mockContext);

      expect(context.sessionPhase).toBe('ongoing');
      expect(context.turnNumber).toBe(5);
    });

    it('should detect reasoning capability', () => {
      mockModel.reasoning = { supported: true } as any;

      const context = middleware.buildInjectionContext(mockModel, false, mockContext);

      expect(context.modelCapabilities).toContain('reasoning');
    });

    it('should detect tools capability', () => {
      mockModel.tools = { supported: true } as any;

      const context = middleware.buildInjectionContext(mockModel, true, mockContext);

      expect(context.modelCapabilities).toContain('tools');
    });

    it('should detect streaming capability', () => {
      mockModel.streaming = { supported: true } as any;

      const context = middleware.buildInjectionContext(mockModel, false, mockContext);

      expect(context.modelCapabilities).toContain('streaming');
    });

    it('should detect multiple capabilities', () => {
      mockModel.reasoning = { supported: true } as any;
      mockModel.tools = { supported: true } as any;
      mockModel.streaming = { supported: true } as any;

      const context = middleware.buildInjectionContext(mockModel, true, mockContext);

      expect(context.modelCapabilities).toEqual(
        expect.arrayContaining(['reasoning', 'tools', 'streaming'])
      );
      expect(context.modelCapabilities).toHaveLength(3);
    });

    it('should set toolCount to 0 when hasTools is false', () => {
      const context = middleware.buildInjectionContext(mockModel, false, mockContext);

      expect(context.toolCount).toBe(0);
      expect(context.hasTools).toBe(false);
    });

    it('should extract API pattern from model config', () => {
      mockModel.api.pattern = 'chat/completions';

      const context = middleware.buildInjectionContext(mockModel, false, mockContext);

      expect(context.apiPattern).toBe('chat/completions');
    });
  });

  // ============================================
  // TEMPLATE VARIABLES TESTS
  // ============================================

  describe('buildTemplateVariables', () => {
    it('should build template variables with all fields', () => {
      const vars = middleware.buildTemplateVariables(5, mockContext);

      expect(vars).toMatchObject({
        projectPath: '/tmp/test-workspace',
        workspacePath: '/tmp/test-workspace',
        toolCount: 5,
        sandboxEnabled: true
      });
      expect(vars.toolNames).toEqual(['Read', 'Write', 'Edit', 'Bash', 'Grep']);
    });

    it('should generate current date in ISO format', () => {
      const vars = middleware.buildTemplateVariables(0, mockContext);

      expect(vars.currentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should generate current time as ISO timestamp', () => {
      const vars = middleware.buildTemplateVariables(0, mockContext);

      expect(vars.currentTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should set empty toolNames when toolCount is 0', () => {
      const vars = middleware.buildTemplateVariables(0, mockContext);

      expect(vars.toolNames).toEqual([]);
    });

    it('should use projectPath from config', () => {
      mockContext.config.projectPath = '/custom/path';

      const vars = middleware.buildTemplateVariables(0, mockContext);

      expect(vars.projectPath).toBe('/custom/path');
      expect(vars.workspacePath).toBe('/custom/path');
    });

    it('should default sandboxEnabled to false if not set', () => {
      mockContext.config.enableSandbox = undefined;

      const vars = middleware.buildTemplateVariables(0, mockContext);

      expect(vars.sandboxEnabled).toBe(false);
    });
  });

  // ============================================
  // MESSAGE INJECTION TESTS
  // ============================================

  describe('injectSystemMessages', () => {
    it('should return normalized array when no messages to inject', async () => {
      mockSystemMessageLoader.getMessagesForInjection.mockResolvedValue([]);

      const result = await middleware.injectSystemMessages(
        'Hello, world!',
        mockModel,
        false,
        mockContext
      );

      expect(result).toEqual([{ type: 'text', text: 'Hello, world!' }]);
    });

    it('should handle string content input', async () => {
      mockSystemMessageLoader.getMessagesForInjection.mockResolvedValue([]);

      const result = await middleware.injectSystemMessages(
        'Test string',
        mockModel,
        false,
        mockContext
      );

      expect(result).toEqual([{ type: 'text', text: 'Test string' }]);
    });

    it('should handle array content input', async () => {
      mockSystemMessageLoader.getMessagesForInjection.mockResolvedValue([]);

      const input = [
        { type: 'text', text: 'Hello' },
        { type: 'text', text: 'World' }
      ];

      const result = await middleware.injectSystemMessages(
        input,
        mockModel,
        false,
        mockContext
      );

      expect(result).toEqual(input);
    });

    it('should inject prepend messages before user content', async () => {
      const prependMessage: SystemMessageForInjection = {
        content: 'System instructions',
        position: 'prepend',
        priority: 10,
        wrapInSystemReminder: true,
        contentHash: 'abc123',
        definition: {} as any
      };

      mockSystemMessageLoader.getMessagesForInjection.mockResolvedValue([prependMessage]);

      const result = await middleware.injectSystemMessages(
        'User message',
        mockModel,
        false,
        mockContext
      );

      expect(result).toHaveLength(2);
      expect(result[0].text).toContain('<system-reminder>');
      expect(result[0].text).toContain('System instructions');
      expect(result[1].text).toBe('User message');
    });

    it('should inject append messages after user content', async () => {
      const appendMessage: SystemMessageForInjection = {
        content: 'Additional context',
        position: 'append',
        priority: 10,
        wrapInSystemReminder: true,
        contentHash: 'def456',
        definition: {} as any
      };

      mockSystemMessageLoader.getMessagesForInjection.mockResolvedValue([appendMessage]);

      const result = await middleware.injectSystemMessages(
        'User message',
        mockModel,
        false,
        mockContext
      );

      expect(result).toHaveLength(2);
      expect(result[0].text).toBe('User message');
      expect(result[1].text).toContain('<system-reminder>');
      expect(result[1].text).toContain('Additional context');
    });

    it('should wrap messages in system-reminder tags when configured', async () => {
      const message: SystemMessageForInjection = {
        content: 'Important context',
        position: 'prepend',
        priority: 10,
        wrapInSystemReminder: true,
        contentHash: 'ghi789',
        definition: {} as any
      };

      mockSystemMessageLoader.getMessagesForInjection.mockResolvedValue([message]);

      const result = await middleware.injectSystemMessages(
        'User message',
        mockModel,
        false,
        mockContext
      );

      expect(result[0].text).toBe('<system-reminder>\nImportant context\n</system-reminder>');
    });

    it('should not wrap messages when wrapInSystemReminder is false', async () => {
      const message: SystemMessageForInjection = {
        content: 'Plain context',
        position: 'prepend',
        priority: 10,
        wrapInSystemReminder: false,
        contentHash: 'jkl012',
        definition: {} as any
      };

      mockSystemMessageLoader.getMessagesForInjection.mockResolvedValue([message]);

      const result = await middleware.injectSystemMessages(
        'User message',
        mockModel,
        false,
        mockContext
      );

      expect(result[0].text).toBe('Plain context');
      expect(result[0].text).not.toContain('<system-reminder>');
    });

    it('should sort prepend messages by priority', async () => {
      const messages: SystemMessageForInjection[] = [
        {
          content: 'Priority 20',
          position: 'prepend',
          priority: 20,
          wrapInSystemReminder: false,
          contentHash: 'c1',
          definition: {} as any
        },
        {
          content: 'Priority 10',
          position: 'prepend',
          priority: 10,
          wrapInSystemReminder: false,
          contentHash: 'c2',
          definition: {} as any
        },
        {
          content: 'Priority 5',
          position: 'prepend',
          priority: 5,
          wrapInSystemReminder: false,
          contentHash: 'c3',
          definition: {} as any
        }
      ];

      mockSystemMessageLoader.getMessagesForInjection.mockResolvedValue(messages);

      const result = await middleware.injectSystemMessages(
        'User message',
        mockModel,
        false,
        mockContext
      );

      expect(result[0].text).toBe('Priority 5');
      expect(result[1].text).toBe('Priority 10');
      expect(result[2].text).toBe('Priority 20');
      expect(result[3].text).toBe('User message');
    });

    it('should sort append messages by priority', async () => {
      const messages: SystemMessageForInjection[] = [
        {
          content: 'Priority 30',
          position: 'append',
          priority: 30,
          wrapInSystemReminder: false,
          contentHash: 'c4',
          definition: {} as any
        },
        {
          content: 'Priority 15',
          position: 'append',
          priority: 15,
          wrapInSystemReminder: false,
          contentHash: 'c5',
          definition: {} as any
        }
      ];

      mockSystemMessageLoader.getMessagesForInjection.mockResolvedValue(messages);

      const result = await middleware.injectSystemMessages(
        'User message',
        mockModel,
        false,
        mockContext
      );

      expect(result[0].text).toBe('User message');
      expect(result[1].text).toBe('Priority 15');
      expect(result[2].text).toBe('Priority 30');
    });

    it('should handle mixed prepend and append messages', async () => {
      const messages: SystemMessageForInjection[] = [
        {
          content: 'Prepend 1',
          position: 'prepend',
          priority: 10,
          wrapInSystemReminder: false,
          contentHash: 'c6',
          definition: {} as any
        },
        {
          content: 'Append 1',
          position: 'append',
          priority: 10,
          wrapInSystemReminder: false,
          contentHash: 'c7',
          definition: {} as any
        },
        {
          content: 'Prepend 2',
          position: 'prepend',
          priority: 5,
          wrapInSystemReminder: false,
          contentHash: 'c8',
          definition: {} as any
        }
      ];

      mockSystemMessageLoader.getMessagesForInjection.mockResolvedValue(messages);

      const result = await middleware.injectSystemMessages(
        'User message',
        mockModel,
        false,
        mockContext
      );

      expect(result).toHaveLength(4);
      expect(result[0].text).toBe('Prepend 2'); // Priority 5
      expect(result[1].text).toBe('Prepend 1'); // Priority 10
      expect(result[2].text).toBe('User message');
      expect(result[3].text).toBe('Append 1');
    });

    it('should preserve array content structure with multiple elements', async () => {
      mockSystemMessageLoader.getMessagesForInjection.mockResolvedValue([]);

      const input = [
        { type: 'text', text: 'Hello' },
        { type: 'image', source: 'data:...' },
        { type: 'text', text: 'World' }
      ];

      const result = await middleware.injectSystemMessages(
        input,
        mockModel,
        false,
        mockContext
      );

      expect(result).toEqual(input);
    });

    it('should call systemMessageLoader with correct parameters', async () => {
      mockSystemMessageLoader.getMessagesForInjection.mockResolvedValue([]);

      await middleware.injectSystemMessages(
        'Test',
        mockModel,
        true,
        mockContext
      );

      expect(mockSystemMessageLoader.getMessagesForInjection).toHaveBeenCalledTimes(1);

      const [injectionContext, templateVars] = mockSystemMessageLoader.getMessagesForInjection.mock.calls[0];

      // Verify injection context
      expect(injectionContext).toMatchObject({
        turnNumber: 0,
        sessionPhase: 'start',
        hasTools: true,
        sessionId: 'test-session-123'
      });

      // Verify template variables
      expect(templateVars).toMatchObject({
        projectPath: '/tmp/test-workspace',
        sandboxEnabled: true
      });
    });
  });

  // ============================================
  // INTEGRATION TESTS
  // ============================================

  describe('Integration', () => {
    it('should handle complete injection workflow', async () => {
      mockContext.turnNumber = 0;
      mockModel.tools.supported = true;
      mockModel.reasoning = { supported: true } as any;

      const messages: SystemMessageForInjection[] = [
        {
          content: 'System prompt',
          position: 'prepend',
          priority: 1,
          wrapInSystemReminder: true,
          contentHash: 'h1',
          definition: {} as any
        },
        {
          content: 'Tool guide',
          position: 'prepend',
          priority: 2,
          wrapInSystemReminder: true,
          contentHash: 'h2',
          definition: {} as any
        }
      ];

      mockSystemMessageLoader.getMessagesForInjection.mockResolvedValue(messages);

      const result = await middleware.injectSystemMessages(
        'User prompt',
        mockModel,
        true,
        mockContext
      );

      expect(result).toHaveLength(3);
      expect(result[0].text).toContain('System prompt');
      expect(result[1].text).toContain('Tool guide');
      expect(result[2].text).toBe('User prompt');
    });

    it('should build correct context for OpenAI model', async () => {
      mockModel.provider = 'openai';
      mockModel.api.pattern = 'chat/completions';
      mockModel.tools.supported = true;
      mockModel.reasoning = { supported: false } as any;
      mockModel.streaming = { supported: true } as any;

      const context = middleware.buildInjectionContext(mockModel, true, mockContext);

      expect(context.apiPattern).toBe('chat/completions');
      expect(context.modelCapabilities).toContain('tools');
      expect(context.modelCapabilities).toContain('streaming');
      expect(context.modelCapabilities).not.toContain('reasoning');
    });

    it('should build correct context for Gemini model', async () => {
      mockModel.provider = 'google';
      mockModel.api.pattern = 'generateContent';
      mockModel.tools.supported = true;
      mockModel.reasoning = { supported: false } as any;

      const context = middleware.buildInjectionContext(mockModel, true, mockContext);

      expect(context.apiPattern).toBe('generateContent');
      expect(context.modelCapabilities).toContain('tools');
    });
  });

  // cross-provider prompt-cache stability — static prepend system content
  // must be split into a stable `systemPrompt` (→ provider system field) instead
  // of riding the moving latest-user-message slot. Byte-preserved (only relocated).
  describe('injectWithSystemSplit (cache stability)', () => {
    it('routes BOTH prepend and append static content to systemPrompt; userContent = bare user only', async () => {
      const prepend: SystemMessageForInjection = {
        content: 'System instructions', position: 'prepend', priority: 10,
        wrapInSystemReminder: true, contentHash: 'p1', definition: {} as any
      };
      const append: SystemMessageForInjection = {
        content: 'Tail context', position: 'append', priority: 10,
        wrapInSystemReminder: true, contentHash: 'a1', definition: {} as any
      };
      mockSystemMessageLoader.getMessagesForInjection.mockResolvedValue([prepend, append]);

      const { systemPrompt, userContent } = await middleware.injectWithSystemSplit(
        'User message', mockModel, false, mockContext
      );

      // prepend AND append both → systemPrompt (stable system field).
      // messages[0] must stay byte-identical across tool-loop iterations
      // (xAI caches the linear prefix; messages serializes before system).
      expect(systemPrompt).toContain('System instructions');
      expect(systemPrompt).toContain('Tail context');
      // userContent = ONLY the bare user message — no static system content
      const joined = JSON.stringify(userContent);
      expect(joined).not.toContain('System instructions');
      expect(joined).not.toContain('Tail context');
      expect(joined).toContain('User message');
      expect(userContent).toHaveLength(1);
      expect(userContent[0].text).toBe('<user_query>\nUser message\n</user_query>');
    });

    it('produces a byte-identical systemPrompt across repeated calls (cacheable prefix)', async () => {
      const prepend: SystemMessageForInjection = {
        content: 'Stable base prompt', position: 'prepend', priority: 5,
        wrapInSystemReminder: false, contentHash: 'p2', definition: {} as any
      };
      mockSystemMessageLoader.getMessagesForInjection.mockResolvedValue([prepend]);

      const a = await middleware.injectWithSystemSplit('Q1', mockModel, false, mockContext);
      const b = await middleware.injectWithSystemSplit('Q2', mockModel, false, mockContext);
      expect(a.systemPrompt).toBe(b.systemPrompt);
      expect(a.systemPrompt).toContain('Stable base prompt');
    });

    it('returns undefined systemPrompt when there are no prepend messages', async () => {
      mockSystemMessageLoader.getMessagesForInjection.mockResolvedValue([]);
      const { systemPrompt, userContent } = await middleware.injectWithSystemSplit(
        'Just a question', mockModel, false, mockContext
      );
      expect(systemPrompt).toBeUndefined();
      expect(JSON.stringify(userContent)).toContain('Just a question');
    });
  });
});
