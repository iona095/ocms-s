# OpenCode Model Sync — Simple Script Contract v1.4.6-rc5

Additive contract over Contracts v1.2–v1.4.6-rc4 (including Amendment A).
Where v1.4.6-rc5 does not explicitly supersede behavior, v1.4.6-rc4
remains binding. Contracts v1.0–v1.4.6-rc4 and Amendment A are unchanged
and immutable.

Status: FROZEN. Freeze SHA-256 and line count recorded in §15.
Gate: OCMS-S v1.4.6-rc5 — S5 PROFILE SUITES PASS ON GITHUB'S RUNNER
(DESIGN → CONTRACT → TEST-FIRST → IMPLEMENTATION).
Baseline: tag v1.4.6-rc4, commit 515fda25df4ec46d37f63e32737342c2505f47f5.
No release/tag authorized in this gate. Release candidate only.

## 1. Problem

CI run 38363626182, job profile suites (real DSH): 449 tests / 429 pass /
13 fail / 7 skipped. The pinned DSH installed and verified fine; the other
three jobs are green. The local reproduced profile job passed only because
the 13 failures are machine-bound in ways a clean HOME/PATH cannot hide:

1. Absolute paths to the developer's DSH install,
   C:/Users/GNV/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/..., in
   env02-native.test.mjs:12, env04-loader.test.mjs:9,
   env04-staging.test.mjs:3/17/33, g1a-schema.test.mjs:8-29,
   g3-loader.test.mjs:18 — ENOENT on the runner, whose DSH lives in a
   job-local prefix.
2. tests/profile-reader/t19-footprint.test.mjs:14 hard-codes REPO =
   'C:\Users\GNV\.dsh\tools\ocms-s' — spawnSync git ENOENT and S1 file
   vanished on the runner, where that path does not exist.
3. Line endings: the Windows runner checks out with CRLF. .gitattributes
   keeps LF only for contracts and the v1.3 anchors, so byte pins of
   profile/*.mjs fail (t15-boundary T18: target-resolver.mjs e5d5c23a… vs
   1d72e816…), and the env04 working-tree-EOL assumptions break
   (binary CRLF manifest tamper excludes; env02 isolated: expected
   ad326cf3…, got 6799847e…).

## 2. Reference: what stays true

Hermetic npm test, the clean-env vehicle, the CI clean-machine guard, the
rc4 profile job shape (job-local pinned DSH, dsh --version check,
timeout-minutes 20), fail-closed home/anchor admission, version pinning,
Preview/Apply semantics, and every planner/classifier rule are frozen and
unchanged. This gate removes machine paths, derives the repo root at run
time, and checks out pinned files byte-exact on every platform. No product
file changes.

## 3. Q1 — DSH install paths derived at run time

Every DSH install path in the profile tests is derived at run time from
the dsh executable on PATH, reusing tests/profile-reader/helpers.mjs
resolveRealScope() (or one shared helper next to it, used by all five
files). No literal home, user, or install path remains in:
env02-native.test.mjs (guestAnchor default), env04-loader.test.mjs
(env04GuestAnchor default), env04-staging.test.mjs (transitive scope,
ApprovedRoots, DSH walk root), g1a-schema.test.mjs (EDITOR_ABS, LLM_ABS and
all package/d.ts reads), g3-loader.test.mjs (NATIVE_ENTRY.editorFile).
Guest STAGED overrides (ENV02_GUEST/ENV04_GUEST with STAGED) are unchanged;
only the developer-machine default becomes runtime-derived. Version pins
(0.2.1-alpha.2 etc.) are still asserted, read from package.json files at
the derived paths.

## 4. Q2 — repo root derived at run time

REPO in tests/profile-reader/t19-footprint.test.mjs (and anywhere else a
hard-coded checkout path remains — the Step-2 grep must prove there is
none) is derived from import.meta.url
(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')).
All git invocations and hash reads in that file then run against the
actual checkout, including a fresh clone at a different path.

## 5. Q3 — pinned files checked out byte-exact

Every file whose bytes a test pins is checked out byte-exact on every
platform: extend .gitattributes (text eol=lf, matching the existing v1.4.5
entries) to cover them. Pinned files and rules:

- profile/target-resolver.mjs, profile/config-reader.mjs,
  profile/surgical-render.mjs, profile/plan-builder.mjs, profile/commit.mjs,
  profile/live-attestation.mjs, profile/preview-session.mjs: text eol=lf.
- tests/profile-target/helpers.mjs,
  tests/profile-target/target-admission.test.mjs,
  tests/profile-target/boundary.test.mjs: text eol=lf (T19 accepted-S1 and
  T18 S1/S2 byte pins).
- tests/profile-acceptance/env02-native.test.mjs: text eol=lf (quarantine
  byte pin).
- Already covered and unchanged: sync.mjs and ui/index.html (-text, v1.3
  anchors), ui.mjs, dsh/client.mjs, dsh/client.js, package.json and the
  contract files (v1.4.5 eol=lf rules).
Step 3 proves it with a fresh clone: git ls-files --eol profile/*.mjs in
the clone shows LF in the working tree.

## 6. Q4 — one cause and fix per failure

| # | Failing test (CI run 38363626182) | Cause | Fix |
|---|-----------------------------------|-------|-----|
| 1 | env02-native: staged versions pinned | 1 (dev DSH path :12) | Q1 guestAnchor default |
| 2 | env04-loader: pinned waterfall contract | 1 (dev DSH path :9) | Q1 env04GuestAnchor default |
| 3 | env04-staging: full harness imports | 1 (dev DSH scope :3) | Q1 runtime scope |
| 4 | g1a: editor package at nested anchor | 1 (EDITOR_ABS :8, pkg :16) | Q1 derived editor path |
| 5 | g1a: llm-pi-ai schema surface | 1 (LLM_ABS :9, reads :21/23/24) | Q1 derived llm paths |
| 6 | g1a: file-side corpus agrees with native shape | 1 (dts read :29) | Q1 derived dts path |
| 7 | g3-loader: native entrypoint recorded read-only | 1 (editorFile :18) | Q1 derived editor path |
| 8 | t19: tracked frozen files … CURRENT pins | 2 (REPO :14) | Q2 run-time REPO |
| 9 | t19: accepted S1 files match recorded bytes | 2 (REPO :14) | Q2 run-time REPO |
| 10 | env04 quarantine: env02 isolated | 3 (CRLF bytes 6799847e…) | Q3 env02 eol=lf |
| 11 | env04 G1: binary CRLF manifest tamper excludes | 3 (all-CRLF tree breaks mixed census) + 1 (walk root :33) | Q3 rules plus owned mixed fixtures in temp (same assertions, controlled bytes); walk root runtime-derived per Q1 |
| 12 | T18 S1/S2 implementation bytes unchanged | 3 (CRLF bytes e5d5c23a…) | Q3 target-resolver eol=lf |
| 13 | CI tally shows one further failure beyond rows 1–12; cause unconfirmed from available evidence (job logs require admin; absence-of-dev-paths cannot be reproduced without mutating this workstation) | other (unconfirmed) | No fix authorized. Step 2 names every failure it reproduces; Step 3 names every failure in the fresh-clone and reproduced runs. ANY failure outside rows 1–12 stops the gate: no pin updated, no test touched. |

Cause proof: rows 10 and 12 confirmed by hashing (LF bytes match the pins,
CRLF bytes match the CI-observed values); row 11 by the census code (mixed
>0/=0 assertions over working-tree files); rows 1–9 by reading the exact
failing lines. No pin is updated to a CI-observed value: re-anchored pins
keep their LF values, which the CRLF bytes merely obscured.

## 7. Q5 — no-machine-paths regression guard

A regression guard in npm test,
tests/v1.4.6-rc5/no-machine-paths.test.mjs: it scans every file under
tests/ for absolute user-home paths (a Windows drive or POSIX root, either
slash style, with a Users/<name>, /home/<name> or /Users/<name> segment;
both single- and JS-escaped double-backslash spellings) and fails listing
file:line for each hit. Fake paths used on purpose ('C:\user-trap' in
tests/sync.test.mjs, 'C:\user-trap-v13' in
tests/v1.3/engine-contract.test.mjs) contain no Users/<name> segment, so the
patterns do not match them — proven by the guard passing and by the Step-3
negative control (a scratch file with a C:/Users/<name>/ literal fails the
guard, then is deleted). The guard builds sensitive literals from split
parts so its own source contains no matchable literal. Named exceptions:
none.

## 8. Q6 — no product change; version and pins

No product file changes (sync.mjs, ui.mjs, ui/index.html, profile/*). All
existing pins stay green with product bytes untouched. Version 1.4.6-rc5
(version assertions only, every file listed in §Files): package.json
version, description contract tag, test script (gains the rc5 freeze suite;
test:profile gains no files); package-lock.json root versions mirroring
package.json; dsh/client.mjs PLUGIN_VERSION and the rebuilt dsh/client.js
(built via dsh/build-client.mjs only, never hand-edited). Existing gate
tests that pin the release version to 1.4.6-rc4 are updated to 1.4.6-rc5
(metadata only; authorized here). The PLUGIN_VERSION drift guard needs no
edit and MUST stay green.

## 9. Q7 — rc4 tag stays; CHANGELOG honesty

The rc4 tag stays as it is (published tags are never moved). CHANGELOG
records that rc4's profile job failed on CI (13 fail), why (machine-bound
paths, hard-coded repo root, CRLF checkout), and what this gate changes.

## 10. Frozen prior rules (unchanged)

v1.4.1 §5 S0–S2, U1–U4, F1–F4 and §§6–11; v1.4.6-rc1 R1–R3 with I-EMIT,
I-DISJOINT, I-ALIAS-INERT; v1.4.6-rc2 R1–R5 including verbatim/in-order
reasons, legacy-shaped blockedReasons, and the no-leak rule; v1.4.6-rc3
H1–H6; v1.4.6-rc4 P1–P6 plus Amendment A; Preview/Apply semantics;
roster/catalog/docs URLs; no live probes or inference.

## 11. §Files

Every file touched in this gate:

- OpenCode Model Sync — Simple Script Contract v1.4.6-rc5.md (this file;
  frozen before any rc5 test was written).
- tests/v1.4.6-rc5/helpers.mjs: freeze anchor.
- tests/v1.4.6-rc5/freeze.test.mjs: the frozen test 1 (also listed in the
  package.json test script).
- tests/v1.4.6-rc5/no-machine-paths.test.mjs: Q5 guard (also listed in the
  package.json test script).
- package.json: version 1.4.6-rc5, description contract tag, test script
  gains the rc5 freeze suite.
- package-lock.json: root versions mirroring package.json.
- dsh/client.mjs: PLUGIN_VERSION 1.4.6-rc5.
- dsh/client.js: rebuilt via dsh/build-client.mjs only.
- tests/v1.4/compat.test.mjs: version pins rc4→rc5 (metadata only).
- tests/dev-tools.test.mjs: whitelist version pin rc4→rc5 (metadata only).
- .gitattributes: Q3 eol=lf rules for the §5 pinned files.
- tests/profile-acceptance/env02-native.test.mjs: Q1 scope (also a Q3
  pinned file; one file, both reasons).
- tests/profile-acceptance/env04-loader.test.mjs: Q1 scope.
- tests/profile-acceptance/env04-staging.test.mjs: Q1 scope plus the row-11
  owned-fixture census (assertions unchanged).
- tests/profile-acceptance/g1a-schema.test.mjs: Q1 paths.
- tests/profile-acceptance/g3-loader.test.mjs: Q1 path.
- tests/profile-reader/t19-footprint.test.mjs: Q2 REPO.
- CHANGELOG.md: new v1.4.6-rc5 entry (includes the Q7 rc4-CI note).
- README.md: test-suite counts, rc5 contract/status entries (touched only
  because these sections describe this output).

Forbidden: sync.mjs, ui.mjs, ui/index.html, profile/*, SPEC*.md, frozen
contracts v1.0–v1.4.6-rc4 and Amendment A, DSH lifecycle/host, bundle
architecture, Preview/Apply semantics, settings targets, route transport,
roster/catalog/docs URLs, live probes, .gate/, real profiles/production
Apply, weakening/skipping/deleting any test, updating any pinned hash to a
CI-observed value, touching C:\Users\GNV\.dsh\profiles.

## 12. §Tests

tests/v1.4.6-rc5/ (node --test) plus the profile job. Identities frozen:

1. contract freeze anchor intact (SHA-256 + line count per §15).
2. no-machine-paths guard passes on the tree, and fails on a scratch file
   carrying a C:/Users/<name>/ literal (negative control, file deleted
   afterwards).
3. test:profile exits 0 in a fresh clone at a different path (default
   core.autocrlf) and in the reproduced profile job (job-local DSH prefix
   first on PATH, clean temp HOME/USERPROFILE/APPDATA/LOCALAPPDATA).
4. fresh-clone proof: git ls-files --eol profile/*.mjs shows LF in the
   working tree.
5. full npm test green with only the authorized rc4→rc5 version-pin updates
   plus the rc5 freeze suite; clean-env vehicle green with 0 fail.
6. acceptance smoke green on Node 22.
7. all RC2/RC3/RC4 pins green; devDependencies stays empty; no product diff.
8. GitHub CI is the final proof (a later gate); Step-3 results are local
   evidence only, each labelled by where it ran.

All prior suites remain unmodified except the files named in §11. Never
weaken, skip, or delete a test. Never update a pinned hash without naming
the cause of the byte difference (see §6).

## 13. Implementation scope (smallest coherent change)

Test scaffolding, repo config, and metadata only: run-time scope derivation
in five files, run-time REPO in one file, eol=lf rules for pinned files,
owned-fixture census in the tamper test (assertions unchanged), the Q5
guard, the rc5 freeze anchor and test, version/metadata/docs as named in
§11. No planner, server, page, or profile logic touched.

## 14. Known limitations (explicit future work)

- The rc2 stub anchor still covers flat fixture shapes only.
- S5 suites still need the real pinned DSH; they never run in the hermetic
  npm-test job by design.
- GitHub CI proves the runner; this gate's Step 3 is local evidence only.

## 15. Contract challenge

| # | Attack | Answer | Result |
|---|--------|--------|--------|
| 1 | Runtime scope hides a version skew | resolveRealScope version-asserts every read; pins unchanged | PASS |
| 2 | import.meta REPO escapes the checkout | It resolves the test file's own checkout by construction | PASS |
| 3 | eol=lf rewrites history | Blobs are already LF; rules only fix checkout conversion | PASS |
| 4 | Owned fixtures weaken the tamper test | Same assertions (mixed census, byte-exact staging, tamper refusal, excludes) over controlled bytes | PASS |
| 5 | Guard false-positives on traps/docs | Traps lack a Users segment; guard splits its own literals; placeholders must use <name> | PASS |
| 6 | Version bump hides drift | No product bytes change; RC2/RC3/RC4 pins stay green | PASS |
| 7 | Unattributed 13th failure | Row 13 stops the gate; no other fix authorized | PASS |
| 8 | Profile job still hangs | timeout-minutes 20 plus bounded waits backstop it | PASS |

## 16. Freeze record

The SHA-256 (over exact file bytes) and line count of this file, as frozen
before any v1.4.6-rc5 test was written, are recorded in
tests/v1.4.6-rc5/helpers.mjs and pinned by test 1. Any later edit requires
a new gate.

