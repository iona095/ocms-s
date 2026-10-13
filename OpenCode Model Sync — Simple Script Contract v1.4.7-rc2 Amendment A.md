# OpenCode Model Sync — Simple Script Contract v1.4.7-rc2 Amendment A

Frozen amendment to Contract v1.4.7-rc2 (SHA-256
fd4d2e186afd721f280ad974f934028377f6802ce1a8620ac1c9968066f760aa, 142 lines),
which is unchanged and immutable. Where this amendment is silent,
v1.4.7-rc2 remains binding.

Status: FROZEN. Freeze SHA-256 and line count recorded below.
Gate: OCMS-S v1.4.7-rc2, amendment A.
Baseline: v1.4.7-rc2 working tree after Step-1 freeze (no commit).
No release/tag authorized in this gate. No tag, no push.

## A1 (sync.mjs pins): U4 moves the pin at three sites

U4 changes sync.mjs (formatProfilePreviewText), so the sync.mjs pin
99e4f9dc78bbaf31a26692fd045f319509d9565bfd20f7419cbe5681a4b34b75 moves
at all three sites with a named reason (per-route CLI lines):
tests/v1.4/compat.test.mjs (skip the rc1 sync pin as superseded, add the
rc2 successor), tests/profile-reader/t19-footprint.test.mjs CURRENT map,
and tests/profile-render/t15-boundary.test.mjs T18. The formatter diff is
the only sync.mjs change; planning bytes are untouched.
Confirmed: rc2 touches no gateway-base test (its 3/7/8 updates belonged to
rc1; endpointApi bases and tails are unchanged by this gate).

## A2 (executable U2/U3): pure page functions under vm

Static markers are replaced with behavioral tests. ui/index.html keeps the
U2 decision and the U3 warning computation in two pure top-level functions
with no DOM access: previewDetailsComplete(response) returns true only when
every detail group is present as an array; routeLossWarnings(perRoute)
returns one entry per route losing more than half, naming the route and
both counts. Each function is delimited by an exact banner comment so the
test extracts it without brittle matching, and the page calls both.
tests/v1.4.7-rc2/profile-preview.test.mjs extracts those functions from the
served ui/index.html and runs them in node:vm against fixtures: a complete
response reads true; each single missing group reads false; a heavy-loss
route warns naming the route and both counts; a small change and an
exactly-50% loss warn nothing. Re-pin ui/index.html after.

## A3: no other change

No product file changes beyond U1–U4 plus the A2 pure functions (which are
the U2/U3 implementation, not extra scope). No other test changed,
weakened, skipped, or deleted. If anything else fails, stop and report;
do not widen this amendment.

## Files

This amendment covers exactly:

- OpenCode Model Sync — Simple Script Contract v1.4.7-rc2 Amendment A.md
  (this file; frozen before any amendment test was written).
- tests/v1.4.7-rc2/helpers.mjs: amendment freeze anchor (additive).
- tests/v1.4.7-rc2/amendment-a.test.mjs: the amendment freeze test (also
  listed in the package.json test script).
- package.json: test script gains amendment-a.test.mjs.
- tests/v1.4/compat.test.mjs: A1 skip plus rc2 successor pin.
- tests/profile-reader/t19-footprint.test.mjs: A1 CURRENT sync value.
- tests/profile-render/t15-boundary.test.mjs: A1 T18 sync value.
- tests/v1.4.7-rc2/profile-preview.test.mjs: A2 vm tests (already covered
  as new in rc2 section 8; listed here for the A2 behavior).
- ui/index.html: A2 pure functions (already covered as changed in rc2
  section 8; re-pinned per A2).

Forbidden: editing Contract v1.4.7-rc2 or any earlier frozen contract,
and everything forbidden by rc2 section 8.

## Freeze record

The SHA-256 (over exact file bytes) and line count of this file, as
frozen before any amendment test was written, are recorded in
tests/v1.4.7-rc2/helpers.mjs and pinned by
tests/v1.4.7-rc2/amendment-a.test.mjs. Any later edit requires a new
amendment.

