---
"@nexus-cortex/core": minor
"@nexus-cortex/server": minor
---

StructuredOutput (grok-build port): schema-constrained JSON output on every provider path via a synthetic request-scoped StructuredOutput tool — inject (essential-tier, survives deferred filtering) + steer via tool description + intercept before executors + Ajv validation + up to 3 corrective retries + fail-open. New `jsonSchema` option on SendMessageOptions; `json_schema` body field on POST /v1/messages; result surfaced as `metadata.structuredOutput {value, valid, attempts, errors?}`. Live-verified cross-provider (deepseek first-try valid; gemini converged via corrective retry).
