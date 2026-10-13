# OpenCode Model Sync — Simple Script Contract v1.4.6-rc5 Amendment A

Frozen amendment to Contract v1.4.6-rc5 (SHA-256
ea05bda17a85bf1ade98d8655b59ba733f03d0d235352d19da8e91c20556de69, 255 lines),
which is unchanged and immutable. Where this amendment is silent,
v1.4.6-rc5 remains binding.

Status: FROZEN. Freeze SHA-256 and line count recorded below.
Gate: OCMS-S v1.4.6-rc5, amendment A.
Baseline: v1.4.6-rc5 working tree after Step-3 GREEN (no commit).
No release/tag authorized in this gate. No tag, no push.

## A1 (§Files correction): s3r1 test title

tests/profile-render/s3r1-b1-binding.test.mjs is added to §Files: one test
title classification/home/overlay → classification/dsh-home/overlay,
because the Q5 guard matched the descriptive /home/ in the old title.
Assertions unchanged; the new title names the bound dshHomeReal field.

## A2 (re-anchored pin): quarantine bytes

env04-staging quarantine pin
ad326cf384b999e4129ab360a09205e42340277220a07e48069e56d9bbb01d06 →
be95e03e1f63d223a3c91cac76fa5416aef78dee802ddec476cd32cf106fbcf9, the LF
hash of env02-native.test.mjs after its authorized Q1 edit (not a
CI-observed value). Same assertion: the file is byte-identical to the
Q1-fixed bytes on every checkout (Q3 eol=lf).

## A3: no other change

No product file changes. No other test changed, weakened, skipped, or
deleted. No pin updated beyond A2. If anything else fails, stop and
report; do not widen this amendment.

## Files

This amendment covers exactly:

- OpenCode Model Sync — Simple Script Contract v1.4.6-rc5 Amendment A.md
  (this file; frozen before any amendment test was written).
- tests/v1.4.6-rc5/helpers.mjs: amendment freeze anchor (additive).
- tests/v1.4.6-rc5/amendment-a.test.mjs: the amendment freeze test (also
  listed in the package.json test script).
- tests/profile-render/s3r1-b1-binding.test.mjs: A1 title (already in the
  tree).
- tests/profile-acceptance/env04-staging.test.mjs: A2 pin (already in the
  tree; §Files-listed for Q1/Q4-row-11).

Forbidden: editing Contract v1.4.6-rc5 or any earlier frozen contract,
and everything forbidden by rc5 §11.

## Freeze record

The SHA-256 (over exact file bytes) and line count of this file, as
frozen before any amendment test was written, are recorded in
tests/v1.4.6-rc5/helpers.mjs and pinned by
tests/v1.4.6-rc5/amendment-a.test.mjs. Any later edit requires a new
amendment.

