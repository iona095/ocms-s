# OpenCode Model Sync — Simple Script Contract v1.4.7-rc2 Amendment B

Frozen amendment to Contract v1.4.7-rc2 (SHA-256
fd4d2e186afd721f280ad974f934028377f6802ce1a8620ac1c9968066f760aa, 142 lines),
which is unchanged and immutable. Where this amendment is silent,
v1.4.7-rc2 and Amendment A remain binding.

Status: FROZEN. Freeze SHA-256 and line count recorded below.
Gate: OCMS-S v1.4.7-rc2, amendment B.
Baseline: HEAD e8d1c67 plus the uncommitted rc2 working tree after Step-4
GREEN (no commit).
No release/tag authorized in this gate. No tag, no push.

## B1 (report every removed copy)

diffDesired reports per (gateway/id, route) copy using prior.records, not
only prior.route: every stored copy not kept at that route is listed in
removed with its route; moved stays for a model whose only copy changes
route (single stored copy). Report-only: desired arrays, candidate bytes,
NO_CHANGE and READY decisions, and Apply are unchanged. Proof fixture
b1three (model triple on opencode-go, opencode-go-messages and
opencode-go-responses, desired on messages only): removed lists both
dropped copies with their routes, moved is empty, and the candidate digest
is 13743b192094b75fe11268799659ca443fdba92d84b118995fea5a2f4a483faa,
identical to before the change. When several stored copies exist and none is on
the desired route, the desired copy is reported in added with its route and
every stored copy in removed (covered by a b1split case with the same digest
pin discipline). Removed rows sort by key then route.

## B2 (observed counts, no derivation)

Per-route current counts in the profile response and CLI text are read from
the stored managed lists (count of entries per route), not derived from
desired plus changes. Mechanism (narrowed): plan-builder returns per-route
stored counts only (currentRouteCounts { route: number }, computed from
plan.priors records) alongside the plan (additive, no planning change); ui.mjs
and the CLI formatter read those numbers. The derivation is removed from both.
Scope note: this adds profile/plan-builder.mjs (count computation plus one
return field) beyond the rc2 file list; it is the only coherent source, since
sync.mjs must not import profile modules and the preview carries no stored
lists.

## B3 (recorded file): r2-browser stub completion

tests/profile-cli-ui/r2-browser.test.mjs is named as touched outside
section 8 and Amendment A: its stub preview responses carry the complete
detail groups the U2 gate now requires. Assertions unchanged.

## B4 (re-pin): sync bytes move for B1

Re-pin sync.mjs at the three sites with the B1 reason (per-copy removed
rows): compat.test.mjs (skip the rc2 sync pin as superseded, add the B
successor), t19-footprint CURRENT map, and t15-boundary T18.

## Files

This amendment covers exactly:

- OpenCode Model Sync — Simple Script Contract v1.4.7-rc2 Amendment B.md
  (this file; frozen before any amendment test was written).
- tests/v1.4.7-rc2/helpers.mjs: amendment freeze anchor (additive).
- tests/v1.4.7-rc2/amendment-b.test.mjs: the amendment freeze test (also
  listed in the package.json test script).
- package.json: test script gains amendment-b.test.mjs.
- sync.mjs: B1 per-copy removed rows (report-only).
- profile/plan-builder.mjs: return currentRouteCounts with the plan (B2 source;
  additive, no planning change).
- ui.mjs: B2 stored-list counts (derivation removed).
- sync.mjs CLI formatter: B2 stored-list counts (derivation removed).
- tests/v1.4.7-rc2/profile-preview.test.mjs: B1 proof test (digest pin plus
  both removed rows).
- tests/v1.4/compat.test.mjs: B4 skip plus successor; B2 plan-builder pin.
- tests/profile-reader/t19-footprint.test.mjs: B4 CURRENT sync value.
- tests/profile-render/t15-boundary.test.mjs: B4 T18 sync value.
- tests/profile-cli-ui/r2-browser.test.mjs: B3 stub completion (in tree).

Forbidden: editing Contract v1.4.7-rc2, Amendment A, or any earlier frozen
contract, and everything forbidden by rc2 section 7 except the files named
above.

## Freeze record

The SHA-256 (over exact file bytes) and line count of this file, as
frozen before any amendment test was written, are recorded in
tests/v1.4.7-rc2/helpers.mjs and pinned by
tests/v1.4.7-rc2/amendment-b.test.mjs. Any later edit requires a new
amendment.

