# OpenCode Model Sync — Simple Script Contract v1.4.7-rc1 Amendment A

Frozen amendment to Contract v1.4.7-rc1 (SHA-256
ea1d3481dba5fc190f0694ef9da6b2bd2a48feb504708b53cf36755d06c4a856, 140 lines),
which is unchanged and immutable. Where this amendment is silent,
v1.4.7-rc1 remains binding.

Status: FROZEN. Freeze SHA-256 and line count recorded below.
Gate: OCMS-S v1.4.7-rc1, amendment A.
Baseline: v1.4.7-rc1 working tree after Step-4 GREEN (no commit).
No release/tag authorized in this gate. No tag, no push.

## A1 (omitted wiring): gateway-go runs in CI

tests/v1.4.7-rc1/gateway-go.test.mjs is added to the package.json test
script. Contract section 7 omitted it, so G1, G2 and G4 never run in CI;
the discovery runs that proved them green invoked the file explicitly.

## A2 (omitted files): section 8 corrections

Section 8 gains four files, each with a one-line reason:

- .gitattributes: the G4 fixture byte-exact rule, without which the
  recorded capture SHAs fail on CRLF checkouts.
- tests/profile-reader/t19-footprint.test.mjs: CURRENT sync pin re-anchored
  to the G1/G2 product bytes with a named reason.
- tests/profile-render/t15-boundary.test.mjs: T18 sync pin re-anchored to
  the same bytes with a named reason.
- tests/sync.test.mjs: cross-gateway expectation moved to the unknown-base
  reason (same fail-closed class as gateway-base test 7 named in rc1 section 8).

## A3 (named supersession): compat rc2 sync pin skips

The compat.test.mjs v1.4.6-rc2 sync pin is a skip, superseded by the new
v1.4.7-rc1 sync pin in the same file (established skip-with-reason pattern).
The rc2 ui/index.html pin is unchanged and still green.

## A4 (new pin): surgical-render bytes

A SHA-256 pin for profile/surgical-render.mjs is added beside the product
pins in compat.test.mjs with a named reason (G3 empty-list line ending):
bd2884fd33abf0e6495bd356463da932728ae11983fb67c98afb0f7d9e4eea86.
The G3 change is currently unpinned; every other changed product file
(sync.mjs) already has a pin.

## A5: no other change

No product file changes beyond the G1-G3 edits already in the tree. No
other test changed, weakened, skipped, or deleted. If anything else fails,
stop and report; do not widen this amendment.

## Files

This amendment covers exactly:

- OpenCode Model Sync — Simple Script Contract v1.4.7-rc1 Amendment A.md
  (this file; frozen before any amendment test was written).
- tests/v1.4.7-rc1/helpers.mjs: amendment freeze anchor (additive).
- tests/v1.4.7-rc1/amendment-a.test.mjs: the amendment freeze test (also
  listed in the package.json test script).
- package.json: test script gains gateway-go.test.mjs (A1) and
  amendment-a.test.mjs.
- tests/v1.4/compat.test.mjs: A3 skip (in tree) plus the A4 render pin.
- .gitattributes, tests/profile-reader/t19-footprint.test.mjs,
  tests/profile-render/t15-boundary.test.mjs, tests/sync.test.mjs,
  tests/v1.4.7-rc1/gateway-go.test.mjs: recorded as amended (all already
  in the tree; listed here so section 8 is exact).

Forbidden: editing Contract v1.4.7-rc1 or any earlier frozen contract,
and everything forbidden by rc1 section 7.

## Freeze record

The SHA-256 (over exact file bytes) and line count of this file, as
frozen before any amendment test was written, are recorded in
tests/v1.4.7-rc1/helpers.mjs and pinned by
tests/v1.4.7-rc1/amendment-a.test.mjs. Any later edit requires a new
amendment.

