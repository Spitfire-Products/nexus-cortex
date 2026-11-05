/**
 * Debug logging of provider requests (2026-11-03). DEBUG=true used to print every FULL request — the whole conversation plus every tool
 * schema, on every round — so a debug log grew with the square of the turn count (CarMax: 27.6 MB, ~80% of it these dumps, against <1 MB
 * of canonical session records holding the same conversation). The canonical append-only session record (.cortex/sessions/<id>.jsonl, one
 * row per message) is the source for WHAT was said; the debug log keeps diagnostics. Per request it now logs one summary line plus only the
 * messages that are new since that conversation's previous request (role, content kinds, size, tool names), each with its index — the
 * message's position in the request, which is also its row order in the canonical record.
 * CORTEX_DEBUG_FULL_REQUESTS=true restores the full dumps (rare wire-level debugging).
 */
import { createHash } from 'node:crypto';

const lastCount = new Map<string, number>();

export function fullRequestDumps(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|on)$/i.test(String(env.CORTEX_DEBUG_FULL_REQUESTS ?? '').trim());
}

/** A stable key for one conversation: the first two messages (system + first user) do not change across its requests. */
function conversationKey(messages: any[]): string {
  const head = JSON.stringify(messages.slice(0, 2)).slice(0, 4000);
  return createHash('sha1').update(head).digest('hex').slice(0, 10);
}

function describe(m: any, i: number): string {
  const c = m?.content;
  let kinds = ''; let chars = 0;
  if (typeof c === 'string') { kinds = 'text'; chars = c.length; }
  else if (Array.isArray(c)) { kinds = c.map((b: any) => b?.type ?? '?').join('+'); chars = JSON.stringify(c).length; }
  const tools = Array.isArray(m?.tool_calls) ? ` calls=${m.tool_calls.map((t: any) => t?.function?.name ?? '?').join(',')}` : '';
  const tid = m?.tool_call_id ? ` result_for=${String(m.tool_call_id).slice(0, 24)}` : '';
  const reasoning = typeof m?.reasoning_content === 'string' && m.reasoning_content ? ` reasoning=${m.reasoning_content.length}ch` : '';
  return `#${i} ${m?.role ?? '?'} ${kinds || '-'} ${chars}ch${tools}${tid}${reasoning}`;
}

/** The log text for an OpenAI-compatible chat request (summary + new messages), or the full dump when that lever is on. */
export function describeChatRequest(req: any): string {
  if (fullRequestDumps()) return JSON.stringify(req, null, 2);
  const messages: any[] = Array.isArray(req?.messages) ? req.messages : [];
  const key = conversationKey(messages);
  const prev = lastCount.get(key) ?? 0;
  const from = prev > 0 && prev <= messages.length ? prev : 0;
  lastCount.set(key, messages.length);
  if (lastCount.size > 500) lastCount.delete(lastCount.keys().next().value as string);
  const chars = JSON.stringify(messages).length;
  const tools = Array.isArray(req?.tools) ? req.tools.length : 0;
  const head = `model=${req?.model} conv=${key} messages=${messages.length} (+${messages.length - from} new) tools=${tools} ~${Math.round(chars / 4)} tok` +
    `${req?.stream ? ' stream' : ''}${req?.max_tokens ? ` max_tokens=${req.max_tokens}` : ''}${req?.reasoning_effort ? ` effort=${req.reasoning_effort}` : ''}`;
  const fresh = messages.slice(from).map((m, j) => '  ' + describe(m, from + j));
  return [head, ...fresh].join('\n') + (from === 0 && messages.length > 2 ? '\n  (first request of this conversation seen by this process: all messages listed)' : '');
}
