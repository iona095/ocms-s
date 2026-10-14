# OpenCode Model Sync — Simple Script Contract v1.4.7-rc5 Amendment A

Frozen amendment to Contract v1.4.7-rc5 (SHA-256
66f11fdcbfafd2445642ed1a9652771a699a4d98f1b8930b44fe85381d0245c1, 130 lines),
which is unchanged and immutable. It names one superseded test. Where this
amendment is silent, v1.4.7-rc5 remains binding.

Status: FROZEN. Freeze SHA-256 and line count recorded below.
Gate: OCMS-S v1.4.7-rc5, amendment A.
Baseline: HEAD edd43c6 plus the frozen rc5 work (W1 implemented, withdrawn
suite green). No release/tag authorized in this gate. No tag, no push.

## Supersession

tests/sync.test.mjs section 20, test titled "refuses placement-unresolved
models duplicated across routes", is superseded by W1. Quoted old
assertions: outcome.result NOT WRITTEN; outcome.unresolved[0].reason matches
PLACEMENT_AMBIGUOUS; the settings file bytes unchanged. New assertions over
the identical fixture: outcome.result UPDATED; outcome.removed deep-equals
the per-copy DOCS_WITHDRAWN rows (go/dup on opencode-go and
opencode-go-messages); the rewritten file no longer contains dup while the
placed fresh model lands. Nothing else in that file changes: same fixture,
same helpers, all other tests byte-untouched.

## Files

This amendment covers exactly:

- OpenCode Model Sync — Simple Script Contract v1.4.7-rc5 Amendment A.md
  (this file; frozen before any amendment test was written).
- tests/v1.4.7-rc5/helpers.mjs: amendment freeze anchor (additive).
- tests/v1.4.7-rc5/amendment-a.test.mjs: the amendment freeze pin (explicit
  path in the package.json test script).
- package.json: test script gains the amendment-a path (this step).
- tests/sync.test.mjs: the one test named above (already edited to W1).

Forbidden: editing Contract v1.4.7-rc5 or any earlier frozen contract,
weakening any other test, and any product change in this step.

## Freeze record

The SHA-256 (over exact file bytes) and line count of this file, as
frozen before any amendment test was written, are recorded in
tests/v1.4.7-rc5/helpers.mjs and pinned by
tests/v1.4.7-rc5/amendment-a.test.mjs. Any later edit requires a new
amendment.
