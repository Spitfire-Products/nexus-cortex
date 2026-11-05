/**
 * Console secret redaction (2026-11-03).
 *
 * The bundled @anthropic-ai/sdk (0.20.x) prints every request's raw headers — including `x-api-key` — through console.log
 * whenever process.env.DEBUG === 'true', and DEBUG=true is also the harness's own debug switch. A cx-local run on 11-02 wrote
 * the operator's Anthropic key into nine server logs that way. Any other dependency that logs a request can do the same, so
 * the fix is at the sink: every console line is formatted once, secret values are replaced, and the masked line is printed.
 *
 * What is masked: values of secret-like environment variables (…_API_KEY, …_TOKEN, …_SECRET, …_KEY, PASSWORD, ≥ 12 chars),
 * every vault value (maskSecretText), and the value of credential headers / bearer tokens by pattern.
 * Installed once per process by bootstrapEnv. CORTEX_LOG_REDACTION=off disables it (debugging the redactor itself).
 */
import { formatWithOptions } from 'node:util';
import { maskSecrets, maskSecretText } from './secretsVault.js';

const SECRET_NAME = /(?:^|_)(?:API_KEY|KEY|TOKEN|SECRET|PASSWORD|PASS|PAT|CREDENTIALS?)$|^(?:ANTHROPIC|OPENAI|XAI|DEEPSEEK|GEMINI|GOOGLE)_.*KEY/i;
const NOT_SECRET = /^(?:CORTEX_SECRETS_KEY_FILE|.*_KEY_NOTE|.*_KEY_PATH|.*_TOKEN_LIMIT|.*_MAX_TOKENS?|.*_TOKENS)$/i;
// Credential headers in util.inspect / JSON / HTTP text form, and bearer tokens.
const HEADER_PATTERNS: RegExp[] = [
  // The value never includes a backslash, and an escaped quote (\") may open it: on JSON-escaped text (a CLI --json answer) the old
  // class ate the backslash of `\"` and left a bare quote — ms-after-r5 Best Buy: `site cookie: locStoreId=513\"` → invalid JSON, answer
  // lost to the judge (2026-11-04).
  /((?:\\?['"]?)(?:x-api-key|api-key|x-goog-api-key|authorization|proxy-authorization|cookie|set-cookie)(?:\\?['"]?)\s*[:=]\s*(?:\\?['"])?)(?:Bearer\s+|Basic\s+)?(?!«)[^'"\s,}«\\]{8,}/gi,
  /(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/g,
];

let installed = false;
let cache: { sig: string; values: Array<{ name: string; value: string }> } = { sig: '', values: [] };

function envSecretValues(env: NodeJS.ProcessEnv): Array<{ name: string; value: string }> {
  const names = Object.keys(env).filter((n) => SECRET_NAME.test(n) && !NOT_SECRET.test(n));
  const sig = names.map((n) => `${n}:${(env[n] ?? '').length}`).join('|');
  if (sig === cache.sig) return cache.values;
  const values = names.map((name) => ({ name, value: env[name] ?? '' })).filter((v) => v.value.length >= 12 && !/^(true|false|\d+)$/i.test(v.value));
  cache = { sig, values };
  return values;
}

/** Mask secrets in one already-formatted log line. Exported for tests and for writers that bypass console. */
export function redactLogText(text: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!text) return text;
  let out = maskSecretText(text);
  out = maskSecrets(out, envSecretValues(env));
  for (const re of HEADER_PATTERNS) out = out.replace(re, (_m, p1: string) => `${p1}«redacted»`);
  return out;
}

/** Wrap console.log/info/warn/error/debug/trace so every line is redacted before it is written. Idempotent. */
export function installConsoleRedaction(env: NodeJS.ProcessEnv = process.env): boolean {
  if (installed || /^(off|false|0)$/i.test(env.CORTEX_LOG_REDACTION ?? '')) return false;
  installed = true;
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
    const original = console[method].bind(console) as (...a: unknown[]) => void;
    (console as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
      if (args.length === 0) return original();
      let line: string;
      try { line = redactLogText(formatWithOptions({ colors: false }, ...args), env); } catch { return original(...args); }
      original(line);
    };
  }
  return true;
}
