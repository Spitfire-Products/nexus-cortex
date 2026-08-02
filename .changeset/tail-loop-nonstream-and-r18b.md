---
"@nexus-cortex/core": patch
---

Close two gaps on the xAI Messages path: (1) non-streaming tail-repetition doom-loop guard — the streaming guard aborts mid-stream, so `sendMessage` now detects a repeating thinking tail POST-HOC on the final response and resamples once (same `XAI_TAIL_LOOP_GUARD` flag + detector, default OFF, byte-identical when off); the guard now covers both streaming and non-streaming xAI Messages requests. (2) R18b skip-when-captured — when structured output was requested and a StructuredOutput call was already captured, an empty visible-text turn is expected (the model ended after its final tool call), so the empty-response retry is skipped instead of burning an extra round-trip (observed with haiku in the structured-output canary). ON resample path still needs a live loop-inducing canary before enabling the flag.
