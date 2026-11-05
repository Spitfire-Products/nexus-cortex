/**
 * Repair malformed tool-call argument JSON (2026-11-04).
 *
 * DeepSeek sometimes emits tool arguments that are not valid JSON — most often a nested
 * object missing ONE closing brace (`{"steps":[{"args":{"a":1},"tool":"x"},{"args":{"b":2,"tool":"y"}]}`)
 * or a stray extra one. The multi-site browser runs logged 93 "Failed to parse tool arguments" lines in
 * four passes; each such call ran with empty arguments, failed, and was sent again (a wasted model round).
 *
 * Repair is purely STRUCTURAL and runs only after JSON.parse has failed:
 *  - a closer that does not match the innermost opener closes the openers above the one it matches;
 *  - a closer that matches no open opener is dropped;
 *  - trailing commas before a closer are dropped;
 *  - raw control characters inside strings (literal newlines/tabs) are escaped;
 *  - a quote inside a string that is not followed by , : } ] or the end is escaped (an unescaped inner quote, e.g. in a page script);
 *  - an unterminated string and any openers still open at the end are closed.
 * Returns the parsed object, or null when the result still is not a JSON object.
 */
export function repairToolJson(raw: string): Record<string, unknown> | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const out: string[] = [];
  const stack: string[] = [];
  const closerOf: Record<string, string> = { '{': '}', '[': ']' };
  let inString = false;
  let escaped = false;
  const dropTrailingComma = (): void => {
    for (let k = out.length - 1; k >= 0; k--) {
      const c = out[k]!;
      if (c === ' ' || c === '\n' || c === '\t' || c === '\r') continue;
      if (c === ',') out.splice(k, 1);
      return;
    }
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) { escaped = false; out.push(ch); continue; }
      if (ch === '\\') { escaped = true; out.push(ch); continue; }
      if (ch === '"') {
        // A quote that closes a string is always followed (after whitespace) by , : } ] or the end. Any other quote is an UNESCAPED
        // quote inside the string (e.g. a page script `querySelector("a")` inside a steps argument) — escape it instead of closing.
        let k = i + 1; while (k < text.length && /\s/.test(text[k]!)) k++;
        if (k < text.length && !',:}]'.includes(text[k]!)) { out.push('\\"'); continue; }
        inString = false; out.push(ch); continue;
      }
      if (ch === '\n') { out.push('\\n'); continue; }
      if (ch === '\r') { out.push('\\r'); continue; }
      if (ch === '\t') { out.push('\\t'); continue; }
      out.push(ch);
      continue;
    }
    if (ch === '"') { inString = true; out.push(ch); continue; }
    if (ch === '{' || ch === '[') { stack.push(ch); out.push(ch); continue; }
    if (ch === '}' || ch === ']') {
      const opener = ch === '}' ? '{' : '[';
      const at = stack.lastIndexOf(opener);
      if (at < 0) continue; // stray closer: nothing open of that kind
      while (stack.length - 1 > at) { dropTrailingComma(); out.push(closerOf[stack.pop()!]!); }
      dropTrailingComma();
      stack.pop();
      out.push(ch);
      continue;
    }
    out.push(ch);
  }
  if (inString) { if (escaped) out.pop(); out.push('"'); }
  while (stack.length) { dropTrailingComma(); out.push(closerOf[stack.pop()!]!); }
  try {
    const parsed = JSON.parse(out.join(''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
