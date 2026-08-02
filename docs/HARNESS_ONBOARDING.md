# Harness Onboarding — the canon adapter protocol

How a new AI-coding harness (Codex, OpenCode, OpenClaw, Hermes, grok-build,
gemini-cli, …) joins the canon store. Capture is configuration; **translation
is the one per-harness engineering task**, and this document is its runbook —
distilled from the claude-code adapter's real hardening history (a3.1→a3.13,
five receipts) so the next adapter reuses lessons instead of rediscovering
them.

Cost model (grounded): ~1 day mechanical + a lint-driven hardening iteration
against the harness's real corpus. The repair *machinery* (synthetic-record
helpers, pairing repair, chain re-parenting) is shared library code after the
first use — later harnesses mostly reuse repairs.

## 0. Classify the persistence grade FIRST

Before anything else, determine what the harness actually writes to disk.
Three grades observed in the wild:

| Grade | Contents | Canon treatment |
|---|---|---|
| **Transcript-grade** | full messages, tool calls **with inputs**, tool results (claude-code, nexus-cortex) | full Message translation |
| **Telemetry-grade** | event stream — tool *names*, timings, phases, permissions, but **no content** (grok-build: `events.jsonl` has `tool_started {tool_name}` only) | events → canon **event sidecar**; Messages NOT reconstructible from disk — full fidelity needs a capture proxy or an upstream feature request |
| **Prompt-only** | user prompts / summaries only | native-only, listed visibly in TRANSLATED.md |

Misclassifying this wastes the whole effort: a telemetry-grade harness cannot
be "translated harder" into transcripts. State the grade in the adapter header
and in TRANSLATED.md.

## 1. The apparatus (have these before writing the adapter)

1. **A real corpus** — the harness's actual session files, big and messy.
   Non-negotiable: every claude-code defect (interrupted turns, backgrounded
   tools, legacy drift, 170MB files) was invisible in clean/synthetic data.
2. **The A4 verify lint as defect detector** (`canon-verify.mjs`, generic):
   JSONL parse → required fields (uuid/timestamp/type/provenance) → pairing
   invariants (every `tool_result` follows a seen `tool_use`; only tail calls
   dangle) → chain integrity (`parentUuid` resolves earlier in file) → secret
   scan → ref resolution. **Each red annotation = one repair rule you now know
   you need.**
3. **The determinism gate** — manifest-wiped full re-translate must be
   byte-identical (blob-SHA provenance makes this checkable), *with execution
   evidence* (the "N translated" line — hash equality on a run that never
   executed is a proven false-pass mode).
4. **Resume receipts** — pull a translated session into the cortex harness and
   fact-check it against original tool results; then **token A/B with content
   probes**. A/B is not optional: it caught a silent renderer chain-break
   (555KB of context dropped) that four comprehension receipts had missed.
   Schema lint cannot see consumer-side rendering semantics.

## 2. Discovery questionnaire (day-1 mechanical)

Answer with file:line evidence from the harness's source and real sessions:

- **Envelope**: where do sessions live; file-per-session or dir-per-session;
  project namespacing convention and its encoding (claude-code: `/`→`-` dirs;
  grok-build: URL-encoded `%2F` dirs); session id source (filename vs field);
  index/lock sidecar files to skip.
- **Record granularity**: one record = one logical message, or fragments?
  (claude-code writes one record *per content block* — reconstruction by
  requestId was a3.4–a3.6.)
- **Tool-call dialect**: OpenAI `tool_calls` / Anthropic `tool_use` / custom
  wrapping. This picks which **existing gateway transform you reuse** — canon
  IS the Anthropic wire shape, and the gateway already implements
  ChatCompletions↔canonical, Responses↔canonical, Messages≈identity. The
  message-transform half of the adapter is usually already written; the
  per-harness work is the envelope + record plumbing around it.
- **Event roster**: every record `type` in the corpus, classified
  message-bearing vs harness-event → sidecar (D8: carried, never dropped).
- **Ids/timestamps**: present natively? stable? (claude-code's
  file-history-snapshot has neither → synthesis rules `fhs-<messageId>`.)
- **Multi-file structure**: subagent transcripts, sidecar files, per-session
  auxiliary docs (system_prompt.txt etc.).
- **Size behavior**: max observed file size; chunking need (>50MB → 25MB
  line-boundary parts).
- **Secret exposure**: which fields can carry keys (the sync scrub runs
  regardless; know where to look when the lint's secret scan fires).

## 3. Wire capture (config, not code)

One `HARNESSES.json` entry in the store:

```json
{ "harnesses": { "<label>": {
    "exts": [".jsonl", ".json"],
    "roots": ["~/.<harness>/sessions"]
} } }
```

Run `canon sync` and confirm `/native/<label>/…` populates with the layout
preserved. The harness is now durably captured even before any translation
exists (native-only, visible in TRANSLATED.md).

## 4. Adapter skeleton → lint-driven hardening loop

1. Write the minimal translate path: envelope parse → per-record dispatch →
   message-bearing types through the (reused) dialect transform + provenance
   stamp → everything else to the `.events.jsonl` sidecar.
2. Full-translate the real corpus. Read every lint annotation. For each,
   decide: repair rule (synthetic marked record), synthesis rule (missing
   field), or deliberate exception (tail-dangling calls stay).
3. Re-run until **0 problems on the full corpus**, then run the determinism
   gate, then the receipts.

### Known defect classes (budget for a subset + one novel)

From the claude-code ledger, in the order they bit:

| Class | Example / fix |
|---|---|
| Fragment granularity ≠ message boundary | merge by requestId; `mergedFrom` traceability (a3.4–a3.6) |
| Interrupt artifacts — orphan results | backgrounded tools skip the `tool_use` record → synthetic marked use, strict-pair placement |
| Interrupt artifacts — abandoned calls | crashed turns leave `tool_use` unanswered mid-file → synthetic error result (a3.12) |
| Legacy drift within one harness | old wrapped-block dialect normalized; 929 dup results deduped (a3.7–a3.9) |
| Missing-field synthesis | snapshot records lack uuid/timestamp → `fhs-<messageId>` + `lastTs` fallback (a3.13) |
| Chain integrity through sidecars | re-parent `parentUuid` past sidecarred events + absolute fallback (a3.10–a3.11) |
| Deliberate non-repair | tail-dangling calls = live session; verify's tail window allows them |

Rule from a3.13: any hand-built synthetic record (not routed through the main
emit path) must set uuid + timestamp + type + provenance itself.

## 5. Acceptance bar

- [ ] Lint: **0 problems over the full corpus** (then CI-enforced forever)
- [ ] Determinism gate passes (with execution evidence)
- [ ] ≥1 ground-truthed resume receipt in a foreign harness
- [ ] Token A/B with content probes: no silent render loss
- [ ] TRANSLATED.md states the persistence grade + any scoped-out record types

---

## Appendix A — worked example: claude-code (complete)

Transcript-grade. Dash-encoded project dirs; one record per content block;
Anthropic-dialect `tool_use`; 9 harness-event types sidecarred; subagent
transcripts in per-session dirs; >50MB sessions chunked. Thirteen adapter
revisions (a3.1–a3.13) driven by five receipts; end state: 3,485 canonical
files, 0 pairing violations, CI-enforced, byte-deterministic.

## Appendix B — worked example: grok-build (surveyed 2026-08-02, adapter pending)

Evidence: real sessions at `~/.grok/sessions/` + the OSS source
(github.com/xai-org/grok-build, Rust).

- **Envelope**: dir-per-session under URL-encoded project dirs
  (`%2Ftmp%2Fgrokbench/<uuidv7>/`), containing `events.jsonl`,
  `prompt_context.json` (config snapshot: prompt_mode, personas, flags),
  `system_prompt.txt`, `summary.json`; project-level `prompt_history.jsonl`
  (user prompts w/ timestamps + session_id) and a `session_search.sqlite`
  index (skip).
- **Persistence grade: TELEMETRY.** `events.jsonl` records `phase_changed`,
  `loop_started`, `first_token`, `turn_started/ended`, `permission_*`, and
  `tool_started/completed` — with **tool names and timings only, no inputs,
  no results, no assistant text**. Full transcripts are not reconstructible
  from local files.
- **Wire dialects: three**, `ApiBackend` in
  `crates/codegen/xai-grok-sampling-types/src/types.rs:1013` —
  `ChatCompletions` (/v1/chat/completions, default), `Responses`
  (/v1/responses), `Messages` (/v1/messages, Anthropic). All three are
  dialects the gateway already implements — if/when transcript content is
  available, the message transform is fully covered.
- **Adapter recommendation (v1)**: events.jsonl + prompt_history →
  canon **event sidecar** + prompt-bearing user Messages (what exists,
  faithfully); persistence grade stated in TRANSLATED.md. Full-fidelity
  options, in order: (a) capture proxy on `base_url` (the grok-build-bench
  logging-proxy pattern already captures the exact wire JSON), (b) upstream
  feature request for transcript persistence, (c) leave telemetry-grade and
  let comprehension ride the summaries.
