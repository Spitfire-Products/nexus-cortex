---
"@nexus-cortex/core": patch
---

Served-model drift detection (dialect-archaeology follow-up): the pure detector `detectServedModelDrift` compares the requested wire id against the response `model` field and flags backend aliasing (xAI serves grok-4-1-fast-* as grok-4.3, grok-code-fast-1 as grok-build-0.1), tolerating OpenAI-style dated snapshots. Wired into GatewayTranslationLayer.convertResponse (same wire-id chain as prepareRequest), warn-once per pair, surfaced additively as `metadata.servedModel` / `metadata.servedModelDrift` on both non-streaming and streaming paths. Informational only — budgets are never auto-adjusted from this signal. This is the slug-drift detector wished for since the July xAI triage.
