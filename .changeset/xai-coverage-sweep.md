---
"@nexus-cortex/core": patch
---

xAI transport coverage sweep (grok-build follow-through): retry-classify all four raw-fetch throw shapes (xAI Responses "error 429:" and Gemini ": 429 -" were never retried — extractor now anchored on "API error", false-positive guards intact); x-grok-req-id + opt-in doom-loop-check on the xAI Responses path (conv-id already rides prompt_cache_key); stronger StructuredOutput steering so weak models (gpt-5-nano) reliably call it; opt-in TAIL_LOOP_GUARD_ALL_PROVIDERS mode (default off, per-provider canary before enabling); typed empty-response classification (reasoning_only vs no_visible_content) enriching the R18b log + tailoring the completion nudge.
