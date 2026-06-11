import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  checkAutoResearchPlanGate,
  markAutoResearchPlanMode,
  resetAutoResearchPlanGate,
} from '../autoResearchPlanGate.js';
import { TodoCreateTool, resetTodoState } from '../../implementations/ui/TodoWriteTool.js';

describe('autoResearchPlanGate — hard plan-gate for autoresearch-agent launches', () => {
  let savedStdin: unknown, savedStdout: unknown, savedEnv: string | undefined;
  const setTTY = (v: boolean) => { (process.stdin as any).isTTY = v; (process.stdout as any).isTTY = v; };

  beforeEach(() => {
    savedStdin = (process.stdin as any).isTTY;
    savedStdout = (process.stdout as any).isTTY;
    savedEnv = process.env.AUTORESEARCH_AGENTS;
    resetTodoState();
    resetAutoResearchPlanGate();
  });
  afterEach(() => {
    (process.stdin as any).isTTY = savedStdin;
    (process.stdout as any).isTTY = savedStdout;
    if (savedEnv === undefined) delete process.env.AUTORESEARCH_AGENTS; else process.env.AUTORESEARCH_AGENTS = savedEnv;
  });

  it('non-autoresearch-agent subagents are never gated', () => {
    process.env.AUTORESEARCH_AGENTS = 'native'; setTTY(true);
    expect(checkAutoResearchPlanGate('code-reviewer')).toBeNull();
  });

  it('feature off → not gated', () => {
    process.env.AUTORESEARCH_AGENTS = 'off'; setTTY(false);
    expect(checkAutoResearchPlanGate('autoresearch-agent')).toBeNull();
  });

  it('interactive + no plan mode → BLOCKED (requires plan mode)', () => {
    process.env.AUTORESEARCH_AGENTS = 'native'; setTTY(true);
    const r = checkAutoResearchPlanGate('autoresearch-agent');
    expect(r).toContain('BLOCKED');
    expect(r).toContain('PLAN MODE');
  });

  it('interactive + plan mode used → allowed', () => {
    process.env.AUTORESEARCH_AGENTS = 'native'; setTTY(true);
    markAutoResearchPlanMode();
    expect(checkAutoResearchPlanGate('autoresearch-agent')).toBeNull();
  });

  it('headless + no todos → BLOCKED (requires a TodoCreate checklist)', () => {
    process.env.AUTORESEARCH_AGENTS = 'mcp'; setTTY(false);
    const r = checkAutoResearchPlanGate('autoresearch-agent');
    expect(r).toContain('BLOCKED');
    expect(r).toContain('TodoCreate');
  });

  it('headless + a TODO plan exists → allowed', async () => {
    process.env.AUTORESEARCH_AGENTS = 'native'; setTTY(false);
    const tool = new TodoCreateTool({ workingDirectory: process.cwd() } as any);
    await tool.execute({ content: 'Plan: define the metric + control + per-arm variation' } as any, new AbortController().signal);
    expect(checkAutoResearchPlanGate('autoresearch-agent')).toBeNull();
  });
});
