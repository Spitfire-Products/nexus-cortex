/**
 * Unit tests for chat/interactive command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { interactiveChat } from '../../../../src/commands/chat/interactive.js';
import { OrchestratorClient } from '../../../../src/orchestrator/OrchestratorClient.js';

vi.mock('../../../../src/orchestrator/OrchestratorClient.js', () => ({
  OrchestratorClient: vi.fn()
}));

vi.mock('../../../../src/config/ConfigManager.js', () => ({
  ConfigManager: {
    get: vi.fn().mockReturnValue(undefined),
    load: vi.fn().mockResolvedValue({ serverUrl: 'http://localhost:4000' }),
    clearCache: vi.fn()
  }
}));

vi.mock('../../../../src/ink-ui/colors.js', () => ({
  persistTheme: vi.fn(),
  loadPersistedTheme: vi.fn(),
  persistThemeForPlatform: vi.fn(),
  loadPersistedThemeForPlatform: vi.fn(),
  loadPersistedModelForPlatform: vi.fn().mockReturnValue(undefined),
  persistModelForPlatform: vi.fn(),
}));

vi.mock('../../../../src/ui/SplashScreen.js', () => ({
  renderSplashScreen: vi.fn().mockReturnValue('Nexus Cortex - Interactive Chat\nType "exit" to quit'),
  renderCompactHeader: vi.fn().mockReturnValue('\n CORTEX · default · ~/workspace\n'),
}));

const mockRawQuestion = vi.fn();
vi.mock('../../../../src/ui/RawInput.js', () => ({
  rawQuestion: (...args: any[]) => mockRawQuestion(...args),
}));

vi.mock('../../../../src/ui/PersistentInput.js', () => ({
  createPersistentInput: vi.fn().mockReturnValue({
    prompt: vi.fn(),
    close: vi.fn(),
    setStatusLine: vi.fn(),
    isCapturing: vi.fn().mockReturnValue(false),
    pause: vi.fn(),
    resume: vi.fn(),
  }),
}));

vi.mock('../../../../src/ui/ChalkThemePicker.js', () => ({
  runThemePicker: vi.fn(),
}));

vi.mock('../../../../src/ui/InkModelPicker.js', () => ({
  showModelPicker: vi.fn(),
}));

vi.mock('../../../../src/ui/InkMenuPicker.js', () => ({
  showInteractiveMenu: vi.fn(),
}));

vi.mock('../../../../src/ui/InkCommandPalette.js', () => ({
  showCommandPalette: vi.fn(),
}));

vi.mock('../../../../src/ui/InkHelp.js', () => ({
  showHelp: vi.fn(),
}));

vi.mock('../../../../src/utils/ToolFormatter.js', () => ({
  ToolFormatter: vi.fn().mockImplementation(() => ({
    formatTool: vi.fn(),
    formatToolCall: vi.fn(),
    formatDiff: vi.fn(),
    formatFileContent: vi.fn(),
  })),
  generateAndParseDiff: vi.fn(),
  parseUnifiedDiff: vi.fn(),
}));

vi.mock('../../../../src/utils/MarkdownRenderer.js', () => ({
  MarkdownRenderer: vi.fn().mockImplementation(() => ({
    render: vi.fn(),
    reset: vi.fn(),
    processChunk: vi.fn().mockReturnValue(''),
    flush: vi.fn().mockReturnValue(''),
  })),
}));

vi.mock('../../../../src/commands/slash/SlashCommandParser.js', () => ({
  parseSlashCommand: vi.fn().mockReturnValue({ isCommand: false }),
}));

vi.mock('../../../../src/commands/slash/CommandPalette.js', () => ({
  commandPalette: vi.fn(),
}));

vi.mock('../../../../src/commands/slash/SlashCommandRegistry.js', () => ({
  slashCommandRegistry: { getAll: vi.fn().mockReturnValue([]) },
}));

vi.mock('../../../../src/commands/system-message/index.js', () => ({
  createSystemMessageCommand: vi.fn(),
}));

vi.mock('../../../../src/commands/agent/index.js', () => ({
  createAgentCommand: vi.fn(),
  listAgents: vi.fn(),
  showAgentInfo: vi.fn(),
}));

vi.mock('@nexus-cortex/core', () => ({
  MentorshipConfigService: { getInstance: vi.fn().mockReturnValue({ getConfig: vi.fn().mockReturnValue({}) }) },
}));

vi.mock('readline', () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn(),
    close: vi.fn(),
  }))
}));

import { parseSlashCommand } from '../../../../src/commands/slash/SlashCommandParser.js';

const blockedEvents = new Set(['uncaughtException', 'unhandledRejection', 'exit', 'SIGINT', 'SIGTERM']);

describe('interactiveChat command', () => {
  let mockInitialize: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let stdoutWriteSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Re-set factory mock implementations that vi.restoreAllMocks() clears
    mockRawQuestion.mockResolvedValue('exit');
    (parseSlashCommand as any).mockReturnValue({ isCommand: false });

    // Block process event handlers that crash vitest
    const origOn = process.on.bind(process);
    vi.spyOn(process, 'on').mockImplementation((event: string, ...args: any[]) => {
      if (blockedEvents.has(event)) return process;
      return origOn(event, ...args);
    });

    mockInitialize = vi.fn().mockResolvedValue(undefined);

    (OrchestratorClient as any).mockImplementation(() => ({
      initialize: mockInitialize,
      sendMessage: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'Hi' }] }),
      streamMessage: vi.fn(),
      getCurrentModel: vi.fn().mockReturnValue(null),
      getSessionId: vi.fn().mockReturnValue('test-session'),
      listModels: vi.fn().mockResolvedValue([]),
      setInputHandlerCallbacks: vi.fn(),
      setPreviewRenderer: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    }));

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'clear').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('Initialization', () => {
    test('should display welcome message', async () => {
      interactiveChat({ serverUrl: 'http://localhost:4000' });
      await new Promise(resolve => setTimeout(resolve, 100));

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));
      expect(calls.some((c: string) => c.includes('Nexus Cortex'))).toBe(true);
    });

    test('should create OrchestratorClient', async () => {
      interactiveChat({ serverUrl: 'http://localhost:4000' });
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(OrchestratorClient).toHaveBeenCalled();
    });
  });

  describe('Exit command', () => {
    test('should handle exit command', async () => {
      mockRawQuestion.mockResolvedValueOnce('exit');

      interactiveChat({ serverUrl: 'http://localhost:4000' });
      await new Promise(resolve => setTimeout(resolve, 100));

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));
      expect(calls.some((c: string) => c.includes('Goodbye'))).toBe(true);
    });
  });

  describe('Empty input handling', () => {
    test('should handle empty input and reprompt', async () => {
      mockRawQuestion
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('exit');

      interactiveChat({ serverUrl: 'http://localhost:4000' });
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockRawQuestion.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    test('should handle whitespace-only input', async () => {
      mockRawQuestion
        .mockResolvedValueOnce('   ')
        .mockResolvedValueOnce('exit');

      interactiveChat({ serverUrl: 'http://localhost:4000' });
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockRawQuestion.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });
});
