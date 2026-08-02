---
"@nexus-cortex/core": patch
---

Client-side tail-repetition doom-loop guard (grok-build port) — OPT-IN, default OFF. Pure `detectTailRepetition` watches the xAI thinking channel (via chunks already flowing through the orchestrator's own consumption loop — NO edit to the sacred APIClient stream reader) for a repeating tail; when `XAI_TAIL_LOOP_GUARD=true` and a confident loop is detected, the doomed stream is abandoned and resampled ONCE (a fresh sample at temp>0 escapes the attractor — grok-build's own remedy for the class). This is the client-side equivalent of grok-build's server `response.doom_loop_check`, with no server dependency. Flag OFF is byte-identical by construction. NOTE: the ON-state resample path is not yet live-canaried (env server-launch was unavailable); canary grok-code-fast-1 with a loop-inducing prompt before enabling.
