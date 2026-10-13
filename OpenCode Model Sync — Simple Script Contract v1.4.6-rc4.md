# OpenCode Model Sync — Simple Script Contract v1.4.6-rc4

Additive contract over Contracts v1.2–v1.4.6-rc3. Where v1.4.6-rc4 does
not explicitly supersede behavior, v1.4.6-rc3 (and transitively
v1.4.6-rc2/v1.4.6-rc1/v1.4.1/v1.4/v1.3/v1.2) remains binding. Contracts
v1.0–v1.4.6-rc3 are unchanged and immutable.

Status: FROZEN. Freeze SHA-256 and line count recorded in §15.
Gate: OCMS-S v1.4.6-rc4 — S5 PROFILE SUITES IN CI (DESIGN → CONTRACT →
TEST-FIRST → IMPLEMENTATION).
Baseline: tag v1.4.6-rc3, commit dc78db95a95c2ef69e7b436958da314aa8f02d65.
No release/tag authorized in this gate. Release candidate only.

## 1. Problem

npm test is hermetic since rc3 (clean-env vehicle
tests/support/clean-env-run.mjs; CI clean-machine guard). The S5 suites
tests/profile-*/ (6 directories: profile-target, profile-reader,
profile-render, profile-commit, profile-cli-ui, profile-acceptance; 62
.test.mjs files, ~448 tests) are NOT in npm test and NOT in CI. They need a
real DSH install: tests/profile-reader/helpers.mjs resolveRealScope()
derives the install anchor from a dsh executable on PATH and fails loudly
without one. Today they run only on the developer machine: 448 total /
438 pass / 5 fail / 5 skipped.

The 5 failures are stale S5-gate snapshot checks, not product bugs
(expected Step-2 RED):

1. tests/profile-acceptance/env04-staging.test.mjs :: ENV04 G0 baseline ::
   HEAD S5R4 env02 S6 (expects HEAD 85027c3).
2. tests/profile-reader/t19-footprint.test.mjs :: T19 tracked frozen files
   have no work-tree modifications except authorized S5-R4 pins (expects
   S5-R4 hashes plus a clean work tree for gate-authorized files).
3. tests/profile-reader/t19-footprint.test.mjs :: T19 untracked set is
   exactly the accepted S1 files plus S2 files (S1–S5 allowlist).
4. tests/profile-render/t15-boundary.test.mjs :: T18 sync.mjs S5-R4 reviewed
   bytes pinned (planning via suites).
5. tests/profile-render/t15-boundary.test.mjs :: T19 S3 files are inside the
   authorized footprint (S3-era untracked allowlist).

rc3 §13 future gates carry forward: (a) run the S5 suites in CI against
pinned DSH packages installed outside package.json; (b) parity check that
the rc2 test-only stub anchor (tests/v1.4.6-rc2/helpers.mjs makeStubAnchor)
and the real DSH composition give the same result for the rc2 fixtures.

Required DSH versions are pinned in profile/target-resolver.mjs
EXPECTED_VERSIONS (dsh 0.2.1-alpha.2, dsh-atomic-write 0.2.1-alpha.2,
dsh-app-boot 0.2.1-alpha.2, cordis-plugin-include 1.0.10-alpha.1). All are
published on npm.

## 2. Reference: what stays true

Hermetic npm test, the clean-env vehicle, the CI clean-machine guard,
fail-closed home resolution, anchor admission, version pinning, Preview/
Apply semantics, and every planner/classifier rule are frozen and
unchanged. The defect is only that the S5 suites have no CI home: they
borrow the developer machine (its real DSH install) and their snapshots
pin history (a past HEAD and superseded hashes). This gate gives them a
pinned real-DSH home in CI and re-anchors the snapshots to what they still
guard. No product file changes.

## 3. P1 — test:profile script

package.json gains an npm script test:profile that runs every
tests/profile-*/ file with explicit paths (no globs), like test does:

- node --test <explicit list of every tests/profile-*/**/*.test.mjs>.
- No shell globs, no directory expansion, no wildcards: each file appears
  literally so a missing or added file is a visible diff.
- Adding, moving, or renaming a profile test file updates the script in the
  same change (and §10).

## 4. P2 — profile CI job (real DSH)

.github/workflows/ci.yml gains a separate job profile suites (real DSH):

- runs-on windows-latest, Node 22, timeout-minutes: 20.
- Installs @deepseek-ai/dsh at exactly the EXPECTED_VERSIONS.dsh version
  (0.2.1-alpha.2) into a job-local prefix (for example
  $RUNNER_TEMP/dsh-real via npm install -g --prefix <dir>
  @deepseek-ai/dsh@0.2.1-alpha.2); never package.json and never
  package-lock.json. The frozen dependency-surface tests (tests/sync.test.mjs,
  tests/v1.3/engine-contract.test.mjs) require devDependencies to stay empty.
- Puts that prefix bin directory on PATH for this job only (via $GITHUB_PATH),
  verifies dsh --version equals the pinned version, then runs
  npm run test:profile.
- The existing test job keeps its clean-machine guard unchanged (fails on
  ~/.dsh or PATH dsh, timeout-minutes 15, matrix Node 20/22). The
  acceptance-smoke job is unchanged.

## 5. P3 — stale snapshots retired or re-anchored

Each of the 5 checks is retired or re-anchored with a one-line reason.
Re-anchor only where a check still guards something real (frozen-file
identity against the CURRENT pins); retire where it only pins a historical
HEAD or a superseded hash. No other profile test is changed, weakened,
skipped, or deleted.

| # | Check (file :: test) | Disposition | One-line reason |
|---|----------------------|-------------|-----------------|
| 1 | tests/profile-acceptance/env04-staging.test.mjs :: ENV04 G0 baseline :: HEAD S5R4 env02 S6 | RETIRE | Pins historical HEAD 85027c3; a gate must run on its own baseline, not its ancestry. |
| 2 | tests/profile-reader/t19-footprint.test.mjs :: T19 tracked frozen files … except authorized S5-R4 pins | RE-ANCHOR | Keeps product-byte identity against the CURRENT pins (bytes unchanged per P6); drops the work-tree-dirty clause for §10-authorized gate files, which enumerates history instead of behavior. |
| 3 | tests/profile-reader/t19-footprint.test.mjs :: T19 untracked set … plus S2 files | RETIRE | Untracked allowlist enumerates S1–S5 history; superseded by the committed tree and §10. |
| 4 | tests/profile-render/t15-boundary.test.mjs :: T18 sync.mjs S5-R4 reviewed bytes pinned | RE-ANCHOR | Keeps the sync.mjs planning-surface pin against the CURRENT reviewed bytes (same value per P6); updates the stale gate comment. |
| 5 | tests/profile-render/t15-boundary.test.mjs :: T19 S3 files are inside the authorized footprint | RETIRE | S3-era footprint allowlist superseded by S5/S6 plus rc-gate files. |

If Step-2 RED evidence shows any other profile test failing, or a listed
check cannot be retired/re-anchored as above without emptying a real
assertion, stop and report; do not widen P3.

## 6. P4 — stub/real parity test

A new parity test lives with the profile suites (tests/profile-acceptance/,
runs in test:profile and the profile CI job, never in npm test):

- For each rc2 flat fixture used by tests/v1.4.6-rc2/blocked-reasons.test.mjs,
  build the stub anchor with tests/v1.4.6-rc2/helpers.mjs makeStubAnchor and
  resolve the real anchor with tests/profile-reader/helpers.mjs
  resolveRealScope (requires the job real DSH install).
- Feed both anchors to the same reader entry (readManagedConfig) over the
  same fixture profile and assert the same result: same status and same
  parsed managed config (deepEqual).
- Flat fixture shapes only, like the stub itself; it must never grow into a
  general DSH reimplementation.

## 7. P5 — hermetic apart from the real DSH install

The profile suites stay hermetic apart from the real DSH install (read-only
library code at exact pinned versions):

- Every test that needs a DSH home creates its own temp home and passes it
  explicitly (existing makeTempHome/sandboxDshHome helpers, the dshHome
  option, or a test-scoped DSH_HOME sandbox); none may read or write the
  real ~/.dsh, C:\Users\GNV\.dsh\profiles, or production profiles.
- No live calls to opencode.ai or models.opencode.ai (existing
  tests/profile-acceptance/net-guard.mjs stays green).

## 8. P6 — no product change; version and pins

No product file changes (sync.mjs, ui.mjs, ui/index.html, profile/*). All
existing pins stay green with product bytes untouched. Version 1.4.6-rc4
(version assertions only): package.json version, description contract tag,
test script (gains the rc4 freeze suite) plus the new test:profile script;
package-lock.json root versions mirroring package.json; dsh/client.mjs
PLUGIN_VERSION and the rebuilt dsh/client.js (built via dsh/build-client.mjs
only, never hand-edited). Existing gate tests that pin the release version
to 1.4.6-rc3 are updated to 1.4.6-rc4 (metadata only; authorized here). The
PLUGIN_VERSION drift guard needs no edit and MUST stay green.

## 9. Frozen prior rules (unchanged)

v1.4.1 §5 S0–S2, U1–U4, F1–F4 and §§6–11; v1.4.6-rc1 R1–R3 with I-EMIT,
I-DISJOINT, I-ALIAS-INERT; v1.4.6-rc2 R1–R5 including verbatim/in-order
reasons, legacy-shaped blockedReasons, and the no-leak rule; v1.4.6-rc3
H1–H6 including hermetic home, DX stubs, stub anchor, bounded waits, and
the clean-machine guard; Preview/Apply semantics; roster/catalog/docs URLs;
no live probes or inference.

## 10. §Files

Every file touched in this gate:

- OpenCode Model Sync — Simple Script Contract v1.4.6-rc4.md (this file;
  frozen before any rc4 test was written).
- package.json: version 1.4.6-rc4, description contract tag, test script
  gains the rc4 freeze suite, new test:profile script with explicit profile
  paths (P1).
- package-lock.json: root versions mirroring package.json.
- dsh/client.mjs: PLUGIN_VERSION 1.4.6-rc4.
- dsh/client.js: rebuilt via dsh/build-client.mjs only.
- tests/v1.4/compat.test.mjs: version pins rc3→rc4 (metadata only).
- tests/v1.4.6-rc4/helpers.mjs: freeze anchor.
- tests/v1.4.6-rc4/freeze.test.mjs: the frozen test 1.
- .github/workflows/ci.yml: new profile suites (real DSH) job (P2); test
  job unchanged.
- tests/profile-acceptance/env04-staging.test.mjs: P3 row 1 retire.
- tests/profile-reader/t19-footprint.test.mjs: P3 rows 2–3.
- tests/profile-render/t15-boundary.test.mjs: P3 rows 4–5.
- tests/profile-acceptance/stub-real-parity.test.mjs (new): P4 parity test.
- CHANGELOG.md: new v1.4.6-rc4 entry.
- README.md: test-suite counts, rc4 contract/status entries (touched only
  because these sections describe this output).

Forbidden: sync.mjs, ui.mjs, ui/index.html, profile/*, SPEC*.md, frozen
contracts v1.0–v1.4.6-rc3, DSH lifecycle/host, bundle architecture,
Preview/Apply semantics, settings targets, route transport,
roster/catalog/docs URLs, live probes, .gate/, real profiles/production
Apply, weakening/deleting/skipping any assertion beyond P3, adding
devDependencies, touching C:\Users\GNV\.dsh\profiles.

## 11. §Tests

tests/v1.4.6-rc4/ (node --test) plus the profile job. Identities frozen:

1. contract freeze anchor intact (SHA-256 + line count per §15).
2. test:profile runs every tests/profile-*/ file by explicit path with no
   globs and exits 0 on a machine with the pinned real DSH on PATH.
3. profile suites (real DSH) CI job green on windows-latest Node 22
   (job-local DSH prefix, dsh --version verified, then npm run test:profile).
4. stub/real parity: for each rc2 fixture the stub anchor and the real DSH
   anchor give the same reader status and the same parsed managed config.
5. P3 five dispositions exactly as the table; no other profile test changed,
   weakened, skipped, or deleted.
6. full npm test green with unchanged counts (only the authorized rc3→rc4
   version-pin updates plus the rc4 freeze suite); clean-env vehicle green
   with 0 fail.
7. acceptance smoke green on Node 22.
8. all RC2/RC3 pins green; devDependencies stays empty; no product diff.

All prior suites remain unmodified except the files named in §10. Never
weaken, delete, or skip an assertion beyond what P3 authorizes.

## 12. Implementation scope (smallest coherent change)

Test scaffolding and CI only: the test:profile script, the profile CI job
with its job-local pinned DSH install, the five P3 retire/re-anchor edits,
the new parity test, the rc4 freeze anchor and test, metadata/docs as named
in §10. No planner, server, page, or profile logic touched.

## 13. Known limitations (explicit future work)

- The rc2 stub anchor still covers flat fixture shapes only; the parity test
  does not extend it.
- S5 suites still need the real pinned DSH; they never run in the hermetic
  npm-test job by design.

## 14. Contract challenge

| # | Attack | Answer | Result |
|---|--------|--------|--------|
| 1 | test:profile glob hides a missing file | Explicit paths only; a missing file is a visible diff | PASS |
| 2 | CI DSH install pollutes the hermetic job | Job-local prefix plus $GITHUB_PATH for this job only; test job guard unchanged | PASS |
| 3 | Retire hides a product regression | Retired checks pin history (HEAD/hashes), not behavior; product pins stay green per P6 | PASS |
| 4 | Re-anchor moves the goalposts | Re-anchored pins keep identical bytes/values; only stale gate-history clauses go | PASS |
| 5 | Parity test proves nothing real | Same reader entry and same fixtures on both anchors; status plus parsed config compared | PASS |
| 6 | Real DSH leaks into the home | Temp DSH homes only; net-guard plus no real-profile paths | PASS |
| 7 | Version bump hides drift | No product bytes change; RC2/RC3 pins stay green | PASS |
| 8 | Profile job hangs | timeout-minutes 20 plus existing bounded waits backstop it | PASS |

## 15. Freeze record

The SHA-256 (over exact file bytes) and line count of this file, as frozen
before any v1.4.6-rc4 test was written, are recorded in
tests/v1.4.6-rc4/helpers.mjs and pinned by test 1. Any later edit requires
a new gate.
