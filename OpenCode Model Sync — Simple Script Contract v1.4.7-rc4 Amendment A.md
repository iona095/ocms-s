# OpenCode Model Sync — Simple Script Contract v1.4.7-rc4 Amendment A

Frozen amendment to Contract v1.4.7-rc4 (SHA-256
988466ebe3e80588bf2075e6874f4fcb2c6f2f9abf3037c49b48a2fafc0c8a43, 181 lines),
which is unchanged and immutable. Where this amendment is silent,
v1.4.7-rc4 remains binding.

Status: FROZEN. Freeze SHA-256 and line count recorded below.
Gate: OCMS-S v1.4.7-rc4, amendment A.
Baseline: HEAD d4bf74c plus the frozen rc4 contract, freeze anchor and the
rc4 RED suites (implementation of L1/L2/P1 complete in the worktree, suite
green except v1.3 H2, which this amendment supersedes by name).
No release/tag authorized in this gate. No tag, no push.

## Conflict

v1.3 H2 (tests/v1.3/ui-contract.test.mjs) bans the substrings localStorage,
sessionStorage and document.cookie anywhere in ui/index.html, to enforce the
v1.3 token rule. P1 remembering needs localStorage for one profile name, so
the substring ban cannot stand as written.

Quoted H2 (unchanged text): "H2: the token bootstrap placeholder mechanism
exists and the page never persists the token": the served template carries
__OCMS_TOKEN__, and for each of localStorage, sessionStorage, document.cookie
the page must not contain it.

Quoted token rule (ui/index.html, unchanged and still binding): "The token
lives only in this variable for the lifetime of the page; it is never stored,
displayed, or logged." The token travels only in the X-OCMS-Token header.

## A1 (token confinement, stricter on the token than H2)

The token rule is unchanged: the TOKEN const stays memory-only. H2 is
superseded by this guard: sessionStorage and document.cookie stay banned
outright (zero occurrences, static). The substring localStorage may occur
only inside ONE helper named rememberedStore, which is the sole function
that reads or writes storage; its only key is the literal
'ocms-s.lastProfile'. Any other key literal, any computed key, or any
localStorage occurrence outside rememberedStore fails. No token bytes may
reach storage, URLs, or cookies: the behaviour test below injects a known
token into the bootstrap placeholder and traces it.

## A2 (behaviour test, RED before consolidation)

tests/v1.4.7-rc4/amendment-a.test.mjs holds the freeze pin plus this test,
run with node:vm, a stub DOM, spied storage and the injected token: load,
prefill, profile Preview to READY, Apply confirm path. It asserts: setItem
and getItem were only ever called with 'ocms-s.lastProfile'; the stored value
equals the trimmed request profileName; the token string appears in no
storage key, no storage value, no fetch URL, no fetch body and no cookie,
while the X-OCMS-Token header still carries it (auth unchanged). Statically:
sessionStorage and document.cookie are absent, and every localStorage
occurrence sits inside rememberedStore. The worktree ui/index.html predates
consolidation (two direct storage users), so this test is RED until the
post-review consolidation; no product change happens in this step.

## Files

This amendment covers exactly:

- OpenCode Model Sync — Simple Script Contract v1.4.7-rc4 Amendment A.md
  (this file; frozen before any amendment test was written).
- tests/v1.4.7-rc4/helpers.mjs: amendment freeze anchor (additive).
- tests/v1.4.7-rc4/amendment-a.test.mjs: freeze pin plus the A2 behaviour
  test (explicit path in the package.json test script).
- package.json: test script gains tests/v1.4.7-rc4/amendment-a.test.mjs by
  explicit path (no globs).
- tests/v1.3/ui-contract.test.mjs: H2 alone gets
  { skip: 'superseded by contract v1.4.7-rc4 Amendment A' } and nothing else;
  applied post-review together with the consolidation, never silently.
- Post-review implementation (not this step): consolidate storage access
  into rememberedStore in ui/index.html; no other product change.

Forbidden: editing Contract v1.4.7-rc4 or any earlier frozen contract,
obfuscating the localStorage substring, weakening any other test, and any
product change in this step.

## Freeze record

The SHA-256 (over exact file bytes) and line count of this file, as
frozen before any amendment test was written, are recorded in
tests/v1.4.7-rc4/helpers.mjs and pinned by
tests/v1.4.7-rc4/amendment-a.test.mjs. Any later edit requires a new
amendment.
