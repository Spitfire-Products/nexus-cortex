/**
 * List configuration categories
 */
import { SETTINGS_METADATA } from '@nexus-cortex/core';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ConfigCategoriesOptions {
  json?: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  api_keys: 'API Keys',
  models: 'Models',
  system: 'System',
  mentorship: 'Mentorship',
  context: 'Context Management',
  session: 'Session',
  loop_control: 'Loop Control',
  server_side_tools: 'Tools & Execution',
  model_router: 'Model Router',
  agent_workspace: 'Agent Workspace',
  training: 'Training & Audit',
  runtime: 'Runtime',
};

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  api_keys: 'API keys and authentication',
  models: 'Default model, helper model, web tools model',
  system: 'Debug, emoji, project path',
  mentorship: 'AI-to-AI mentorship, keywords, patterns',
  context: 'Context budget, prompt caching',
  session: 'Session storage, MCP, system messages',
  loop_control: 'Tool iterations, timeouts, loop detection',
  server_side_tools: 'Server-side tools, PTC, deferred loading',
  model_router: 'Auto-routing based on task type',
  agent_workspace: 'Tmux monitoring for parallel agents',
  training: 'EndTurn audit, decision store',
  runtime: 'Orchestrator mode, YOLO, port, auto-resume',
};

/**
 * List configuration categories
 */
export async function configCategories(
  options: ConfigCategoriesOptions = {}
): Promise<void> {
  const theme = ThemeManager.getTheme();

  try {
    const cats: Record<string, number> = {};
    for (const s of SETTINGS_METADATA) {
      cats[s.category] = (cats[s.category] || 0) + 1;
    }

    if (options.json) {
      const result = Object.entries(cats).map(([key, count]) => ({
        key,
        name: CATEGORY_LABELS[key] || key,
        description: CATEGORY_DESCRIPTIONS[key] || '',
        count,
      }));
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(theme.colors.primary('\nConfiguration Categories:'));
    console.log();

    let idx = 1;
    for (const [key, count] of Object.entries(cats)) {
      const label = CATEGORY_LABELS[key] || key;
      const desc = CATEGORY_DESCRIPTIONS[key] || '';
      console.log(theme.colors.highlight(`${idx}. ${label}`) +
        theme.colors.muted(` (${count} settings)`));
      if (desc) console.log(theme.colors.muted(` ${desc}`));
      console.log();
      idx++;
    }

    console.log(theme.colors.muted('Use "cortex config category <name>" to view details'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
