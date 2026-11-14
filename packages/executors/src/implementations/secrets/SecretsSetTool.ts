/**
 * SecretsSet Tool Executor (2026-11-14) — the agent's WRITE path into the encrypted secrets vault (~/.cortex/secrets.enc; core
 * config/secretsVault.ts storeSecretForAgent). Operator: "if the agent is working with keys it should have a way to either add it to the
 * encrypted secrets vault or the encrypted session vault and then it can be used from there without printing". The key is stored
 * encrypted, bound as $NAME for shell/tool processes, and masked as «secret:NAME» in every later tool result. Never returns the value.
 */
import { BaseTool, type ToolResult } from '../../base/index.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';
import { storeSecretForAgent } from '@nexus-cortex/core';

export interface SecretsSetToolParams {
  name: string; value?: string; from_env?: string; from_file?: string; delete_file?: boolean;
  bind?: boolean; env_var?: string; tool?: string; provider?: string; note?: string; overwrite?: boolean;
}

export class SecretsSetToolExecutor extends BaseTool<SecretsSetToolParams, ToolResult> {
  constructor(private config: ExecutorConfig) {
    super(
      'SecretsSet',
      'SecretsSet',
      'Store a key/token in the user\'s encrypted secrets vault, bound as an environment variable for your shell — never printed.',
      {
        type: 'object',
        properties: {
          name: { type: 'string' }, value: { type: 'string' }, from_env: { type: 'string' }, from_file: { type: 'string' },
          delete_file: { type: 'boolean' }, bind: { type: 'boolean' }, env_var: { type: 'string' }, tool: { type: 'string' },
          provider: { type: 'string' }, note: { type: 'string' }, overwrite: { type: 'boolean' },
        },
        required: ['name'],
      },
    );
    void this.config;
  }

  validateToolParams(p: SecretsSetToolParams): string | null {
    if (!p || typeof p.name !== 'string' || !p.name.trim()) return 'name is required (environment-variable style, e.g. OPENAI_API_KEY)';
    const n = [p.value !== undefined, !!p.from_env, !!p.from_file].filter(Boolean).length;
    if (n !== 1) return 'give exactly one of value, from_env or from_file';
    return null;
  }

  async execute(p: SecretsSetToolParams, _signal: AbortSignal): Promise<ToolResult> {
    const startTime = Date.now();
    try {
      const r = storeSecretForAgent({
        name: p.name, value: p.value, fromEnv: p.from_env, fromFile: p.from_file, deleteFile: p.delete_file, bind: p.bind,
        envVar: p.env_var, tool: p.tool, provider: p.provider, note: p.note, overwrite: p.overwrite,
      });
      const lines = [
        `Stored «secret:${r.name}» (${r.chars} chars) in the encrypted vault${r.created ? ' (vault created)' : ''}${r.replaced ? ' — replaced the previous value (kept in secrets.enc.bak)' : ''}.`,
        r.boundAs
          ? `Bound as $${r.boundAs}${r.boundTool ? ` for ${r.boundTool} only` : ' for your shell and tool processes'} — use "$${r.boundAs}" in commands; never echo it.`
          : 'Not bound: tool processes do not see it (call again with bind:true, or the user runs `cortex secrets bind`).',
        `Any tool output containing the value shows «secret:${r.name}» instead.`,
        ...(r.source === 'file' ? [r.fileDeleted ? `Deleted the plaintext file ${p.from_file}.` : `The plaintext file ${p.from_file} is still on disk — remove it (delete_file:true does this).`] : []),
      ];
      return { ...this.createSuccessResult(lines.join('\n')), metadata: { executionTime: Date.now() - startTime, name: r.name, boundAs: r.boundAs, created: r.created, replaced: r.replaced } };
    } catch (error: any) {
      return { ...this.createErrorResult(`SecretsSet: ${error.message}`), metadata: { executionTime: Date.now() - startTime } };
    }
  }
}
