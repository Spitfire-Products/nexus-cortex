#!/usr/bin/env bash
# P6c arm B: boot-observation orient script. Output = orientation as
# observation-mass (BASH_PLUS_SPEC P6 refinement). Compact, fast, read-only.
R=/home/runner/workspace/omniclaude-v4
echo "=== REPO ORIENTATION: omniclaude-v4 (nexus-cortex harness monorepo) ==="
echo "Root: $R  (npm workspaces; TypeScript ES modules; built output in each package's dist/)"
echo
echo "--- Packages ---"
for p in core cli server executors types tui canon; do
  [ -d "$R/packages/$p" ] && echo "packages/$p"
done
echo
echo "--- Key subsystem locations (packages/core/src) ---"
echo "orchestrator/CortexOrchestrator.ts   - main turn loop, tool dispatch, anchoring"
echo "orchestrator/APIClient.ts            - provider send paths (messages/chat/responses/hf-space)"
echo "adapters/                            - per-API format adapters + GatewayTranslationLayer (canonical<->provider)"
echo "tools/registries/BaseToolRegistry.ts - tool definitions incl. discoveryTier"
echo "tools/ClientSideToolFilter.ts        - deferred tool discovery/widening (SearchTools)"
echo "models/cards/ + models/configurators/ - model cards and provider configurators"
echo "middleware/SystemMessageMiddleware.ts - system message injection"
echo "system-messages/                     - registry + loader for system docs"
echo "canon (packages/canon/src)           - cross-harness session store; toolMapping.ts maps tool concepts per harness"
echo
echo "--- Repo state ---"
git -C "$R" log --oneline -1 2>/dev/null | head -1
echo
echo "Search with grep -rn PATTERN packages/<pkg>/src; read files before asserting. Bench fixtures live under .cortex/bench/fixtures/."
