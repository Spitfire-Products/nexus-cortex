# Internal Browser — Optional Harness Module (Build Plan)

**Status:** PLAN (future work; not commissioned). Authored 2026-08-27.
**Motivation source:** operator, during the TB2.1 single-provider-key discussion.
**Gate:** this is a **product** capability, **decoupled from the TB2.1 bench** — TB2.1 needs no
browse (investigated 2026-08-27: 0/89 tasks require web search/browse; internet is for
dependency fetching via bash — see `.claude/skills/harbor-bench/SKILL.md §TB2.1 FACTS`). Do NOT
bench-justify this build. Build it when the **product** wants native browse, not for a bench number.

---

## 1. Goal

Give the `nexus-cortex` harness a **native, self-contained browse capability** so that a single
provider key powers the *entire* harness (main model + helper + web), reproducibly, everywhere the
harness runs — hosted TMUX containers, local `npm i` installs, and any internet-enabled sandbox.
The agent calls its **own internal browser tools** (drive a real headless Chromium via tool calls),
with the vision-capable helper reading screenshots for visual pages. No dependency on our
`nexus-browser` Cloudflare Worker (which external users can't reproduce), and no second provider key
for web grounding (DeepSeek has no native web-search API — see §7).

This continues the "one key powers the whole harness" theme (cf. the 2026-08-27
helper-model → `deepseek-v4-flash` single-key change).

---

## 2. Design principles

1. **Optional, never mandatory.** Chromium + Playwright/Puppeteer is ~300 MB. It must NOT bloat the
   base `npm i nexus-cortex`. Ship as an optional dependency / extra, lazy-provisioned on first use.
2. **Driver abstraction, not a rewrite.** The existing `nexus-browser` 34-tool *surface* is the
   reusable asset. Extract it; abstract the browser *driver* under it. Do not reimplement scan/click/
   type/get_content/screenshot.
3. **Reuse existing infra** (recognize-existing-infra): the `nexus-browser` tool surface + the
   `nexus-browser-sandbox` Playwright-relay pattern are the base to lift, not the CF-Puppeteer glue.
4. **Vision as a complement.** Most web extraction is text (HTML→markdown, text model). Vision-flash
   reads *screenshots* only for genuinely visual pages (rendered-UI verification, canvas/PDF-as-image).
5. **Security posture is first-class.** An agent driving a real browser to arbitrary sites is a real
   surface — same risk class as the VFS `new Function` concern. Gate behind explicit enablement +
   consent; support a network allowlist; stronger isolation where the host isn't already sandboxed.
6. **Cache discipline.** A browse *subagent* (dispatch) does the messy multi-step browsing and
   returns a distilled answer, keeping the MAIN agent's context/cache clean (mirrors the CORTEX
   browser harness and the item-10/11 helper cache-safe delivery rails).

---

## 3. Current-state grounding (what exists today)

| Piece | What it is | File(s) |
|---|---|---|
| `nexus-browser` (CF Worker) | 34 browser tools driven by **`@cloudflare/puppeteer`** → Cloudflare Browser Rendering; **per-session browser via a Durable Object**; `backend: 'puppeteer' \| 'sandbox'`. CF-runtime-coupled. | `nexus-terminal/workers/nexus-browser/src/mcp.ts` (`@cloudflare/puppeteer` import ~:23; backend ~:191), `index.ts`, `sessions.ts`, `playbook.ts`, `sandbox-page.ts`, `injectable/` |
| `nexus-browser-sandbox` | Docker container: **Chromium + Xvfb + xdotool + a persistent Playwright (Python) relay** (`playwright-relay.py`), driven via `@cloudflare/sandbox`. **This is the closest analog to what a library driver does.** | `nexus-terminal/workers/nexus-browser-sandbox/{Dockerfile,src/index.ts,playwright-relay.py}` |
| Harness tool registry | Where new tools register (the harness Skill tool registers here too). | `omniclaude-v4/packages/core/src/tools/registries/BaseToolRegistry.ts` |
| Dispatch / subagents | `DispatchCoordinator` — spawn a sub-agent with its own tools/model (the browse-subagent vehicle). | `omniclaude-v4/packages/core/src/orchestrator/` (dispatch) |
| MCP management | How MCP servers/tools are discovered/added. | `omniclaude-v4/packages/core/src/tools/mcp-management/{ListAvailableMcpServers,InitMcpConfig}.ts` |

**Key insight:** the tool *logic* (Puppeteer page operations: `page.goto/click/type/evaluate/content/
screenshot`) is largely portable. What's CF-coupled is the *runtime glue* — `@cloudflare/puppeteer`
`connect()`, Durable-Object session management, `@cloudflare/sandbox`. The port replaces that glue
with a local Chromium launch + local session management; the tool surface stays.

---

## 4. Target architecture — the driver abstraction

```
        BrowserTools (the 34-tool surface: scan/click/type/get_content/screenshot/…)
        — page-operation logic, parameterized over ↓
                       BrowserDriver  (interface)
        ┌───────────────────┬─────────────────────────┬───────────────────────┐
   CFBrowserDriver     LocalBrowserDriver        SandboxRelayDriver
   (@cloudflare/       (NEW — local playwright-   (existing Chromium+Playwright
    puppeteer →         core/puppeteer-core;       relay container; challenge/
    Browser Rendering)  launches Chromium          hardened-isolation cases)
   → the CF Worker      in-process) → the CLI
                        harness / this module
```

- **`BrowserDriver` interface** (minimal): `launch()/newSession()`, `goto(url)`, `click(sel)`,
  `type(sel,text)`, `select`, `scroll`, `evaluate(fn)`, `content()→html`, `screenshot()→bytes`,
  `waitFor`, `close()`, plus session lifecycle (open/reuse/dispose).
- **Both surfaces consume the same `BrowserTools`;** only the driver differs. The CF Worker keeps
  `CFBrowserDriver` (zero behavior change); the harness module ships `LocalBrowserDriver`.
- This is the refactor that makes "just make it part of the library" real without duplicating 34
  tools or diverging the two implementations.

---

## 5. Packaging (the "optional module" mechanics)

- **New optional package** `@nexus-cortex/browser` (peer/optional dep of the harness), OR an extra
  the user opts into. Base `nexus-cortex` install pulls NO Chromium.
- **Chromium provisioning — lazy, on first browse use:** `playwright-core` (preferred — smaller API
  surface, `playwright install chromium`) or `puppeteer-core` + a browser fetch. Detect a
  system-installed Chromium first (`google-chrome-stable`/`chromium` on PATH — the
  `nexus-browser-sandbox` already probes exactly this) and reuse it to skip the download.
- **Feature gate:** `CORTEX_BROWSER_ENABLED=true` (env) + module-present detection. Browse tools
  register **only when** the module is installed AND a browser is resolvable.
- **Graceful absence:** with the module/browser absent, the browse tools are simply not registered
  (or return a one-line "enable the browser module: `npm i @nexus-cortex/browser` + set
  `CORTEX_BROWSER_ENABLED=true`") — never a hard crash, never a silent hang.

---

## 6. Tool surface + the browse-subagent pattern

- **Ported tools (from the 34):** `browse/goto`, `scan` (a11y/DOM → selectors), `click`, `type`,
  `select`, `scroll`, `get_content` (→ markdown), `screenshot`, `wait_for`, `evaluate`,
  `extract_table`/`extract_links`, `fill_form`, `close_session`. (Trim the CF-only/challenge-solver
  tools initially; add back as needed.)
- **Vision complement:** `screenshot` → hand bytes to the vision helper (`deepseek-v4-flash-vision-exp`)
  for visual pages. Text extraction (`get_content`) stays on the text model — vision is targeted.
- **Browse subagent (dispatch):** a `DispatchCoordinator` sub-agent profile with the browse tools +
  vision helper, on a cheap model (`deepseek-v4-flash`). It does the multi-step browse and returns a
  distilled answer to the main agent — main's context/cache stay clean. This is the CORTEX-browser
  parallel and the correct containment for token economics.

---

## 7. Why this (not the alternatives)

- **Provider-grounded WebSearch/WebFetch is a dead end for single-key DeepSeek:** the harness web
  tools auto-pick Gemini > Anthropic > XAI (provider-native search grounding); **DeepSeek has no
  native web-grounding API**, so a single DeepSeek key can only fall back to the unreliable
  DuckDuckGo HTML scrape. Agentic browse makes web a **tool** (no grounding API needed) — DeepSeek
  drives it by tool calls.
- **Depending on the remote `nexus-browser` MCP Worker breaks reproducibility** (our infra + our
  keys; external parties can't run it). An in-process/local driver is self-contained.

---

## 8. Phases / milestones (each release-gated)

- **Phase 0 — Spike (½–1 day):** `playwright-core` in a throwaway script — launch Chromium, `goto` +
  `get_content` + `screenshot` one page, locally AND inside a representative container. Validate the
  Chromium install path, size, and system-Chromium reuse. Decide `playwright-core` vs `puppeteer-core`.
- **Phase 1 — Driver abstraction (the bulk):** extract `BrowserTools` + define `BrowserDriver`;
  implement `LocalBrowserDriver`; refactor the CF Worker to consume `BrowserTools` via
  `CFBrowserDriver` (prove zero Worker regression with its existing tests). This is where most of the
  value + risk lives.
- **Phase 2 — Harness integration:** register the browse tools in `BaseToolRegistry` behind
  `CORTEX_BROWSER_ENABLED`; lazy Chromium provisioning + system-Chromium detection; graceful absence.
- **Phase 3 — Vision + subagent:** wire `screenshot` → vision helper; ship a browse-subagent dispatch
  profile (cheap model, distilled return).
- **Phase 4 — Security + packaging:** optional-dep packaging (`@nexus-cortex/browser`); consent/enable
  gating; optional network allowlist; sandbox posture doc; user docs.
- **Phase 5 — (optional) Validation:** a browse-capable arm on a **browse-relevant** eval — NOT
  TB2.1 (no browse tasks). Build/borrow a small web-task set if we want a number; otherwise validate
  functionally.

---

## 9. Risks / open questions

- **Chromium size + provisioning** in constrained/offline environments — the "environment that
  supports it" gate. Mitigation: system-Chromium reuse; clear "browser unavailable" degradation.
- **Cross-platform** Chromium (linux/mac/win) for local installs — playwright-core handles this but
  adds install-matrix surface.
- **Security** — arbitrary-site browsing on a *user's* machine. Mitigation: default-off, explicit
  consent, allowlist option, reuse the sandbox-relay isolation where the host isn't already isolated.
- **Two drivers to keep in sync** — mitigated by the shared `BrowserTools`; the CF Worker's existing
  tests guard its driver.
- **CF Worker parity** — extracting the surface must not regress the Worker; Phase 1 gates on its
  tests staying green.

---

## 10. Non-goals

- Not for TB2.1 (zero browse tasks — do not bench-justify).
- Not a mandatory dependency (base install stays lean).
- Not a replacement for the `nexus-browser` CF Worker — both coexist via the shared `BrowserTools`.
- Not a general web-scraping product — an agent capability, gated and optional.

---

## 11. Rough effort

Phase 0–1 (spike + driver abstraction + local driver) is the majority of the work; Phase 2–4
(integration, packaging, security) is incremental. Order-of-days of focused engineering, release-gated
through the standard `deploy-nexus-cortex.sh --release` train. Sequence it after the loop-management
A/B (the current live priority) unless a product need pulls it forward.
