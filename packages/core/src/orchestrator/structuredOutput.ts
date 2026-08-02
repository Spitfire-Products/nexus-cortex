/**
 * StructuredOutput — schema-constrained JSON output via a synthetic tool
 * (grok-build port; see grok-build turn.rs structured-output mechanism).
 *
 * Gives callers schema-constrained JSON output on EVERY provider path with no
 * transport/wire changes: when a request carries `options.jsonSchema`, a
 * request-scoped synthetic tool named `StructuredOutput` is appended to the
 * tools array for every request of the turn. The orchestrator intercepts calls
 * to it BEFORE executor dispatch (it is never registered in any registry and
 * never routed to a real executor), validates the arguments against the
 * caller's JSON Schema with Ajv, and steers the model with synthetic
 * tool_results:
 *
 *   - co-emitted with other tools  -> corrective (not an error, no retry burn)
 *   - invalid args, attempts < max -> corrective error listing schema failures
 *   - invalid args, attempts >= max-> fail-open: accept with validation errors
 *                                     (never wedge the loop)
 *   - valid args                   -> accepted; captured on the turn state
 *
 * The captured result surfaces as `metadata.structuredOutput` on the
 * orchestrator response (non-streaming) and on the `message_stop` chunk data
 * (streaming).
 *
 * ALL steering lives in the injected tool's DESCRIPTION and in the synthetic
 * tool_result texts below — message history is never mutated for steering.
 *
 * Naming: the canonical tool name is PascalCase `StructuredOutput`; the
 * GatewayTranslationLayer converts to the provider's naming convention on the
 * wire and restores canonical names on return. This tool is request-scoped and
 * is never registered in BaseToolRegistry.
 */

import AjvImport from 'ajv';
import type { ValidateFunction } from 'ajv';
import type { CanonicalTool, ToolSchema } from '../tools/types/CanonicalTool.js';

// ajv ships CJS; depending on the loader the ESM default import is either the
// class itself or a namespace object carrying it on `.default`. Normalize.
const AjvCtor = ((AjvImport as unknown as { default?: unknown }).default ??
  AjvImport) as typeof AjvImport;

/** Canonical (PascalCase) name of the synthetic structured-output tool. */
export const STRUCTURED_OUTPUT_TOOL_NAME = 'StructuredOutput';

/** Maximum validation-failure retries before failing open. */
export const MAX_STRUCTURED_OUTPUT_RETRIES = 3;

/**
 * Corrective tool_result text used when the model calls the structured-output
 * tool in the same assistant round as other tool calls. Not an error and not
 * a counted retry — the model simply has not finished its tool work yet.
 */
export const COEMISSION_CORRECTIVE =
  'Structured output was not captured: you called StructuredOutput together with other tools in the same response. ' +
  'Finish your other tool work first, then call StructuredOutput alone as your final action.';

/** Text of the tool_result synthesized when validation succeeds. */
export const ACCEPTED_RESULT_TEXT =
  'Structured output accepted. Your structured answer has been captured; you can end the turn now.';

/**
 * Text of the tool_result synthesized when the retry budget is exhausted and
 * the last arguments are accepted anyway (fail-open — never wedge the loop).
 */
export const ACCEPTED_WITH_ERRORS_RESULT_TEXT =
  'Accepted with validation errors. The retry limit was reached, so your last arguments were captured as-is ' +
  'even though they do not fully satisfy the schema. You can end the turn now.';

/** Captured structured-output result surfaced on response metadata. */
export interface StructuredOutputResult {
  /** The arguments of the accepted StructuredOutput call. */
  value: unknown;
  /** Whether the value satisfied the caller's schema. */
  valid: boolean;
  /** Validation attempts consumed (co-emission rounds are not counted). */
  attempts: number;
  /** Rendered validation errors, present when valid === false. */
  errors?: string[];
}

/**
 * Turn-local state for the structured-output mechanism. Created once per
 * sendMessage/streamMessage invocation when options.jsonSchema is set, and
 * threaded (by reference) through tool dispatch.
 */
export interface StructuredOutputTurnState {
  /** The caller's JSON Schema (top-level object schema expected). */
  schema: object;
  /** The injected tool, built once so every request of the turn shares it. */
  tool: CanonicalTool;
  /** Validation attempts consumed so far. */
  attempts: number;
  /** Captured result, once a StructuredOutput call is accepted. */
  result?: StructuredOutputResult;
}

/** Decision produced for a single StructuredOutput tool call. */
export interface StructuredOutputDecision {
  /** Text of the synthetic tool_result to send back to the model. */
  toolResultText: string;
  /** Whether the synthetic tool_result is marked is_error. */
  isError: boolean;
  /** Attempt count after this call (unchanged for co-emission). */
  attemptsAfter: number;
  /** Whether the call was terminally accepted (valid or fail-open). */
  accepted: boolean;
  /** Captured result — set only when accepted. */
  result?: StructuredOutputResult;
}

/**
 * Build the request-scoped synthetic StructuredOutput tool.
 *
 * The element shape matches the canonical tools array the orchestrator passes
 * to gatewayTranslation.prepareRequest ({ name, description, schema }, see
 * BaseToolRegistry entries / toCanonicalTool). discoveryTier 'essential'
 * guarantees the tool SURVIVES ClientSideToolFilter's deferred-loading
 * reduction — same rationale as server-side tools (ServerSideTools.ts).
 *
 * The caller's schema is expected to be a top-level `object` JSON Schema
 * (the same contract as provider-native structured outputs).
 */
export function buildStructuredOutputTool(schema: object): CanonicalTool {
  return {
    name: STRUCTURED_OUTPUT_TOOL_NAME,
    description:
      'REQUIRED: you MUST return your final answer by calling this tool — a plain text reply will NOT be ' +
      'accepted as the answer for this request. ' +
      'Captures the FINAL structured answer for this request as machine-readable JSON. ' +
      'The calling application reads the arguments of this tool call as the result of the request, so the ' +
      'arguments must satisfy the provided JSON schema exactly: every required field present, correct types, ' +
      'and no wrapping, markdown, or commentary — the arguments ARE the answer. ' +
      'Call this tool exactly once, as your FINAL action, after all other tool work is complete. ' +
      'Do not call it together with other tools. If validation fails you will receive the list of schema ' +
      'violations; call StructuredOutput again with corrected arguments.',
    schema: schema as ToolSchema,
    discoveryTier: 'essential',
  };
}

/** Create the turn-local state for a request that set options.jsonSchema. */
export function createStructuredOutputTurnState(schema: object): StructuredOutputTurnState {
  return {
    schema,
    tool: buildStructuredOutputTool(schema),
    attempts: 0,
  };
}

/**
 * True when a (canonical) tool-call name addresses the structured-output tool.
 * The GatewayTranslationLayer restores canonical names on return, but the
 * snake_case wire form is matched too as a defensive belt.
 */
export function isStructuredOutputToolName(name: string): boolean {
  return name === STRUCTURED_OUTPUT_TOOL_NAME || name === 'structured_output';
}

/**
 * Return a tools array that contains the structured-output tool, cloning
 * instead of mutating (clone-on-write — the input array is never modified).
 */
export function ensureStructuredOutputTool(
  tools: CanonicalTool[] | undefined,
  state: StructuredOutputTurnState,
): CanonicalTool[] {
  const base = tools ?? [];
  if (base.some((t) => t?.name === STRUCTURED_OUTPUT_TOOL_NAME)) {
    return base;
  }
  return [...base, state.tool];
}

// Compiled-validator cache keyed by schema JSON. Ajv compilation is not free;
// a turn validates the same schema up to MAX_STRUCTURED_OUTPUT_RETRIES times.
const validatorCache = new Map<string, ValidateFunction>();
const VALIDATOR_CACHE_MAX = 32;

function getValidator(schema: object): ValidateFunction {
  const key = JSON.stringify(schema);
  const cached = validatorCache.get(key);
  if (cached) return cached;
  const ajv = new AjvCtor({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (validatorCache.size >= VALIDATOR_CACHE_MAX) {
    // Drop the oldest entry (Map preserves insertion order).
    const oldest = validatorCache.keys().next().value;
    if (oldest !== undefined) validatorCache.delete(oldest);
  }
  validatorCache.set(key, validate);
  return validate;
}

/**
 * Validate candidate structured-output arguments against the caller's schema.
 * Errors are rendered as short "instancePath: message" strings.
 */
export function validateStructuredOutput(
  schema: object,
  args: unknown,
): { valid: boolean; errors: string[] } {
  let validate: ValidateFunction;
  try {
    validate = getValidator(schema);
  } catch (err) {
    // An uncompilable schema is a caller bug — fail open (accept anything)
    // rather than wedging the turn on every validation attempt.
    return {
      valid: true,
      errors: [`schema compilation failed, validation skipped: ${(err as Error)?.message ?? String(err)}`],
    };
  }
  const valid = validate(args) === true;
  if (valid) return { valid: true, errors: [] };
  const errors = (validate.errors ?? []).map((e) => {
    const where = e.instancePath && e.instancePath.length > 0 ? e.instancePath : '(root)';
    return `${where}: ${e.message ?? 'invalid'}`;
  });
  return { valid: false, errors: errors.length > 0 ? errors : ['(root): invalid'] };
}

/**
 * Corrective tool_result text for a failed validation attempt: tells the model
 * exactly what failed and to call StructuredOutput again with corrected args.
 */
export function buildCorrectiveResult(errors: string[], attempt: number, max: number): string {
  const list = errors.map((e) => ` - ${e}`).join('\n');
  return (
    `Structured output validation failed (attempt ${attempt}/${max}):\n${list}\n\n` +
    'Call StructuredOutput again with corrected arguments that satisfy the schema exactly. ' +
    'Fix every listed violation; do not change fields that already validate.'
  );
}

/**
 * Pure decision function for one StructuredOutput tool call.
 *
 * @param schema                  caller's JSON Schema
 * @param args                    the tool call's input arguments
 * @param attemptsBefore          validation attempts consumed before this call
 * @param hasOtherToolCallsInRound whether the assistant round contained any
 *                                other tool call (co-emission)
 */
export function evaluateStructuredOutputCall(
  schema: object,
  args: unknown,
  attemptsBefore: number,
  hasOtherToolCallsInRound: boolean,
): StructuredOutputDecision {
  if (hasOtherToolCallsInRound) {
    // Not counted as a retry, not an error — plain steering.
    return {
      toolResultText: COEMISSION_CORRECTIVE,
      isError: false,
      attemptsAfter: attemptsBefore,
      accepted: false,
    };
  }

  const attemptsAfter = attemptsBefore + 1;
  const { valid, errors } = validateStructuredOutput(schema, args);

  if (valid) {
    return {
      toolResultText: ACCEPTED_RESULT_TEXT,
      isError: false,
      attemptsAfter,
      accepted: true,
      result: { value: args, valid: true, attempts: attemptsAfter },
    };
  }

  if (attemptsAfter < MAX_STRUCTURED_OUTPUT_RETRIES) {
    return {
      toolResultText: buildCorrectiveResult(errors, attemptsAfter, MAX_STRUCTURED_OUTPUT_RETRIES),
      isError: true,
      attemptsAfter,
      accepted: false,
    };
  }

  // Retry budget exhausted — fail open so the turn can end (mirrors the
  // grok-build infra-error path: never wedge the loop).
  return {
    toolResultText: ACCEPTED_WITH_ERRORS_RESULT_TEXT,
    isError: false,
    attemptsAfter,
    accepted: true,
    result: { value: args, valid: false, attempts: attemptsAfter, errors },
  };
}

/**
 * Finalize the turn's structured-output surface. When the model never called
 * the tool, a deterministic invalid result is returned so callers that set
 * options.jsonSchema always find `metadata.structuredOutput`.
 */
export function finalizeStructuredOutput(state: StructuredOutputTurnState): StructuredOutputResult {
  if (state.result) return state.result;
  return {
    value: undefined,
    valid: false,
    attempts: state.attempts,
    errors: ['StructuredOutput tool was not called before the turn ended'],
  };
}
