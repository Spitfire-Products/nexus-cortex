# Agent SDK Transport — Investigation & Strategy (2026-08-15)

**Status:** DESIGNED, not built. Investigation complete across three tracks: authoritative
Agent SDK / ToS facts (live docs), the omniclaude-v4 transport map, and the browser-CORTEX
map. Supersedes the premise in the `claude-agent-sdk-oauth-transport` memory.

---

## 0. THE COMPLIANCE CORRECTION (read first — it reframes the project)

The project premise was: *"subscription OAuth tokens are authorized through the Claude Agent
SDK, so an Agent-SDK transport makes subscription-token use compliant."* **That is not what
the current terms say.**

Verified position (2026-08-15, citations in §7):

1. **Subscription OAuth tokens (`sk-ant-oat01-…`, Claude Code `/login` /
   `claude setup-token`) are restricted to Claude Code and claude.ai themselves.** The
   Feb 2026 ToS clarification prohibits their use in "any other product, tool, or service."
2. **The Agent SDK docs state explicitly**: "Unless previously approved, Anthropic does not
   allow third party developers to offer claude.ai login or rate limits for their products,
   *including agents built on the Claude Agent SDK*." The SDK being sanctioned *tooling*
   does not sanction subscription *credentials* inside a third-party product.
3. **A formal path exists but is approval-gated**: the June 2026 policy change created a
   credit-pool tier for "third-party apps that authenticate with your Claude subscription
   through the Agent SDK" — i.e. Anthropic runs a program for exactly this, but it is a
   partnership/approval program, not self-serve.
4. Token families must not be conflated:
   - `sk-ant-api…` Console API keys → authorized anywhere (incl. the Agent SDK). Metered.
   - `sk-ant-oat01…` **subscription** OAuth → Claude Code / claude.ai only, unless approved.
   - `ant auth login` **platform** OAuth profiles → org-billed, usable directly against the
     API (Bearer + `anthropic-beta: oauth-2025-04-20`); a *different* credential class.
   - `ANTHROPIC_AUTH_TOKEN` (gateway bearer) → authorized.

**Strategic consequence:** build the Agent-SDK transport now on *authorized* credentials
(API key / AUTH_TOKEN / platform-OAuth); treat subscription-credential enablement as a
**flag behind Anthropic approval** (apply via the June-2026 program). The transport is
worth building regardless — it gives the harness Claude-Code-parity execution semantics
and becomes the ready rail the day approval lands. What we must NOT ship: any code path
that sends an `sk-ant-oat01` token to the API from our products without that approval.
The credential gate therefore *hard-blocks by prefix* rather than enabling by prefix.

---

## 1. omniclaude-v4: the `agent-sdk` transport design

### 1a. Where it plugs in (from the map, all file:line verified)

Transport registration is a hardcoded switch, not a registry. Four edits:
1. `packages/types/src/models.ts:50` — add `'agent-sdk'` to the `api.pattern` union.
2. `APIClient.sendRequest` switch (`APIClient.ts:233`) — new case → `sendAgentSDKAPI`.
3. `APIClient.streamRequest` switch (`APIClient.ts:281`) — new case.
4. `GatewayTranslationLayer.extractMessagesFromResponse` (`:748-767`) + `extractUsage`
   (`:775-793`) — new branches. Cleanest: **synthesize an Anthropic-`messages`-shaped
   response** so the existing anthropic branches Just Work (the hf-space transport is the
   architectural template — it synthesizes an OpenAI `chat.completion`, `APIClient.ts:991-1002`).

### 1b. The transport internals

`AgentSDKTransport` wraps `@anthropic-ai/claude-agent-sdk` `query()`:

- **Tool inversion (the key design decision).** The SDK runs its *own* agent loop; it does
  not surface pending tool_use for an external executor the way `/v1/messages` does. To keep
  "harness owns all 31 tools" true, wrap the harness executors as an **in-process MCP
  server** (`createSdkMcpServer` + `tool()` — handlers call straight into our
  `ToolFactory`/executor layer, same process, no subprocess) and disable every built-in with
  `tools: []` + `allowedTools: ["mcp__nexus-cortex__*"]` + `permissionMode` deny-elsewhere.
  Result: Claude sees only our tools; our code executes them; the *loop* runs inside the SDK
  for that turn instead of in CortexOrchestrator.
- **Reporting the inner loop outward.** As SDK messages stream, the transport re-emits our
  `StreamChunk`s: assistant text → `content_block_delta`; each MCP tool call/result →
  `tool_use_complete` / tool_result chunks + appended canonical messages, so
  decisions.jsonl, canon capture, TUI rendering and cost meters see a normal multi-tool
  turn. `includePartialMessages: true` gives live deltas; `ResultMessage.total_cost_usd` +
  `usage` map into `TokenUsageMetrics` (`GatewayTranslationLayer.ts:109-149`).
- **Session mapping.** Per-orchestrator-session, hold an SDK session: first turn plain
  `query()`, capture `session_id` from the init SystemMessage, subsequent turns
  `resume: sessionId` (preserves prompt caching). Fall back to stateless
  `persistSession: false` replay when resume is unavailable. AbortController wired to the
  orchestrator's signal.
- **Consumer-map compliance (the 🔴 rules).** Emit `data: { reasoning: true }` on thinking
  deltas (the marker consumed at `interactive.ts:1882`, `useCortexStream.ts:332/347`,
  `CortexOrchestrator.ts:3274`) — never invent a new chunk type. Do not touch the four
  sacred surfaces: the xAI APIClient reader (`APIClient.ts:1815-1960`),
  `ResponsesAPIAdapter` header contract, the reasoning-marker convention, and the
  thinking-block round-trip in `MessagesAPIAdapter.ts:514-570/638-663`. A new pattern case
  + Anthropic-shaped finalMessage touches none of them. NOTE (SDK track, UNCERTAIN):
  whether the Agent SDK surfaces Anthropic thinking blocks at all is undocumented — probe
  during the spike; if absent, emit no reasoning channel (allowed) rather than a fake one.

### 1c. Cards + credential gate

- **Env-gated card registration** (hf-space pattern, `hf-space-models.ts:81-113`): register
  `claude-*-agentsdk` card variants only when an authorized credential for the SDK path is
  present. Card factory: extend `createClaudeModelConfig` options with a
  `transport: 'agent-sdk'` discriminator → sets `api.pattern: 'agent-sdk'`; or ride
  `metadata` (precedent: `metadata.hfSpaceExpectedModel`, `APIClient.ts:974-983`).
- **`AnthropicCredentialService`** already has the oauth branch (reads
  `~/.claude/.credentials.json` `claudeAiOauth.accessToken` + `CLAUDE_CODE_OAUTH_TOKEN`,
  `:192-224`) — i.e. the harness *today* will happily put a subscription token on a raw
  Messages call via `new Anthropic({authToken})` (`APIClient.ts:517-521`). **That existing
  branch is itself the compliance hazard.** P1 adds a prefix gate: `sk-ant-oat01…` →
  REFUSE on the raw Messages path with a clear message ("subscription tokens are only
  usable via Claude Code, or via the Agent SDK transport once the approval flag
  `CORTEX_SUBSCRIPTION_AUTH_APPROVED=1` is set"). Platform-OAuth bearer tokens (ant-auth
  profiles) remain allowed on the raw path — they are authorized there.
- **Bug found, fix regardless:** `modelKeyAvailability.ts:23-33` checks only
  `api.apiKeyEnvVar` → an OAuth-only install fails the check and sub-agents pinned to
  Claude are *silently rerouted* (`modelWithKeyFallback:39-48`). Teach it about
  AUTH_TOKEN/oauth availability.
- Second injection site to gate identically: `MessagesAPIHelperAdapter.makeAPICall`
  (`:311-367`) — same env read, raw fetch Bearer.

### 1d. Facts that bound the design
- SDK: Node 18+ (repo targets >=18, runs v20), bundles its own Claude Code binary,
  spawns it as a subprocess — fine on server/CLI/container, **impossible in browsers**.
- `@anthropic-ai/sdk` is pinned old (`^0.20.9` resolved 0.20.9) — the Agent SDK dep is
  additive; no version fight expected, but the old SDK pin deserves its own upgrade item.
- Subprocess/env-control precedents to reuse: `SubAgentProcessManager.spawnAgent`
  (`:167-229`), `harnessProcess.ts:126-132`.

---

## 2. Browser CORTEX: delegation, not embedding

The SDK cannot run in a browser. The compliant architecture is **delegate Anthropic
subscription turns to a Node host we already run** — and the seam already exists:

- **`ExternalAgentTransport` (`cortex/core/orchestrator/ExternalAgentTransport.ts`)
  implements the same `streamMessage(StreamParams) → MessagesAPIResponse` contract as
  `MessagesAPITransport`, selected at `CortexOrchestrator.ts:935-951`.** A
  `HostedAgentTransport` clone pointed at the cortex front door needs zero orchestrator or
  middleware changes.
- **Host:** the hosted container (`cortex.spitfire-products.com` → nexus-cortex-sandbox,
  a real Node process host with nexus-cortex installed). Missing piece: a synchronous
  front-door **turn route** (`POST /turn` streaming) — the front door has
  /terminal, /session/*, /mcp today, no message-turn endpoint (verified absent).
  The container-side leg is just the omniclaude-v4 `agent-sdk` transport (§1) running in
  the harness that is already installed there — build once, both surfaces benefit.
- **Credential rail:** the envelope vault (`workers/nexus-cortex/src/inference.ts:195-247`
  RSA-OAEP+AES-GCM unwrap → job token) with a reserved non-model provider slot exactly like
  `CANON_VAULT_PROVIDER = 'canon'` (`AutoResearchCredentialService.ts:165-169`) — add
  `'anthropic-oauth'`. Alternative courier: `/session/env` allowlist
  (`nexus-cortex-sandbox/src/index.ts:146-157` + `cortexServingClient.ts:361`) — two
  one-line allowlist additions.
- **Credential UX:** CORTEX → Connections tab (`ConnectionsPage.tsx`) — the established
  home for scope-isolated non-inference credentials with "save for hosted sessions"
  semantics and per-slot status. SECRETS already has `access-token`/`refresh-token`
  SecretTypes. Gate the field's very existence behind the approval flag.
- **Landmine (fix before ANY bearer work):** ai-proxy `hasClientAuth()`
  (`ai-proxy.js:427-435`) checks only `X-Api-Key` for Anthropic — a request bearing only
  `Authorization: Bearer` is treated as *unauthenticated* and gets the **platform API key
  silently injected** (`:518-524`). Until fixed, a leaked/misrouted subscription-bearer
  attempt would double-fail: token dropped AND platform-billed. Fix: recognize
  bearer-shaped client auth for Anthropic and forward it — or explicitly 400 it (preferred
  until approval exists).
- Direct browser→`api.anthropic.com`/`claude.ai`: triple-blocked (our CSP `public/_headers:4`,
  the proxy domain allowlist `ai-proxy.js:337`, Anthropic's browser/CORS posture). Not a path.

---

## 3. Phased plan

| Phase | What | Gate |
|---|---|---|
| **P0** ✅ DONE 2026-08-15 | Compliance hardening (do now, independent of the rest): prefix-gate `sk-ant-oat01` in `AnthropicCredentialService` raw path + `MessagesAPIHelperAdapter`; ai-proxy bearer 400 (no silent platform-key injection); `modelKeyAvailability` OAuth-awareness fix. | none — these are correctness/compliance fixes |
| **P1** | `AgentSDKTransport` in omniclaude-v4 on **API-key auth**: 4 switch edits + transport + in-process MCP bridge to ToolFactory + env-gated `-agentsdk` cards + scoped tests (red-green on the consumer-map invariants). Value now: Claude-Code-parity harness execution, A/B-able vs the Messages path via cortex-bench. | operator go (build) |
| **P2** | Hosted delegation for the browser: front-door `POST /turn` + `HostedAgentTransport` (ExternalAgentTransport clone) + `anthropic-oauth` vault slot (dormant). | operator go |
| **P3** | Subscription enablement: apply to Anthropic's third-party subscription-auth program (June-2026 credit tier). On approval: flip `CORTEX_SUBSCRIPTION_AUTH_APPROVED`, enable the Connections field, allow `sk-ant-oat01` **only** into the agent-sdk transport env. | **Anthropic approval — hard external gate** |
| — | Broader per-provider subscription rails (OpenAI/Codex, xAI/grok) from the original memory: same pattern, each needs its own ToS verification first. Deferred. | per-provider ToS check |

**Recommendation:** greenlight P0 immediately (it closes live compliance/correctness holes),
P1 next (real value on authorized credentials + the readiness argument), and start the P3
approval conversation with Anthropic in parallel — the build is never the bottleneck; the
authorization is.

---

## 7. Citations (compliance track)
- Agent SDK Overview — third-party claude.ai login restriction:
  code.claude.com/docs/en/agent-sdk/overview.md
- Claude Code Authentication (credential precedence, CLAUDE_CODE_OAUTH_TOKEN):
  code.claude.com/docs/en/authentication.md
- Feb 2026 ToS clarification (subscription tokens → Claude Code/claude.ai only):
  theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access/
- June 2026 credit-pool program (third-party apps + subscription auth through Agent SDK):
  techtimes.com/articles/317625/20260602/anthropic-ends-subscription-subsidy-agents-june-15.htm
- Agent SDK sessions/custom-tools/MCP docs: code.claude.com/docs/en/agent-sdk/{sessions,custom-tools,mcp}.md


---

## 8. P0 IMPLEMENTED 2026-08-15 (commits: harness c3eb180a70, worker 30cb0e2cc9)
All three P0 fixes shipped + tested red-green (subscription-gate 12/12, modelKeyAvailability
8/8, ai-proxy bearer-gate 6/6, gate3 regression 20/20; typecheck clean):
- FIX 1: `sk-ant-oat01` prefix gate in AnthropicCredentialService (both OAuth sources) +
  MessagesAPIHelperAdapter defense-in-depth; `CredentialError` code `SUBSCRIPTION_TOKEN_BLOCKED`;
  unlock flag `CORTEX_SUBSCRIPTION_AUTH_APPROVED=1`. Auto-mode still falls back to API key.
  Side change: `ANTHROPIC_AUTH_TOKEN` now a first-class `type:'bearer'` credential.
- FIX 2: `hasAnthropicAuth()` counts API key OR AUTH_TOKEN OR non-gated OAuth — Claude-pinned
  subagents no longer silently reroute on an OAuth/AUTH_TOKEN-only install.
- FIX 3 (DEPLOYED via ai-proxy worker): bearer-only Anthropic requests get an explicit 401
  instead of silent platform-key substitution; BYOK X-Api-Key, narjob_ tokens, and the
  no-auth anon/tier lane all preserved.
Harness fix rides the next nexus-cortex npm release (not yet published). Worker deployed.
Remaining phases P1-P3 unchanged (P1 = AgentSDKTransport on API keys; P3 gated on Anthropic approval).