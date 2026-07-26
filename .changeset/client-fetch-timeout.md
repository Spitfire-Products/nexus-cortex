---
"@nexus-cortex/cli": patch
---

fix: CLI→server message fetches no longer die at undici's 300s headersTimeout default ("fetch failed" on slow local-model turns — non-streaming turns send headers only at completion). Both client paths (CortexClient, OrchestratorClient server mode) now use a long-timeout dispatcher, default 900s, configurable via CORTEX_CLIENT_FETCH_TIMEOUT_MS. Same defect class the autoresearch bench dispatcher fixed earlier; surfaced by think-mode 0.8B arms exceeding 5 minutes per turn on t4 hardware.
