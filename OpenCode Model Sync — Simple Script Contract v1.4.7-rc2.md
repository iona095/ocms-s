# OpenCode Model Sync — Simple Script Contract v1.4.7-rc2

Additive contract over Contracts v1.2 through v1.4.7-rc1. Where v1.4.7-rc2
does not explicitly supersede behavior, v1.4.7-rc1 remains binding.
Contracts v1.0 through v1.4.7-rc1 are unchanged and immutable.

Status: FROZEN. Freeze SHA-256 and line count recorded.
Gate: OCMS-S v1.4.7-rc2.
Baseline: tag v1.4.7-rc1, commit e8d1c67600ccf36f68e566fbdc300d05840c8ef2.
No release or tag is authorized in this gate. Release candidate only.

## 1. Problem

In profile mode the browser shows a READY notice while every counter, every
detail group and all five Upstream Sources show dashes, and Apply Sync stays
enabled. Cause: the profile Preview response only carries state, target,
digests, attestation, previewId and timestamps. It never returns changes,
sources, preserved, skipped, unsupported, fallback or drift, although the
server holds the full plan and sources. Legacy mode returns all of these.
Present since S5, unchanged in v1.4.6. A hidden plan cannot be reviewed, so
Apply must never be offered blind.

## 2. Reference: what stays true

Fail-closed home and anchor admission, version pinning, Preview and Apply
semantics, commit behavior, attestation rules, and every planner rule stay
frozen. Planning (sync.mjs outside the CLI formatter), render, and the
client bundle logic stay unchanged. Truly blocked and error paths keep
their current responses.

## 3. U1 — profile Preview carries reviewable content

The profile Preview response carries the same reviewable content as legacy
mode, all of it from the plan and sources the server already holds, with no
extra fetch: changes with added, removed, moved and metadataChanged; the
preservedUnresolved, skippedUnresolved, unsupportedSkipped and
fallbackResolved rows; endpointBaseDrift; and a sources summary for the
five sources in the legacy shape. It also carries per-route desired counts
from the desired arrays and per-route current counts derived as desired
minus added and moved-to plus removed and moved-from, per route, from the
same changes object. Item rows show model ID and routes the same way
legacy rows do: preserved rows carry gateway, id, reason and route;
skipped rows carry gateway, id and reason; unsupported rows add endpoint;
fallback rows carry gateway, id, counterpart, route and provenance.

## 4. U2 — Apply only over reported details

Apply is enabled and the Review notice is shown only when the response actually
reports every detail group with arrays present. If any group is missing, the
state is shown as an error reading Preview details not reported by server, and
Apply stays disabled with no previewId retained. Never say READY over dashes.
The guard is a response-shape check in the page; server refusal paths are
unchanged, and forged Apply posts still fail server-side as before.

## 5. U3 — visible per-route scale and loss warning

The summary shows per-route current turning into desired from the response
route counts. When any managed route would lose more than half of its current
entries, the page shows a prominent warning naming the route and both counts.
Warning only: no new blocking rule (a mass-removal guard is a later gate).

## 6. U4 — CLI prints per-route counts

The CLI profile preview text also prints one per-route current turning into
desired line per managed route. No other CLI change.

## 7. U5 — version 1.4.7-rc2 and pins

Version 1.4.7-rc2: package.json version, description contract tag, test script
(gains the rc2 freeze suite); package-lock root versions mirroring package.json;
client PLUGIN_VERSION and the rebuilt client.js (builder script only, never
hand-edited). ui.mjs, ui/index.html and the CLI text formatter may change,
limited to U1 through U4. Re-pin every changed pinned file with a named reason:
ui.mjs and ui/index.html values in the footprint CURRENT map, and the compat
ui/index.html pin by skipping the rc2 test with supersession reason and adding
the rc2 successor test (established pattern). Existing gate tests pinning the
release version to 1.4.7-rc1 move to 1.4.7-rc2 (metadata only). No other
product change. Files lists every touched file, including every re-pin site,
CHANGELOG, README and the contract.

Forbidden: sync.mjs planning, profile files, SPEC files, frozen contracts v1.0
through v1.4.7-rc1, lifecycle and host, bundle architecture, Preview and Apply
semantics, settings targets, route transport, roster and catalog and docs URLs,
live probes, .gate/, real profiles and production Apply, weakening or deleting
or skipping any test.

## 8. Files

Every file touched in this gate:

- The v1.4.7-rc2 contract (this file; frozen before any rc2 test was written).
- ui.mjs: U1 profile response groups, counts, sources summary retention.
- ui/index.html: U2 details guard and error notice; U3 per-route summary and
  loss warning elements.
- sync.mjs: U4 formatter per-route lines only (planning untouched).
- tests/v1.4.7-rc2/helpers.mjs: freeze anchor.
- tests/v1.4.7-rc2/freeze.test.mjs: the frozen test 1.
- tests/v1.4.7-rc2/profile-preview.test.mjs: U1 response groups and counts,
  U4 CLI lines, legacy shape unchanged, static U2 and U3 markers.
- tests/profile-reader/t19-footprint.test.mjs: CURRENT ui.mjs and ui/index.html
  values re-pinned with named reason.
- tests/v1.4/compat.test.mjs: ui/index.html pin succession (skip plus successor).
- package.json, package-lock.json, dsh/client.mjs, dsh/client.js (version).
- tests/v1.4/compat.test.mjs and tests/dev-tools.test.mjs (version pins).
- CHANGELOG.md and README.md (release notes and counts).

## 9. Tests

Identities frozen: 1. freeze anchor intact. 2. U1 response groups present with
exact counts for a fixture plan with adds, removes, moves and skips, plus
per-route counts and a five-source summary. 3. U2 missing-group responses keep
Apply disabled under the error notice (static markers plus browser proof).
4. U3 loss warning shown for a heavy-loss fixture and absent for a small
change. 5. U4 CLI per-route lines. 6. legacy-mode response shape unchanged
since rc1. 7. full npm test green with only authorized version updates plus
the rc2 freeze suite; vehicle green with 0 fail. 8. fresh-clone, reproduced
profile job, smoke on Node 22, and the read-only web check with counters,
per-route counts and warnings reported.

Prior suites stay unmodified except the files named in section 8. Never
weaken, skip, or delete a test outside a named amendment.

## 10. Challenge

Row one: group mapping invents data. Answer: every row derives from retained
plan dispositions with legacy shapes. Row two: completeness gate blocks stale
clients. Answer: only READY with missing groups diverts to error; BLOCKED and
ERROR paths unchanged. Row three: warning threshold is arbitrary. Answer: one
fixed rule, display only, no planning effect. Row four: formatter counts drift
from response counts. Answer: both derive from the same changes object.
Row five: version bump hides drift. Answer: changed pinned files re-pinned
with named reasons; rest green.

## 11. Freeze record

The SHA-256 over exact file bytes and the line count of this file, as frozen
before any v1.4.7-rc2 test was written, are recorded in
tests/v1.4.7-rc2/helpers.mjs and pinned by test 1. Any later edit requires
a new gate.

Disposition rows are sorted by gateway then id, as in legacy mode.

