# OpenCode Model Sync — Simple Script Contract v1.4.7-rc4 Amendment C

Frozen amendment over Amendment B (SHA-256
f322dc956fba3d1c8030826773fe92720020e13c60e875078a01eec66b571060, 111 lines),
covering exactly two corrections. Everything else in rc4, Amendment A and
Amendment B stays binding. Nothing here supersedes P1, Amendment A, Frozen
or V.

Status: FROZEN. Freeze SHA-256 and line count recorded below.
Gate: OCMS-S v1.4.7-rc4, amendment C (counters shape and lede colour).
Baseline: HEAD d4bf74c plus the frozen rc4 work including the density
implementation (lede lime at the maintainer's direct instruction).
No release/tag authorized in this gate. No tag, no push.

## C1 (counters: 4 across below 1100px, not 2)

Below 1100px the 8 counters are 4 across and 2 rows (repeat(4)). This
supersedes B3's "4x2 below 1100px" and named layout change 3's repeat(2)
assertion, which is rewritten accordingly (per-breakpoint track counts;
2 across never appears). Final shape: base repeat(4); 8 across at full width
for 1100-1399px; repeat(4) while Preview sits in the 1400px middle column.
Single container of 8, removed-hero and the Removed-larger numeric check stay.

## C2 (lede keeps the rc3 lime token)

The lede keeps var(--lime), at the maintainer's direct instruction. This
supersedes the single word "muted" in B1; the inline row, ellipsis and
tooltip requirements are unchanged.

## Files

This amendment covers exactly:

- OpenCode Model Sync — Simple Script Contract v1.4.7-rc4 Amendment C.md
  (this file; frozen before any amendment test was written).
- tests/v1.4.7-rc4/helpers.mjs: amendment freeze anchor (additive).
- tests/v1.4.7-rc4/amendment-c.test.mjs: freeze pin plus C1/C2 checks
  (explicit path in the package.json test script).
- package.json: test script gains the amendment-c path (this step).
- tests/v1.4.7-rc4/layout.test.mjs: the named change-3 assertion rewritten to
  per-breakpoint track counts (post-OK RED work, not this step).
- ui/index.html: base counters repeat(2) to repeat(4), CSS only (post-OK).
- tests/v1.4/compat.test.mjs and tests/profile-reader/t19-footprint.test.mjs:
  ui/index.html re-pin with reason "Amendment C counters and lede" (post-OK).

Forbidden: touching P1, Amendment A, Frozen or V semantics; editing any
frozen contract or test outside the named changes; any product or pin change
in this step.

## Freeze record

The SHA-256 (over exact file bytes) and line count of this file, as
frozen before any amendment test was written, are recorded in
tests/v1.4.7-rc4/helpers.mjs and pinned by
tests/v1.4.7-rc4/amendment-c.test.mjs. Any later edit requires a new
amendment.
