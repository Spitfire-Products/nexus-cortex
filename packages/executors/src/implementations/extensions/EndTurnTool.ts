/**
 * EndTurn — generative end-of-turn attestation (Stage 1).
 *
 * Why: grounding/verification rules in system messages are ignored by some
 * models (grok-4.3: ~0/6 on line-number fabrication); the SAME models obey
 * tool mechanics (Edit `old_string`: 6/6). Routing the contract through a
 * required tool converts an ignored request into an enforced checkpoint.
 *
 * The params are GENERATIVE, not multiple-choice: the model must re-derive
 * each reference's verbatim source, paste the actual command output it saw,
 * and write a skeptical self-review. A label can be rubber-stamped (Stage-1
 * enum leaked 1/6); producing the evidence cannot — the act of
 * reconstructing it forces the lookup and surfaces missed errors in latent
 * space before the final message. Stage 1 does NOT verify server-side; it
 * echoes the model's own self_review + sources back so it must act on them
 * before finalizing. Server-side cross-check is Stage 2.
 */
import { BaseTool, type ToolResult } from '../../base/index.js';

export interface CitationEvidence {
  /** The claim/reference as it appears in the drafted answer. */
  reference: string;
  /** The EXACT token transcribed from THIS turn's tool output that grounds
   *  it (verbatim code line, URL from a fetched page, API signature). */
  verbatim_source: string;
}

export interface VerificationEvidence {
  /** The command run this turn (build/test/lint). */
  command: string;
  /** The actual result line observed in this turn's tool output. */
  observed_result: string;
}

export interface EndTurnParams {
  /** One entry per specific reference in the answer. Empty = none cited. */
  citations: CitationEvidence[];
  /** One entry per verification command actually run. Empty = none asked. */
  verification: VerificationEvidence[];
  /** One sentence: what was delivered this turn. */
  summary: string;
  /** Anything unverified/assumed/incomplete. Empty array if nothing. */
  open_items: string[];
  /** Skeptical re-read of the drafted answer: what was NOT checked, what is
   *  assumed/possibly wrong, what one more tool call would verify. */
  self_review: string;
}

export class EndTurnToolExecutor extends BaseTool<EndTurnParams, ToolResult> {
  constructor() {
    super(
      'EndTurn',
      'End Turn',
      'Mandatory final step before your user-facing answer. You must RECONSTRUCT the evidence for your work (not tick boxes): list each reference with the verbatim source you copied it from, paste real command output, and write a skeptical self-review.',
      {
        type: 'object',
        properties: {
          citations: {
            type: 'array',
            description:
              "Every specific reference in your drafted answer (file:line, line numbers, URLs, API/function signatures, quotes). For EACH, give the exact token you transcribed from THIS turn's tool output. If you cannot produce the verbatim source, the reference is unverified — remove it from your answer and do not list it. Empty array = you cited none.",
            items: {
              type: 'object',
              properties: {
                reference: {
                  type: 'string',
                  description: 'The claim/reference as it appears in your answer.',
                },
                verbatim_source: {
                  type: 'string',
                  description:
                    "The EXACT text copied from this turn's tool output that grounds it (a quoted code line, a URL from a fetched page). Character-for-character, like an edit old_string.",
                },
              },
              required: ['reference', 'verbatim_source'],
            },
          },
          verification: {
            type: 'array',
            description:
              'Every verification command (build/test/lint) the task asked for that you actually ran THIS turn. Empty array = none asked. Do not list a command you did not run.',
            items: {
              type: 'object',
              properties: {
                command: { type: 'string', description: 'The command you ran.' },
                observed_result: {
                  type: 'string',
                  description: 'The actual result line you saw in this turn\'s tool output.',
                },
              },
              required: ['command', 'observed_result'],
            },
          },
          summary: {
            type: 'string',
            description: 'One sentence: what you delivered this turn.',
          },
          open_items: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Anything unverified, assumed, or incomplete. Empty array if nothing. Do not hide gaps.',
          },
          self_review: {
            type: 'string',
            description:
              'Re-read your drafted answer as a skeptical reviewer. What did you NOT check? What is assumed or possibly wrong? What surface might you have missed? If you had one more tool call, what would you verify? Be specific — this pass exists to catch your own mistakes before they ship.',
          },
        },
        // Only the two cheap, always-producible generative fields are required.
        // The evidence arrays are legitimately empty on many turns ("empty =
        // none"), so requiring them caused well-formed sparse attestations to
        // loop-reject. Absent arrays normalize to [] in normalizeParams().
        required: ['summary', 'self_review'],
      },
    );
  }

  /**
   * Coerce a raw attestation into a well-formed shape. Absent arrays become []
   * ("empty = none" per the field docs); malformed array items are dropped
   * rather than rejected. This makes EndTurn non-blocking at the executor level
   * — the strict, MEANINGFUL rejection (a verbatim_source not grounded in this
   * turn's tool output) is enforced by the orchestrator's Stage-2 grounding
   * check when CORTEX_ENDTURN_GATE is on, where it belongs. A blunt
   * validate-and-reject here only produced retry loops that ended in the model
   * giving up with NO attestation at all — strictly worse than a sparse one.
   */
  private normalizeParams(params: EndTurnParams): EndTurnParams {
    const p = (params && typeof params === 'object' ? params : {}) as Partial<EndTurnParams>;
    // A citation is a (reference, verbatim_source) pair — drop any item missing
    // either half (ungrounded evidence is not a citation). Same for verification.
    const citations = (Array.isArray(p.citations) ? p.citations : [])
      .filter(
        (c) =>
          c &&
          typeof c.reference === 'string' &&
          c.reference.trim() !== '' &&
          typeof c.verbatim_source === 'string' &&
          c.verbatim_source.trim() !== '',
      )
      .map((c) => ({ reference: c.reference, verbatim_source: c.verbatim_source }));
    const verification = (Array.isArray(p.verification) ? p.verification : [])
      .filter(
        (v) =>
          v &&
          typeof v.command === 'string' &&
          v.command.trim() !== '' &&
          typeof v.observed_result === 'string' &&
          v.observed_result.trim() !== '',
      )
      .map((v) => ({ command: v.command, observed_result: v.observed_result }));
    const open_items = (Array.isArray(p.open_items) ? p.open_items : []).filter(
      (o): o is string => typeof o === 'string' && o.trim() !== '',
    );
    return {
      citations,
      verification,
      summary: typeof p.summary === 'string' ? p.summary : '',
      open_items,
      self_review: typeof p.self_review === 'string' ? p.self_review : '',
    };
  }

  validateToolParams(params: EndTurnParams): string | null {
    // Non-blocking: any object is acceptable. Missing/empty fields normalize
    // (absent arrays → [], "empty = none"). The only thing worth a hard reject
    // is a payload that isn't an object at all.
    if (!params || typeof params !== 'object') return 'params object required';
    return null;
  }

  getDescription(params: EndTurnParams): string {
    const nCit = Array.isArray(params?.citations) ? params.citations.length : 0;
    const nVer = Array.isArray(params?.verification) ? params.verification.length : 0;
    return `EndTurn attestation (${nCit} citation(s), ${nVer} verification(s))`;
  }

  async execute(rawParams: EndTurnParams, _signal: AbortSignal): Promise<ToolResult> {
    const validationError = this.validateToolParams(rawParams);
    if (validationError) {
      return {
        llmContent: `EndTurn rejected: ${validationError}. Fix the attestation and call EndTurn again.`,
        success: false,
        error: validationError,
      };
    }

    // Normalize: absent arrays → [], malformed items dropped, missing strings → ''.
    const params = this.normalizeParams(rawParams);

    const cites =
      params.citations.length > 0
        ? params.citations
            .map((c) => ` - "${c.reference}" ⇐ ${c.verbatim_source}`)
            .join('\n')
        : ' (none cited)';
    const vers =
      params.verification.length > 0
        ? params.verification
            .map((v) => ` - \`${v.command}\` ⇒ ${v.observed_result}`)
            .join('\n')
        : ' (none)';
    const open =
      params.open_items.length > 0
        ? params.open_items.map((o) => ` - ${o}`).join('\n')
        : ' (none)';

    // Echo the model's OWN reconstruction + skeptical review back at it. The
    // model must now read its own self_review and act on it before
    // finalizing — the reflection loop closes in its own context (no
    // server-side verification in Stage 1).
    const llmContent =
      `Attestation recorded — read your own review before finalizing:\n\n` +
      `CITATIONS (each must be grounded in the verbatim source you gave):\n${cites}\n\n` +
      `VERIFICATION:\n${vers}\n\n` +
      `OPEN ITEMS:\n${open}\n\n` +
      `YOUR SELF-REVIEW:\n  ${params.self_review}\n\n` +
      `SUMMARY: ${params.summary}\n\n` +
      `Now act on your own self-review: if it identified anything missed, wrong, or unverified, FIX it before answering — re-read or re-run as needed. ` +
      `Your final answer MUST NOT contain any reference not backed by a verbatim_source above; if you can't ground it, quote the code/source instead of asserting a coordinate. ` +
      `Then produce your final answer (the user-facing response) as plain text. Do not call any more tools.`;

    return {
      llmContent,
      returnDisplay: `EndTurn: ${params.citations.length} cited, ${params.verification.length} verified`,
      success: true,
    };
  }
}
