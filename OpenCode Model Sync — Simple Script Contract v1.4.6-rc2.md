# OpenCode Model Sync — Simple Script Contract v1.4.6-rc2

Additive contract over Contracts v1.2–v1.4.6-rc1. Where v1.4.6-rc2 does not
explicitly supersede behavior, v1.4.6-rc1 (and transitively v1.4.1/v1.4/v1.3/
v1.2) remains binding. Contracts v1.0–v1.4.6-rc1 are unchanged and immutable.

Status: FROZEN. Freeze SHA-256 and line count recorded in §15.
Gate: OCMS-S v1.4.6-rc2 — SHOW WHY A PROFILE PREVIEW IS BLOCKED
(DESIGN → CONTRACT → TEST-FIRST → IMPLEMENTATION).
Baseline: tag v1.4.6-rc1, commit e2883f4a83d9e1982d07282551d59c97588bc9c8,
plus the uncommitted S5 profile work carried unchanged.
No release/tag authorized in this gate. Release candidate only.

## 1. Problem

When profile planning blocks, the reasons are computed and then dropped
before anyone sees them:

- profile/plan-builder.mjs builds detail.reasons (e.g.
  "PLACEMENT_AMBIGUOUS: go/qwen3.6-plus has multiple existing routes")
  and returns refusal('VERIFY_FAILED', 'Planning is blocked.', { reasons }).
  profile/preview-session.mjs and runProfileSync (sync.mjs) carry detail
  through correctly.
- Web: ui.mjs replies { ok:false, code, message } only; detail is dropped.
  ui/index.html then shows state ERROR with the bare message "Planning is
  blocked.". The legacy settings path instead shows state BLOCKED and lists
  data.blockedReasons. The profile path should match it.
- CLI: sync.mjs prints a report whose only unresolved entry is
  "<code>: <message>"; detail.reasons is dropped.

Real case that exposed it: 13 duplicated-model blockers in the web profile,
which could only be found with a hand-written script.

## 2. Reference: carrying is correct, presentation drops

No planning, placement, classification, or carrying logic is broken. The
refusal shape { ok:false, code, message, status:'BLOCKED', detail } from
plan-builder through preview-session through runProfileSync is correct and
unchanged. Only two presentation seams drop detail.reasons: the profile
Preview refusal branch in ui.mjs and the blocked-profile report branch in
sync.mjs main, plus the profile catch branch in ui/index.html that cannot
see reasons it was never sent.

## 3. R1 — Reasons are verbatim and in order

When a profile refusal carries detail.reasons that is a non-empty array of
strings (Array.isArray(detail.reasons), length > 0, every entry typeof
string), the web response and the CLI output include every reason,
verbatim and in order. Verbatim means the exact string bytes in the exact
array order; no truncation, no re-sorting, no rewording, no de-duplication.
The existing "<code>: <message>" line/pair stays first and unchanged.

## 4. R2 — Web: blockedReasons on /api/preview, BLOCKED in the page

- The /api/preview profile-refusal body gains
  blockedReasons: [{ reason }], the same shape as the legacy path
  (ui.mjs previewResponsePayload maps each entry to
  { reason: String(entry.reason) }). For profile refusals the source array
  is detail.reasons, mapped to { reason: <verbatim string> } in order.
- HTTP status and code stay exactly as they are today. In particular a
  VERIFY_FAILED profile refusal still answers HTTP 400 with code
  VERIFY_FAILED; any other profile refusal keeps its current status/code.
- ui/index.html shows the BLOCKED state with the reasons, using the same
  notice format as the legacy path, when a profile Preview refusal has
  code VERIFY_FAILED and a non-empty blockedReasons array. The notice is
  'Synchronization blocked: ' + reasons.join(' | ') with warn styling, the
  same construction the legacy BLOCKED branch uses. Every other refusal
  still shows ERROR with the bare message, unchanged.

## 5. R3 — CLI: each reason is its own unresolved entry

The printed blocked-profile report lists each reason as its own unresolved
entry, after the existing "<code>: <message>" line, in order. Concretely
the unresolved array passed to formatReport is
[{ reason: code + ': ' + message }, ...reasons.map((r) => ({ reason: r }))],
rendered by the unchanged formatReport unresolved section. The exit code
is unchanged: 1 for a blocked profile run.

## 6. R4 — No other detail shapes are exposed

No other detail shapes are exposed. Objects with digests or causes
(e.g. { expected, observed }, { cause }, { path }), internal strings
(e.g. 'reader-missing', 'reader-status-invalid', 'patch-missing',
'patch-digest-malformed', 'reresolve-threw', 'target-mismatch'), and any
non-array or empty or non-string reasons value MUST NOT produce
blockedReasons and MUST NOT appear as a detail key in the web body. Reasons
only. The web refusal body for a profile refusal is exactly
{ ok:false, code, message } plus blockedReasons only when R1 applies.

## 7. R5 — No planning or routing change; version and pin

No planning, placement, classification, membership, diff, render, commit,
or attestation behaviour changes. plan-builder, preview-session,
runProfileSync carrying, and every non-presentation branch stay
byte-behavior-identical; only the two presentation seams (ui.mjs profile
refusal branch, sync.mjs blocked-profile report branch) and the profile
catch branch in ui/index.html change. Version 1.4.6-rc2. Replaces the RC1
sync.mjs byte pin with an RC2 pin computed over the final rc2 sync.mjs
bytes. The S5-R4 ui/index.html pin is superseded by an RC2 ui/index.html
pin for the same reason (R2 requires index.html bytes to change); rc1 §7
"MUST stay green" is explicitly superseded here.

## 8. Frozen prior rules (unchanged)

v1.4.1 §5 S0–S2, U1–U4, F1–F4 and §§6–11; v1.4.6-rc1 R1–R3 with invariants
I-EMIT, I-DISJOINT, I-ALIAS-INERT; Preview/Apply transaction semantics;
legacy /api/preview shape including blockedReasons and endpointBaseDrift
passthrough; roster/catalog/docs URLs; no live probes or inference. The
only change is downstream of planning: already-computed reasons become
visible where they were dropped.

## 9. Version metadata

- package.json version, package-lock.json root version and root package
  version: 1.4.6-rc2. package.json description contract tag moves to
  v1.4.6-rc2; the test script gains the rc2 suite.
- dsh/client.mjs and the built dsh/client.js PLUGIN_VERSION: 1.4.6-rc2
  (client.js rebuilt via dsh/build-client.mjs only, never hand-edited).
- Existing gate tests that pin the release version to 1.4.6-rc1 are updated
  to 1.4.6-rc2 (metadata only; authorized here). The PLUGIN_VERSION drift
  guard (tests/v1.4/client-view.test.mjs) needs no edit and MUST stay
  green. The RC1 sync.mjs pin and the S5-R4 ui/index.html pin are
  superseded by RC2 pins over the final rc2 bytes.

## 10. §Files

Every file touched in this gate (rc1 left CHANGELOG/README out of its file
list; this gate does not repeat that gap):

- OpenCode Model Sync — Simple Script Contract v1.4.6-rc2.md (this file;
  frozen before any rc2 test was written).
- ui.mjs: profile Preview refusal branch only (blockedReasons mapping, R1/
  R2/R4; status/code untouched).
- ui/index.html: profile catch branch only (carry blockedReasons on the
  thrown refusal; BLOCKED vs ERROR branch per R2; legacy branch untouched).
- sync.mjs: blocked-profile report branch only (unresolved reasons per R3;
  exit code untouched) plus version metadata.
- package.json: version 1.4.6-rc2, description contract tag, test script
  gains the rc2 suite.
- package-lock.json: root version mirrors package.json.
- dsh/client.mjs: PLUGIN_VERSION 1.4.6-rc2.
- dsh/client.js: rebuilt via dsh/build-client.mjs only.
- tests/v1.4.6-rc2/helpers.mjs: freeze anchor plus shared stub helpers.
- tests/v1.4.6-rc2/blocked-reasons.test.mjs: the six frozen tests in §11.
- tests/v1.4/compat.test.mjs: version pins rc1→rc2 (metadata only),
  RC1 sync pin superseded by RC2 sync pin, S5-R4 UI pin superseded by RC2
  UI pin (both skips record the supersession).
- tests/dev-tools.test.mjs: version assertion rc1→rc2 (metadata only).
- CHANGELOG.md: new v1.4.6-rc2 entry (symptom, R1–R5, files, verification).
- README.md: Reporting documents the blocked-profile reasons entries (R3),
  Local Web UX notes the profile BLOCKED-with-reasons state (R2), Project
  contracts/status lists the rc2 contract and version (touched only because
  these sections describe this output).

Forbidden: profile/*, SPEC*.md, frozen contracts v1.0–v1.4.6-rc1, DSH
lifecycle/host, bundle architecture, Preview/Apply semantics, settings
targets, route transport, roster/catalog URLs, live probes, .gate/,
real profiles, production Apply.

## 11. §Tests

tests/v1.4.6-rc2/ (node --test). Identities frozen:

1. contract freeze anchor intact (SHA-256 + line count per §15).
2. web-blocked-reasons: stubbed profile Preview that blocks with 2+
   reasons → the refusal body has blockedReasons with those exact strings
   in order, plus the same HTTP status (400) and code (VERIFY_FAILED) as
   before. Real plan-builder reasons; no live network.
3. web-no-leak: a profile refusal whose detail is not a reasons array
   (digest-mismatch object shape, e.g. { expected, observed }) → no
   blockedReasons key and no detail key in the body. Status/code unchanged.
4. ui-blocked-vs-error: BLOCKED rendering for a VERIFY_FAILED refusal with
   non-empty blockedReasons using the legacy notice format
   ('Synchronization blocked: ' + join(' | '), warn); ERROR with the bare
   message for every other refusal. Follows the existing ui-contract test
   style (static HTML assertions, no browser).
5. cli-blocked-reasons: a blocked profile run (stubbed sources, 2+
   reasons) prints every reason as its own unresolved entry after the
   existing "<code>: <message>" line, with exit code 1. No live network.
6. http-drift-passthrough: committed HTTP test proving the legacy Preview
   payload carries endpointBaseDrift (rc1 future-gate item; additive,
   non-blocking, already implemented — this gate adds the missing HTTP
   proof, no production change).

All prior suites remain unmodified except the metadata/pin updates named
in §9–§10. Baseline failures present before this gate are recorded in the
gate report and are not counted as regressions.

## 12. Implementation scope (smallest coherent change)

ui.mjs: map detail.reasons to blockedReasons in the single profile-refusal
branch; no other branch touched. ui/index.html: carry blockedReasons on
the thrown preview error and branch BLOCKED iff code is VERIFY_FAILED with
a non-empty blockedReasons array, reusing the legacy notice construction;
no other rendering touched. sync.mjs: append detail.reasons as unresolved
entries in the single blocked-profile report branch; no other report path
touched. Metadata/docs/tests as named in §10. Nothing in profile/*.

## 13. Known limitations (explicit future work)

- Reasons are display strings from the planner (e.g. PLACEMENT_AMBIGUOUS);
  this gate does not restructure them into machine fields.
- Only VERIFY_FAILED + blockedReasons shows BLOCKED in the profile page;
  other codes with reasons (none exist today) would still show ERROR until
  a future gate defines them.
- S2 concealment, alias/switch questions, and roster key/x-session topics
  from rc1 §10 remain future work, unchanged.

## 14. Contract challenge

| # | Attack | Answer | Result |
|---|--------|--------|--------|
| 1 | Reasons reordered or paraphrased | R1 verbatim+order; tests 2, 5 | PASS |
| 2 | blockedReasons on non-reasons detail | R4 no-leak; test 3 | PASS |
| 3 | Digest object leaks to browser | R4; body has no detail key; test 3 | PASS |
| 4 | Status/code changed to smuggle reasons | R2 status/code frozen; test 2 | PASS |
| 5 | Every refusal shows BLOCKED | R2 VERIFY_FAILED+reasons only; test 4 | PASS |
| 6 | CLI exit code changed | R3 exit unchanged (1); test 5 | PASS |
| 7 | Planner quietly fixed while displaying | R5 no planning change; prior suites green | PASS |
| 8 | Alias/drift semantics changed | §8 frozen; test 6 non-blocking | PASS |

## 15. Freeze record

The SHA-256 (over exact file bytes) and line count of this file, as frozen
before any v1.4.6-rc2 test was written, are recorded in
tests/v1.4.6-rc2/helpers.mjs and pinned by test 1. Any later edit requires
a new gate.
