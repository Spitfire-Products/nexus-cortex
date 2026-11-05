/**
 * SecretsList Tool Executor — the agent's view of the encrypted secrets vault (~/.cortex/secrets.enc; core config/secretsVault.ts,
 * docs/SECRETS_VAULT_PLAN.md Phase 2). Names, providers and bindings only — never values. Lets the agent tell the user which key to
 * bind instead of guessing why a command lacks credentials.
 */
import { BaseTool, type ToolResult } from '../../base/index.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';
import { describeVaultForAgent } from '@nexus-cortex/core';

export type SecretsListToolParams = Record<string, never>;

export class SecretsListToolExecutor extends BaseTool<SecretsListToolParams, ToolResult> {
  constructor(private config: ExecutorConfig) {
    super(
      'SecretsList',
      'SecretsList',
      'List the secrets in the user\'s encrypted vault (names, providers, which env vars they are bound to) — never their values.',
      { type: 'object', properties: {} },
    );
    void this.config;
  }

  validateToolParams(_params: SecretsListToolParams): string | null { return null; }

  async execute(_params: SecretsListToolParams, _signal: AbortSignal): Promise<ToolResult> {
    const startTime = Date.now();
    try {
      const d = describeVaultForAgent();
      const lines: string[] = [];
      if (!d.unlocked) lines.push(`Secrets vault: ${d.note}.`);
      else {
        lines.push(`Secrets vault: unlocked (${d.source}), ${d.secrets.length} secret(s).`);
        for (const s of d.secrets) lines.push(`- ${s.name}${s.provider ? ` [${s.provider}${s.type ? `/${s.type}` : ''}]` : ''}${s.boundAs.length ? ` → bound as ${s.boundAs.join(', ')}` : ' → not bound (not visible to shell/tool processes)'}`);
        lines.push('', d.note);
      }
      return { ...this.createSuccessResult(lines.join('\n')), metadata: { executionTime: Date.now() - startTime, count: d.secrets.length } };
    } catch (error: any) {
      return { ...this.createErrorResult(`Failed to read the secrets vault: ${error.message}`), metadata: { executionTime: Date.now() - startTime } };
    }
  }
}
