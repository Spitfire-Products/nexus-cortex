/**
 * Single-message sender — sends one prompt to the server and exits.
 * Used by `fuzzycortex-cli message <prompt>`.
 * Follows the same HTTP pattern as cortex.js.
 */

const BASE_URL = process.env.CORTEX_URL || `http://localhost:${process.env.PORT || '4000'}`;

interface SingleMessageOptions {
  serverUrl?: string;
  model?: string;
  system?: string;
  maxTokens?: number;
  json?: boolean;
}

export async function sendSingleMessage(prompt: string, options: SingleMessageOptions = {}): Promise<void> {
  const baseUrl = options.serverUrl || BASE_URL;

  // Check server health
  try {
    const healthResp = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!healthResp.ok) {
      throw new Error(`Server returned ${healthResp.status}`);
    }
  } catch (err: any) {
    if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
      process.stderr.write(`No server running on ${baseUrl}\n`);
      process.stderr.write('Start one with:\n');
      process.stderr.write(' node packages/server/dist/index.js &\n');
      process.exit(1);
    }
    process.stderr.write(`Server health check failed: ${err.message}\n`);
    process.exit(1);
  }

  // Build payload
  const payload: Record<string, any> = {
    model: options.model || process.env.DEFAULT_MODEL_ID || 'grok-code-fast-1',
    messages: [{ role: 'user', content: prompt }],
  };
  if (options.system) payload.system = options.system;
  if (options.maxTokens) payload.max_tokens = options.maxTokens;

  // Send message
  let data: any;
  try {
    const resp = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(600000), // 10 min
    });
    if (!resp.ok) {
      const text = await resp.text();
      process.stderr.write(`Server error: HTTP ${resp.status}: ${text}\n`);
      process.exit(1);
    }
    data = await resp.json();
  } catch (err: any) {
    process.stderr.write(`Request failed: ${err.message}\n`);
    process.exit(1);
  }

  // Output
  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    const text = (data.content || [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n');
    console.log(text);

    // Usage stats to stderr
    const usage = data.usage || {};
    const tools = (data.toolUses || []).length;
    const iterations = data.metadata?.toolCallIterations || 0;
    const parts: string[] = [];
    if (usage.inputTokens) parts.push(`${usage.inputTokens} in`);
    if (usage.outputTokens) parts.push(`${usage.outputTokens} out`);
    if (tools > 0) parts.push(`${tools} tool${tools > 1 ? 's' : ''}`);
    if (iterations > 0) parts.push(`${iterations} iteration${iterations > 1 ? 's' : ''}`);
    if (parts.length > 0) {
      process.stderr.write(`\n[${parts.join(' | ')}]\n`);
    }
  }
}
