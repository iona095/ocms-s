# Changelog

All notable project-level changes are summarized here.

This file is intentionally concise. The authoritative behavioral specification remains the current contract.

## v1.4.1

Generic unsupported-protocol containment: a live model whose exact authority establishes a protocol outside the managed set (`chat/completions`, `messages`, `responses`) is explicitly skipped instead of blocking the whole synchronization.

### Added

- New `SKIPPED_UNSUPPORTED_PROTOCOL` disposition (reason `UNSUPPORTED_PROTOCOL` plus the exact endpoint), intentionally absent from all six managed arrays and recognized by membership validation.
- Protocol classification (`classifyProtocolSupport`) before model-record construction: exact docs remain first authority, the exact nested model-local `provider.npm` hint keeps its v1.4 fallback role, and no family/name/sibling/gateway inference, probing, or model-ID special-casing was added.
- Unsupported `-free` containment: an unsupported free model never crosses into supported routing through `FREE_COUNTERPART_FALLBACK`.
- Preview/UI visibility: CLI report section plus pass-through Web UX group (`unsupportedSkipped`); an unsupported live model already present in a managed array is removed and reported under `removed`.
- 14 v1.4.1 tests (`tests/v1.4.1/`) written test-first (controlled RED, then GREEN with no post-implementation test edits). Full release suite is now 227 tests (225 pass, 2 authorized Contract v1.4.1 §14 skips of the superseded v1.3 byte-identity pins, themselves replaced by v1.4.1 SHA pins).

### Unchanged (explicit)

- Strict metadata validation for supported protocols (`limit.output`, modalities, reasoning) and blocking on malformed authority, ambiguity, and membership mismatch.
- No new managed route; no inference probing; no DSH lifecycle behavior change; no transport ownership behavior change; no production settings behavior change.

### Verification

- Live scratch Preview acceptance against current public OpenCode sources: `zen/jev-1.13` and `zen/jev-1.13-free` → `SKIPPED_UNSUPPORTED_PROTOCOL` (endpoint `/zen/v1/systemone`), plan `READY`, all six managed routes populated normally.
- Immutable: contract v1.4.1 SHA-256 `f48e236f40ee5c15202f18c3e812d3f41742804304d0de0d070342c0adeeb05b` (392 lines).

## v1.4.0

Optional DSH integration: OCMS-S as one DSH conversation view (tab label `Models`, slot `conversation.view`, id `models`, order `30`). DSH-owned scope is exclusively lifecycle (status/Start/Stop), exact child-process ownership, and iframe hosting. All sync authority stays in the released engine and Web UX.

### Added

- DSH Host plugin (`dsh/host.mjs`): one process-global lifecycle controller per Host instance; typed Remote `ocms` (`status`/`start`/`stop`); embed-origin validation; no auto-start triggers; disposal stops the exact owned child.
- Pure lifecycle controller (`dsh/lifecycle.mjs`) with a `disposed`/generation fence: disposal synchronously invalidates any in-flight Start generation — no post-disposal spawn, no stale `ONLINE` (even with a late `READY`), exact-child `SIGKILL` during `STARTING`, permanent Start refusal after disposal.
- Embed-origin validation (`parseEmbedOrigin`) in `ui.mjs` plus embed-mode CSP (only `frame-ancestors` changes to the single normalized loopback origin; standalone stays `frame-ancestors 'none'`); duplicate `--embed-origin` refused.
- Built client bundle (`dsh/client.js`, rc.2 `window.__ModuleLoader__` form; `react` external, no second runtime) produced by `node dsh/build-client.mjs`.
- Profile-bundle packaging (`cordis.patch.yml`, `dsh.bundle.patch` + `dsh.client` manifest, pinned peers `@deepseek-ai/dsh-typert-protocol 0.1.5-rc.2`, `@deepseek-ai/cordis 4.0.2`, `@deepseek-ai/schemastery 3.18.2`); install via `dsh plugin --profile <name> add <tarball>`.
- 57 v1.4 tests (`tests/v1.4/`): embed-origin matrix, CSP standalone/embed, lifecycle state machine, readiness/spawn/external/stop/unexpected-exit/concurrency/disposal, disposal-vs-Start race regressions, client-view, and compatibility anchors. Full release suite is now 211 tests (70 legacy/v1.2 + 84 v1.3 + 57 v1.4) under one `npm test`.

### Safety / hardening

- No daemon/service/scheduler/tray/protocol/launcher; no automatic Start, Preview, or Apply from any DSH/boot/mount/session/tab/reconnect/HMR path.
- `EXTERNAL` is informational refusal only: never kill, claim, scan, or embed the occupying listener.
- Browser supplies only `start(embedOrigin)`; `nodeBin`/`uiPath`/`settingsPath` stay Host-owned. Iframe `src` comes only from trusted Host output with `sandbox="allow-scripts allow-same-origin"`, `referrerPolicy="no-referrer"`.
- Production target remains `%USERPROFILE%\.dsh\settings.yaml` unless a Host-owned scratch `settingsPath` is configured.

### Compatibility

```text
Top-level CLI:
@deepseek-ai/dsh 0.1.5-rc.1

Plugin-facing tested runtime:
exact resolved DSH package graph recorded by the gate,
with relevant internal packages at 0.1.5-rc.2.
```

### Verification

- Independent HOLD→PASS audit: disposal race reproduced, repaired test-first, all three race regressions plus the full 57-test v1.4 suite independently pass.
- Immutable: contract v1.4 SHA-256 `3a4461d099e8994c773c98cfe3d001b9fb872fc182c64d31eddf8e46d4f27831`; lifecycle `36f65604cd95322ba643d6ba7baa225d459270113ef75298ad9839e8d79a0c47`; `sync.mjs` `9211544a…` and `ui/index.html` `6610e735…` byte-identical to v1.3; lineage `50968d968ede3c0c847c6d127e1ff8059f790185`.
- Normal `web`-profile acceptance: `Models` appears, initial `OFFLINE`, explicit Start → `ONLINE`, Stop → `OFFLINE`.

## v1.3.0

Local Web UX release. The CLI remains fully supported; both surfaces drive the same synchronization engine.

### Added

- Local Web UX (`ui.mjs` + `ui/index.html`): explicit Preview → retained-plan → Apply workflow in the browser.
- Shared plan/commit engine boundary: `buildPlan` plans without writing; `commitPlan` writes with byte-level staleness protection.
- Stale-preview protection based on exact settings bytes: an Apply after any settings change is refused with `STALE_PREVIEW`.
- Loopback-only server (`127.0.0.1`, default port `18751`) with per-process browser authorization token and Host/Origin protections.
- Comprehensive 154-test local release suite: 70 legacy/v1.2 regression tests plus 84 v1.3 engine/server/UI contract tests, run by one explicit `npm test` command.

### Safety / hardening

- Page load never synchronizes; no polling, no automatic sync, no automatic retry.
- One explicit Apply confirmation per write; timestamped backup before every successful update.
- No frontend/runtime dependency additions; no dev dependencies.
- No telemetry, no remote assets, no authenticated model probes.

## v1.2.0

Previous release line.

### Added

- Model-local dispositions:
  - `RESOLVED`
  - `PRESERVED_UNRESOLVED`
  - `SKIPPED_UNRESOLVED`
- Conservative handling of live models with incomplete placement authority.
- Opaque preservation of a uniquely existing `CATALOG_MISSING` model record.
- Explicit handling of unsupported Google-style models.
- `FREE_COUNTERPART_FALLBACK` for eligible exact terminal `-free` model IDs.
- Deterministic reporting of every preserved, skipped, and fallback-resolved model.
- `UPDATED` / `NO CHANGE` reporting that can coexist with unresolved warnings and fallback provenance.

### Safety / hardening

- Desired managed arrays are rebuilt from authoritative roster membership rather than incrementally patched.
- Existing YAML is used only for narrowly permitted local-state preservation.
- Ambiguous unresolved placement and conflicting `compat` fail closed.
- Production writes use backup → temp file → parse/verify → replace semantics.
- Default settings resolution uses `%USERPROFILE%`; ambient `HOME` and `OCMS_SETTINGS` do not redirect production execution.
- `--settings=<path>` remains available for deliberate scratch/test/audit use.
- No authenticated model probes or inference requests are required for synchronization.

### Fixed

- Fail closed when either required Go or Zen catalog model map is empty, instead of softening a broken whole-source catalog into per-model `CATALOG_MISSING` dispositions.

### Verification

v1.2 underwent unit/regression testing, adversarial synthetic validation, live-public-source synthetic validation, controlled production synchronization, backup verification, and idempotence verification. The current Windows regression suite contains 70 tests; the count is informational, not a compatibility promise.

## v1.1

### Changed / hardened

- Corrected the DSH managed-provider container to `llm-pi-ai.providers`.
- Hardened desired-route-first `compat` preservation/migration.
- Removed ambient environment-variable write-target redirection.
- Hardened default production-path resolution.

## v1.0

- Initial OCMS-S implementation.
- Manual OpenCode Go / Zen roster, metadata, and placement synchronization.
- Six managed DSH model arrays.
- YAML validation, backup, and replacement transaction.
