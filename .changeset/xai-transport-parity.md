---
"@nexus-cortex/core": patch
---

xAI Messages transport parity (grok-build port, operator-approved sacred-path change, canaried both slugs both flag states): per-request x-grok-req-id on both xAI paths; server-advertised limit headers (x-grok-context-window / x-grok-max-completion-tokens) parsed into optional APIResponse.xaiServerLimits; opt-in XAI_DOOM_LOOP_CHECK=true sends x-grok-doom-loop-check with terminal doom_loop_check passthrough (streaming SSE consumption deferred). Interleaved-thinking pattern verified intact pre/post.
