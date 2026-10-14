# OpenCode Model Sync — Simple Script Contract v1.4.7-rc5

Additive contract over v1.4.7-rc4 including Amendments A, B and C. Where
v1.4.7-rc5 does not explicitly supersede planning, v1.4.7-rc4 remains
binding. All earlier contracts and SPEC files are unchanged and immutable;
nothing here edits them.

Status: FROZEN. Freeze SHA-256 and line count recorded.
Gate: OCMS-S v1.4.7-rc5.
Repo: C:\Users\GNV\.dsh\tools\ocms-s, branch main.
Baseline: HEAD edd43c6 (v1.4.7-rc4). No commit, tag or push in this gate.
Release candidate only.

## 1. Problem (observed 2026-10-14)

OpenCode replaced deepseek-v4-flash and deepseek-v4-flash-vision-exp with
deepseek-v4.1-flash. Both docs pages dropped the old rows. Both rosters still
list the old IDs, and the catalog has no provider.npm for them. The old IDs
sit in several routes of the profile. buildDesired pushes
PLACEMENT_AMBIGUOUS to blocking (sync.mjs planDesired multi-route branch),
so the entire sync stops over unplaceable dead copies.

## 2. Rule W1 (withdrawn-docs removals, report-only)

When every source is OK (all five sources fetched and parsed with no
FETCH_FAILED, ROSTER_INVALID, CATALOG_INVALID, DOCS_INVALID or SOURCE_INVALID
refusal in force, threaded as an explicit allSourcesOk flag) and a roster
model has no docs row on its gateway and no catalog npm hint, reaching the
PLACEMENT_UNRESOLVED branch: if its stored copies span more than one route,
it no longer blocks, provided the id has no docs row on any gateway's docs
page, not just its own (truncation guard: a model still documented on the
other gateway keeps today's PLACEMENT_AMBIGUOUS block). Planning continues;
all its copies are absent from the desired arrays (unchanged) and each copy
is listed under Removed with reason
DOCS_WITHDRAWN (gateway/id/route per copy, existing key-then-route sort kept).
Digests of every existing fixture stay unchanged; in the W1 fixture the
candidate lacks every withdrawn copy and differs in nothing else. Test 2(b)
must assert both, per copy. With removals present the Preview is READY and
reviewable, not BLOCKED; the
Apply flow (explicit confirm, backup, fail-closed refusals) is unchanged.

One-route and zero-route cases keep today's behaviour: a single stored copy
stays PRESERVED_UNRESOLVED and a missing one stays SKIPPED_UNRESOLVED. Reason:
withdrawing the last copy on docs silence alone would be guessing (roster lag
versus true withdrawal is undecidable locally); the multi-copy case is
different because no route can be preserved and blocking the whole sync over
it is disproportionate. Every copy stays reviewable under Removed with the
mass-removal warning below and explicit Apply.

Any source not OK keeps today's fail-closed block (fetch/parse refusals
unchanged; W1 cannot fire there). Malformed docs identities (DOCS_INVALID)
and COMPAT_AMBIGUOUS (selectCompat) stay blocking. Fallback, unsupported and
CATALOG_MISSING paths are untouched.

## 3. Display and modes

The UI shows the reason per removed copy (textContent only, no innerHTML):
the web Details Removed rows and the CLI report Removed lines carry
DOCS_WITHDRAWN with gateway/id/route. The rc2 mass-removal warning
(routeLossWarnings, byte-identical) still applies and is expected to fire
over these removals; warning-only, no new block.
Legacy (settings.yaml) mode: W1 applies there too. Legacy and profile share
planDesired/diffDesired in sync.mjs, so the same reviewable removals, rows
and warning appear in both; no mode fork.

## 4. Tests (fixtures only, never live calls)

Package.json test script lists every file by explicit path (no globs).
1. tests/v1.4.7-rc5/freeze.test.mjs: contract freeze anchor intact.
2. tests/v1.4.7-rc5/withdrawn.test.mjs: (a) RED fixture (captured docs pair
   without the v4-flash rows plus a roster still listing them, old IDs stored
   in several routes) reproduces today's PLACEMENT_AMBIGUOUS block; (b) GREEN:
   same fixture plans DOCS_WITHDRAWN removals per copy with gateway/id/route
   and unchanged digests, READY not BLOCKED; (c) one-route PRESERVED and
   zero-route SKIPPED fixtures unchanged; (d) source-not-OK, DOCS_INVALID,
   COMPAT_AMBIGUOUS and other-gateway-documented fixtures still block; (e) web
   Removed rows and CLI lines
   render the reason via textContent; (f) legacy and profile paths agree.
3. Frozen suites pass unmodified (rc2 vm, r2-browser, ui-binding, rc3 visual,
   rc4 layout/remembered/amendment-a/b/c).
4. Full npm test green; vehicle green with 0 fail.
5. Clean-environment vehicle, fresh clone at a path containing ocms-s (npm
   test, vehicle, profile job with DSH 0.2.1-alpha.2); read-only web check
   (Refresh Preview only, never acknowledge or Apply) reports the expected
   outcome: READY, the deepseek-v4-flash and deepseek-v4-flash-vision-exp
   copies listed under Removed with DOCS_WITHDRAWN (count per gateway/route)
   and 0 blocking; both cordis.patch.yml hashes identical before and after.
   No live calls in tests. A pass counts only from the clean vehicle, the
   fresh clone, or CI.

## 5. Files, pins and version

Version 1.4.7-rc4 -> 1.4.7-rc5: package.json version, description tag, test
script (gains the rc5 suites by explicit path); package-lock mirrors; client
PLUGIN_VERSION plus rebuilt client.js (builder only). Product: sync.mjs (W1
branch plus withdrawn-key plumbing, report-only), ui.mjs (translateChanges
carries the reason), ui/index.html (Removed row renders the reason via
textContent; nothing else in script logic). Re-pin every changed pinned file
with a named reason (withdrawn-docs removals): sync.mjs at compat (skip plus
successor), t19 CURRENT map and t15-boundary T18; ui.mjs and ui/index.html at
t19 CURRENT and the compat succession. tests/dev-tools.test.mjs and
compat version pins move rc4 -> rc5. CHANGELOG.md and README.md. SPEC files,
frozen contracts, profile/*, dsh/host.mjs, dsh/lifecycle.mjs and
cordis.patch.yml stay byte-identical (verified, not re-pinned).
Forbidden: live calls in tests; weakening/skipping/deleting any test outside
a named amendment; .gate/, real profiles, production Apply.

## 6. Challenge

Row one: silent mass deletion. Answer: every copy is listed with reason, the
mass warning fires, Preview is READY for review, and Apply stays explicit;
nothing is deleted without confirmation.
Row two: roster lag versus true withdrawal. Answer: one-route copies stay
preserved; only the unplaceable multi-copy case converts, and only to
reviewable removals.
Row three: digest drift. Answer: desired bytes unchanged, so all digest pins
hold; verified by the GREEN fixture.
Row four: mode fork. Answer: one shared planner, both modes, same rows.
Row five: version bump hides drift. Answer: all three product files re-pinned
with named reasons at every pin site.
Row six: partially truncated docs table. Answer: W1 requires no docs row on
any gateway; a model still documented elsewhere keeps the block, so a half-
updated docs table must not mass-remove.

## Freeze record

The SHA-256 over exact file bytes and the line count of this file, as frozen
before any v1.4.7-rc5 test was written, are recorded in
tests/v1.4.7-rc5/helpers.mjs and pinned by test 1. Any later edit requires
a new gate.
