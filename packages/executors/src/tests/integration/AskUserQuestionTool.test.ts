/**
 * AskUserQuestionTool Integration Tests
 *
 * Tests interactive user questioning with real validation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  AskUserQuestionTool,
  type Question,
} from '../../implementations/ui/AskUserQuestionTool.js';
import { ToolRegistry, type ExecutorConfig } from '../../base/ToolRegistry.js';

describe('AskUserQuestionTool Integration', () => {
  let tool: AskUserQuestionTool;
  let registry: ToolRegistry;
  let config: ExecutorConfig;

  beforeEach(() => {
    config = {
      workingDirectory: process.cwd(),
      allowFileSystem: true,
    };

    tool = new AskUserQuestionTool(config);
    registry = new ToolRegistry(config);
    registry.registerTool(tool);
  });

  it('should present a single question', async () => {
    const questions: Question[] = [
      {
        question: 'Which library should we use?',
        header: 'Library',
        options: [
          { label: 'React', description: 'Popular UI framework' },
          { label: 'Vue', description: 'Progressive framework' },
        ],
        multiSelect: false,
      },
    ];

    const result = await tool.execute(
      { questions },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('User Questions');
    expect(result.llmContent).toContain('[Library]');
    expect(result.llmContent).toContain('Which library should we use?');
    expect(result.llmContent).toContain('1. React');
    expect(result.llmContent).toContain('2. Vue');
    expect(result.metadata?.questionCount).toBe(1);
  });

  it('should present multiple questions', async () => {
    const questions: Question[] = [
      {
        question: 'Which framework?',
        header: 'Framework',
        options: [
          { label: 'Express', description: 'Minimal framework' },
          { label: 'Fastify', description: 'Fast framework' },
        ],
        multiSelect: false,
      },
      {
        question: 'Which database?',
        header: 'Database',
        options: [
          { label: 'PostgreSQL', description: 'Relational database' },
          { label: 'MongoDB', description: 'Document database' },
        ],
        multiSelect: false,
      },
    ];

    const result = await tool.execute(
      { questions },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('Which framework?');
    expect(result.llmContent).toContain('Which database?');
    expect(result.llmContent).toContain('---'); // Separator
    expect(result.metadata?.questionCount).toBe(2);
  });

  it('should handle multi-select questions', async () => {
    const questions: Question[] = [
      {
        question: 'Which features do you want?',
        header: 'Features',
        options: [
          { label: 'Authentication', description: 'User auth system' },
          { label: 'Caching', description: 'Redis caching' },
          { label: 'Logging', description: 'Winston logging' },
        ],
        multiSelect: true,
      },
    ];

    const result = await tool.execute(
      { questions },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('You can select multiple options');
    expect(result.metadata?.questions?.[0].multiSelect).toBe(true);
  });

  it('should validate minimum 1 question', async () => {
    const result = await tool.execute(
      { questions: [] },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Questions array cannot be empty');
  });

  it('should validate maximum 4 questions', async () => {
    const questions: Question[] = Array(5)
      .fill(null)
      .map((_, i) => ({
        question: `Question ${i + 1}?`,
        header: `Q${i + 1}`,
        options: [
          { label: 'A', description: 'Option A' },
          { label: 'B', description: 'Option B' },
        ],
        multiSelect: false,
      }));

    const result = await tool.execute(
      { questions },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Too many questions');
    expect(result.error).toContain('Maximum: 4');
  });

  it('should validate question text length', async () => {
    const questions: Question[] = [
      {
        question: 'Why?', // Only 4 characters, too short
        header: 'Short',
        options: [
          { label: 'A', description: 'Option A' },
          { label: 'B', description: 'Option B' },
        ],
        multiSelect: false,
      },
    ];

    const result = await tool.execute(
      { questions },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/at least 5 characters|Question text must be at least/);
  });

  it('should validate header length', async () => {
    const questions: Question[] = [
      {
        question: 'Which option?',
        header: 'ThisIsWayTooLongForAHeader', // > 12 chars
        options: [
          { label: 'A', description: 'Option A' },
          { label: 'B', description: 'Option B' },
        ],
        multiSelect: false,
      },
    ];

    const result = await tool.execute(
      { questions },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Header too long');
    expect(result.error).toContain('max 12');
  });

  it('should validate minimum 2 options', async () => {
    const questions: Question[] = [
      {
        question: 'Which option?',
        header: 'Options',
        options: [{ label: 'Only one', description: 'The only option' }],
        multiSelect: false,
      },
    ];

    const result = await tool.execute(
      { questions },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Must have at least 2 options');
  });

  it('should validate maximum 4 options', async () => {
    const questions: Question[] = [
      {
        question: 'Which option?',
        header: 'Options',
        options: Array(5)
          .fill(null)
          .map((_, i) => ({
            label: `Option ${i + 1}`,
            description: `Description ${i + 1}`,
          })),
        multiSelect: false,
      },
    ];

    const result = await tool.execute(
      { questions },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Too many options');
    expect(result.error).toContain('max 4');
  });

  it('should validate option labels', async () => {
    const questions: Question[] = [
      {
        question: 'Which option?',
        header: 'Options',
        options: [
          { label: '', description: 'Empty label' },
          { label: 'Valid', description: 'Valid option' },
        ],
        multiSelect: false,
      },
    ];

    const result = await tool.execute(
      { questions },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Label cannot be empty');
  });

  it('should validate option descriptions', async () => {
    const questions: Question[] = [
      {
        question: 'Which option?',
        header: 'Options',
        options: [
          { label: 'Valid', description: '' },
          { label: 'Also Valid', description: 'Has description' },
        ],
        multiSelect: false,
      },
    ];

    const result = await tool.execute(
      { questions },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Description cannot be empty');
  });

  it('should work via ToolRegistry', async () => {
    const questions: Question[] = [
      {
        question: 'Test question?',
        header: 'Test',
        options: [
          { label: 'Yes', description: 'Affirmative' },
          { label: 'No', description: 'Negative' },
        ],
        multiSelect: false,
      },
    ];

    const result = await registry.executeTool('AskUserQuestion', { questions });

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('Test question?');
  });

  it('should include metadata in result', async () => {
    const questions: Question[] = [
      {
        question: 'Which one?',
        header: 'Choice',
        options: [
          { label: 'A', description: 'First' },
          { label: 'B', description: 'Second' },
          { label: 'C', description: 'Third' },
        ],
        multiSelect: false,
      },
    ];

    const result = await tool.execute(
      { questions },
      new AbortController().signal,
    );

    expect(result.metadata).toBeDefined();
    expect(result.metadata!.questionCount).toBe(1);
    expect(result.metadata!.questions).toBeDefined();
    expect(result.metadata!.questions![0].header).toBe('Choice');
    expect(result.metadata!.questions![0].optionCount).toBe(3);
    expect(result.metadata!.executionTime).toBeGreaterThanOrEqual(0);
  });

  it('should handle abort signal', async () => {
    const controller = new AbortController();
    controller.abort();

    const questions: Question[] = [
      {
        question: 'Which option?',
        header: 'Options',
        options: [
          { label: 'A', description: 'Option A' },
          { label: 'B', description: 'Option B' },
        ],
        multiSelect: false,
      },
    ];

    const result = await tool.execute({ questions }, controller.signal);

    expect(result.success).toBe(false);
    expect(result.error).toContain('cancelled');
  });

  it('should format questions clearly', async () => {
    const questions: Question[] = [
      {
        question: 'What is your preferred approach?',
        header: 'Approach',
        options: [
          { label: 'Functional', description: 'Use functional components' },
          { label: 'Class-based', description: 'Use class components' },
        ],
        multiSelect: false,
      },
    ];

    const result = await tool.execute(
      { questions },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    const content = result.llmContent as string;
    expect(content).toContain('[Approach]');
    expect(content).toContain('What is your preferred approach?');
    expect(content).toContain('1. Functional');
    expect(content).toContain('Use functional components');
    expect(content).toContain('2. Class-based');
    expect(content).toContain('Use class components');
  });

  it('should report correct tool name', () => {
    expect(tool.name).toBe('AskUserQuestion');
  });
});
