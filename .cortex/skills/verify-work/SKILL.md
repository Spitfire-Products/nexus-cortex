---
name: verify-work
description: >
  Verify completed work with an independent, skeptical subagent before calling
  it done. Spawns a verifier that reviews the diff, runs the build and tests,
  and tries to REFUTE the claimed result rather than confirm it. Use when asked
  to "check work", "verify changes", "self-verify", or before merging/shipping
  any change whose failure would be expensive.
metadata:
  short-description: "Adversarial verification subagent — refute, don't confirm"
  author: "nexus-cortex"
---

# Verify-Work — Independent Verification Subagent

The agent that wrote a change is the worst judge of it: it re-reads its own
intent, not the code. Verification works when it is **independent** (a fresh
context that never saw the implementation reasoning) and **adversarial** (the
verifier's job is to find what's wrong, not to agree).

## When to use

- Before declaring any non-trivial change complete — especially refactors,
  cross-package edits, and anything touching wiring/registries.
- When the implementer reports success but the evidence is its own narration.
- Before a merge whose revert would be expensive.

## The workflow

1. **Freeze the claim.** Write down exactly what the change is supposed to do,
   as testable statements ("X now returns Y for input Z", "the build passes",
   "no caller of `foo()` breaks"). Vague claims can't be verified — sharpen
   them first.

2. **Spawn a verifier subagent** (`Task`) with a prompt that contains ONLY:
   - the claim list (not the implementation reasoning — independence is the
     point; do not bias the verifier with why the change "should" work),
   - where the change lives (branch/diff/files),
   - the instruction: **try to refute each claim**. Default to "not verified"
     when uncertain.

3. **The verifier's checklist** (each item produces evidence, not opinion):
   - **Read the actual diff** — flag anything the claims don't cover (collateral
     edits, leftover debug code, accidental deletions).
   - **Build it** — run the project's real build; a green build is a fact, a
     "should compile" is not.
   - **Run the tests** — the affected suite at minimum; capture failures
     verbatim. New behavior without a covering test is a finding.
   - **Exercise the claim directly** — run the command / hit the endpoint /
     execute the snippet that the claim describes, and compare output to the
     claimed result. Independent ground truth beats both agents' opinions:
     grep/shell/direct execution on the real artifact decides disputes.
   - **Hunt the blast radius** — search for other callers/consumers of every
     changed symbol; verify they still hold.

4. **Verdict, per claim**: `verified` (with the evidence), `refuted` (with the
   failing output), or `unverifiable` (with what's missing — e.g. no test, no
   repro). The overall result is the WORST per-claim verdict, not the average.

5. **Act on it.** Refuted → fix and re-verify (the re-verify is a fresh
   verifier, not the implementer "confirming the fix"). Unverifiable → either
   add the missing check or downgrade the done-claim honestly. Only an
   all-verified result justifies "done, verified".

## Rules

- **Fixed ≠ verified.** Passing the case that surfaced the problem is `fixed`;
  `verified` requires the build, the tests, and the blast-radius check to hold.
- **Evidence or it didn't happen.** Every verdict cites command output, a test
  result, or a quoted diff line. Narration is not evidence.
- **The verifier never edits.** It reports; the implementer fixes. Mixing the
  roles re-introduces the bias verification exists to remove.
- **Don't soften the claims to pass.** If a claim was too strong, the honest
  outcome is "claim corrected", not a quiet rewording.
