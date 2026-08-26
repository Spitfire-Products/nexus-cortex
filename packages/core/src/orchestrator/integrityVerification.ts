/**
 * integrityVerification — EndTurn Stage 5 (item 12 layer 4, operator-directed
 * 2026-08-26): DETERMINISTIC task-integrity checks at the gate, using evidence
 * the gate already holds. Two mechanically decidable checks:
 *
 *  A. WEB-CONTENT TRANSPLANT — a long contiguous run (>= SHINGLE words) from
 *     this turn's WebSearch/WebFetch RESULTS appears verbatim in this turn's
 *     Write/Edit INPUTS: fetched content was copied into the deliverable.
 *  B. SOLUTION-SEEKING QUERY — a WebSearch query is solution-shaped
 *     (solution/answer/walkthrough/writeup/speedrun) or shares a long
 *     verbatim run with the task statement itself (= looking up the task).
 *
 * Armed by CORTEX_ENDTURN_INTEGRITY=true (off by default; TB2.1/bench and
 * serving profiles arm it). Rides the gate's existing bounded nudge budget —
 * fallback-accept still guarantees liveness; every flag is emitted as an
 * integrity_flag decisions event by the caller REGARDLESS of nudge outcome,
 * so the distiller's integrity lens gets pre-labeled rows (steer + audit,
 * never hard-block: TB2.1 grants internet access deliberately).
 */

export interface IntegrityInput {
  /** WebSearch query strings issued this turn. */
  webQueries: string[];
  /** Web tool RESULT texts this turn (WebSearch/WebFetch outputs). */
  webContent: string[];
  /** Mutating-tool content this turn (Write.content, Edit.new_string). */
  writeInputs: string[];
  /** The task statement (last real user text). */
  userTaskText: string;
  /** EndTurn `sources` attestation (check C): the model's show-your-work for
   *  this turn's web usage — one row per access. */
  sourcesAttestation?: Array<{ accessed: string; purpose: string; used_for: string }>;
}

export interface IntegrityFlag {
  check: 'web_transplant' | 'solution_query' | 'unattested_web_use';
  detail: string;
}

export interface IntegrityVerdict {
  ok: boolean;
  nudge?: string;
  flags: IntegrityFlag[];
}

const SHINGLE_WORDS = 20;
const TASK_RUN_WORDS = 8;
const SOLUTION_QUERY_RE = /\b(solutions?|answers?|walkthroughs?|write-?ups?|speedruns?|solved)\b/i;

export function resolveEndTurnIntegrityMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.CORTEX_ENDTURN_INTEGRITY ?? '').trim().toLowerCase() === 'true';
}

function words(text: string): string[] {
  return text.toLowerCase().replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
}

function shingles(text: string, n: number): Set<string> {
  const w = words(text);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
  return out;
}

/** True when `a` and `b` share a contiguous run of >= n words. */
function sharesRun(a: string, b: string, n: number): boolean {
  const sa = shingles(a, n);
  if (sa.size === 0) return false;
  for (const sh of shingles(b, n)) if (sa.has(sh)) return true;
  return false;
}

export function verifyIntegrity(input: IntegrityInput): IntegrityVerdict {
  const flags: IntegrityFlag[] = [];

  // B first (cheap): solution-shaped or task-verbatim queries.
  for (const q of input.webQueries) {
    if (SOLUTION_QUERY_RE.test(q)) {
      flags.push({ check: 'solution_query', detail: `solution-shaped query: "${q.slice(0, 120)}"` });
    } else if (input.userTaskText && sharesRun(q, input.userTaskText, TASK_RUN_WORDS)) {
      flags.push({ check: 'solution_query', detail: `query repeats the task statement verbatim: "${q.slice(0, 120)}"` });
    }
  }

  // A: fetched-content transplant into deliverables.
  if (input.writeInputs.length > 0 && input.webContent.length > 0) {
    const writeShingles = new Set<string>();
    for (const w of input.writeInputs) for (const sh of shingles(w, SHINGLE_WORDS)) writeShingles.add(sh);
    if (writeShingles.size > 0) {
      outer: for (const web of input.webContent) {
        for (const sh of shingles(web, SHINGLE_WORDS)) {
          if (writeShingles.has(sh)) {
            flags.push({
              check: 'web_transplant',
              detail: `>=${SHINGLE_WORDS} contiguous words from fetched web content appear in a written artifact ("${sh.slice(0, 100)}…")`,
            });
            break outer; // one flag is enough to nudge; the event carries it
          }
        }
      }
    }
  }

  // C (operator-directed): SHOW YOUR WORK — any web usage this turn demands a
  // sources attestation on EndTurn. Mechanical checks A/B still run above, so
  // the attestation cannot talk its way past a transplant or solution query.
  const webUsed = input.webQueries.length > 0 || input.webContent.length > 0;
  if (webUsed) {
    const att = input.sourcesAttestation;
    const attOk = Array.isArray(att) && att.length > 0 &&
      att.every(r => r && typeof r.accessed === 'string' && r.accessed.trim().length > 0 &&
        typeof r.purpose === 'string' && r.purpose.trim().length > 0 &&
        typeof r.used_for === 'string' && r.used_for.trim().length > 0);
    if (!attOk) {
      flags.push({
        check: 'unattested_web_use',
        detail: `web tools were used this turn (${input.webQueries.length} search(es), ${input.webContent.length} fetch result(s)) with no sources attestation`,
      });
    }
  }

  // JUSTIFY, DON'T BLOCK (operator-set 2026-08-26): legitimate work sometimes
  // NEEDS internet sources or repo archaeology. A/B findings therefore NEVER
  // reject on their own — they bank as integrity_flag audit events for the
  // distiller lens (and the leaderboard's own trajectory review). The ONLY
  // rejecting condition is web usage with NO valid attestation (check C):
  // show your work, and the work stands.
  const rejecting = flags.filter(f => f.check === 'unattested_web_use');
  if (rejecting.length === 0) return { ok: true, flags };
  const lines = flags.map(f => ` - [${f.check}] ${f.detail}`).join('\n');
  return {
    ok: false,
    flags,
    nudge:
      `EndTurn REJECTED — task-integrity check failed:\n${lines}\n\n` +
      `Deliverables must be produced by work you execute in THIS workspace. Web tools are for ` +
      `documentation and concepts — not for retrieving a task's solution, and fetched content must ` +
      `not be transplanted into your artifact. If you used web tools, SHOW YOUR WORK: include a ` +
      `\`sources\` array on EndTurn — one row per access: { accessed (query/url), purpose (what ` +
      `you needed), used_for (how it informed work you then executed yourself) }. Rework anything ` +
      `flagged above by deriving it from your own execution, then call EndTurn again.`,
  };
}
