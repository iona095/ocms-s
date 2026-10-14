# OpenCode Model Sync — Simple Script Contract v1.4.7-rc6 Amendment A

Frozen amendment to Contract v1.4.7-rc6 (SHA-256
0d9244d8c89e452baaa5c1d6fdad72c67fefd718414691279b8da25a2dc7c634, 97 lines),
which is unchanged and immutable. It amends exactly one test-constant site and
records one already-made test-only change. Where this amendment is silent,
v1.4.7-rc6 remains binding.

Status: FROZEN. Freeze SHA-256 and line count recorded below.
Gate: OCMS-S v1.4.7-rc6, amendment A.
Baseline: HEAD bf2ded1 plus the frozen rc6 work (outcome (a) implemented, rc6
suite green). No release/tag authorized in this gate. No commit, no tag, no
push.

## Problem

Contract v1.4.7-rc6 §3 makes the unpinned fresh install — the coordinated
2026-10-14 alpha.2 tree every new user resolves — a required CI matrix entry
(`tree: alpha2`) that asserts its eleven resolved versions and then runs
`npm run test:profile` (§8 row four: drift in that run withdraws outcome (a)).
One acceptance fixture still asserts the alpha.1 tree by name, so that entry
would be red on a test constant, not on behaviour.

## Amendment

`tests/profile-acceptance/env04-staging.test.mjs`, test "full harness imports"
(ENV04-R1 transitive), constant `dshPkgs`. The three packages that move with
the coordinated release accept their exact pair by exact string membership:

- `cordis`: {4.0.5-alpha.1, 4.0.5-alpha.2}
- `cordis-plugin-loader`: {1.0.6-alpha.1, 1.0.6-alpha.2}
- `cordis-plugin-include`: {1.0.10-alpha.1, 1.0.10-alpha.2}

Every other entry (`dsh-llm-pi-ai`, `dsh-app-boot`, `dsh-atomic-write`,
`dsh-config-editor`, all 0.2.1-alpha.2) stays an exact single version. No
range, no prefix or semver matching; a version outside a pair still fails the
assertion and names both the observed version and the admitted pair.

Reason (named): the CI `tree: alpha2` entry runs the unpinned tree, per
contract v1.4.7-rc6 §3 and §8 row four. This is a test constant change only;
it grants no product behaviour and changes no refusal.

## Retroactive record

`tests/profile-acceptance/env02-native.test.mjs`, test "staged versions
pinned", already accepted exactly {1.0.10-alpha.1, 1.0.10-alpha.2} for
`cordis-plugin-include` and {1.0.6-alpha.1, 1.0.6-alpha.2} for
`cordis-plugin-loader` under contract v1.4.7-rc6 §5(a), with the same named
reason. This amendment records that change; it is not re-made here. The
`EXPECTED_ENV02` byte pin over that file is re-pinned only if its bytes change
again. The retired rc4 P3 row 1 baseline constant (`EXPECTED_ENV02` inside the
`it.skip` block, together with `EXPECTED_HEAD` and `S5R4`) keeps its historical
value by its own recorded retirement.

## Files

This amendment covers exactly:

- OpenCode Model Sync — Simple Script Contract v1.4.7-rc6 Amendment A.md
  (this file; frozen before any amendment test was written).
- tests/v1.4.7-rc6/helpers.mjs: amendment freeze anchor (additive).
- tests/v1.4.7-rc6/amendment-a.test.mjs: the amendment freeze pin (explicit
  path in the package.json test script).
- package.json: test script gains the amendment-a path (this step).
- tests/profile-acceptance/env04-staging.test.mjs: the one constant named above.

Forbidden: editing Contract v1.4.7-rc6 or any earlier frozen contract, any
product (`profile/*`, `sync.mjs`, `ui.mjs`, `ui/index.html`, `dsh/host.mjs`,
`dsh/lifecycle.mjs`, `cordis.patch.yml`) change, weakening any other test, and
any change to the admitted-version rule itself.

## Freeze record

The SHA-256 (over exact file bytes) and line count of this file, as frozen
before any amendment test was written, are recorded in
tests/v1.4.7-rc6/helpers.mjs and pinned by
tests/v1.4.7-rc6/amendment-a.test.mjs. Any later edit requires a new
amendment.
