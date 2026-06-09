/**
 * ExitPlanModeTool Integration Tests
 *
 * Tests plan presentation and mode transition signaling
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ExitPlanModeTool } from '../../implementations/ui/ExitPlanModeTool.js';
import { ToolRegistry, type ExecutorConfig } from '../../base/ToolRegistry.js';

describe('ExitPlanModeTool Integration', () => {
  let tool: ExitPlanModeTool;
  let registry: ToolRegistry;
  let config: ExecutorConfig;

  beforeEach(() => {
    config = {
      workingDirectory: process.cwd(),
      allowFileSystem: true,
    };

    tool = new ExitPlanModeTool(config);
    registry = new ToolRegistry(config);
    registry.registerTool(tool);
  });

  it('should present a basic plan', async () => {
    const plan = `
## Implementation Plan

1. Create database schema
2. Implement authentication
3. Build REST API
4. Add tests
`;

    const result = await tool.execute(
      { plan },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('Plan Ready for Execution');
    expect(result.llmContent).toContain('Implementation Plan');
    expect(result.llmContent).toContain('database schema');
    expect(result.llmContent).toContain('Waiting for user approval');
  });

  it('should handle markdown formatting', async () => {
    const plan = `
## Phase 1: Setup
**Duration**: 2 hours

- Install dependencies
- Configure environment

## Phase 2: Implementation
**Duration**: 4 hours

- Write core logic
- Add error handling
`;

    const result = await tool.execute(
      { plan },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('Phase 1');
    expect(result.llmContent).toContain('Phase 2');
    expect(result.metadata?.hasMarkdown).toBe(true);
  });

  it('should validate plan is not empty', async () => {
    const result = await tool.execute(
      { plan: '' },
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Plan cannot be empty');
  });

  it('should validate minimum plan length', async () => {
    const result = await tool.execute(
      { plan: 'Too short' }, // Less than 10 chars
      new AbortController().signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Plan is too short');
    expect(result.error).toContain('at least 10 characters');
  });

  it('should accept minimal valid plan', async () => {
    const plan = '1. Do this\n2. Then that';

    const result = await tool.execute(
      { plan },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('Do this');
  });

  it('should handle long detailed plans', async () => {
    const plan = Array(100)
      .fill(null)
      .map((_, i) => `${i + 1}. Step ${i + 1}`)
      .join('\n');

    const result = await tool.execute(
      { plan },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.metadata?.wordCount).toBeGreaterThan(100);
  });

  it('should calculate plan metrics', async () => {
    const plan = `
Line 1
Line 2
Line 3

**Bold text** and regular text
`;

    const result = await tool.execute(
      { plan },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.metadata?.lineCount).toBeGreaterThan(0);
    expect(result.metadata?.wordCount).toBeGreaterThan(0);
    expect(result.metadata?.planLength).toBeGreaterThan(0);
    expect(result.metadata?.hasMarkdown).toBe(true);
  });

  it('should detect non-markdown plans', async () => {
    const plan = 'Simple plan without markdown formatting';

    const result = await tool.execute(
      { plan },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.metadata?.hasMarkdown).toBe(false);
  });

  it('should work via ToolRegistry', async () => {
    const plan = 'Test plan via registry';

    const result = await registry.executeTool('ExitPlanMode', { plan });

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('Test plan via registry');
  });

  it('should include metadata in result', async () => {
    const plan = 'A simple test plan with multiple words';

    const result = await tool.execute(
      { plan },
      new AbortController().signal,
    );

    expect(result.metadata).toBeDefined();
    expect(result.metadata!.planLength).toBe(plan.length);
    expect(result.metadata!.wordCount).toBeGreaterThan(0);
    expect(result.metadata!.lineCount).toBeGreaterThan(0);
    expect(result.metadata!.executionTime).toBeGreaterThanOrEqual(0);
  });

  it('should handle abort signal', async () => {
    const controller = new AbortController();
    controller.abort();

    const plan = 'Test plan for abort';

    const result = await tool.execute({ plan }, controller.signal);

    expect(result.success).toBe(false);
    expect(result.error).toContain('cancelled');
  });

  it('should format plan output consistently', async () => {
    const plan = 'Test plan formatting';

    const result = await tool.execute(
      { plan },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    const content = result.llmContent as string;
    expect(content).toContain('=== Plan Ready for Execution ===');
    expect(content).toContain('Test plan formatting');
    expect(content).toContain('Ready to exit plan mode');
    expect(content).toContain('Waiting for user approval');
  });

  it('should handle multiline plans', async () => {
    const plan = `Step 1: Setup
Step 2: Implementation
Step 3: Testing
Step 4: Deployment`;

    const result = await tool.execute(
      { plan },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('Step 1');
    expect(result.llmContent).toContain('Step 4');
    expect(result.metadata?.lineCount).toBe(4);
  });

  it('should handle plans with special characters', async () => {
    const plan = 'Plan with $pecial ch@racters & symbols!';

    const result = await tool.execute(
      { plan },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(result.llmContent).toContain('$pecial');
    expect(result.llmContent).toContain('@racters');
  });

  it('should report correct tool name', () => {
    expect(tool.name).toBe('ExitPlanMode');
  });

  it('should provide helpful description', async () => {
    const plan = 'A comprehensive implementation plan with detailed steps';

    const result = await tool.execute(
      { plan },
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    const description = tool.getDescription({ plan });
    expect(description).toContain('plan for approval');
    expect(description).toContain('words');
  });
});
