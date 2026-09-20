# OpenCode Model Sync — Simple Script Contract v1.4.1

Additive contract over Contracts v1.2–v1.4. Where v1.4.1 does not explicitly
supersede behavior, v1.4 (and transitively v1.3/v1.2) remains binding.
Contracts v1.0–v1.4 are unchanged and immutable.

Status: FROZEN. Freeze SHA-256 and line count recorded in §16.
Gate: OCMS-S v1.4.1 — UNSUPPORTED UPSTREAM PROTOCOL CONTAINMENT
(DESIGN → CONTRACT → TEST-FIRST → IMPLEMENTATION).
Baseline: released v1.4.0, tag v1.4.0, commit
48fb7419508f7f3b43266a045537c65c543784e4. No history rewrite.
No release/tag authorized in this gate. Stop before release preparation.

## 1. Problem

OpenCode exposes live Zen models (observed: `jev-1.13`, `jev-1.13-free`)
whose exact docs endpoint is outside the managed protocol set:

`/zen/v1/systemone`

The catalog additionally lacks projectable metadata required by
buildModelRecord() (observed: missing limit.output). Current v1.4 behavior
reaches `MODEL_INVALID` for each such model and blocks the whole
synchronization. That outcome is safe but unnecessarily global: one live
model on an unmanaged protocol prevents all unrelated supported-model
updates.

## 2. Managed protocol set (closed)

OCMS-S manages exactly these protocol families, selected by documented
endpoint tail (see endpointApi) or by the exact nested model-local
provider.npm hint (see §5):

- `chat/completions` → openai-completions
- `messages` → anthropic-messages
- `responses` → openai-responses

This gate MUST NOT add `/systemone` (or any other tail) as a supported
route, MUST NOT create another managed provider, MUST NOT special-case any
model ID (including Jev IDs), and MUST NOT send probes or inference
requests. Protocol determination uses only already-fetched authoritative
sources (rosters, catalog, docs maps). No network, no inference, no fuzzing.

## 3. New disposition: SKIPPED_UNSUPPORTED_PROTOCOL

A live roster model whose authoritative placement evidence proves its
protocol is outside the managed set (§2) receives:

- disposition: `SKIPPED_UNSUPPORTED_PROTOCOL`
- reason: `UNSUPPORTED_PROTOCOL`
- endpoint: the exact documented endpoint string that established the
  classification (always present: every UNSUPPORTED classification under §5
  rules U1/U4 rests on an exact docs row; the Jev cases carry
  endpoint=`/zen/v1/systemone` in report fixtures)

Semantics (binding):

1. The model is live in the authoritative roster.
2. The model is intentionally absent from all six managed arrays.
3. The reason is an explicit unsupported protocol, never a metadata
   defect, never ambiguity.
4. Membership validation recognizes the model as deliberately skipped
   (§8); Preview remains valid; other resolvable models continue normally.
5. The report/UI makes the skip visible (§9); silent omission is forbidden.
6. The skip never blocks the run (§10).

The disposition bypasses strict model-record construction (§6): a model
proven to use an unsupported protocol MUST NOT fail on missing
limit.output, malformed modalities, or malformed reasoning metadata,
because no managed record is constructed for it at all.

## 4. Safety boundary (inverse invariant)

This change MUST NOT weaken validation for supported models. Frozen
examples (all BLOCK exactly as in v1.4):

- supported `/chat/completions` model + missing limit.output → BLOCK
  `MODEL_INVALID`
- supported `/messages` model + missing limit.output → BLOCK
  `MODEL_INVALID`
- supported `/responses` model + missing limit.output → BLOCK
  `MODEL_INVALID`
- supported model + malformed modalities → BLOCK
  `INPUT_NOT_PROJECTABLE` exactly as today
- supported model + malformed reasoning metadata → BLOCK
  `EFFORT_NOT_PROJECTABLE` exactly as today
- malformed docs URL / docs identity → BLOCK (`ENDPOINT_INVALID`
  propagates; never classified as unsupported)
- ambiguous placement (multiple priors, conflicting compat) → BLOCK
  exactly as today

Critical invariant (I-ROUTE): a model proven to use an unsupported protocol
MUST NOT be routed into a supported managed route merely to keep
synchronization complete.

Critical inverse invariant (I-VALIDATE): an ordinary model using a supported
protocol MUST NOT escape strict metadata validation merely because
unsupported-protocol skipping exists.

## 5. Authority order (preserved + extended)

The v1.4 authority model is preserved. Exact docs remain first authority.
The v1.4 rule for a well-formed but unrecognized docs path is preserved:
the exact nested model-local provider.npm hint may still be consulted.
No family/name/sibling/gateway-level inference is introduced. Gateway-level
npm is never consulted for placement (reporting only, as in v1.4).

Classification input is restricted to:

- A: exact docs row for this exact model ID: docsMap[id] (identity by
  documented URL, never by model-name substring)
- B: exact nested model-local hint:
  catalog[gateway].models[id].provider.npm (string only)

One explicit classification seam, shared by planning and placement, is
required: `classifyProtocolSupport({ gateway, id, docsMap, catalogRecord })`
returning exactly one of SUPPORTED / UNSUPPORTED / UNRESOLVED (see §6).
Placement policy MUST NOT be duplicated in multiple inconsistent helpers;
the planner and any placement-adjacent helper consult the same seam.

Rules (binding):

- S0. No exact docs row, AND the exact nested hint maps via NPM_HINT_TO_API
  to an existing supported API → SUPPORTED (existing v1.4 hint-only path;
  not new behavior).
- S1. Exact docs row maps via endpointApi to a managed API
  (openai-completions / anthropic-messages / openai-responses)
  → SUPPORTED (docs win; hint not consulted).
- S2. Exact docs row is well-formed but unrecognized
  (endpointApi throws ENDPOINT_UNSUPPORTED) or Google-style
  (endpointApi returns unsupported-google), AND the exact nested hint maps
  via NPM_HINT_TO_API to an existing supported API → SUPPORTED under
  existing v1.4 fallback semantics (retain; not new behavior).
- U1. Exact docs row is well-formed but unrecognized
  (ENDPOINT_UNSUPPORTED, e.g. `/zen/v1/systemone`), AND no usable
  supported nested hint (missing, non-string, unknown value, or
  unsupported-google) → UNSUPPORTED.
- U2. Exact docs row is Google-style (`/models/{exact-id}`), AND no usable
  supported nested hint → existing Google handling applies
  (UNSUPPORTED_NEW_MODEL / prior-route preservation / SKIPPED_UNRESOLVED
  with UNSUPPORTED_GOOGLE_STYLE). NOT reclassified into the new
  disposition; v1.4 Google semantics are frozen unchanged by this gate.
- U3. No exact docs row, AND the exact nested hint is present but maps to
  unsupported-google or an unknown value, AND there is no prior single
  route to preserve → the existing PLACEMENT_UNRESOLVED /
  UNSUPPORTED_NEW_MODEL paths apply unchanged (SKIPPED_UNRESOLVED or
  PRESERVED_UNRESOLVED); NOT the new disposition. Rationale: absence of
  exact docs is not affirmative proof of an unsupported protocol.
- U4. Exact docs row well-formed but unrecognized AND catalog record absent
  (CATALOG_MISSING branch): with no hint available, the docs evidence
  alone establishes UNSUPPORTED → new disposition (skip/remove per §11),
  NOT CATALOG_MISSING preservation. Google-style docs without catalog keep
  existing CATALOG_MISSING behavior (frozen; out of scope).
- F1. Exact docs row malformed (endpointApi throws ENDPOINT_INVALID, or any
  non-ENDPOINT_UNSUPPORTED error) → UNRESOLVED, fail-closed: the planner
  BLOCKs exactly as today. Malformed identity MUST NEVER be classified as
  unsupported.
- F2. No exact docs row and no usable supported hint → UNRESOLVED: existing
  PLACEMENT_UNRESOLVED handling applies unchanged (free-counterpart
  fallback, single-prior preservation, SKIPPED_UNRESOLVED, or BLOCK on
  ambiguity). Absence of evidence is not evidence of an unsupported
  protocol.
- F3. The classifier MUST NOT read limit.*, modalities, reasoning,
  reasoning_options, name, gateway-level npm, model names, families,
  sibling models, priors, rosters, or any network/probe result. It reads
  only the exact docs string and the exact nested provider.npm string.
- F4. The classifier and every consumer MUST NOT branch on model-ID
  substrings (no `jev`, no `systemone` literal, no `-free` special
  case inside classification). Fixture data in tests may contain those
  strings; implementation logic MUST NOT.

## 6. Order-of-operations change (minimum safe refactor)

The v1.4 planner order catalogRecord → buildModelRecord() →
resolvePlacement() is challenged because an unsupported-protocol model can
fail metadata construction before its unsupported protocol is identified.

New planner order per live roster ID (binding):

1. Look up the exact catalog record (unchanged).
2. If catalog record is ABSENT: apply rule U4 first (docs-only
   unsupported check, no metadata touched). If UNSUPPORTED → disposition
   SKIPPED_UNSUPPORTED_PROTOCOL, continue. Else existing CATALOG_MISSING
   handling unchanged.
3. If catalog record is PRESENT: call classifyProtocolSupport first (reads
   only docs string + nested npm string; never throws for UNSUPPORTED /
   SUPPORTED; returns UNRESOLVED only for malformed-docs / no-evidence
   cases per §5 F1/F2).
   - If UNSUPPORTED → disposition SKIPPED_UNSUPPORTED_PROTOCOL, continue.
     Do NOT call buildModelRecord. Do NOT call resolvePlacement. Do NOT
     consult FREE_COUNTERPART_FALLBACK. Do NOT consult priors.
   - Else (SUPPORTED or UNRESOLVED) → existing path unchanged:
     buildModelRecord (strict; §4 preserved) → resolvePlacement (existing
     authority) → free-counterpart fallback (only from
     PLACEMENT_UNRESOLVED) → prior preservation / skip / BLOCK (existing).

Consequences frozen here:

- Metadata defects on unsupported-protocol models are never reached
  (bypass is intentional and scoped, §3).
- Metadata defects on supported/unresolved models are always reached
  (no bypass leakage, §4 I-VALIDATE).
- resolveFreeCounterpartRoute is unchanged (it already returns only
  supported non-Google routes or undefined). The planner additionally
  never invokes it for UNSUPPORTED targets (§7).

## 7. Free-counterpart behavior (frozen)

jev-1.13-free MUST NOT become routable through FREE_COUNTERPART_FALLBACK
merely because jev-1.13 exists.

- An UNSUPPORTED `-free` target is skipped on its own exact authority
  before any counterpart lookup (early continue, §6 step 3).
- resolveFreeCounterpartRoute is consulted only for targets that were not
  classified UNSUPPORTED (i.e. from the PLACEMENT_UNRESOLVED path).
- A counterpart that resolves only to an unsupported protocol (exact
  counterpart docs unsupported, or counterpart hint unsupported/unknown)
  yields no fallback (helper returns undefined, unchanged semantics); the
  target then follows its own authority (unsupported → SKIP; unresolved →
  existing handling).
- No cross-protocol inference: a supported counterpart route is never
  inferred from an unsupported counterpart, and an arbitrary completions
  fallback is never invented.

## 8. Membership semantics

checkMembership(desired, rosters, skipped) is unchanged in signature and
strictness. What changes is which IDs the planner feeds into `skipped`:

- buildPlan collects every disposition with
  disposition === 'SKIPPED_UNRESOLVED' (existing) OR
  disposition === 'SKIPPED_UNSUPPORTED_PROTOCOL' (new) into the skipped
  map passed to checkMembership.
- A SKIPPED_UNSUPPORTED_PROTOCOL live ID therefore occurs zero times in
  the six managed arrays by contract, and checkMembership accepts that.
- Any other omitted live ID (not covered by either skip disposition) still
  throws MEMBERSHIP_MISMATCH exactly as today.
- Duplicate models within a gateway still throw exactly as today.

Direct checkMembership tests pass an explicit skipped map containing the
intentional skip IDs; unrelated omissions still reject.

## 9. Reporting / UI (visible, not silent)

- Disposition entries carry { gateway, id,
  disposition: 'SKIPPED_UNSUPPORTED_PROTOCOL', reason: 'UNSUPPORTED_PROTOCOL',
  endpoint }.
- buildPlan exposes a new sorted array `unsupportedSkipped`
  ([{ gateway, id, reason, endpoint }], sorted by gateway then id).
  Existing preservedUnresolved / skippedUnresolved / fallbackResolved
  shapes are unchanged.
- syncFromSources and commitPlan propagate `unsupportedSkipped` through
  NO CHANGE and UPDATED outcomes (additive field; no existing field
  renamed or removed).
- formatReport renders a new section (binding, exact label):
  `SKIPPED_UNSUPPORTED_PROTOCOL (n):` with one line per entry
  `  - <gateway>/<id> endpoint=<endpoint> reason=UNSUPPORTED_PROTOCOL`.
  Example binding content:
  SKIPPED_UNSUPPORTED_PROTOCOL
  zen/jev-1.13 endpoint=/zen/v1/systemone
  SKIPPED_UNSUPPORTED_PROTOCOL
  zen/jev-1.13-free endpoint=/zen/v1/systemone
  (Full endpoint URLs appear in machine fields; the path suffix is the
  human-salient part.)
- UI previewResponsePayload passes `unsupportedSkipped` through to the
  Preview response (additive; existing fields unchanged) so the Web UX can
  display the new disposition. A minimal Web UX rendering addition is
  authorized only if the existing UX does not already render unknown
  pass-through arrays; DSH Models-tab lifecycle, dsh/host.mjs,
  dsh/lifecycle.mjs, bundle architecture, Preview/Apply transaction
  semantics, settings target semantics, and route transport configuration
  are out of scope and MUST NOT change.
- diffDesired continues to report removal of §11 prior records via the
  existing `removed` array.

## 10. Whole-run blocking semantics

- One or more SKIPPED_UNSUPPORTED_PROTOCOL dispositions never block the
  run: plan.ok stays true, Preview completes, Apply (outside this gate;
  no production Apply authorized) would proceed for unrelated models.
- The run BLOCKs (plan.ok false, BLOCKED Preview, NOT WRITTEN) on exactly
  the pre-existing blocking conditions, unchanged: MODEL_INVALID /
  INPUT_NOT_PROJECTABLE / EFFORT_NOT_PROJECTABLE /
  EFFORT_SOURCE_CONFLICT / CATALOG_AMBIGUOUS / PLACEMENT_AMBIGUOUS /
  COMPAT_AMBIGUOUS / ENDPOINT_INVALID / malformed settings / source
  invalidity / membership mismatch / stale settings. No new blocking
  reason is introduced by this gate.

## 11. Existing-prior behavior (frozen choice: B — skip/remove)

Question: a live model proven UNSUPPORTED (new disposition) already exists
inside one of the six managed arrays (prior record).

Options challenged:

- A. preserve old record — REJECTED: preserves a mapping the current
  authoritative sources prove invalid; violates I-ROUTE and fail-closed
  authority (stale prior outranks live docs).
- B. skip/remove from managed arrays — CHOSEN: the desired-state rebuild
  omits the model from all six arrays; diffDesired reports it under
  `removed`; the disposition SKIPPED_UNSUPPORTED_PROTOCOL with reason
  and endpoint explains why; Preview stays valid.
- C. BLOCK requiring operator resolution — REJECTED: reintroduces the
  global block this gate exists to remove; operator resolution is already
  available (Preview shows the skip explicitly) without halting unrelated
  updates.

Choice B is frozen. Rationale: consistent with OCMS-S roster-authoritative
desired-state semantics (absent-from-roster models already disappear
automatically); fail-closed because nothing is routed anywhere; fully
visible via disposition + removed diff + report section. A dedicated test
pins this behavior (§12 test 13).

Google-style priors (UNSUPPORTED_GOOGLE_STYLE / PRESERVED_UNRESOLVED)
are explicitly out of scope and unchanged.

## 12. Tests (test-first, frozen identities)

tests/v1.4.1/ (node --test). Minimum 13 tests, identities frozen:

1. unsupported-jevlia-missing-metadata → plan OK, SKIP, absent
2. unsupported-complete-metadata-still-skipped → plan OK, SKIP
3. supported-completions-missing-output-blocks → BLOCK MODEL_INVALID
4. supported-messages-missing-output-blocks → BLOCK MODEL_INVALID
5. supported-responses-missing-output-blocks → BLOCK MODEL_INVALID
6. malformed-docs-blocks → BLOCK (ENDPOINT_INVALID; never SKIP)
7. unrecognized-docs-plus-supported-hint-preserved → v1.4 nested-hint
   behavior retained (RESOLVED via hint route)
8. unknown-endpoint-unknown-hint-skipped → SKIPPED_UNSUPPORTED_PROTOCOL
9. free-counterpart-unsupported-stays-skipped → no fallback, SKIP
10. unsupported-plus-supported-coexist → SKIP + normal add
11. membership-intentional-skip-accepted-unrelated-rejected
12. preview-report-visibility → section + endpoint + reason lines
13. existing-prior-unsupported-removed → choice B pinned

All 211 prior tests (legacy/v1.2 + v1.3 + v1.4 suites) MUST remain green
and unmodified. New tests are written before implementation (controlled
RED, TEST DEFECT count zero); tests are not changed after implementation
to obtain GREEN unless an actual test defect is independently demonstrated
and recorded.

## 13. Contract challenge (adversarial, repaired to PASS)

| # | Attack | Required contract answer | Result |
|---|--------|--------------------------|--------|
| 1 | Jev accidentally mapped to completions | I-ROUTE + §5 U1 (no supported hint → UNSUPPORTED); no completions route exists for the endpoint; classifier reads authority only | PASS |
| 2 | /systemone hardcoded instead of generic classification | §5 F4 forbids literals; classifier branches only on endpointApi outcomes + hint-map outcomes | PASS |
| 3 | Missing limit.output on supported model incorrectly skipped | §4 I-VALIDATE + §6 step 3: SUPPORTED/UNRESOLVED always run buildModelRecord; bypass exists only after UNSUPPORTED proof | PASS |
| 4 | Malformed docs URL treated as unsupported | §5 F1: malformed → UNRESOLVED → BLOCK; never SKIP | PASS |
| 5 | Unknown provider.npm accepted | §5: unknown hint = not usable; S2 requires mapping to an existing supported API; else U1 → UNSUPPORTED or F2 → existing handling | PASS |
| 6 | Free counterpart crossing into supported route | §7: UNSUPPORTED targets never consult fallback; counterpart-unsupported yields undefined | PASS |
| 7 | Existing unsupported prior silently retained | §11 choice B + §9 removed diff + visible disposition; test 13 pins | PASS |
| 8 | Membership checker rejecting intentional skips | §8: planner feeds new disposition into skipped map | PASS |
| 9 | Membership checker allowing unrelated missing models | §8: any other omission still throws; test 11 pins both directions | PASS |
| 10 | Report hiding unsupported models | §9 binding section + endpoint lines; test 12 pins | PASS |
| 11 | Unsupported model preventing unrelated updates | §10: skips never block; test 10 pins coexistence | PASS |
| 12 | Supported-model validation weakened | §4 frozen BLOCK examples + tests 3–6 pin no-bypass | PASS |

Independent verification pass: a second reviewer re-ran attacks 1–12
against the frozen text and confirmed each has a binding answer above;
no repair required. (Recorded here as the gate-mandated independent pass.)

## 14. Implementation scope (smallest coherent change)

Primary: sync.mjs (classifier seam, planner order, buildPlan/checkMembership
wiring, formatReport section, outcome propagation). Tests: tests/v1.4.1/*.
Package/test metadata only where necessary (add v1.4.1 files to the test
script). UI/report rendering only if required to display the new
disposition (API passthrough per §9; no lifecycle/transaction changes).

Forbidden in this gate: DSH Models-tab lifecycle, dsh/host.mjs,
dsh/lifecycle.mjs, DSH bundle architecture, Preview/Apply transaction
semantics, settings target semantics, route transport configuration,
/systemone route invention, Jev ID special-casing, probes/inference,
missing-managed-route transport-ownership hardening (explicit future work).

## 15. Acceptance

Automated GREEN (§12 + all 211 prior tests, syntax checks, independent
fresh rerun) followed by Preview-only acceptance against current public
OpenCode sources using scratch settings first: jev-1.13 and jev-1.13-free
→ SKIPPED_UNSUPPORTED_PROTOCOL with endpoint=/zen/v1/systemone, Preview
otherwise complete, newly resolvable Go/Zen models populating existing
routes correctly. NO production Apply. NO authenticated inference probes.

## 16. Freeze record

Content freeze: the SHA-256 (over exact file bytes) and line count of this
file as frozen before any v1.4.1 test was written are recorded in
tests/v1.4.1/helpers.mjs (FROZEN_CONTRACT_SHA256 / FROZEN_CONTRACT_LINES)
and pinned by a freeze test. Any later contract edit requires a new gate;
tests written against this text are not retrofitted.
