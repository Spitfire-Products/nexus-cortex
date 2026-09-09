# HB-SLICE-BLOCK — scoped coercive escalation for the ignored slice-nudge

Status: SPEC + build (2026-09-09). Ships DARK behind `CORTEX_SLICE_BLOCK` (validate in a cell before default-on).
Sibling of `CORTEX_LOOP_TOOL_BLOCK` (`loopToolBlock.ts`) — same "soft nudge ignored → coercive block" doctrine.

## The deficiency (evidence-grounded, not assumed)

`CORTEX_SLICE_NUDGE` (ON in reson, `effectiveConfig.ts:97`, `CortexOrchestrator.applySliceNudge` :8663) fires ONE
`<system-reminder>` at the **3rd** bash slice-read (`sed -n 'N,Mp'` / `head -n N` / `tail -n N`) of a file, telling
the model to `Read` it once instead — then goes **silent** (`if (n !== 3) return`, :8672). Full-sample compliance
mining (k5 @4.91.1, all sessions, **66 nudge-fires**, `scratchpad/slice-full`) shows the reminder is **largely
ignored**:

| outcome | ALL (66) | flash (40) | pro (26) |
|---|---|---|---|
| comply (→ `Read` next) | 7 (10%) | 5 | 2 |
| **ignore** (keeps slicing) | 28 (42%) | 16 | 12 |
| no-return (file dropped) | 31 (46%) | 19 | 12 |
| **ignore, of re-accessed** | **80%** | 76% | 85% |

- **93% of ignored files (26/28) are NEVER `Read`** — the model declines the reminder, it does not miss it. So a
  **re-fire of the same channel is not supported** (an ignored signal sent again).
- **60% of ignores slice only 1–2 more times then stop** (median 2 extra) — self-limiting, no intervention needed.
  The harm is the **39% deep-grinders** (3+ more, up to **23** extra slices of one file) — exactly who ignore the
  reminder channel hardest.
- **Scope, from the ignore list:** 16/28 are `.log`/`.txt` (`caffe_build.log`, `install2.log`, `qemu.log`,
  `training_output.txt`, …) — repeatedly `tail`-ing a *growing* log is LEGITIMATE and `Read`-once is the wrong fix.
  12/28 are static source (`shared_heap.c`, `tasks.py`, `doom.asm`, `text.gcode`, `bottle.py`, `clparse.c`) —
  genuine re-slice-the-same-static-file waste.

Precedent: `loopToolBlock.ts` header — "a soft `<system-reminder>` nudge is provably IGNORED … a HARD,
non-ignorable intervention instead." Same finding, same fix shape.

## The fix — coercive, scoped, bounded (`CORTEX_SLICE_BLOCK`, dark)

A **pre-execution gate** `maybeBlockSliceRead(toolUse)` at the two executor sites next to `maybeBlockLoopingTool`
(`CortexOrchestrator.ts:7249`, `:7805`). When the model calls Bash with a slice-read of a **static/source** file it
has already sliced `>= CORTEX_SLICE_BLOCK_AT` times, the slice is **NOT executed** — it returns an append-only
`is_error` redirect (tools array unchanged → cache-safe) telling the model to `Read` it once. Bounded to
`CORTEX_SLICE_BLOCK_MAX` blocks per file (then let through — no infinite loop, no expensive mentor consult:
the evidence says slice-spam is not worth a pro-max escalation, the block itself is the intervention).

- Reuse `sliceReads` (the per-file counter `applySliceNudge` already maintains, post-exec). Add per-file
  `sliceBlockCounts`.
- The soft nudge at n=3 (`applySliceNudge`) STAYS unchanged (reson). The block is a strictly-additive dark layer.
- **Scope (append-log exemption):** exempt files whose basename matches `/\.log$|log|output|progress|download|\.out$/i`
  → legit re-tailing is never blocked. Everything else = static/source → block-eligible. Heuristic + tunable; the
  cell A/B validates the boundary (does it help without false-positive harm on log-tailing?).

### Config (all dark)
- `CORTEX_SLICE_BLOCK` (gate; default off). `CORTEX_SLICE_BLOCK_AT` (default **5** — block the 6th slice; leaves the
  soft nudge at 3 + the 60% shallow-stoppers alone, coerces only sustained grinders). `CORTEX_SLICE_BLOCK_MAX`
  (default **2**). Add to `effectiveConfig.ts`, `.env` LEDGER (dark), `ToolProfile.resolveSliceBlock`,
  `SettingsSchema`/`RuntimeConfigRegistry`.
- New decision event kind `slice_block` (DecisionStore `SteeringEventKind`) — the mechanism-engagement marker.

## Modules
- NEW pure `packages/core/src/orchestrator/sliceBlock.ts`: `sliceReadFile(cmd)` (the shared slice regex, also
  reused by `applySliceNudge`), `isAppendLog(file)`, `decideSliceBlock(file, priorSlices, priorBlocks)` →
  `{action:'block'|'none', message}`. PURE — all state in the orchestrator.
- NEW `__tests__/sliceBlock.test.ts`.
- WIRE `CortexOrchestrator.maybeBlockSliceRead` + `sliceBlockCounts` at the 2 executor sites; refactor
  `applySliceNudge` to use `sliceReadFile`.

## Test plan (before any cell)
1. Unit: `sliceBlock.test.ts` — regex extraction (sed/head/tail forms), log exemption (block source, exempt
   `.log`/output/progress), threshold (none < AT, block at AT, none once priorBlocks >= MAX).
2. `tsc --noEmit` clean; scoped `sliceBlock.test.ts` + no-regression on the orchestrator e2e.
3. Live seeded fire-check (local server, DEBUG): drive a task that slices ONE source file 6+ times → confirm the
   block fires + `slice_block` event bank + the slice did NOT execute; drive a `tail -f`-style log re-read →
   confirm it is NOT blocked (scope holds). Gate-off → byte-identical (no block, no event).

## Validation (the cell)
A/B `CORTEX_SLICE_BLOCK` on vs off on the slice-heavy source population (gcode-to-text, make-doom, dna-*,
fix-ocaml-gc, build-pmars, make-mips) — metric: pass-rate + turns/tokens + `slice_block` fire count with
mechanism-engagement, + a false-positive watch (blocked a legit log-tail?). Winner → reson default-on.

## Evidence artifacts
`scratchpad/slice-full/*.session.jsonl` (152 k5 trajectories), the compliance + post-nudge-depth analysis
(this session's canon-grounded mine). Add HB-SLICE-BLOCK to `HARNESS_IMPROVEMENT_BACKLOG.md` + the STDB
`deficiency` ledger (project=nexus-cortex).
