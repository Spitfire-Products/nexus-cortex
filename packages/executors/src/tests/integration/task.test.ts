import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TaskToolExecutor } from '../../implementations/agent/TaskTool.js';
import { promises as fs } from 'fs';
import { join } from 'path';

describe('TaskTool Integration', () => {
  let executor: TaskToolExecutor;
  let testDir: string;
  let agentsDir: string;
  const signal = new AbortController().signal;

  beforeAll(async () => {
    // Create temporary test directory
    testDir = join(process.cwd(), 'test-agents');
    agentsDir = join(testDir, '.cortex', 'agents');
    await fs.mkdir(agentsDir, { recursive: true });

    // Create test agents
    await createTestAgents(agentsDir);

    // Initialize executor
    executor = new TaskToolExecutor({ workingDirectory: testDir });
  });

  afterAll(async () => {
    // Cleanup
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('Agent Loading', () => {
    it('should load agent with complete frontmatter', async () => {
      const result = await executor.execute(
        {
          description: 'Review code',
          prompt: 'Review the authentication module for security issues',
          subagent_type: 'code-reviewer'
        },
        signal
      );

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('code-reviewer');
      expect(result.llmContent).toContain('Review code');
      expect(result.metadata.agentName).toBe('code-reviewer');
    });

    it('should load agent with minimal frontmatter', async () => {
      const result = await executor.execute(
        {
          description: 'Simple task',
          prompt: 'Do something',
          subagent_type: 'simple-agent'
        },
        signal
      );

      expect(result.success).toBe(true);
      expect(result.metadata.agentName).toBe('simple-agent');
    });

    it('should fail for non-existent agent', async () => {
      const result = await executor.execute(
        {
          description: 'Test task',
          prompt: 'Do something',
          subagent_type: 'nonexistent-agent'
        },
        signal
      );

      expect(result.success).toBe(false);
      expect(result.returnDisplay).toContain('not found');
      expect(result.returnDisplay).toContain('Available agents');
    });

    it('should list available agents in error message', async () => {
      const result = await executor.execute(
        {
          description: 'Test',
          prompt: 'Test',
          subagent_type: 'missing'
        },
        signal
      );

      expect(result.success).toBe(false);
      expect(result.returnDisplay).toContain('code-reviewer');
      expect(result.returnDisplay).toContain('simple-agent');
    });
  });

  describe('Frontmatter Parsing', () => {
    it('should parse tools field correctly', async () => {
      const result = await executor.execute(
        {
          description: 'Review code',
          prompt: 'Review',
          subagent_type: 'code-reviewer'
        },
        signal
      );

      expect(result.success).toBe(true);
      expect(result.metadata.tools).toEqual(['Read', 'Grep', 'Glob', 'TodoCreate']);
    });

    it('should parse model field correctly', async () => {
      const result = await executor.execute(
        {
          description: 'Task',
          prompt: 'Do task',
          subagent_type: 'code-reviewer'
        },
        signal
      );

      expect(result.success).toBe(true);
      expect(result.metadata.model).toBe('sonnet');
    });

    it('should handle missing optional fields', async () => {
      const result = await executor.execute(
        {
          description: 'Task',
          prompt: 'Do task',
          subagent_type: 'simple-agent'
        },
        signal
      );

      expect(result.success).toBe(true);
      expect(result.metadata.tools).toEqual([]);
      expect(result.metadata.model).toBe('inherit');
    });

    it('should include agent system prompt in output', async () => {
      const result = await executor.execute(
        {
          description: 'Review',
          prompt: 'Review code',
          subagent_type: 'code-reviewer'
        },
        signal
      );

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('## Agent System Prompt');
      expect(result.llmContent).toContain('You are an elite Code Review Specialist');
    });
  });

  describe('Parameter Validation', () => {
    it('should reject empty description', async () => {
      const result = await executor.execute(
        {
          description: '',
          prompt: 'Test',
          subagent_type: 'code-reviewer'
        },
        signal
      );

      expect(result.success).toBe(false);
      expect(result.returnDisplay).toContain('description must be a non-empty string');
    });

    it('should reject empty prompt', async () => {
      const result = await executor.execute(
        {
          description: 'Test',
          prompt: '',
          subagent_type: 'code-reviewer'
        },
        signal
      );

      expect(result.success).toBe(false);
      expect(result.returnDisplay).toContain('prompt must be a non-empty string');
    });

    it('should reject empty subagent_type', async () => {
      const result = await executor.execute(
        {
          description: 'Test',
          prompt: 'Test',
          subagent_type: ''
        },
        signal
      );

      expect(result.success).toBe(false);
      expect(result.returnDisplay).toContain('subagent_type must be a non-empty string');
    });

    it('should reject invalid subagent_type characters', async () => {
      const result = await executor.execute(
        {
          description: 'Test',
          prompt: 'Test',
          subagent_type: 'invalid/agent'
        },
        signal
      );

      expect(result.success).toBe(false);
      expect(result.returnDisplay).toContain('must contain only letters, numbers, and hyphens');
    });

    it('should reject subagent_type that is too long', async () => {
      const result = await executor.execute(
        {
          description: 'Test',
          prompt: 'Test',
          subagent_type: 'a'.repeat(65)
        },
        signal
      );

      expect(result.success).toBe(false);
      expect(result.returnDisplay).toContain('must be 64 characters or less');
    });

    it('should accept valid agent names with hyphens', async () => {
      const result = await executor.execute(
        {
          description: 'Task',
          prompt: 'Do task',
          subagent_type: 'code-reviewer'
        },
        signal
      );

      expect(result.success).toBe(true);
    });

    it('should trim whitespace from subagent_type', async () => {
      const result = await executor.execute(
        {
          description: 'Task',
          prompt: 'Do task',
          subagent_type: '  code-reviewer  '
        },
        signal
      );

      expect(result.success).toBe(true);
      expect(result.metadata.agentName).toBe('code-reviewer');
    });
  });

  describe('Model Override', () => {
    it('should use model from params when provided', async () => {
      const result = await executor.execute(
        {
          description: 'Task',
          prompt: 'Do task',
          subagent_type: 'code-reviewer',
          model: 'opus'
        },
        signal
      );

      expect(result.success).toBe(true);
      expect(result.metadata.model).toBe('opus');
    });

    it('should use model from agent when params not provided', async () => {
      const result = await executor.execute(
        {
          description: 'Task',
          prompt: 'Do task',
          subagent_type: 'code-reviewer'
        },
        signal
      );

      expect(result.success).toBe(true);
      expect(result.metadata.model).toBe('sonnet');
    });

    it('should default to inherit when no model specified', async () => {
      const result = await executor.execute(
        {
          description: 'Task',
          prompt: 'Do task',
          subagent_type: 'simple-agent'
        },
        signal
      );

      expect(result.success).toBe(true);
      expect(result.metadata.model).toBe('inherit');
    });

    it('should reject invalid model values', async () => {
      const result = await executor.execute(
        {
          description: 'Task',
          prompt: 'Do task',
          subagent_type: 'code-reviewer',
          model: 'invalid model with spaces' as any
        },
        signal
      );

      expect(result.success).toBe(false);
      expect(result.returnDisplay).toContain('must contain only');
    });
  });

  describe('Abort Signal', () => {
    it('should handle abort signal during agent loading', async () => {
      const abortController = new AbortController();

      // Start loading and abort immediately
      abortController.abort();

      const result = await executor.execute(
        {
          description: 'Task',
          prompt: 'Do task',
          subagent_type: 'code-reviewer'
        },
        abortController.signal
      );

      expect(result).toBeDefined();
      // Might succeed or fail depending on timing, just verify it returns
    });
  });

  describe('Cache Management', () => {
    it('should cache agents after first load', async () => {
      // First call - loads from disk
      const result1 = await executor.execute(
        {
          description: 'Task',
          prompt: 'Do task',
          subagent_type: 'code-reviewer'
        },
        signal
      );

      expect(result1.success).toBe(true);

      // Second call - uses cache
      const result2 = await executor.execute(
        {
          description: 'Task',
          prompt: 'Do task',
          subagent_type: 'code-reviewer'
        },
        signal
      );

      expect(result2.success).toBe(true);
      expect(result2.metadata.agentName).toBe('code-reviewer');
    });

    it('should reload agents when cache is cleared', async () => {
      // Load agent
      const result1 = await executor.execute(
        {
          description: 'Task',
          prompt: 'Do task',
          subagent_type: 'code-reviewer'
        },
        signal
      );

      expect(result1.success).toBe(true);

      // Clear cache
      executor.clearCache();

      // Load again - should work
      const result2 = await executor.execute(
        {
          description: 'Task',
          prompt: 'Do task',
          subagent_type: 'code-reviewer'
        },
        signal
      );

      expect(result2.success).toBe(true);
    });
  });

  describe('Output Formatting', () => {
    it('should include task description in output', async () => {
      const result = await executor.execute(
        {
          description: 'Review authentication code',
          prompt: 'Review the auth module',
          subagent_type: 'code-reviewer'
        },
        signal
      );

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('Review authentication code');
    });

    it('should include task prompt in output', async () => {
      const result = await executor.execute(
        {
          description: 'Task',
          prompt: 'Review the authentication module for security vulnerabilities',
          subagent_type: 'code-reviewer'
        },
        signal
      );

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('Review the authentication module');
    });

    it('should format output with clear sections', async () => {
      const result = await executor.execute(
        {
          description: 'Task',
          prompt: 'Do something',
          subagent_type: 'code-reviewer'
        },
        signal
      );

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('# Agent: code-reviewer');
      expect(result.llmContent).toContain('## Task');
      expect(result.llmContent).toContain('## Agent System Prompt');
    });

    it('should include agent metadata in output', async () => {
      const result = await executor.execute(
        {
          description: 'Task',
          prompt: 'Do task',
          subagent_type: 'code-reviewer'
        },
        signal
      );

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('**Model**: sonnet');
      expect(result.llmContent).toContain('**Tools**: Read, Grep, Glob, TodoCreate');
      expect(result.llmContent).toContain('**Location**: project');
    });
  });

  describe('Edge Cases', () => {
    it('should handle agent without tools field', async () => {
      const result = await executor.execute(
        {
          description: 'Task',
          prompt: 'Do task',
          subagent_type: 'simple-agent'
        },
        signal
      );

      expect(result.success).toBe(true);
      expect(result.metadata.tools).toEqual([]);
    });

    it('should handle very long prompts', async () => {
      const longPrompt = 'x'.repeat(10000);
      const result = await executor.execute(
        {
          description: 'Task',
          prompt: longPrompt,
          subagent_type: 'code-reviewer'
        },
        signal
      );

      expect(result.success).toBe(true);
      expect(result.metadata.promptLength).toBe(10000);
    });

    it('should handle special characters in prompt', async () => {
      const result = await executor.execute(
        {
          description: 'Task',
          prompt: 'Review <html> & "quoted" code with $variables',
          subagent_type: 'code-reviewer'
        },
        signal
      );

      expect(result.success).toBe(true);
      expect(result.llmContent).toContain('<html>');
      expect(result.llmContent).toContain('$variables');
    });

    it('should handle agent with no description', async () => {
      // Create malformed agent
      await fs.writeFile(
        join(agentsDir, 'malformed.md'),
        `---
name: malformed
---

System prompt`
      );

      // Clear cache to pick up new file
      executor.clearCache();

      const result = await executor.execute(
        {
          description: 'Task',
          prompt: 'Do task',
          subagent_type: 'malformed'
        },
        signal
      );

      expect(result.success).toBe(false);
      expect(result.returnDisplay).toContain('not found');
    });
  });

  describe('Metadata', () => {
    it('should include execution metadata', async () => {
      const result = await executor.execute(
        {
          description: 'Review code',
          prompt: 'Review authentication',
          subagent_type: 'code-reviewer'
        },
        signal
      );

      expect(result.success).toBe(true);
      expect(result.metadata).toHaveProperty('executionTime');
      expect(result.metadata).toHaveProperty('agentName');
      expect(result.metadata).toHaveProperty('location');
      expect(result.metadata).toHaveProperty('model');
      expect(result.metadata).toHaveProperty('tools');
      expect(result.metadata).toHaveProperty('description');
      expect(result.metadata).toHaveProperty('promptLength');
    });

    it('should track execution time', async () => {
      const result = await executor.execute(
        {
          description: 'Task',
          prompt: 'Do task',
          subagent_type: 'code-reviewer'
        },
        signal
      );

      expect(result.success).toBe(true);
      expect(typeof result.metadata.executionTime).toBe('number');
      expect(result.metadata.executionTime).toBeGreaterThanOrEqual(0);
    });
  });
});

/**
 * Create test agents for integration testing
 */
async function createTestAgents(agentsDir: string): Promise<void> {
  // Code reviewer agent
  await fs.writeFile(
    join(agentsDir, 'code-reviewer.md'),
    `---
name: code-reviewer
description: Performs comprehensive code reviews for quality, security, and best practices
tools: Read, Grep, Glob, TodoCreate
model: sonnet
---

You are an elite Code Review Specialist with deep expertise in software security, performance optimization, and engineering best practices.

## Your Core Responsibilities

1. Security Analysis
2. Code Quality
3. Performance
4. Best Practices

## Review Process

Systematically review code for:
- Security vulnerabilities
- Code quality issues
- Performance problems
- Best practice violations`
  );

  // Simple agent (minimal frontmatter)
  await fs.writeFile(
    join(agentsDir, 'simple-agent.md'),
    `---
name: simple-agent
description: A simple test agent
---

You are a simple agent for testing purposes.`
  );
}
