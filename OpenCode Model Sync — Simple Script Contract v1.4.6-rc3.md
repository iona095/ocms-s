# OpenCode Model Sync — Simple Script Contract v1.4.6-rc3

Additive contract over Contracts v1.2–v1.4.6-rc2. Where v1.4.6-rc3 does not
explicitly supersede behavior, v1.4.6-rc2 (and transitively
v1.4.6-rc1/v1.4.1/v1.4/v1.3/v1.2) remains binding. Contracts v1.0–v1.4.6-rc2
are unchanged and immutable.

Status: FROZEN. Freeze SHA-256 and line count recorded in §15.
Gate: OCMS-S v1.4.6-rc3 — HERMETIC npm test (DESIGN → CONTRACT →
TEST-FIRST → IMPLEMENTATION).
Baseline: tag v1.4.6-rc2, commit 886fc2470e4cde811006270c18e525a0f463c75e.
No release/tag authorized in this gate. Release candidate only.

## 1. Problem

Every GitHub CI run since 85027c3 fails or hangs; CI on 85027c3 already
failed. Reproduced locally with an empty USERPROFILE/HOME and dsh removed
from PATH. Three causes, all in test setup — product behaviour is correct
and deliberate wherever it refuses:

1. sync.mjs resolveLegacyBinding refuses SETTINGS_UNREADABLE when the DSH
   home (DSH_HOME or ~/.dsh) does not exist. The v1.3 suites start servers
   without a dshHome, so on a runner with no ~/.dsh: preview-contract
   fails 15, apply-contract fails E2–E7, http-security fails 3, ui-contract
   fails 2. concurrency.test.mjs then waits forever for a request that
   never arrives (the CI hang): its fetch barrier resolves only inside
   acquisition, which the refused server never reaches. With an empty
   ~/.dsh created, all of these pass. Fail-closed on an unresolvable home
   is deliberate product behaviour and MUST NOT change.
2. tests/dev-tools.test.mjs DX-2 and DX-4 (5 tests, named in §11) assume a
   real dsh executable on PATH via the inherited process environment.
3. tests/v1.4.6-rc2 tests 2 and 5 resolve the real DSH install anchor
   through PATH and fail INCOMPATIBLE_DSH (HTTP 409) with no dsh
   installed, instead of exercising the blocked-reasons path.

The CI test job additionally has no timeout-minutes, so cause 1 hangs the
runner instead of failing it.

## 2. Reference: what stays true

Fail-closed home resolution, anchor admission, version pinning, Preview/
Apply semantics, and every planner/classifier rule are frozen and
unchanged. The defect is that test setup borrows the developer machine:
the real ~/.dsh, the real PATH dsh, and unbounded barrier waits. This gate
moves every such borrow inside the test sandbox. No product file changes.

## 3. H1 — Hermetic home

npm test passes on a machine with no ~/.dsh, no DSH_HOME, and no dsh on
PATH. Every test that needs a DSH home creates its own temp home and
passes it explicitly (the dshHome server/dispatch option or a test-scoped
DSH_HOME sandbox); none may read or write the real ~/.dsh. Concretely:

- tests/v1.3/helpers.mjs startTestServer gains an optional dshHome seam
  and, when the caller passes none, creates a per-test temp home and
  passes it to ui.startServer, so every existing caller becomes hermetic
  with no call-site edits. Scratch settings files live outside the temp
  home and keep classifying SCRATCH.
- Direct ui.startServer callers that bind a settingsPath pass an explicit
  temp dshHome at the call site (named in §10).
- The clean-environment run (§11 test 2) asserts after npm test that no
  .dsh was created inside the scrubbed home, proving no writes; reads of
  the real home are impossible because it does not exist there.

## 4. H2 — Real-dsh dependence becomes stubs

Tests needing a real dsh executable use an explicit stub, following the
existing fake-bin pattern (makeFakeBin/dwFakeBin); a declared capability
skip with reason "capability missing: dsh executable", following the
existing Typert-registry skip pattern, is allowed ONLY where a stub would
test nothing real. Prefer a stub in every case. Exactly the 5 tests named
in §11 test 3 are in scope, each with its prescribed stub; no skips are
pre-authorized. If Step-2 RED evidence shows a named test cannot be made
hermetic with a stub without emptying its assertion, stop and report; do
not convert it to a skip.

## 5. H3 — Stubbed install anchor for rc2 tests 2 and 5

tests/v1.4.6-rc2 tests 2 and 5 pass an explicit stubbed install anchor;
their assertions stay unchanged. The stub is test-side scaffolding, not
product semantics, bounded as follows:

- Built at test time by a tests/v1.4.6-rc2/helpers.mjs builder from
  EXPECTED_VERSIONS (dsh 0.2.1-alpha.2, dsh-atomic-write 0.2.1-alpha.2,
  dsh-app-boot 0.2.1-alpha.2, cordis-plugin-include 1.0.10-alpha.1):
  scope manifests at those exact versions, package entries resolvable by
  the product resolvePackageEntry rules (exports or main), importable
  modules exposing exactly the symbols the product checks
  (loadProfileDirectory, readProfilePatches, composeEntries,
  entryListSchema, js-yaml load), and an owning dsh anchor beside the
  scope per the S1 explicit convention.
- Implements ONLY the flat fixture shapes the two tests use (one llm-pi-ai
  candidate row plus one insert bundle, no groups); anything outside those
  shapes refuses. It must never grow into a general DSH reimplementation.
- Wired explicitly: ui.startServer installAnchorDir for the HTTP test,
  dispatchSyncCli installAnchorDir dep for the CLI test, and the direct
  buildProfilePreview comparison call.

## 6. H4 — Bounded waits, never hangs

concurrency G1/G2 await their fetch barriers with an explicit timeout
(10–15s) that fails with a message naming the unmet barrier instead of
hanging; the same bound applies to any barrier or held-request wait in the
suites. Assertion content is unchanged: timeouts only convert a hang into
a clear failure.

## 7. H5 — CI proves the clean machine

.github/workflows/ci.yml test job gains timeout-minutes: 15, and a step
before npm test that proves the clean-machine condition: fail the job if
~/.dsh exists or a dsh executable is found on PATH on the runner. The
acceptance-smoke job is unchanged.

## 8. H6 — No product change; version and pins

No product file changes (sync.mjs, ui.mjs, ui/index.html, profile/*).
All existing pins stay green: with product bytes untouched, the RC2
sync.mjs and ui/index.html pins still match. Version 1.4.6-rc3:
package.json version, description contract tag, and test script (gains the
rc3 freeze suite); package-lock.json root versions mirroring package.json;
dsh/client.mjs PLUGIN_VERSION and the rebuilt dsh/client.js (built via
dsh/build-client.mjs only, never hand-edited). Existing gate tests that
pin the release version to 1.4.6-rc2 are updated to 1.4.6-rc3 (metadata
only; authorized here). The PLUGIN_VERSION drift guard needs no edit and
MUST stay green.

## 9. Frozen prior rules (unchanged)

v1.4.1 §5 S0–S2, U1–U4, F1–F4 and §§6–11; v1.4.6-rc1 R1–R3 with I-EMIT,
I-DISJOINT, I-ALIAS-INERT; v1.4.6-rc2 R1–R5 including verbatim/in-order
reasons, legacy-shaped blockedReasons, and the no-leak rule; Preview/Apply
semantics; roster/catalog/docs URLs; no live probes or inference.

## 10. §Files

Every file touched in this gate:

- OpenCode Model Sync — Simple Script Contract v1.4.6-rc3.md (this file;
  frozen before any rc3 test was written).
- tests/support/clean-env-run.mjs (new): the Step-2 reproduction vehicle;
  runs npm test under a fresh temp USERPROFILE/HOME, no DSH_HOME, and a
  PATH with dsh-bearing entries removed; asserts post-run that no .dsh
  was created in the scrubbed home.
- tests/v1.3/helpers.mjs: optional dshHome seam on startTestServer with
  per-test temp-home default; bounded-wait helper for barrier promises.
- tests/v1.3/concurrency.test.mjs: bounded barrier waits (H4).
- tests/v1.3/http-security.test.mjs: explicit temp dshHome at the direct
  ui.startServer call site.
- tests/v1.4/embed-origin.test.mjs: explicit temp dshHome at the direct
  ui.startServer call site.
- tests/dev-tools.test.mjs: explicit temp-home/fake-bin stubs for the 5
  tests named in §11 test 3.
- tests/v1.4.6-rc2/helpers.mjs: stub-anchor builder (H3).
- tests/v1.4.6-rc2/blocked-reasons.test.mjs: explicit stub-anchor wiring
  for tests 2 and 5 (assertions unchanged).
- tests/v1.4.6-rc3/helpers.mjs: freeze anchor.
- tests/v1.4.6-rc3/freeze.test.mjs: the frozen test 1.
- .github/workflows/ci.yml: test-job timeout-minutes 15 plus the
  clean-machine proof step (H5).
- package.json: version 1.4.6-rc3, description contract tag, test script
  gains the rc3 freeze suite.
- package-lock.json: root versions mirroring package.json.
- dsh/client.mjs: PLUGIN_VERSION 1.4.6-rc3.
- dsh/client.js: rebuilt via dsh/build-client.mjs only.
- tests/v1.4/compat.test.mjs: version pins rc2→rc3 (metadata only).
- CHANGELOG.md: new v1.4.6-rc3 entry.
- README.md: test-suite counts, rc3 contract/status entries (touched only
  because these sections describe this output).

Forbidden: sync.mjs, ui.mjs, ui/index.html, profile/*, SPEC*.md, frozen
contracts v1.0–v1.4.6-rc2, DSH lifecycle/host, bundle architecture,
Preview/Apply semantics, settings targets, route transport,
roster/catalog/docs URLs, live probes, .gate/, real profiles/production
Apply, weakening/deleting/skipping any assertion beyond §11.

## 11. §Tests

tests/v1.4.6-rc3/ (node --test) plus the RED→GREEN vehicle. Identities
frozen:

1. contract freeze anchor intact (SHA-256 + line count per §15).
2. clean-environment reproduction: tests/support/clean-env-run.mjs exits
   nonzero pre-fix with the CI signature (v1.3 SETTINGS_UNREADABLE 400s,
   INCOMPATIBLE_DSH in rc2 tests 2/5, the 5 DX failures, bounded-barrier
   failure rather than a hang) and zero post-fix with no .dsh created in
   the scrubbed home.
3. hermetic DX stubs (assertions unchanged, explicit temp home and/or
   fake dsh bin): "nonexistent profile fails before plugin add",
   "target printed before first action",
   "shutdown during web waits owned settlement",
   "repeated shutdown is idempotent", "import has zero CLI side effects".
4. rc2 tests 2 and 5 with the H3 stub anchor (assertions unchanged).
5. concurrency G1/G2 bounded: barrier timeout fails fast naming the
   barrier; READY/UPDATED assertions unchanged.
6. endpointBaseDrift HTTP proof, UI BLOCKED/ERROR rendering, and web
   no-leak guard stay green unchanged (rc2 tests 6, 4, 3).
7. full npm test green on Node 22 and Node 24 with only the authorized
   superseded-pin skips plus the pre-existing Typert-registry capability
   skip; all RC2 pins green.

All prior suites remain unmodified except the files named in §10. Never
weaken, delete, or skip an assertion beyond what H2/§11 authorize (none
pre-authorized).

## 12. Implementation scope (smallest coherent change)

Test scaffolding only: the clean-env vehicle, the helper default home,
call-site dshHome options, DX stubs, the anchor builder and its two
wirings, bounded waits, CI timeout plus proof step, metadata/docs as named
in §10. No planner, server, page, or profile logic touched.

## 13. Known limitations (explicit future work)

- The stub anchor covers flat fixture shapes only; S5 profile suites keep
  using the real DSH install and run separately from npm test, unchanged.
- Retire or re-anchor the S5 snapshot footprint tests
  (tests/profile-reader/t19-footprint.test.mjs,
  tests/profile-acceptance/env04-staging.test.mjs), carried from rc2.

## 14. Contract challenge

| # | Attack | Answer | Result |
|---|--------|--------|--------|
| 1 | Helper default masks a real regression | Default only supplies a home; approval semantics unchanged; prior suites green | PASS |
| 2 | Stub dsh hides a missing-DSH bug | Product fail-closed paths untouched; stubs assert the same messages | PASS |
| 3 | Fake anchor proves nothing | Anchor asserts exact versions/symbols; planning assertions unchanged | PASS |
| 4 | Timeout weakens the race proof | Timeout only bounds the wait; READY/UPDATED assertions unchanged | PASS |
| 5 | CI proof step is vacuous | It fails on ~/.dsh or PATH dsh; clean-run asserts no .dsh created | PASS |
| 6 | Version bump hides drift | No product bytes change; RC2 pins stay green | PASS |
| 7 | Real home read in passing | Home absent on the vehicle; post-run absence asserted | PASS |
| 8 | Hang returns elsewhere | H4 bounds every barrier/held wait; CI timeout 15 backstops | PASS |

## 15. Freeze record

The SHA-256 (over exact file bytes) and line count of this file, as frozen
before any v1.4.6-rc3 test was written, are recorded in
tests/v1.4.6-rc3/helpers.mjs and pinned by test 1. Any later edit requires
a new gate.
