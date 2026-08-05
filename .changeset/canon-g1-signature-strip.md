---
"nexus-canon": minor
---

G1 signature portability — `canon pull --strip-signatures`. Provider thinking
signatures validate against the originating account/org, so a shared store's
session can fail signature replay when a teammate pulls it. The new flag applies
an explicit, counted lossy projection to the MATERIALIZED COPY only (the
canonical line is never modified): thinking blocks become
`<prior_reasoning>` text — the harness's own THINKING_AS_TEXT_FALLBACK
convention — and org-bound `redacted_thinking` blocks are dropped (a message
left empty gets a marked stub; empty content is replay-invalid). Exported as
`stripThinkingSignatures(file)` for library use. Pre-req for any team/sharing
tier per the G1 gap record.
