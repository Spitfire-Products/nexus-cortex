import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SystemReminderInjector } from '../SystemReminderInjector.js';

describe('SystemReminderInjector — auto-research PM capability hint (AUTORESEARCH_AGENTS)', () => {
  const inj = new SystemReminderInjector();
  let savedMode: string | undefined;
  let savedAgent: string | undefined;

  beforeEach(() => { savedMode = process.env.AUTORESEARCH_AGENTS; savedAgent = process.env.CORTEX_AGENT_MODE; delete process.env.CORTEX_AGENT_MODE; });
  afterEach(() => {
    if (savedMode === undefined) delete process.env.AUTORESEARCH_AGENTS; else process.env.AUTORESEARCH_AGENTS = savedMode;
    if (savedAgent === undefined) delete process.env.CORTEX_AGENT_MODE; else process.env.CORTEX_AGENT_MODE = savedAgent;
  });

  it('off / unset / invalid → null (main context stays clean)', () => {
    process.env.AUTORESEARCH_AGENTS = 'off';
    expect(inj.buildAutoResearchCapabilitySection()).toBeNull();
    delete process.env.AUTORESEARCH_AGENTS;
    expect(inj.buildAutoResearchCapabilitySection()).toBeNull();
    process.env.AUTORESEARCH_AGENTS = 'bogus';
    expect(inj.buildAutoResearchCapabilitySection()).toBeNull();
  });

  it('native → PM delegation hint in native mode (internal tools)', () => {
    process.env.AUTORESEARCH_AGENTS = 'native';
    const note = inj.buildAutoResearchCapabilitySection();
    expect(note).toContain('EXECUTION MODE: native');
    expect(note).toContain('internal tools');
    expect(note).toContain('autoresearch-agent');
    expect(note).toContain('do NOT run experiments yourself');
  });

  it('mcp → hint routes experiment-running to the MCP', () => {
    process.env.AUTORESEARCH_AGENTS = 'mcp';
    const note = inj.buildAutoResearchCapabilitySection();
    expect(note).toContain('EXECUTION MODE: mcp');
    expect(note).toContain('MCP');
  });

  it('inside a subagent (CORTEX_AGENT_MODE=true) → null (no recursion)', () => {
    process.env.AUTORESEARCH_AGENTS = 'native';
    process.env.CORTEX_AGENT_MODE = 'true';
    expect(inj.buildAutoResearchCapabilitySection()).toBeNull();
  });
});
