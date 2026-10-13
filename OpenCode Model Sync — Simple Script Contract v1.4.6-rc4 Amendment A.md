# OpenCode Model Sync — Simple Script Contract v1.4.6-rc4 Amendment A

Frozen amendment to Contract v1.4.6-rc4 (SHA-256
bdf79b620f5b69fe575c6abb2206a13191488cb1112a7ffd7609f42613ad2c63, 245 lines),
which is unchanged and immutable. Where this amendment is silent,
v1.4.6-rc4 (and transitively v1.4.6-rc3 and earlier) remains binding.

Status: FROZEN. Freeze SHA-256 and line count recorded below.
Gate: OCMS-S v1.4.6-rc4 — S5 PROFILE SUITES IN CI, amendment A.
Baseline: v1.4.6-rc4 working tree after Step-2 GREEN (no commit).
No release/tag authorized in this gate. No commit, tag, or push.

## A1 (P5 hermeticity): g2-isolation real-home guard

tests/profile-acceptance/g2-isolation.test.mjs line 34 resolves the
real ~/.dsh only if it exists. When path.resolve(os.homedir(), '.dsh')
exists, the check is unchanged: realpath comparison proving the scratch
home is not inside the real home. When it does not exist (a clean
runner has no ~/.dsh), the test still asserts that the scratch home is
not lexically inside path.resolve(os.homedir(), '.dsh'), without calling
realpathSync on the absent path. The assertion stays; nothing is
skipped, weakened, or deleted.

Reason: on a clean runner ~/.dsh is absent, so the realpathSync call
throws ENOENT before the check can run. The test passes on the developer
machine only because the real ~/.dsh happens to exist. Existence must
not decide the verdict; non-traversal must hold either way.

## A2 (§Files correction): dev-tools version pin

tests/dev-tools.test.mjs, one metadata-only line: the release-version pin
1.4.6-rc3 → 1.4.6-rc4 in the package-manifest-whitelist test, as
authorized in kind by rc4 P6 (existing gate tests that pin the release
version are updated). This line is already in the working tree; this
amendment records it so §Files is exact.

## A3: no other change

No product file changes. No other test changed, weakened, skipped, or
deleted. No devDependencies. No live calls. If the reproduced profile
job shows any other failure after A1, stop and report; do not widen
this amendment.

## Files

This amendment covers exactly:

- OpenCode Model Sync — Simple Script Contract v1.4.6-rc4 Amendment A.md
  (this file; frozen before any amendment test was written).
- tests/v1.4.6-rc4/helpers.mjs: amendment freeze anchor (additive).
- tests/v1.4.6-rc4/amendment-a.test.mjs: the amendment freeze test.
- tests/profile-acceptance/g2-isolation.test.mjs: A1 guard (only change
  to this file).
- tests/dev-tools.test.mjs: A2 one-line pin (already in the tree).

Forbidden: editing Contract v1.4.6-rc4 or any earlier frozen contract,
and everything forbidden by rc4 §10.

## Freeze record

The SHA-256 (over exact file bytes) and line count of this file, as
frozen before any amendment test was written, are recorded in
tests/v1.4.6-rc4/helpers.mjs and pinned by
tests/v1.4.6-rc4/amendment-a.test.mjs. Any later edit requires a new
amendment.

