/**
 * toolDisplay — which tool calls a surface should NOT print in full (operator 2026-11-14: "it isnt cohesive to read in the tui").
 *
 * `EndTurn` is the harness's finish gate: its INPUT is the model's attestation (citations / verification / self-review) and its RESULT
 * is an instruction written TO THE MODEL ("Now act on your own self-review … produce your final answer"). Both belong in the transcript
 * and the session file, never in the reader's view — printed, they put a wall of scaffolding between the last tool and the answer.
 * Surfaces show one short line for such a call instead. Decided here so every surface (fuzzycortex, neoncortex, anything on the
 * library) hides the same calls; the name arrives in whatever form the provider's naming handler used (EndTurn, end_turn, end-turn …).
 */
const MODEL_FACING = new Set(['endturn']);

const norm = (name: string): string => String(name || '').replace(/^.*__/, '').replace(/[_\-\s]/g, '').toLowerCase();

/** True for a tool whose call and result are written for the model, not the reader (EndTurn in any naming form). */
export function isModelFacingTool(name: string | undefined | null): boolean {
  return !!name && MODEL_FACING.has(norm(name));
}

/** The one line a surface prints for a model-facing call (undefined = print the call normally). */
export function modelFacingToolLine(name: string | undefined | null, isError?: boolean): string | undefined {
  if (!isModelFacingTool(name)) return undefined;
  return isError ? 'answer check returned an error' : 'answer checked';
}
