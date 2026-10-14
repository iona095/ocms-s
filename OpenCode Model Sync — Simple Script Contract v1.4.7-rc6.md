# OpenCode Model Sync — Simple Script Contract v1.4.7-rc6

Additive contract over v1.4.7-rc5 including Amendment A. Where v1.4.7-rc6 does not explicitly supersede planning, v1.4.7-rc5 remains binding. All earlier contracts and SPEC files are unchanged and immutable; nothing here edits them.

Status: FROZEN. Freeze SHA-256 and line count recorded.
Gate: OCMS-S v1.4.7-rc6.
Repo: C:\Users\GNV\.dsh\tools\ocms-s, branch main.
Baseline: HEAD bf2ded1 (v1.4.7-rc5, pushed, untagged; CI run 38573763113 is red only on profile suites (real DSH)). No commit, tag or push in this gate.
Release candidate only.

## 1. Problem (observed 2026-10-14)

A coordinated alpha.2 release published seven dependency packages on 2026-10-14 (publication times from npm view <pkg> time, all UTC, as recorded; alpha.1 versions were published 2026-10-03): @deepseek-ai/cordis 4.0.5-alpha.2 at 11:44:16Z, @deepseek-ai/cordis-plugin-group 1.0.5-alpha.2 at 11:42:38Z, @deepseek-ai/cordis-plugin-include 1.0.10-alpha.2 at 11:42:50Z, @deepseek-ai/cordis-plugin-loader 1.0.6-alpha.2 at 11:43:37Z, @deepseek-ai/cordis-plugin-timer 1.1.7-alpha.2 at 11:42:41Z, @deepseek-ai/cosmokit 1.8.6-alpha.2 at 11:43:30Z and @deepseek-ai/schemastery 3.18.5-alpha.2 at 11:46:35Z. @deepseek-ai/dsh 0.2.1-alpha.2 declares cordis ~4.0.5-alpha.1, cordis-plugin-loader ~1.0.6-alpha.1, cordis-plugin-include ~1.0.10-alpha.1, cordis-plugin-timer ~1.1.7-alpha.1, schemastery ~3.18.5-alpha.1 and node-addon-require-builtin ^0.1.9 directly; cordis-plugin-group 1.0.5-alpha.1 is transitive (cordis does not declare it); cosmokit 1.8.6-alpha.1 is transitive from schemastery. Neither is declared directly. Because those tilde ranges select alpha.2, the CI step npm install -g --prefix $prefix @deepseek-ai/dsh@0.2.1-alpha.2 (.github/workflows/ci.yml ~83) now pulls the alpha.2 tree. The version-skew check (EXPECTED_VERSIONS in profile/target-resolver.mjs:26, also read by profile/commit.mjs and profile/config-reader.mjs) correctly refuses with INCOMPATIBLE_DSH. Every new DSH install gets alpha.2, so profile mode refuses for new users too. The maintainer's local DSH still has alpha.1. Pinning only include, or only any subset, would run one of the never-verified mixed trees (include alpha.1 alongside group, cordis, loader, timer, cosmokit and schemastery alpha.2, or vice versa), so the pin covers the full coordinated alpha.2 set as one tree. OCMS-S and the profile suites call neither @deepseek-ai/cordis-plugin-group nor @deepseek-ai/cordis-plugin-timer anywhere; both are indirect dependencies of DSH. They still ship in the resolved tree and, for timer only, new files change behaviour (see R2), so both are version-pinned too.

## 2. R1, reproducible CI (full verified set)

The pinned CI entry holds the full verified set. Overrides in a job-local package.json in the prefix do NOT apply to a global install (npm ignores overrides when installing into a global prefix); they are therefore not the mechanism. The concrete mechanism that keeps the global layout (on Windows, CI runs windows-latest and npm install -g --prefix places dsh.cmd directly in $prefix, with no bin/ or lib/ beneath it) is the --before flag:

  npm install -g --prefix $prefix \
    --before=2026-10-14T11:40:00Z @deepseek-ai/dsh@0.2.1-alpha.2

It selects the 11:40 UTC alpha.1 publications only, while keeping DSH itself at 0.2.1-alpha.2. The shim lands in $prefix, which is where admitDependencyPackages resolves it from; an equivalent exact-pin manifest under npm install --prefix would land in node_modules/.bin and is not resolved by admitDependencyPackages.

admitDependencyPackages reads package.json from exactly two resolver scope paths. On Windows those are $prefix/node_modules/@deepseek-ai and $prefix/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai. The pinned packages resolve in the nested scope ($prefix/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai). node-addon-require-builtin is in $prefix/node_modules/@deepseek-ai/dsh/node_modules. The CI assert step reads each package from whichever of the two scopes holds it and fails loudly if it is missing from both.

The CI step prints and asserts the resolved versions of these eleven packages before any profile suite runs: dsh (0.2.1-alpha.2, top scope only), dsh-app-boot (0.2.1-alpha.2), dsh-atomic-write (0.2.1-alpha.2), cordis (4.0.5-alpha.1), cordis-plugin-group (1.0.5-alpha.1), cordis-plugin-include (1.0.10-alpha.1), cordis-plugin-loader (1.0.6-alpha.1), cordis-plugin-timer (1.1.7-alpha.1), cosmokit (1.8.6-alpha.1), schemastery (3.18.5-alpha.1) and node-addon-require-builtin (0.1.9). Keep timeout-minutes. No package.json or package-lock.json change for the pin (the frozen dependency-surface tests require devDependencies to stay empty); the pin lives in the job only.

Observed run (2026-10-14, isolated temp prefix, --ignore-scripts, real resolution, no overrides): npm install -g --prefix <isolated temp> --ignore-scripts --before=2026-10-14T11:40:00Z @deepseek-ai/dsh@0.2.1-alpha.2 completed with 559 packages and produced exactly the alpha.1 set above: cordis 4.0.5-alpha.1, cordis-plugin-group 1.0.5-alpha.1, cordis-plugin-include 1.0.10-alpha.1, cordis-plugin-loader 1.0.6-alpha.1, cordis-plugin-timer 1.1.7-alpha.1, cosmokit 1.8.6-alpha.1, schemastery 3.18.5-alpha.1, node-addon-require-builtin 0.1.9, plus dsh and dsh-app-boot and dsh-atomic-write 0.2.1-alpha.2. No package code was executed. Note the provenance of node-addon-require-builtin: @deepseek-ai/dsh declares it directly as "^0.1.9", while @deepseek-ai/cordis-plugin-loader at alpha.1 peer-declares it as "^0.1.6". The global install therefore resolves 0.1.9; 0.1.6 is the loader peer range, not the dsh dependency, so the earlier sentence that guessed 0.1.6 for dsh was wrong.

## 3. R2, decide on alpha.2 with evidence, not by bumping a number

Fetch all seven coordinated tarballs read-only (npm pack each at alpha.1 and alpha.2) into a scratch directory outside the repo, and diff their contents. Never install them into the maintainer's DSH, never touch ~/.dsh, never execute package code outside an isolated temp prefix.

Evidence (2026-10-14, read-only, scratch outside the repo, all seven):

include (1.0.10): same 7 files, 6 non-package identical (lib/index.js, src/index.ts, types, LICENSE, README checksums as earlier), only package.json differs (peer loader ~1.0.6-alpha.1 to ~1.0.6-alpha.2, peer cordis ~4.0.5-alpha.1 to ~4.0.5-alpha.2, dep cosmokit ~1.8.6-alpha.1 to ~1.8.6-alpha.2, key order). Classification: metadata only. OCMS-S relies on entryListSchema plus YAML parsing; unchanged.

cordis (4.0.5): same 32 files, 31 non-package identical; only package.json differs (peer loader/include and dep cosmokit to alpha.2). Classification: metadata only.

cordis-plugin-loader (1.0.6): same 28 files, 27 non-package identical; only package.json differs (peer cordis to alpha.2, node-addon range ^0.1.6 to ^0.1.9, deps cosmokit and schemastery to alpha.2). Classification: manifest check only for OCMS-S (loader entry plumbing unchanged byte-for-byte); the node-addon range widen is a compatibility improvement, not a behaviour change in OCMS-S's path.

cosmokit (1.8.6): same 25 files, 24 non-package identical; only package.json differs (version only). Classification: metadata only.

cordis-plugin-group (1.0.5): same 7 files, only package.json differs (version plus peer loader and peer cordis ~ ranges to alpha.2). Classification: metadata only.

schemastery (3.18.5): same 8 files, only package.json differs (version plus dep cosmokit ~1.8.6-alpha.1 to ~1.8.6-alpha.2). Classification: metadata only.

cordis-plugin-timer (1.1.7): alpha.1 has 7 files, alpha.2 has 9 files (added locale/en.json and locale/zh.json). All original files are byte-identical between alpha.1 and alpha.2; the two added files are new locale data. package.json gains the lower "files" entry "locale", gains the export "./locale/*.json": "./locale/*.json", and changes peer cordis ~4.0.5-alpha.1 to ~4.0.5-alpha.2 and dep cosmokit ~1.8.6-alpha.1 to ~1.8.6-alpha.2. Classification: NOT metadata only. Adds localised message templates and a new export surface, and escalates cordis and cosmokit to alpha.2. OCMS-S and the profile suites do not import or consume cordis-plugin-timer in any code path (no reference to @deepseek-ai/cordis-plugin-timer found anywhere in the repo, including tests/ and profile/), so this change is outside any OCMS-S behaviour; nevertheless the alpha.2 tree must be exercised as a whole by the second matrix entry below before (a) stands.

Proposed outcome: (a) accept both alpha.1 and alpha.2 at the OCMS-S boundary, but only for the package that is actually version-checked: EXPECTED_VERSIONS in profile/target-resolver.mjs:26 admits exactly {1.0.10-alpha.1, 1.0.10-alpha.2} for cordis-plugin-include, and only those two strings; all other versions refuse with INCOMPATIBLE_DSH. The checked package set is unchanged from today (dsh, dsh-atomic-write, dsh-app-boot, cordis-plugin-include); UTILITY_PACKAGES and its members are untouched. No new refusal surface is added for cordis-plugin-group, cordis-plugin-loader, cordis-plugin-timer, cordis, cosmokit or schemastery. The only intended product behaviour change is that cordis-plugin-include 1.0.10-alpha.2 is admitted alongside alpha.1; no other version, package or refusal changes, consistent with §6 ("One product behaviour change in this gate"). Rationale: include's alpha.2 is metadata-only and byte-compatible (see the include row above); DSH's own ~ range already admits it; refusing breaks every new user; enumeration stays fail-closed. The coordinated full eleven-package alpha.2 tree is not accepted at the product boundary by anything in profile/*; it is only exercised as CI vehicle (the second matrix entry), which prints and asserts all eleven versions. The alpha.2 misbehaviour withdraws (a) via that run, per §4.

If (a), the second matrix entry is the unpinned fresh install (the alpha.2 tree new users get today: dsh, dsh-app-boot and dsh-atomic-write 0.2.1-alpha.2; cordis 4.0.5-alpha.2; cordis-plugin-group 1.0.5-alpha.2; cordis-plugin-loader 1.0.6-alpha.2; cordis-plugin-include 1.0.10-alpha.2; cordis-plugin-timer 1.1.7-alpha.2; cosmokit 1.8.6-alpha.2; schemastery 3.18.5-alpha.2; node-addon-require-builtin 0.1.9), with the same print step asserting those eleven versions. If that run shows behaviour drift, (a) is withdrawn and (b) applies.

## 4. Skew check stays fail-closed

The skew check stays fail-closed for any other version. Never a range, never a warning-only downgrade. Outcome (b), if taken, is: keep refusing alpha.2, document it in README as a known incompatibility, with the refusal message pointing users to alpha.1.

## 5. Pin sites to change by name

profile/target-resolver.mjs EXPECTED_VERSIONS:
profile/commit.mjs (resolveCommitUtils, ~100-115) reads EXPECTED_VERSIONS['cordis-plugin-include'] as a single string and compares with !==;
profile/config-reader.mjs (resolveCompositionUtils, ~401-405, and the admitted-evidence block ~478-482) reads the same EXPECTED_VERSIONS['cordis-plugin-include'] as a single string; ~478-482 records the expected version as the observed one.
tests/profile-commit/helpers.mjs:14 EXPECTED;
tests/profile-reader/helpers.mjs EXPECTED;
tests/profile-acceptance/env02-native.test.mjs:39; ci.yml.
Re-pin every byte-pinned profile/* file with a named reason (version-skew reproducibility): T18/T19 and wherever target-resolver.mjs, commit.mjs and config-reader.mjs are hashed (t19-footprint recorded map, t15-boundary T18 map, t18 CURRENT where applicable). No wildcard exemptions. Scope requirements for the include-only outcome: (a) all three consumer files use one shared exact-membership check for include with exactly the two enumerated strings, no ranges, no prefix or semver matching; (b) recorded evidence reports the actually observed version, never the expected constant; (c) the byte pins of commit.mjs and config-reader.mjs are re-pinned with the named reason, in addition to target-resolver.mjs. Timer and group are indirect DSH dependencies only; neither is hashed at any target-resolver pin site, but both versions are still asserted by the CI print step.

## 6. Version, CHANGELOG, README

Version 1.4.7-rc5 to 1.4.7-rc6: package.json version, description tag, test script (gains the rc6 suites by explicit path); package-lock mirrors; client PLUGIN_VERSION plus rebuilt client.js only if the builder output changes, else byte-identical. CHANGELOG.md gains v1.4.7-rc6 (reproducible profile CI plus alpha.2 evidence and outcome). README.md current version, authoritative spec pointer, and CI/known-incompatibility note per the outcome. SPEC files, frozen contracts, sync.mjs, ui.mjs, ui/index.html, dsh/host.mjs, dsh/lifecycle.mjs and cordis.patch.yml stay byte-identical (verified, not re-pinned). One product behaviour change in this gate: cordis-plugin-include 1.0.10-alpha.2 is admitted in addition to alpha.1; no other version, package or refusal changes.

## 7. Tests (fixtures only, never live calls)

Package.json test script lists every file by explicit path (no globs).
1. tests/v1.4.7-rc6/freeze.test.mjs: contract freeze anchor intact.
2. Skew-logic fixtures: alpha.1 accepted, alpha.2 accepted, alpha.3 refused, through all three paths (admitDependencyPackages, the commit path, the composition path), asserting the observed version in evidence (manifest-only anchors plus skew/drop helpers; no live DSH).
3. CI pin test: --before install above, assert step reads package.json from the two resolver scope paths and prints eleven versions (dsh, dsh-app-boot, dsh-atomic-write, cordis, cordis-plugin-group, cordis-plugin-include, cordis-plugin-loader, cordis-plugin-timer, cosmokit, schemastery, node-addon-require-builtin), failing on any drift; second-prefix matrix entry is the unpinned fresh install asserting the same eleven alpha.2 versions, only if outcome (a).
4. Frozen suites pass unmodified. Full npm test green; vehicle green with 0 fail. Clean-environment vehicle plus fresh clone at a path containing ocms-s. No live calls in tests. A pass counts only from the clean vehicle, the fresh clone, or CI.

## 8. Challenge

Row one: unpinned CI drifts again. Answer: job-local --before pin of the full verified set plus a print-and-assert step that fails loudly; timeout-minutes kept.
Row two: range creep. Answer: exactly two enumerated strings for cordis-plugin-include (1.0.10-alpha.1 and 1.0.10-alpha.2), nothing else; all other checked-package versions refuse. The wider set of seven remains CI-only and is never added to EXPECTED_VERSIONS.
Row three: warning-only softening. Answer: never; INCOMPATIBLE_DSH stays blocking.
Row four: transitive alpha.2 drift. Answer: the second matrix entry is the unpinned fresh alpha.2 install running the full profile suites; drift withdraws (a).
Row five: version bump hides drift. Answer: every changed pinned file re-pinned with the named reason at every pin site.
Row six: new-user block. Answer: (a) admits the DSH-default alpha.2 after evidence; (b) documents the refusal with a pointer to alpha.1.

## 9. Boundaries

Always: hermetic fixtures under os.tmpdir, explicit paths, bounded waits, LF-exact pins, fail-closed refusals.
Ask first: any profile/* byte change, any CI timeout change, any new dependency or range.
Never: commit secrets, edit vendor or real ~/.dsh, install alpha.2 into the maintainer DSH, execute tarball code outside an isolated temp prefix, weaken or delete any test outside a named amendment, touch .gate or production Apply.

## Freeze record

The SHA-256 over exact file bytes and the line count of this file, as frozen before any v1.4.7-rc6 test was written, are recorded in tests/v1.4.7-rc6/helpers.mjs and pinned by test 1. Any later edit requires a new gate.
