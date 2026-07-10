/**
 * HF Gradio Space output normalizer.
 *
 * A Gradio-space model returns ONE blob of raw text containing the model's NATIVE
 * chain-of-thought (`<think>…</think>`) and tool-call syntax. Different model families
 * emit different tool-call formats; this module converts any of them into the canonical
 * OpenAI shape (`reasoning_content` + `tool_calls[]`) so the rest of the harness — which
 * is provider-agnostic — treats an hf-space model like any chat/completions model.
 *
 * Scoped to the hf-space provider ONLY. Real OpenAI/DeepSeek/etc. responses are already
 * structured and must NOT go through this (they'd be corrupted).
 *
 * (TypeScript port of the bench `toolparse.py`.)
 */

import { randomUUID } from 'crypto';

export interface HFToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string }; // arguments = JSON string (OpenAI shape)
}

export interface ParsedHFCompletion {
  reasoning: string;
  content: string;
  toolCalls: HFToolCall[];
}

const END_TOKENS = ['<|im_end|>', '<|end|>', '<|eot_id|>', '<|endoftext|>', '</s>'];

function mkCall(name: string, args: unknown): HFToolCall {
  return {
    id: 'call_' + randomUUID().replace(/-/g, '').slice(0, 24),
    type: 'function',
    function: {
      name,
      arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
    },
  };
}

function stripEndTokens(s: string): string {
  for (const t of END_TOKENS) s = s.split(t).join('');
  return s.trim();
}

/** Qwen enable_thinking=True puts the opening <think> in the PROMPT, so output has the
 *  closing </think> only. Split at the first </think>: before = reasoning, after = rest.
 *  Families that emit BOTH tags (SmolLM3) can also overrun max_tokens mid-thought,
 *  leaving an opening <think> with no close — treat that whole tail as reasoning
 *  rather than leaking raw think-text into content. */
function extractReasoning(s: string): { reasoning: string; rest: string } {
  const idx = s.indexOf('</think>');
  if (idx === -1) {
    const open = s.indexOf('<think>');
    if (open !== -1) {
      return {
        reasoning: s.slice(open + '<think>'.length).trim(),
        rest: s.slice(0, open).trim(),
      };
    }
    return { reasoning: '', rest: s };
  }
  const reasoning = s.slice(0, idx).replace(/<think>/g, '').trim();
  const rest = s.slice(idx + '</think>'.length).trim();
  return { reasoning, rest };
}

/** LFM2.5 pythonic: `[get_weather(city="Paris"), other(x=1)]` → [{name, arguments}]. */
function parsePythonic(seg: string): Array<{ name: string; arguments: Record<string, unknown> }> {
  const out: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const callRe = /([A-Za-z_]\w*)\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(seg))) {
    const name = m[1]!;
    const argstr = m[2]!;
    const args: Record<string, unknown> = {};
    const argRe = /([A-Za-z_]\w*)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|true|false|-?\d+\.?\d*)/g;
    let a: RegExpExecArray | null;
    while ((a = argRe.exec(argstr))) {
      const k = a[1]!;
      let v = a[2]!;
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        args[k] = v.slice(1, -1);
      } else if (v === 'true' || v === 'false') args[k] = v === 'true';
      else args[k] = Number(v);
    }
    out.push({ name, arguments: args });
  }
  return out;
}

/** Qwen3.5 XML: `<function=name><parameter=k>v</parameter></function>`. */
function parseXml(body: string): Array<{ name: string; arguments: Record<string, string> }> {
  const out: Array<{ name: string; arguments: Record<string, string> }> = [];
  const funcRe = /<function=([^>]+)>([\s\S]*?)<\/function>/g;
  let m: RegExpExecArray | null;
  while ((m = funcRe.exec(body))) {
    const name = m[1]!.trim();
    const args: Record<string, string> = {};
    const paramRe = /<parameter=([^>]+)>\s*([\s\S]*?)\s*<\/parameter>/g;
    let p: RegExpExecArray | null;
    while ((p = paramRe.exec(m[2]!))) args[p[1]!.trim()] = p[2]!.trim();
    out.push({ name, arguments: args });
  }
  return out;
}

/** MiniCPM5 XML (attribute syntax, per openbmb/MiniCPM5-1B chat_template.jinja):
 *  `<function name="n"><param name="k">v</param></function>` — param values may be
 *  wrapped `<![CDATA[...]]>` (emitted for values containing <, & or newlines).
 *  Content and calls are separated by `<tool_sep>`. */
function parseMiniCpmXml(body: string): Array<{ name: string; arguments: Record<string, string> }> {
  const out: Array<{ name: string; arguments: Record<string, string> }> = [];
  const funcRe = /<function name="([^"]+)">([\s\S]*?)<\/function>/g;
  let m: RegExpExecArray | null;
  while ((m = funcRe.exec(body))) {
    const name = m[1]!.trim();
    const args: Record<string, string> = {};
    const paramRe = /<param name="([^"]+)">([\s\S]*?)<\/param>/g;
    let p: RegExpExecArray | null;
    while ((p = paramRe.exec(m[2]!))) {
      let v = p[2]!.trim();
      const cdata = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
      if (cdata) v = cdata[1]!;
      args[p[1]!.trim()] = v;
    }
    out.push({ name, arguments: args });
  }
  return out;
}

export function parseHFCompletion(raw: string): ParsedHFCompletion {
  raw = raw.replace(/^\[MODEL=[^\]]*\]\s*/, '');
  const { reasoning, rest } = extractReasoning(raw);
  raw = rest;

  // 1. LFM2.5 pythonic
  const lfmRe = /<\|tool_call_start\|>([\s\S]*?)<\|tool_call_end\|>/g;
  const lfmSegs: string[] = [];
  let lm: RegExpExecArray | null;
  while ((lm = lfmRe.exec(raw))) lfmSegs.push(lm[1]!);
  if (lfmSegs.length) {
    const tc = lfmSegs.flatMap(parsePythonic).map((o) => mkCall(o.name, o.arguments));
    if (tc.length) return { reasoning, content: stripEndTokens(raw.replace(lfmRe, '')), toolCalls: tc };
  }

  const body = stripEndTokens(raw);

  // 2. Qwen3.5 XML
  if (body.includes('<function=')) {
    const tc = parseXml(body).map((o) => mkCall(o.name, o.arguments));
    if (tc.length) {
      const content = body.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim();
      return { reasoning, content, toolCalls: tc };
    }
  }

  // 2b. MiniCPM5 XML (attribute syntax — `<function name="...">`, unambiguous vs
  // Qwen3.5's `<function=...>`). Calls follow content after a <tool_sep> marker.
  if (body.includes('<function name="')) {
    const tc = parseMiniCpmXml(body).map((o) => mkCall(o.name, o.arguments));
    if (tc.length) {
      const content = body
        .replace(/<function name="[^"]+">[\s\S]*?<\/function>/g, '')
        .replace(/<tool_call>|<\/tool_call>|<tool_sep>/g, '')
        .trim();
      return { reasoning, content, toolCalls: tc };
    }
  }

  // 3. Hermes JSON <tool_call>{...}</tool_call>
  const tc: HFToolCall[] = [];
  const jsonRe = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g;
  let jm: RegExpExecArray | null;
  while ((jm = jsonRe.exec(body))) {
    try {
      const o = JSON.parse(jm[1]!);
      tc.push(mkCall(o.name, o.arguments ?? o.parameters));
    } catch { /* skip */ }
  }
  let content = body.replace(jsonRe, '').trim();

  // 3b. Phi-4-mini token-wrapped array: <|tool_call|>[{...}]<|/tool_call|>
  // (with the tools block rendered, Phi wraps its JSON array in these special
  // tokens rather than emitting it bare; closing token may be truncated away)
  if (!tc.length) {
    const phiRe = /<\|tool_call\|>\s*(\[[\s\S]*?\])\s*(?:<\|\/tool_call\|>)?/g;
    let pm: RegExpExecArray | null;
    while ((pm = phiRe.exec(content))) {
      try {
        const arr = JSON.parse(pm[1]!);
        if (Array.isArray(arr)) {
          for (const o of arr) {
            if (o && typeof o === 'object' && 'name' in o) tc.push(mkCall(o.name, o.arguments ?? o.parameters));
          }
        }
      } catch { /* skip */ }
    }
    if (tc.length) content = content.replace(phiRe, '').replace(/<\|\/?tool_call\|>/g, '').trim();
  }

  // 4. bare JSON array / object (Phi-4-mini)
  if (!tc.length && content.startsWith('[') && content.includes('"name"')) {
    try {
      const arr = JSON.parse(content);
      if (Array.isArray(arr) && arr.every((o) => o && typeof o === 'object' && 'name' in o)) {
        for (const o of arr) tc.push(mkCall(o.name, o.arguments ?? o.parameters));
        content = '';
      }
    } catch { /* skip */ }
  }
  if (!tc.length && content.startsWith('{') && content.includes('"name"')) {
    try {
      const o = JSON.parse(content);
      if (o && typeof o === 'object' && 'name' in o) { tc.push(mkCall(o.name, o.arguments ?? o.parameters)); content = ''; }
    } catch { /* skip */ }
  }

  return { reasoning, content, toolCalls: tc };
}

/** OpenAI sends assistant tool_calls[].function.arguments as a JSON STRING, but HF chat
 *  templates call .items() on it (expect a mapping). Parse them to objects before send.
 *  Also coerce content: null -> "" — templates that concatenate content raw
 *  (Phi-4-mini) crash on None, and pure tool-call assistant turns carry null. */
export function normalizeToolCallArguments(messages: any[]): any[] {
  for (const m of messages || []) {
    if (m && m.content === null) m.content = '';
    for (const tc of (m?.tool_calls || [])) {
      if (tc?.function && typeof tc.function.arguments === 'string') {
        try { tc.function.arguments = JSON.parse(tc.function.arguments); } catch { /* leave */ }
      }
    }
  }
  return messages;
}
