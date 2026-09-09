/**
 * dsmlRecovery.ts — HB-DSML-PARSE (2026-09-09).
 *
 * Recover a DeepSeek tool call that leaked into assistant TEXT in the DSML dialect instead of the
 * structured `tool_calls` field. DeepSeek occasionally emits (as plain content):
 *
 *   <｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="Bash">
 *     <｜｜DSML｜｜parameter name="command">ls -la</｜｜DSML｜｜parameter>
 *   </｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>
 *
 * (`｜` = U+FF5C, the fullwidth vertical bar). The structured `tool_calls` field is then empty, so the
 * turn reads "empty" and trips the terminal EndTurn reminder (HB-ENDTURN-TERMINAL) — a dropped turn,
 * not a genuine stop. This module recovers the intended call.
 *
 * 🔴 SACRED SURFACE (tool-call parsing). The recovery is PURELY ADDITIVE: the caller invokes it ONLY
 * when the structured `tool_calls` field is empty AND `looksLikeLeakedDsml(content)` is true, so a
 * normal (structured-tool-call) response never reaches this code. It NEVER fabricates a call — it
 * returns null when nothing parseable is present. Ship behind before/after canary probes on the
 * deepseek + xai tool-call round-trip ([[feedback_xai_interleaved_sacred]]).
 */

const BAR = '｜'; // ｜ fullwidth vertical bar
const DSML = `${BAR}${BAR}DSML${BAR}${BAR}`; // ｜｜DSML｜｜

function reEsc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Cheap detector — is there leaked DSML tool-call markup in this assistant text? */
export function looksLikeLeakedDsml(content: string): boolean {
  return content.includes(`${DSML}invoke`) || content.includes(`${DSML}tool_calls`);
}

export interface RecoveredDsml {
  toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  /** the content with the leaked markup stripped (usually the model's prose/reasoning before it) */
  cleanedContent: string;
}

/**
 * Parse leaked DSML `invoke` blocks into OpenAI-shape `tool_calls`. Returns null when nothing
 * parseable is present (the caller then leaves the turn untouched — no fabricated call).
 */
export function recoverDsmlToolCalls(content: string): RecoveredDsml | null {
  const invokeRe = new RegExp(`<${reEsc(DSML)}invoke\\s+name="([^"]+)"\\s*>`, 'g');
  const invokes: Array<{ name: string; markStart: number; bodyStart: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = invokeRe.exec(content)) !== null) {
    const name = m[1];
    if (name === undefined) continue;
    invokes.push({ name, markStart: m.index, bodyStart: m.index + m[0].length });
  }
  if (invokes.length === 0) return null;

  const toolCalls: RecoveredDsml['toolCalls'] = [];
  const closedParamRe = new RegExp(
    `<${reEsc(DSML)}parameter\\s+name="([^"]+)"\\s*>([\\s\\S]*?)</${reEsc(DSML)}parameter\\s*>`,
    'g',
  );
  const openParamRe = new RegExp(`<${reEsc(DSML)}parameter\\s+name="([^"]+)"\\s*>`, 'g');

  for (let i = 0; i < invokes.length; i++) {
    const inv = invokes[i]!;
    const next = invokes[i + 1];
    const bodyEnd = next ? next.markStart : content.length;
    const body = content.slice(inv.bodyStart, bodyEnd);
    const args: Record<string, string> = {};

    // Preferred: well-formed <...parameter name="X">VALUE</...parameter> pairs.
    let anyClosed = false;
    closedParamRe.lastIndex = 0;
    let pm: RegExpExecArray | null;
    while ((pm = closedParamRe.exec(body)) !== null) {
      const k = pm[1];
      if (k === undefined) continue;
      args[k] = pm[2] ?? '';
      anyClosed = true;
    }

    // Fallback: closing tags absent/malformed → capture each param value up to the next DSML tag.
    if (!anyClosed) {
      openParamRe.lastIndex = 0;
      const spans: Array<{ name: string; valStart: number }> = [];
      let opm: RegExpExecArray | null;
      while ((opm = openParamRe.exec(body)) !== null) {
        const k = opm[1];
        if (k === undefined) continue;
        spans.push({ name: k, valStart: opm.index + opm[0].length });
      }
      for (let j = 0; j < spans.length; j++) {
        const span = spans[j]!;
        const nextSpan = spans[j + 1];
        const rawEnd = nextSpan ? nextSpan.valStart : body.length;
        let val = body.slice(span.valStart, rawEnd);
        const cut = val.indexOf(`<${DSML}`);
        if (cut >= 0) val = val.slice(0, cut);
        args[span.name] = val.replace(/\s+$/, '');
      }
    }

    toolCalls.push({
      id: `dsml_${Date.now().toString(36)}_${i}`,
      type: 'function',
      function: { name: inv.name, arguments: JSON.stringify(args) },
    });
  }

  if (toolCalls.length === 0) return null;

  // Cleaned content = everything before the leaked block (strip an immediately-preceding
  // <｜｜DSML｜｜tool_calls> opener too if present).
  const first = invokes[0]!;
  let firstMark = first.markStart;
  const openIdx = content.lastIndexOf(`<${DSML}tool_calls`, firstMark);
  if (openIdx >= 0 && openIdx < firstMark) firstMark = openIdx;
  const cleanedContent = content.slice(0, firstMark).trim();

  return { toolCalls, cleanedContent };
}
