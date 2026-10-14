# Changelog

All notable project-level changes are summarized here.

This file is intentionally concise. The authoritative behavioral specification remains the current contract.

## v1.4.7-rc5

**Release candidate: withdrawn-docs removals (contract v1.4.7-rc5).**

### Changed

- When every source is OK and a roster model has no docs row on any gateway and no catalog npm hint, stored copies in more than one route no longer block the sync: each copy is listed under Removed with reason DOCS_WITHDRAWN (gateway/id/route), the Preview is READY for review, and the mass-removal warning still applies. One-route copies stay preserved, missing ones stay skipped, and not-OK sources, malformed docs identities and compat clashes still block. The web Removed rows and CLI lines render the reason; legacy and profile modes share the rule.
- Version 1.4.7-rc4 → 1.4.7-rc5 (metadata only, plus the W1 rule with re-pinned bytes).

### Unchanged (explicit)

- No other planning, render, commit, attestation, Apply-flow or client-bundle-logic change; desired bytes for all other fixtures are identical. `profile/*`, `dsh/host.mjs`, `dsh/lifecycle.mjs` and `cordis.patch.yml` are byte-identical.

## v1.4.7-rc4

**Release candidate: work-first Local Web UX layout plus remembered profile (contract v1.4.7-rc4).**

### Changed

- The Local Web UX (`ui/index.html`, only product file) moves to a work-first grid: profile target wide with Actions and Sources stacked right, single-line Settings target in profile mode, 8-across counters (4x2 below ~1100px), per-route loss warnings as separate lines, Details full width; the header compacts to one row (logo, heading, constellation) with lede below. No horizontal scroll at 1024px; Actions visible without scrolling at 1280x800.
- Remembered profile (P1, amends SPEC 8.1 by name; SPEC text unchanged): after a profile Preview reaches READY the trimmed request name is stored under `ocms-s.lastProfile`; on load an empty picker is prefilled only for names passing the exact server grammar. Invalid/absent/throwing storage stays empty and silent; prefill never previews, attests or acknowledges; the server `--profile` is never written into the picker. Storage may be partitioned in the DSH iframe, so remembering is best-effort.
- Version 1.4.7-rc3 → 1.4.7-rc4 (metadata only, plus the layout and remembering above with re-pinned bytes).

### Unchanged (explicit)

- No behaviour, safety-rule, planning, render, commit, attestation, or Apply-flow change; the three page pure functions stay byte-identical and all frozen suites pass unmodified. `ui.mjs`, `sync.mjs`, `profile/*`, `dsh/host.mjs`, `dsh/lifecycle.mjs` and `cordis.patch.yml` are byte-identical.

## v1.4.7-rc3

**Release candidate: PixelCrafts-inspired Local Web UX (contract v1.4.7-rc3, Amendment A).**

### Changed

- The Local Web UX (`ui/index.html`, only product file) adopts the PixelCrafts look: reference tokens on `:root`, 2x2 pixel logo, Model-light/Sync-heavy display heading, lime lede, static inline-SVG constellation (decoration only), flat panels with hairline dividers, and fixed accent roles (lime ready/ok, cyan info/added, violet moved/metadata, orange warnings/skipped/unsupported, pink removed/destructive/errors) that never carry meaning by colour alone. Removed count and per-route loss warning are most prominent when non-zero; enabled Apply Sync is destructive-primary (pink fill, `--base` label), disabled is inert.
- Two display fixes, no server change: sources `{ ok: true }` with no count show "OK" (lime), `{ ok: false }` shows "unavailable" (pink), via a new small pure function; the legacy Settings-target panel is labelled "not used in profile mode" in profile mode.
- Amendment A: decorative hairlines keep `--border` (exempt per WCAG 1.4.11); interactive control boundaries use `--control-border` and the focus ring uses lime, both >= 3:1; every text pair >= 4.5:1, checked from token hex values in tests.
- Version 1.4.7-rc2 → 1.4.7-rc3 (metadata only, plus the look and display fixes above with re-pinned bytes).

### Unchanged (explicit)

- No behaviour, safety-rule, planning, render, commit, attestation, or client-bundle-logic change; every element id, the DETAIL_GROUPS logic, the U2 completeness gate, the A2 pure functions, and all rc2 vm suites stay green unmodified. `ui.mjs`, `sync.mjs`, `profile/*` and `cordis.patch.yml` are byte-identical.

### Verification

- npm test 421 tests (411 pass, 0 fail, 10 authorized pin skips); clean-environment run 410 pass, 0 fail, 11 skipped; S5 profile suites 451 tests (444 pass, 0 fail, 7 skipped) against real DSH 0.2.1-alpha.2; all on Windows, Node 24.15.0. CI green on all four jobs at commit 78c14cb (run 38469173666 for the main push, run 38469459522 for tag v1.4.7-rc3).

### Known limitation

- Apply Sync stays enabled (pink) on a READY PRODUCTION Preview while the live state is UNATTESTED; this is the frozen rc2 client rule, and the server refuses that Apply with LIVE_OVERLAY_UNKNOWN. Disabling it in the page is in the backlog.

## v1.4.7-rc2

**Release candidate: profile Preview shows its plan (contract v1.4.7-rc2, Amendment A).**

### Fixed

- The profile Preview response carries the same reviewable content as legacy mode: changes, preserved/skipped/unsupported/fallback rows, drift, a five-source summary, and per-route desired plus stored current counts, all from the retained plan with no extra fetch.
- Amendment B: diffDesired reports every removed copy per route (moved only for single-copy route changes; desired/digest/decisions unchanged), per-route current counts are read from stored lists via plan.currentRouteCounts, and the r2-browser stub carries complete detail groups (assertions unchanged).
- Apply is enabled and the Review notice shown only over complete detail groups; otherwise the page reports Preview details not reported by server with Apply disabled. Per-route scale renders with a >50% loss warning naming route and counts (display only). The CLI preview text prints per-route current turning into desired lines.
- Pure page decision functions run under node:vm in tests, so the browser rules cannot go stale unnoticed.

### Changed

- Version 1.4.7-rc1 → 1.4.7-rc2 (metadata only, plus the U1–U4 product changes above with re-pinned bytes).

### Unchanged (explicit)

- No planning, render, commit, attestation, or client-bundle change; all RC1 pins stay green.

## v1.4.7-rc1

**Release candidate: Go docs move, fail-closed unknown base, empty-list render (contract v1.4.7-rc1).**

### Fixed

- The live Go docs moved to https://opencode.ai/inference/go/v1/ (20 chat/completions, 6 messages, 6 responses); that base is admitted to DOC_ENDPOINT_BASES.go with written /zen/go URLs and drift notices unchanged.
- A documented endpoint on an unlisted base now blocks planning with an ENDPOINT_BASE_UNKNOWN reason naming gateway, model and URL: never skipped, never placed via catalog hints, never dropped or moved. Unknown tails on known bases keep their classification.
- An emptied managed list renders valid YAML with following keys on their own lines and reparse-equal candidates.

### Changed

- Version 1.4.6 → 1.4.7-rc1 (metadata only, plus the G1–G3 product changes above with re-pinned bytes).

## v1.4.6

**Release: promotes v1.4.6-rc5 unchanged in behaviour (contract v1.4.6).**

### For users

- Documented /inference/v1 bases with drift notices: exact docs authority applies to Zen endpoints again, and a non-blocking ENDPOINT_BASE_DRIFT report flags alias-base routing.
- Blocked-Preview reasons shown verbatim in order: web refusals carry legacy-shaped blockedReasons with the BLOCKED notice for VERIFY_FAILED, and the CLI blocked-profile report lists each reason as its own entry (exit code 1 unchanged).

### Verification

- Hermetic tests: explicit temp DSH homes, stubbed dsh binaries and install anchors, bounded waits instead of hangs.
- CI timeouts and a clean-machine guard on the npm-test job; S5 profile suites in CI against pinned real DSH 0.2.1-alpha.2 installed into a job-local prefix.
- Portable run-time DSH scope and repo-root derivation, LF-exact checkouts for byte-pinned files, and an npm-test guard that fails on any absolute machine path under tests/.

### Honest record

- Tag v1.4.6-rc4's profile CI job was red (449 tests / 429 pass / 13 fail / 7 skipped): absolute developer-DSH paths, a hard-coded developer repo root, and a CRLF checkout breaking byte pins. v1.4.6-rc5 fixed the test setup with no product change, and CI is green on tag v1.4.6-rc5 (run 38368970261: npm test 377 / 0 fail on Node 20 and 22; profile suites 449 / 0 fail; smoke pass). The rc4 tag stays as published.

### Known risks

- Inference/Zen endpoint evolution is unprobed live; one header test is second-boundary sensitive; dev-tools assumes the checkout folder name contains ocms-s; nested DSH packages float on tilde ranges. See the v1.4.7 backlog.

### Changed

- Version 1.4.6-rc5 → 1.4.6 (metadata only). Release tarball ocms-s-1.4.6.tgz.

### Unchanged (explicit)

- No product behaviour change: sync.mjs, ui.mjs, ui/index.html and profile/* are byte-identical to v1.4.6-rc5; all RC2/RC3/RC4/RC5 pins stay green.

## v1.4.7 backlog

- routeBaseURL unknown-gateway guard.
- longest-prefix base match.
- one shared URL-validation helper for endpointApi and endpointBaseDrift.
- copy the drift array into outcomes.
- endpointBaseDrift null-arg tolerance.
- formatReport comparator style.
- one shared non-empty string reasons helper for sync.mjs and ui.mjs (rc2).
- S2 visibility or per-ID protocol pins.
- profile CI job also checks nested DSH package versions (tilde-range drift).
- rename RC4_ALLOWED in t19-footprint.
- embed-origin Date-header second-boundary flake.
- dev-tools assumption that the repo folder name contains ocms-s.
- disable Apply in the page on a PRODUCTION profile until the live state is attested and acknowledged (needs a named amendment).
- render the per-route loss warnings as one item per route instead of one paragraph.
- a blocking guard for mass removal, beyond the rc2 warning.
- same-route duplicate copies still hide one removal each in diffDesired.
- tests must clean up spawned ui.mjs children (an orphan on port 18751 broke http-security I1/I7).
- port-collision flakes in ui-contract and preview-contract.
- optionally vendor Plus Jakarta Sans (OFL) as a local file (needs an amendment).
- promote to v1.4.7.
- optionally switch the Zen model list to /inference/v1/models.
- authenticated check that /zen/v1 still serves chat (close it if the maintainer confirms daily Zen use works).
- recorded closed with evidence: the model-list endpoints (/inference/v1/models, /zen/v1/models, /zen/go/v1/models) answered 200 without a key or session header on 2026-10-13, and /zen/v1/models and /inference/v1/models served identical model lists (84 IDs).

## v1.4.6-rc5

**Release candidate: S5 profile suites pass on GitHub's runner (contract v1.4.6-rc5).**

### Q7 note: rc4 on CI

- Tag v1.4.6-rc4's `profile suites (real DSH)` job failed on CI (449 tests / 429 pass / 13 fail / 7 skipped) while all local runs were green. Causes, all in test setup: absolute developer-DSH paths read as ENOENT on the runner, a hard-coded developer repo root, and a CRLF checkout breaking byte pins and working-tree-EOL assumptions. No product bug; the rc4 tag stays as published and is not moved.

### Fixed

- Every DSH install path in the profile tests is derived at run time from the dsh executable on PATH (same scope the composition readers admit); guest STAGED overrides unchanged. The t19 repo root is derived from import.meta.url. Pinned files check out LF-exact on every platform via .gitattributes eol=lf rules. The staging tamper census runs over owned mixed-LF/CRLF fixtures in temp with byte-exact assertions unchanged. A new npm-test guard fails on any absolute machine path under tests/.

### Changed

- Version 1.4.6-rc4 → 1.4.6-rc5 (metadata only).

### Unchanged (explicit)

- No product behaviour change: sync.mjs, ui.mjs, ui/index.html and profile/* are byte-identical to v1.4.6-rc4; all RC2/RC3/RC4 pins stay green. No pinned hash was updated to a CI-observed value.

## v1.4.6-rc4

**Release candidate: S5 profile suites in CI (contract v1.4.6-rc4).**

### Fixed

- The S5 profile suites (`tests/profile-*/`, 63 files including the new stub/real parity test) run in CI: a new `profile suites (real DSH)` job on windows-latest Node 22 installs `@deepseek-ai/dsh@0.2.1-alpha.2` into a job-local prefix (never package.json; devDependencies stays empty), verifies `dsh --version`, then runs the new `npm run test:profile` script that lists every profile file by explicit path with no globs. The 5 stale S5-gate snapshot checks are retired or re-anchored per contract §10 P3 (historical HEAD pin, S1–S5 untracked allowlist and S3 footprint retired; product-byte pins re-anchored to the current reviewed bytes, values unchanged). A new parity test proves the rc2 test-only stub anchor and the real DSH composition give the same reader status and managed config for the rc2 fixtures. The hermetic `npm test` job keeps its clean-machine guard unchanged.

### Changed

- Version 1.4.6-rc3 → 1.4.6-rc4 (metadata only).

### Unchanged (explicit)

- No product behaviour change: sync.mjs, ui.mjs, ui/index.html and profile/* are byte-identical to v1.4.6-rc3; all RC2/RC3 pins stay green. Fail-closed home/anchor admission is deliberate and untouched.

## v1.4.6-rc3

**Release candidate: hermetic npm test (contract v1.4.6-rc3).**

### Fixed

- `npm test` now passes on a clean machine with no ~/.dsh, no DSH_HOME, and no dsh on PATH. Test setup no longer borrows the developer machine: servers under test receive an explicit temp DSH home, dev-tools flows use stubbed homes and fake dsh bins, the rc2 blocked-reasons tests use a test-only stub install anchor, and concurrency barriers fail fast instead of hanging. The CI test job has a 15-minute timeout and a pre-test step proving the clean-machine condition.

### Changed

- Version 1.4.6-rc2 → 1.4.6-rc3 (metadata only).

### Unchanged (explicit)

- No product behaviour change: sync.mjs, ui.mjs, ui/index.html and profile/* are byte-identical to v1.4.6-rc2; all RC2 pins stay green. Fail-closed home/anchor admission is deliberate and untouched.

### Future gates

- A parity check that the stub anchor and the real DSH composition produce the same result for the rc2 fixtures.
- Running the S5 profile suites in CI against pinned DSH packages installed outside package.json.

## v1.4.6-rc2

**Release candidate: show why a profile Preview is blocked (contract v1.4.6-rc2).**

### Fixed

- Profile planning blockers were computed (detail.reasons, e.g. PLACEMENT_AMBIGUOUS) and carried through preview-session.mjs and runProfileSync, then dropped at presentation: the web /api/preview refusal carried only { ok, code, message } (the page showed bare ERROR) and the CLI report carried only "<code>: <message>". Blocked reasons are now visible verbatim and in order. Web refusals whose detail.reasons is a non-empty string array gain legacy-shaped blockedReasons: [{ reason }] (HTTP status and code unchanged; the page shows BLOCKED with the legacy "Synchronization blocked: r1 | r2" notice for VERIFY_FAILED plus reasons, ERROR otherwise). The CLI blocked-profile report lists each reason as its own unresolved entry after the existing line (exit code 1 unchanged). No other detail shapes are exposed (digest objects, internal strings).

### Changed

- Version 1.4.6-rc1 → 1.4.6-rc2; RC1 sync.mjs pin superseded by the RC2 pin; S5-R4 ui/index.html pin superseded by the RC2 UI pin (R2 requires index.html bytes to change; rc1 §7 "MUST stay green" explicitly superseded).
- Committed HTTP proof that the legacy Preview payload carries endpointBaseDrift (rc1 future-gate item; additive, non-blocking, no production change).

### Unchanged (explicit)

- No planning, placement, classification, membership, diff, render, commit, or attestation behaviour change. v1.4.1 classification rules, v1.4.6-rc1 gateway bases/aliases/drift, Preview/Apply semantics, roster/catalog/docs URLs, and live-probe policy are unchanged.

## v1.4.6-rc1

**Release candidate: gateway base derivation and documented base aliases (contract v1.4.6-rc1).**

### Added

- Profile-aware synchronization (S5, commit `7738079`): explicit `--profile <name>` targets for `sync.mjs` and `ui.mjs`, explicit `--live-state=` attestation for production profiles, `--scratch` as a restriction mode, and real-path scratch/production classification. A bare `node sync.mjs` now refuses (`PROFILE_REQUIRED`); `--settings=<path>` accepts scratch paths only and asks for confirmation. Also includes the R1 repair of the Go/Zen docs source URLs (`/v2/docs/console/go/`, `/v2/docs/console/models/`).

### Fixed

- Zen docs moved every endpoint to `https://opencode.ai/inference/v1/...`; `endpointApi` only knew `/zen/v1/`, so all 88 Zen docs rows were ENDPOINT_UNSUPPORTED and placement silently fell back to `provider.npm` hints (or misclassified ordinary models as unsupported). Documented bases are now a closed per-gateway list (`DOC_ENDPOINT_BASES`: Go `/zen/go/v1/`; Zen `/zen/v1/`, `/inference/v1/`) and docs authority is restored for Zen (79 managed, 7 Google-style, 2 unrecognized on the 2026-10-12 captures).

### Changed

- One canonical base per gateway (`GATEWAY_BASE`); all six managed route `baseURL`s are derived via `routeBaseURL(gateway, api)` (anthropic-messages → base, others → base/v1). Emitted values are byte-identical to v1.4.5; `/inference` is never written to settings.
- New non-blocking report section `ENDPOINT_BASE_DRIFT` (and additive `endpointBaseDrift` field on plans, outcomes and the Preview payload) shows live models whose docs use an alias base.
- Version 1.4.5 → 1.4.6-rc1; rc1 `sync.mjs` byte pin supersedes the S5-R4 pin.

### Unchanged (explicit)

- v1.4.1 classification rules (S0–S2, U1–U4, F1–F4), route keys, apiKeyEnv, roster/catalog URLs, Preview/Apply semantics, `ui/index.html`, DSH lifecycle/host.

## v1.4.5

**Package reproducibility repair (no runtime behavior change).**

### Fixed

- Packaged text files are canonicalized to LF in the Git tree, so `npm pack` is byte-identical across the primary worktree, `git archive`/export, and clean checkouts regardless of `core.autocrlf`. v1.4.4 exposed a Windows clean-checkout repacking mismatch that differed solely in line endings; v1.4.5 supersedes it for deterministic package reproduction.

### Unchanged (explicit)

- No runtime, model-sync, transport-ownership, contract, or Apply behavior change. DSH target remains exactly 0.2.1-alpha.2.

## v1.4.4

**DSH 0.2.1-alpha.2 compatibility release (release preparation; no new model-sync functionality).**

OCMS-S v1.4.4 supports DSH 0.2.1-alpha.2 exactly. No support is claimed for 0.1.5-rc.x, 0.2.1-alpha.1, future 0.2.1 alphas, or >=0.2.1-alpha.2.

### Changed

- Release version 1.4.3 → 1.4.4 (`package.json`, `package-lock.json`, `dsh/client.mjs` `PLUGIN_VERSION`, rebuilt `dsh/client.js` via `dsh/build-client.mjs` only).
- Peer graph repinned to the new runtime with exact pins (no wildcard, caret, tilde, or range): `@deepseek-ai/dsh-typert-protocol 0.2.1-alpha.2`, `@deepseek-ai/cordis 4.0.5-alpha.1`, `@deepseek-ai/schemastery 3.18.5-alpha.1`.
- Added release metadata `engines.dsh: "0.2.1-alpha.2"` (metadata only; exact `peerDependencies` remain the admission authority; no runtime fallback, no fail-open unknown-version behavior, no zero-data fallback, no alternate old-runtime branches).
- Removed the obsolete old-runtime HMR generation coordinator: current DSH awaits old Fiber disposal before replacement (`registry.delete` → fiber await → reload), so the framework owns replacement ordering and the OCMS disposer awaits the exact-exit child cleanup (`STOPPING` while retiring).
- Strict browser Typert codecs now use `create()` schema factories returning `parse(value)` schemas.
- Stale `rc.2` client/runtime comments corrected (no executable change beyond the accepted candidate plus explicit version/metadata changes).
- Release-identity tests updated only: `PLUGIN_VERSION`/package/lock version drift guards now pin 1.4.4 plus an `engines.dsh == "0.2.1-alpha.2"` compatibility-metadata assertion; all accepted codec/HMR/lifecycle tests remain authoritative.

### Unchanged (explicit)

- Lifecycle Stop/disposal safety semantics remain intact (exact-exit ownership; no second child; no post-disposal spawn).
- No sync/planner/Go/Zen transport semantics changed; no transport-ownership work; no lifecycle redesign; no client architecture change.
- `dsh/lifecycle.mjs`, `sync.mjs`, `ui.mjs`, `ui/index.html`, model planner, and Go/Zen placement logic are unchanged.
- Deferred developer ergonomics (`npm run build`, `npm run register -- --profile <explicit>`, `npm run watch -- --profile <explicit>`, possibly safe `dev:web`) remain post-release follow-up; no `npm publish`/`publish.sh`, no automatic DSH process killing, no implicit `web`-profile targeting was added.

### Verification

- Focused suites (compat, host-client-compat, client-view, hmr-generation, lifecycle, ownership, disposal-race, embed-origin, unsupported-protocol): 0 failures, no new skips.
- Fresh `npm ci` exact resolved graph; full regression 0 failures (only the two authorized historical skips unless retired with explanation); rebuilt client proof (ModuleLoader format, import-free source path, React implicit external, `create()` factories, badge 1.4.4); packed `ocms-s-1.4.4.tgz` with disposable-profile admission and final packed-byte browser smoke (Models, v1.4.4, OFFLINE → Start → ONLINE → iframe → Stop → OFFLINE, child port released; no Preview/Apply).

## v1.4.3

**The Models tab reports its own release version.** Cosmetic release: no lifecycle,
sync, settings, or Remote contract change.

### Added

- The Models tab header renders a right-aligned `v<version>` badge in every
  lifecycle state, so the loaded release is confirmable from the UI instead of
  inferred from behavior.
- `dsh/client.mjs` exports `PLUGIN_VERSION` as an exact semver literal.
  `dsh/client.mjs` must stay import-free for the bundle build, so this is a
  literal rather than an import; a new test in `tests/v1.4/client-view.test.mjs`
  pins it to the `package.json` release version, so a future release bump that
  forgets the badge turns the suite RED rather than shipping a stale number.

### Unchanged (explicit)

- No lifecycle, ownership, HMR-coordinator, sync/planner, settings, or Remote
  contract change. `dsh/host.mjs`, `dsh/lifecycle.mjs`, `sync.mjs`, `ui.mjs` and
  `ui/index.html` are byte-unchanged.
- The badge is a build-time constant, not Remote state: the Host status payload
  and its strict codec are unchanged, and the browser still supplies only
  `start(embedOrigin)`.

### Shipped from the post-v1.4.2 queue

- `tests/acceptance/smoke.mjs` and `npm run test:smoke`: an acceptance check that runs the committed plugin through a real Cordis runtime with a real `ui.mjs` child, the real `ocmsLifecycleService` Remote methods, the installed HMR ordering (`registry.delete()` not awaited, then the replacement fiber), and OS-level child-liveness/listener observation. It is portable (Windows and POSIX probes, repo-derived paths and ports, no machine-specific assumptions), uses only a scratch settings file, cleans up every child on all exit paths, and has a watchdog. It also reproduces the documented cold-start upgrade boundary against a materialized pre-coordinator generation. Intentionally excluded from `npm test`: it needs the DSH peer packages, spawns real processes, and takes seconds rather than milliseconds.
- `--strict` (or `OCMS_SMOKE_STRICT=1`): for unattended runners, a missing prerequisite fails the acceptance run instead of reporting a green skip. Local and manual runs keep the explicit-skip behaviour.
- CI job `acceptance smoke (real child, real HMR)`: Windows / Node 22, bounded by `timeout-minutes`, full git history so the boundary phase can materialize the `v1.4.1` ref, running the smoke test with `--strict`. The ordinary Node 20.x/22.x test matrix is unchanged.

## v1.4.2

**Exact child-lifetime ownership and safe HMR generation handoff.** Correctness/reliability release: no new public API, materially stronger lifecycle semantics and HMR ownership guarantees.

### Fixed

- **Ownership is released only by the exact child's own `exit` event.** Previously a kill request, a `kill()` return value, a child `error` event, a readiness deadline, or a disposal shortcut could all clear ownership and report `OFFLINE` while a possibly-live child was still running — which allowed a second child to spawn behind it, or a child to outlive its Host. Every ownership-clearing path is now gated on that one event, including `error` during `STARTING` and `ONLINE`, the readiness deadline, and all four Start/disposal-fence branches.
- **Disposal completes only on the exact child exit.** `dispose()` used to signal, clear ownership and emit `OFFLINE` without an exit and swallow a failed stop. It now waits for an in-flight transition to settle, reports `STOPPING`, and stays pending until the child actually exits; ownership is never released on a guess.
- **One termination sequence per child.** Stop, disposal and a Start that lost its Host now join a single termination authority (`SIGTERM`, then `SIGKILL` after the graceful window) instead of each signalling independently, so no duplicate signals or kill storms.
- **No false `OFFLINE` in the status surface.** A child `error` is a fault, not a termination: the state becomes `ERROR` with ownership retained, and only the exact exit reconciles to `OFFLINE`.
- **HMR generation handoff.** Cordis HMR imports the replacement generation, drops the retiring plugin and starts unloading the old fiber *without awaiting its disposer*, so two generations were live at once and the replacement published its service immediately. A process-global, per-root coordinator (`globalThis[Symbol.for('ocms-s/generation-coordinator')]`) now serializes them: `apply()` awaits a per-apply lease before constructing or publishing anything, the newest queued generation wins a free lease, superseded generations publish nothing at all, releases are identity-checked so a repeated or stale disposer cannot free a lease another apply holds, and a post-lease setup failure releases the lease instead of stranding it.

### Unchanged (explicit)

- No new managed route, no sync/planner change, no settings behavior change, no new public API, no dependency change. `sync.mjs` and `ui/index.html` are byte-identical to the reviewed v1.4.1 files.
- DSH scope stays lifecycle-only: status/Start/Stop, exact child ownership, iframe hosting. No auto-Start from any session, tab, reconnect, reload or HMR path.
- `EXTERNAL` remains an informational refusal only: never kill, claim, scan or embed the occupying listener.
- Browser still supplies only `start(embedOrigin)`; `nodeBin`/`uiPath`/`settingsPath` stay Host-owned.

### Intentional boundaries (read before upgrading)

1. **One cold DSH/profile restart is required after upgrading from a pre-coordinator generation.** A generation already running when v1.4.2 is installed does not participate in the coordinator, so a hot swap over it is not serialized (the replacement reaches publication while the predecessor is still serving, and Cordis refuses the duplicate service registration). Restart DSH once; the handoff guarantee applies to every later reload.
2. **If an owned child never emits `exit`, disposal intentionally remains pending** and, with it, activation of the replacement generation, until DSH's outer forced-exit boundary. This is the deliberate trade: a blocked plugin unload is preferred over two children serving one Host root.

### Verification

- Controlled RED before each production edit: 7 of 9 lifecycle/disposal cases failed on the intended defect, and all 6 coordinator cases fail against the pre-fix `dsh/host.mjs`.
- Full release suite: **243 tests / 241 pass / 0 fail / 2 authorized skips**, re-run from a clean checkout of the implementation commit (CRLF working-tree form).
- Real-runtime smoke test (real Cordis 4.0.2 runtime, real `ocmsLifecycleService` Remote calls, real `ui.mjs` child, installed HMR ordering `registry.delete()` not awaited + replacement fiber, child liveness read from the OS process table and `netstat`): normal Start → Stop, HMR while the child is running, replacement unpublished for the whole window in which the child was alive, first publication only after ownership release, replacement functional on a new child, and both boundaries demonstrated. 33/33 checks.
- Three independent adversarial audits (coordinator, lifecycle, evidence) returned PASS; the one false-green test and the one Cordis-internal assertion they flagged were fixed.
- Implementation commit `8167039d2120f859c79194e8273d08379a3ffa23`.

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
