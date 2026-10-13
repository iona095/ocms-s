# OpenCode Model Sync — Simple Script Contract v1.4.7-rc1

Additive contract over Contracts v1.2–v1.4.6. Where v1.4.7-rc1 does not
explicitly supersede behavior, v1.4.6 (and transitively earlier contracts)
remains binding. Contracts v1.0–v1.4.6 are unchanged and immutable.

Status: FROZEN. Freeze SHA-256 and line count recorded.
Gate: OCMS-S v1.4.7-rc1.
Baseline: tag v1.4.6, commit bb8c240fc3380000b65d8a90ae635b70a0ef7867.
No release/tag authorized in this gate. Release candidate only.

## 1. Problem

Evidence (2026-10-13, read-only, no writes): the live Go docs list every
endpoint under https://opencode.ai/inference/go/v1/ (20 chat/completions, 6
messages, 6 responses), but DOC_ENDPOINT_BASES.go only has the zen/go base.
Both model-list endpoints return 200 with the identical 39 IDs (old base
served as an alias, as with Zen). planDesired then marks 20 Go models
SKIPPED_UNSUPPORTED_PROTOCOL and desired per route collapses.
Separately, rendering an emptied managed list yields invalid YAML with the
following key on the same line; the reparse check refused with
VERIFY_FAILED PATCH_PARSE_ERROR, the only reason Apply was not offered.

## 2. Reference: what stays true

Fail-closed home/anchor admission, version pinning, Preview/Apply semantics,
compat metadata, and every planner rule not named in G2 stay frozen. Written
baseURLs stay zen/go (alias-inert); drift notices keep reporting alias use.
Truly unsupported protocols on a KNOWN base keep current classification.

## 3. G1 — inference/go base admitted

The inference/go documented base is added to DOC_ENDPOINT_BASES.go
(canonical zen/go base first). Go and Zen lists stay disjoint. Written
baseURLs stay unchanged, with drift notices as for Zen.

## 4. G2 — unknown documented base blocks (fail closed)

A documented endpoint whose base is not in its gateway list BLOCKS planning
with a reason naming gateway, model, and URL. It never yields
SKIPPED_UNSUPPORTED_PROTOCOL, never falls back to a catalog hint, and never
drops or moves a model. This supersedes, for the unknown-base case only: v1.4.1
step 3 on unsupported skipping, the catalog-hint fallback after unsupported
docs, and rc1 R2 with section 8 tests 7 and 8, whose unknown-base expectations
move to the new unknown-base reason. Unknown tails on a known base stay
unsupported with current skip and fallback behavior.

## 5. G3 — empty managed lists render valid YAML

A managed list that becomes empty renders as valid YAML keeping every
following key on its own line, and the candidate reparses to exactly the
desired structure. Regression tests cover an empty list followed by another
managed provider, and an empty list as the last managed provider.

## 6. G4 — captured fixtures, today reproduced

Tests use captured fixtures of current Go and Zen docs pages (stored under
tests/v1.4.7-rc1/fixtures/, captured read-only, no live fetch in tests). One
test reproduces the current situation and proves (a) with G1 all 32 documented
Go rows place normally, and (b) without the new base the same plan blocks
under G2 with the unknown-base reason, yielding no skip and moving nothing.

## 7. G5 — version 1.4.7-rc1 and pins

Version 1.4.7-rc1: package.json version, description contract tag, test script
(gains the rc1 freeze suite) and test profile script (gains the G3 render
test); package-lock root versions mirroring package.json; client PLUGIN_VERSION
and the rebuilt client.js (built via the builder script only, never
hand-edited). sync.mjs and profile/surgical-render.mjs may change, limited to
G1-G3. Re-pin the changed product files with named reasons. Existing gate
tests pinning the release version to 1.4.6 move to 1.4.7-rc1 (metadata only).
No other product change. Files lists every touched file, including CHANGELOG,
README and the contract.

Forbidden: ui.mjs, ui/index.html, SPEC files, frozen contracts v1.0 through
v1.4.6, DSH lifecycle and host, bundle architecture, Preview and Apply
semantics, settings targets, route transport, roster and catalog and docs URLs,
live probes, .gate/, real profiles and production Apply, weakening or deleting
or skipping any test beyond the named expectation updates in section 8 tests
3, 7 and 8 (fail-closed strengthening, not weakening).

## 8. Files

Every file touched in this gate:

- The v1.4.7-rc1 contract (this file; frozen before any rc1 test was written).
- sync.mjs: G1 base list; G2 unknown-base distinction and fail-closed block.
- profile/surgical-render.mjs: G3 empty-list line ending.
- tests/v1.4.6-rc1/gateway-base.test.mjs: tests 3, 7 and 8 updated.
- tests/v1.4.7-rc1/helpers.mjs: freeze anchor plus fixture loaders.
- tests/v1.4.7-rc1/freeze.test.mjs: the frozen test 1.
- tests/v1.4.7-rc1/gateway-go.test.mjs: G1 and G2 unit tests plus the G4 test.
- tests/profile-render/t11-empty-list.test.mjs: G3 regressions.
- tests/v1.4.7-rc1/fixtures/go-docs-20261013.html and zen-docs-20261013.html.
- package.json, package-lock.json, dsh/client.mjs, dsh/client.js (version).
- tests/v1.4/compat.test.mjs and tests/dev-tools.test.mjs (version pins).
- CHANGELOG.md and README.md (release notes and counts).

## 9. Tests

Identities frozen:

1. contract freeze anchor intact (SHA-256 plus line count).
2. G1: go bases exact with the new base second, disjointness holds, written
   URLs stay zen/go, drift reports the inference/go alias.
3. G2: unknown-base docs block with gateway, model and URL reasons; no skip, no
   hint fallback even with a valid managed hint, no drop or move; known-base
   tails unchanged.
4. G3: empty-middle and empty-last render valid YAML, keys on own lines,
   reparse equals desired structure.
5. G4 today: 32 Go rows place with none skipped or blocked; without the new
   base the plan blocks under G2.
6. gateway-base tests 3, 7 and 8 updated per G1 and G2; all others unchanged.
7. full npm test green with only authorized version updates plus the rc1 freeze
   suite; clean-env vehicle green with 0 fail.
8. fresh-clone and reproduced profile-job evidence unchanged in kind; smoke
   green on Node 22; read-only web check reaches CONFIRMATION_DECLINED with
   per-route desired counts reported.

Prior suites stay unmodified except the files named in section 8. Never
weaken, delete, or skip a test.

## 10. Challenge

Row one: new base collides across gateways. Answer: disjointness asserted
pairwise in tests. Row two: block breaks a working model. Answer: only
unknown-base rows block; known bases and tails unchanged. Row three: hint
fallback removal loses placements. Answer: fallback kept for known-base tails.
Row four: empty render adds stray blank lines. Answer: reparse equality plus
key-line assertions pin exact bytes. Row five: fixtures go stale. Answer:
captured dated pages with pinned counts. Row six: version bump hides drift.
Answer: changed product files re-pinned with named reasons.

## 11. Freeze record

The SHA-256 over exact file bytes and the line count of this file, as frozen
before any v1.4.7-rc1 test was written, are recorded in
tests/v1.4.7-rc1/helpers.mjs and pinned by test 1. Any later edit requires
a new gate.

