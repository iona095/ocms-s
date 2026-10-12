# OpenCode Model Sync — Simple Script Contract v1.4.6-rc1

Additive contract over Contracts v1.2–v1.4.1. Where v1.4.6-rc1 does not
explicitly supersede behavior, v1.4.1 (and transitively v1.4/v1.3/v1.2)
remains binding. Contracts v1.0–v1.4.1 are unchanged and immutable.

Status: FROZEN. Freeze SHA-256 and line count recorded in §12.
Gate: OCMS-S v1.4.6-rc1 — GATEWAY BASE DERIVATION AND DOCUMENTED BASE
ALIASES (DESIGN → CONTRACT → TEST-FIRST → IMPLEMENTATION).
Baseline: released v1.4.5 plus the uncommitted R1 docs-URL repair
(SOURCE_URLS.goDocs/zenDocs → /v2/docs/console/{go,models}/) and the
uncommitted S5 profile work, both carried unchanged.
No release/tag authorized in this gate. Release candidate only.

## 1. Problem

The repaired Zen docs source (Console Models page, captured
2026-10-12) documents every Zen endpoint under

`https://opencode.ai/inference/v1/{responses,messages,chat/completions,models/{id},systemone}`

while endpointApi recognizes Zen endpoints only under `/zen/v1/`. All 88
captured Zen rows therefore throw ENDPOINT_UNSUPPORTED. Under frozen v1.4.1
§5 this has two observable effects, neither caused by a protocol change:

- S2: every row with a usable nested provider.npm hint resolves through the
  hint. The exact docs authority is silently discarded (concealment).
- U1: every row without a usable hint is classified UNSUPPORTED — including
  ordinary completions/messages/responses models — and Google-style rows
  leave the frozen v1.4 Google path (U2) for the new disposition.

The endpoint *suffixes* are unchanged and already recognized. Only the
documented *base* moved. The Go docs still document `/zen/go/v1/` and are
fully compatible (32/32).

Root cause: one hard-coded string per gateway serves two different jobs —
"which documented base identifies this gateway" and "which base OCMS-S
writes into the managed routes". The managed route baseURLs repeat that
same knowledge six more times.

## 2. Reference design

omp (oh-my-pi) resolves the same gateways with one base path per gateway
and derives every route URL from protocol:
`anthropic-messages → <base>`, every other managed API → `<base>/v1`.
OCMS-S adopts that derivation. OCMS-S keeps its stricter docs authority
(omp does not read docs); docs remain first authority for protocol
selection exactly as in v1.4.1.

## 3. R1 — Gateway base (single source)

- `GATEWAY_BASE` (exported, frozen) holds exactly one canonical base per
  gateway:
  - go: `https://opencode.ai/zen/go`
  - zen: `https://opencode.ai/zen`
- `routeBaseURL(gateway, api)` (exported) returns `GATEWAY_BASE[gateway]`
  for `anthropic-messages` and `GATEWAY_BASE[gateway] + '/v1'` for every
  other managed API.
- Every `MANAGED_ROUTES[route].baseURL` is derived through routeBaseURL.

Invariant I-EMIT: the six derived baseURL values are byte-identical to
v1.4.5. Emitted settings, managed route keys, apiKeyEnv values and route
transport configuration do not change in this gate. OCMS-S does NOT start
writing `/inference` anywhere.

## 4. R2 — Documented endpoint bases (closed, per gateway)

- `DOC_ENDPOINT_BASES` (exported, frozen) is a closed list of documented
  path bases per gateway. The first entry is the canonical base (the path
  of `routeBaseURL(gateway, non-messages API)` plus `/`); later entries
  are documented aliases:
  - go: [`/zen/go/v1/`]
  - zen: [`/zen/v1/`, `/inference/v1/`]
- endpointApi(endpoint, gateway, id) accepts a well-formed documented URL
  whose pathname starts with any base in DOC_ENDPOINT_BASES[gateway] and
  maps the remaining tail exactly as v1.4.1 (`chat/completions`,
  `messages`, `responses`, `models/{exact-id}` → unsupported-google;
  anything else → ENDPOINT_UNSUPPORTED). Host/protocol/port/userinfo/
  query/fragment validation is unchanged (ENDPOINT_INVALID).
- A path under no listed base for this gateway → ENDPOINT_UNSUPPORTED
  (unchanged semantics).

Invariant I-DISJOINT: no base listed for one gateway is a prefix of, or
equal to, any base listed for the other gateway. A Zen alias never makes
a Go row valid and vice versa (cross-gateway independence, v1.4 §5).

Invariant I-ALIAS-INERT: an alias affects recognition only. Placement
always selects a MANAGED_ROUTES entry, whose baseURL is derived from
GATEWAY_BASE (R1). A documented alias base is never written to settings.

Adding a future alias is a one-line, gate-reviewed change to
DOC_ENDPOINT_BASES; it is never inferred at runtime (no prefix guessing,
no "any `/v1/` path" acceptance).

## 5. R3 — Base drift is visible, never silent, never blocking

- `endpointBaseDrift({ rosters, docs })` (exported, pure) returns a sorted
  array of `{ gateway, documentedBase, routedBase, models }`:
  - one entry per (gateway, alias base) with at least one LIVE roster ID
    whose exact docs row is well-formed and starts with that alias base
    (any tail, recognized or not);
  - `documentedBase` = `https://opencode.ai` + alias base without trailing
    slash; `routedBase` = `routeBaseURL(gateway, 'openai-completions')`;
  - `models` = count of such live IDs;
  - sorted by gateway, then documentedBase. Docs-only IDs never count.
  - Never throws: malformed docs rows are skipped here (they BLOCK through
    the existing planner path, unchanged).
- buildPlan exposes `endpointBaseDrift` (additive). blockedPlan exposes
  `endpointBaseDrift: []`. syncFromSources and commitPlan propagate it
  through NO CHANGE and UPDATED outcomes. The UI Preview payload passes it
  through (additive; ui/index.html is NOT changed in this gate).
- formatReport renders a new section (binding, exact label) after
  `FREE_COUNTERPART_FALLBACK`:
  `ENDPOINT_BASE_DRIFT (n):` with one line per entry
  `  - <gateway> documented=<documentedBase> routed=<routedBase> models=<models>`
  or `  (none)`.
- Drift never blocks: plan.ok, Preview and Apply semantics are unchanged.

## 6. Frozen v1.4.1 rules (unchanged)

v1.4.1 §5 S0–S2, U1–U4, F1–F4 and §§6–11 are unchanged. The only change is
upstream of them: rows under a listed alias base now reach S1 / U1 / U2
exactly as rows under the canonical base did. Expected consequences on the
2026-10-12 captures (live roster IDs only):

- Zen `/inference/v1/{chat/completions,messages,responses}` → S1, docs
  authority restored (79 rows).
- Zen `/inference/v1/models/{id}` → U2, frozen v1.4 Google path restored
  (7 rows).
- Zen `/inference/v1/systemone` → unrecognized tail: U1 when no usable
  hint (SKIPPED_UNSUPPORTED_PROTOCOL, endpoint carries the documented URL),
  S2 when a usable hint exists (frozen; see §10).
- Go: unchanged (32/32 S1, no drift entry).

F4 still binds: implementation MUST NOT branch on `systemone`, `jev`,
`gemini`, `-free` or any model-ID substring.

## 7. Version metadata

- package.json version, package-lock.json root version and root package
  version: `1.4.6-rc1` (SemVer pre-release of 1.4.6, ordered after 1.4.5;
  `1.4.6.rc1` is not valid SemVer and is rejected by npm).
- dsh/client.mjs and the built dsh/client.js `PLUGIN_VERSION`:
  `1.4.6-rc1`.
- Existing gate tests that pin the release version to `1.4.5` are updated
  to `1.4.6-rc1` (metadata only; authorized here). The PLUGIN_VERSION
  format anchor (tests/v1.4/client-view.test.mjs) is widened to accept a
  SemVer pre-release suffix (metadata only; authorized here).
- The S5-R4 sync.mjs byte pin in tests/v1.4/compat.test.mjs is superseded
  by an RC1 pin over the final rc1 sync.mjs bytes (the S5-R4 pin was
  already invalidated by the uncommitted R1 docs-URL repair). The
  ui/index.html S5-R4 pin is unchanged and MUST stay green.

## 8. Tests (test-first, frozen identities)

tests/v1.4.6-rc1/ (node --test). Captured fixtures are copied read-only
into tests/v1.4.6-rc1/fixtures/ (no live network). Identities frozen:

1. contract freeze anchor intact
2. gateway-base-derivation: MANAGED_ROUTES baseURLs equal routeBaseURL and
   equal the six v1.4.5 literals (I-EMIT)
3. doc-bases-disjoint (I-DISJOINT)
4. zen-alias-recognized: `/inference/v1/{chat/completions,messages,
   responses}` map to the same API as `/zen/v1/...`
5. zen-alias-google: `/inference/v1/models/{id}` → unsupported-google
6. zen-alias-unknown-tail: `/inference/v1/<unknown>` → ENDPOINT_UNSUPPORTED
7. cross-gateway-rejection: Go rejects `/inference/v1/...` and
   `/zen/v1/...`; Zen rejects `/zen/go/v1/...`
8. no-prefix-guessing: `/other/v1/responses` → ENDPOINT_UNSUPPORTED for
   both gateways; malformed host still ENDPOINT_INVALID
9. docs-authority-restored: an alias completions row with a contrary
   anthropic hint places on the completions route (S1, hint ignored)
10. alias-inert-emission: a placed alias-documented model's route baseURL
    is the canonical derived base (no `/inference` in desired settings)
11. unknown-tail-no-hint-skipped under alias (U1 path, endpoint preserved)
12. drift-report: endpointBaseDrift counts live IDs only, aggregates per
    base, ignores docs-only rows and canonical rows, never throws on a
    malformed row
13. drift-propagation-and-report: buildPlan / syncFromSources expose the
    array; formatReport renders the exact section; drift never blocks
14. captured-fixture-matrix: on the 2026-10-12 captures, parseDocs + 
    endpointApi classify Go 32/32 managed and Zen 79 managed + 7 Google +
    2 unrecognized; zero ENDPOINT_UNSUPPORTED caused by base

All prior suites remain unmodified except the metadata pins named in §7.
Baseline failures present before this gate (environment-dependent default
path tests and the already-invalidated S5-R4 sync pin) are recorded in the
gate report and are not counted as regressions.

## 9. Implementation scope (smallest coherent change)

sync.mjs: GATEWAY_BASE, routeBaseURL, DOC_ENDPOINT_BASES, endpointApi base
loop, endpointBaseDrift, buildPlan/blockedPlan/syncFromSources/commitPlan
propagation, formatReport section, legacy CLI report call.
ui.mjs: Preview payload passthrough only.
Metadata: package.json (version + test script), package-lock.json,
dsh/client.mjs, dsh/client.js, version/pin tests named in §7.

Forbidden in this gate: writing `/inference` into settings, changing route
keys/apiKeyEnv/transport, roster or catalog URLs, live probes or inference,
ui/index.html, DSH lifecycle/host, Preview/Apply transaction semantics,
model-ID special-casing, changing v1.4.1 S2.

## 10. Known limitations (explicit future work)

- S2 concealment remains for genuinely unrecognized tails with a usable
  hint (frozen by v1.4.1 test 7). A future gate may make S2 visible or
  replace it with per-ID gateway-verified protocol pins (omp `api-routes`
  model).
- Whether `/zen/v1` is still served (alias of `/inference/v1`) is not
  verified here (no probes). The drift section makes the question visible;
  switching the canonical Zen base is a one-value GATEWAY_BASE change in a
  later gate after an authenticated probe.
- Roster fetches send neither an API key nor `x-opencode-session`. If the
  gateway enforces either on `/v1/models`, the run fails closed
  (FETCH_FAILED); out of scope here.

## 11. Contract challenge

| # | Attack | Answer | Result |
|---|--------|--------|--------|
| 1 | Alias written into settings | I-ALIAS-INERT + I-EMIT; tests 2, 10 | PASS |
| 2 | Zen alias accepted for Go | I-DISJOINT; tests 3, 7 | PASS |
| 3 | Any `/v1/` path accepted | closed list; test 8 | PASS |
| 4 | Drift hidden | R3 section + passthrough; tests 12, 13 | PASS |
| 5 | Drift blocks run | R3 non-blocking; test 13 | PASS |
| 6 | systemone routed as completions | tail map unchanged; U1; test 11 | PASS |
| 7 | Hint overrides restored docs | S1 precedence; test 9 | PASS |
| 8 | Model-ID branching | F4 unchanged; implementation review | PASS |

## 12. Freeze record

The SHA-256 (over exact file bytes) and line count of this file, as frozen
before any v1.4.6-rc1 test was written, are recorded in
tests/v1.4.6-rc1/helpers.mjs and pinned by test 1. Any later edit requires
a new gate.
