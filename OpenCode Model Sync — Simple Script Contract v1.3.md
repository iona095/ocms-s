# OpenCode Model Sync — Simple Script Contract v1.3

**Task ID:** OCMS-S1.3
**Folder:** `C:\Users\GNV\.dsh\tools\ocms-s`
**Engine (unchanged authority):** `C:\Users\GNV\.dsh\tools\ocms-s\sync.mjs`
**Server/adapter (new, future):** `C:\Users\GNV\.dsh\tools\ocms-s\ui.mjs`
**Page (new, future):** `C:\Users\GNV\.dsh\tools\ocms-s\ui\index.html`
**Contract:** `C:\Users\GNV\.dsh\tools\ocms-s\OpenCode Model Sync — Simple Script Contract v1.3.md`

This project is independent from:

`C:\Users\GNV\.dsh\tools\opencode-model-sync`

The separate v5.6 DSH-plugin project remains unchanged and is not superseded by this contract.

The physical authoritative v1.3 contract is the long-name file above. Audit and execution prompts may refer to that file logically as `CONTRACT.v1.3.md`; that logical name does not require a second file to exist.

## RFC-2119 keywords

In this contract `MUST`, `MUST NOT`, `REQUIRED`, `SHALL`, `SHALL NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` are binding as in RFC 2119. An implementation gate fails on any `MUST`/`MUST NOT` violation.

---

## 1. Status / authority / relationship to v1.2

1.1. This contract specifies **OCMS-S v1.3.0 — Local Web UX**: a local browser presentation and authorization layer over the existing OCMS-S synchronization engine. It is a **design/specification contract only**; it authorizes no runtime change by itself.

1.2. Core principle:

> The UI is a presentation and authorization layer over the existing OCMS-S synchronization engine. It must never become a second implementation of synchronization semantics.

1.3. The currently released authority for all synchronization semantics is:

`OpenCode Model Sync — Simple Script Contract v1.2.md`

SHA-256:

```text
cd64d95cb1fa3aef074195a254de172a955952a1c40ced8a58035b32b73c55bf
```

1.4. **All v1.2 synchronization semantics remain binding** unless this v1.3 contract explicitly supersedes a named rule. v1.3 explicitly supersedes **no** v1.2 planning, classification, normalization, preservation, transaction, or reporting rule. Every v1.2 rule cited in §4 below applies to Preview and Apply exactly as it applies to the CLI.

1.5. Where this contract restates a v1.2 rule for UI purposes, the v1.2 wording remains authoritative for the underlying semantics; if any restatement conflicts with v1.2, v1.2 wins for engine behavior and the conflict MUST be repaired in a later contract revision before implementation.

1.6. v1.3 is purely additive: it adds Preview (§9), preview identity (§10), Apply authorization (§11), a loopback HTTP server and one self-contained page (§§5, 13–15, 19). It MUST NOT change what the engine considers correct synchronization.

---

## 2. Scope

2.1. In scope for a future implementation gate (not this gate):

```text
ui.mjs                       loopback HTTP server + API adapter, Node built-ins preferred
ui/index.html                one self-contained page (embedded CSS/JS, no remote resources)
tests/ui.test.mjs            additive server/UI tests using scratch targets only
Preview                      plan-without-write engine boundary over the existing planner
Apply(previewId)             authorized commit of exactly the retained previewed plan
production/scratch badge     unambiguous target classification in UI and confirmation
```

2.2. The v1.3 contract MUST be sufficiently complete that an implementation agent cannot invent UI-specific synchronization behavior: every question of what is correct synchronization MUST resolve to v1.2 or to an explicit v1.3 rule below.

---

## 3. Non-goals

3.1. v1.3 MUST NOT add any of the following. This list is exhaustive for gate purposes; absence of an item here does not authorize it if it conflicts with another section:

```text
account switching
API-key management
quota display
scheduler
automatic synchronization
periodic polling
background daemon
Windows service
tray application
authenticated provider probes
model inference
model editor
raw YAML editor
manual route assignment
drag/drop placement
GoRouter integration
opencode-model-sync integration
automatic fallback beyond the v1.2 contract
remote network access to the UI
```

3.2. In particular: no polling, no background refresh, no hidden retry loop, no auto-sync on page load, no daemonization, no remote access, no credential handling, and no editing surface beyond the Refresh Preview / Apply authorization flow defined below.

---

## 4. Existing synchronization semantics

4.1. Preview and Apply MUST use the v1.2 engine semantics without reimplementation. The binding v1.2 rules include, at minimum:

```text
five public sources and their roles (§3 v1.2: Go roster, Zen roster, catalog, Go docs, Zen docs)
whole-source failure → NOT WRITTEN (empty/duplicate/malformed rosters; missing/malformed/empty catalog structures; unparsable docs tables)
model-local gaps → CATALOG_MISSING / PLACEMENT_UNRESOLVED handling under §9 v1.2, never guessed
authority order: rosters for membership; exact catalog record for metadata; exact docs row → exact nested provider.npm → exact terminal -free same-gateway counterpart (placement only) for placement
docs win over nested hint; prohibited placement inference stays prohibited
Google-style handling (§7 v1.2: unique existing → PRESERVED_UNRESOLVED; new → SKIPPED_UNRESOLVED; ambiguous → NOT WRITTEN)
input-modality allowlist projection; blocking normalization failures stay blocking (never reinterpreted as §9 gaps)
reasoning normalization (reasoning:false → reasoningEfforts:false; effort mapping; none → off:none; unsupported effort → NOT WRITTEN)
compat preservation/selection (§13 v1.2), including the CATALOG_MISSING opaque-record exception
complete six-array rebuild from final dispositions; membership invariant (roster minus SKIPPED_UNRESOLVED; each non-skipped ID exactly once per gateway; arrays sorted by exact model ID)
NO CHANGE rule: all six current arrays deep-equal (cardinality, order, complete records incl. compat) to desired arrays; NO CHANGE coexists with nonzero unresolved/fallback reporting and creates no backup
transaction (§15 v1.2): exact-byte timestamped backup → temp YAML → re-read + parse → verify six arrays → replace; any pre-write/temp validation failure → NOT WRITTEN with original intact
target container llm-pi-ai.providers and the six managed arrays; no root-level providers mapping
output dispositions UPDATED / NO CHANGE / NOT WRITTEN with full per-model unresolved and FREE_COUNTERPART_FALLBACK reporting (§17 v1.2)
```

4.2. Browser JavaScript MUST NOT reproduce, approximate, or second-guess any rule in §4.1 (see §19.5).

---

## 5. Architecture

5.1. Target architecture:

```text
                 ┌──────────────────────┐
                 │      Browser UI      │
                 │ HTML/CSS/vanilla JS  │
                 └──────────┬───────────┘
                            │ localhost HTTP
                            ▼
                 ┌──────────────────────┐
                 │       ui.mjs         │
                 │ server/API adapter   │
                 └──────────┬───────────┘
                            │
                            ▼
                 ┌──────────────────────┐
                 │ existing sync engine │
                 │ authoritative logic  │
                 └──────────┬───────────┘
                            │
                            ▼
                  settings.yaml transaction
```

5.2. Expected eventual file structure:

```text
ocms-s/
├── sync.mjs
├── ui.mjs
├── ui/
│   └── index.html
├── tests/
│   ├── sync.test.mjs
│   └── ui.test.mjs
└── ...
```

5.3. Implementation preferences, binding unless a later implementation gate proves necessity:

```text
Node built-ins for the HTTP server
no frontend framework
no frontend build system
no CDN
no remote fonts/scripts/styles
no new dependency unless an implementation gate later proves one necessary
one self-contained HTML file with embedded CSS/JS for v1.3
```

5.4. The contract MUST NOT be read as requiring any dependency or framework. A future implementation MUST justify any new dependency as necessary, not merely convenient.

5.5. Engine refactor boundary (binding behavior, not function names): the implementation gate MAY extract a plan-without-write boundary from `sync.mjs` so that Preview and the CLI planner share one code path:

```text
acquire/parse sources
      ↓
plan
      ↓
PlanResult
      ├── preview only
      └── apply exact plan
```

The CLI MUST continue using the same engine. Planning code MUST NOT be duplicated into `ui.mjs`. Internal function renames are permitted only as necessary to expose this boundary.

5.6. Importing `ui.mjs` MUST NOT start the server, fetch sources, plan, or write settings — mirroring the v1.2 rule that importing `sync.mjs` performs no synchronization.

---

## 6. CLI compatibility

6.1. The existing CLI:

```powershell
node sync.mjs
```

MUST remain fully supported with unchanged v1.2 semantics. The HTML UX is additive.

6.2. Expected new launch command:

```powershell
node ui.mjs
```

Scratch target:

```powershell
node ui.mjs --settings=C:\Temp\ocms-test\settings.yaml
```

6.3. Supported flags: `--settings=<path>`, `--port=<port>`, `--no-open`. Unknown flags MUST cause an immediate usage error and nonzero exit, never silent startup with assumed defaults.

6.4. The UI launch path MUST use the same target-resolution semantics as the CLI (see §7). The browser MUST never supply, influence, or override the settings path.

---

## 7. UI launch / target selection

7.1. The target path is selected **only at server process launch**:

```text
default:
    %USERPROFILE%\.dsh\settings.yaml
    (derived exactly as the CLI resolves it)

explicit:
    --settings=<path>
    (solely for intentionally supplied scratch/test/audit files)
```

7.2. Ambient `HOME` and `OCMS_SETTINGS` MUST NOT redirect the default production target — identical to the CLI rule.

7.3. The browser MUST never be allowed to supply an arbitrary settings path through a query string, POST body, form field, header, or JavaScript request. The server MUST NOT read any request field as a filesystem path. Any path-like value received from the browser MUST be ignored for target selection (it MAY be rejected as a bad request, but MUST NOT be honored).

7.4. Server defaults (fixed by this contract so Host/Origin validation is deterministic):

```text
bind:            127.0.0.1 (literal; see §14.1)
default port:    18751
--port=<port>:   explicit override; invalid/non-numeric/out-of-range → usage error + nonzero exit
```

If the desired port is unavailable, the server MUST fail clearly with a nonzero exit and MUST NOT silently bind elsewhere or fall back to another interface or port.

7.5. On launch the server MUST print to stdout: the loopback URL, the resolved target path, and the PRODUCTION/SCRATCH classification. It MUST NOT print the per-process token (§15.2).

7.6. `node ui.mjs` MAY attempt to open the system browser to the printed URL; `--no-open` (or equivalent) MUST suppress it. Browser automation MUST NOT be contract-critical: the server MUST remain fully functional when the user opens the URL manually.

---

## 8. UI states

8.1. The UI has exactly these conceptual states:

```text
IDLE
READY
NO_CHANGE
BLOCKED
APPLYING
UPDATED
ERROR
```

8.2. Semantics:

- **IDLE.** No synchronization preview is held by this page. Opening or reloading the page MUST land in IDLE. No public OpenCode synchronization sources need to have been fetched merely because the page opened (see §8.4 — none MUST have been fetched).
- **READY.** A valid preview exists and applying that preview would produce an update.
- **NO_CHANGE.** A valid preview exists and the six managed arrays already match the desired state. Apply MUST NOT manufacture a write in this state: the Apply control MUST be disabled or absent, and the server MUST refuse Apply for a NO_CHANGE preview (see §11.4).
- **BLOCKED.** Planning encountered a contract-level refusal condition corresponding to `NOT WRITTEN`. No Apply is possible: the Apply control MUST be disabled or absent, the exact safe reason MUST be shown, no backup MUST be created, the target MUST NOT be mutated, and the browser MUST NOT be offered a bypass.
- **APPLYING.** An explicitly authorized Apply transaction is currently running. The UI MUST prevent duplicate concurrent Apply requests (disable controls while APPLYING).
- **UPDATED.** The previously authorized plan was safely committed.
- **ERROR.** A UI/server transport or unexpected internal failure occurred outside the normal contract dispositions. `ERROR` MUST NOT be confused with a planner-generated `BLOCKED / NOT WRITTEN`.

8.3. Binding state transitions:

```text
IDLE --Refresh Preview--> READY | NO_CHANGE | BLOCKED | ERROR
READY --Refresh Preview--> READY | NO_CHANGE | BLOCKED | ERROR   (old preview invalidated)
READY --Apply(confirmed)--> APPLYING
NO_CHANGE --Refresh Preview--> READY | NO_CHANGE | BLOCKED | ERROR
BLOCKED --Refresh Preview--> READY | NO_CHANGE | BLOCKED | ERROR
APPLYING --success--> UPDATED
APPLYING --STALE_PREVIEW--> IDLE + "Refresh Preview" notice      (preview consumed/invalid)
APPLYING --transport/internal failure--> ERROR                    (original preserved per §17)
UPDATED --Refresh Preview--> READY | NO_CHANGE | BLOCKED | ERROR
ERROR --Refresh Preview--> READY | NO_CHANGE | BLOCKED | ERROR
any --page reload--> IDLE                                        (page holds no previewId)
```

STALE_PREVIEW (§11.5) never triggers an Apply and never silently regenerates a plan.

8.4. No automatic live synchronization activity: opening or refreshing the HTML page MUST NOT automatically fetch OpenCode rosters, fetch the catalog, fetch OpenCode documentation, plan synchronization, or write settings. Live source acquisition occurs ONLY after the explicit user action `Refresh Preview`. There MUST be no interval polling, no background refresh, and no hidden retry loop. A BLOCKED plan MUST NOT be silently retried.

---

## 9. Preview semantics

9.1. Preview is a first-class engine concept with a real architectural separation (exact internal function names are an implementation detail):

```text
read target settings
      +
fetch five public sources
      ↓
validate source structures
      ↓
build desired state
      ↓
classify models
      ↓
calculate exact proposed changes
      ↓
NO WRITE
      ↓
return preview object
```

9.2. Preview MUST execute the same authoritative source parsing, catalog normalization, placement logic, unresolved handling, `compat` rules, desired-array construction, and membership validation that Apply uses. Preview and Apply MUST share the planner code path (§5.5); any divergence is a contract violation.

9.3. Preview MUST perform zero writes: no settings write, no backup file, no temp file in the target directory, and no mutation of any existing file. (NO_CHANGE and BLOCKED previews create no backup — trivially, since no preview creates anything on disk.)

9.4. Preview response schema. Exact field naming MAY be refined by the implementation gate with justification, but the response MUST contain at least:

```js
{
  state: "READY",           // READY | NO_CHANGE | BLOCKED

  target: {
    displayPath: "...",     // server-resolved target path, display form
    production: true         // true = PRODUCTION, false = SCRATCH
  },

  sources: {
    goRoster: { ok: true, count: 0 },
    zenRoster: { ok: true, count: 0 },
    catalog: { ok: true },
    goDocs: { ok: true },
    zenDocs: { ok: true }
  },

  changes: {
    added: [],              // { gateway, id, route }
    removed: [],            // { gateway, id, route } (stale entries the plan would delete)
    moved: [],              // { gateway, id, oldRoute, newRoute }
    metadataChanged: []     // { gateway, id, route }
  },

  preservedUnresolved: [],  // { gateway, id, reason, route }
  skippedUnresolved: [],    // { gateway, id, reason }
  fallbackResolved: [],     // { gateway, id, counterpartId, route, provenance: "FREE_COUNTERPART_FALLBACK" }

  previewId: "...",         // opaque; server-generated (see §10)
  generatedAt: "..."        // ISO-8601 server timestamp
}
```

Change classification is computed server-side by comparing the six current managed arrays with the six desired arrays, keyed by exact `(gateway, id)`: **added** (in desired, absent in current), **removed** (in current, absent in desired), **moved** (present in both, different route), **metadataChanged** (same route, record value differs by deep comparison). Counts are array lengths; counts MUST NOT replace item lists.

9.5. Data minimization: the browser MUST receive only information needed to explain the synchronization plan. Secrets, API keys, unrelated provider configuration, and raw full settings content MUST NOT be sent to the browser. Unrelated settings MUST NOT appear in any response.

---

## 10. Preview identity / stale-preview rules

10.1. Mandatory invariant: **a user must never preview one state and unknowingly apply another.** Every successful preview (READY, NO_CHANGE, or BLOCKED) MUST generate an opaque `previewId` (minimum 128 bits from a cryptographic random source) that binds the Apply authorization to the previewed inputs.

10.2. The server MUST retain, in process memory only, the authoritative preview record bound to each live `previewId`:

```text
previewId
target path identity
exact target settings bytes digest (SHA-256)
complete normalized five-source snapshot digest (SHA-256) relevant to planning
exact desired six managed arrays
planner result (state, dispositions, change classification, unresolved/fallback reports)
```

10.3. The browser MUST NOT construct `previewId` and MUST NOT be able to alter preview contents and submit them as authority. Apply requests MUST be honored solely by `previewId` lookup against server-retained state; any plan arrays, desired state, source data, or paths supplied by the browser MUST be ignored for Apply semantics (unknown fields SHOULD cause rejection, never interpretation).

10.4. Preview lifetime (simple model):

```text
one active preview per UI process (single retained-preview slot)
a successful new Refresh Preview invalidates the previous preview
successful Apply consumes (invalidates) the preview
server restart invalidates all previews (memory-only; nothing to reload)
no persistent preview storage, on disk or elsewhere
```

A modest expiry period MAY additionally be defined by the implementation gate; expiry MUST surface as STALE_PREVIEW, never as silent regeneration.

10.5. STALE_PREVIEW is a UI/API refusal condition, never a trigger for Apply. It MUST be returned when: the target settings changed after Preview (digest mismatch); the preview was superseded by a later preview; the preview expired (if expiry defined); the server restarted; the preview ID is unknown; the preview was already consumed by Apply; or required preview-bound state is otherwise unavailable. The UI MUST then instruct `Refresh Preview` and MUST NOT silently regenerate and apply a new plan.

---

## 11. Apply semantics

11.1. Apply requires, together:

```text
valid previewId (server-retained, unconsumed, current slot)
+
explicit user confirmation (see §12.4)
+
per-process token (see §15.2)
```

11.2. Retained-plan model (MANDATORY — no alternative design is permitted under this contract): Apply MUST NOT perform a fresh synchronization, re-fetch upstream sources, re-plan, or reinterpret the browser request. It MUST execute exactly:

```text
Preview
  ↓
server retains authoritative preview plan/snapshot
  ↓
Apply(previewId)
  ↓
re-read current settings bytes
  ↓
compare to preview-bound settings digest
  ↓
if changed → STALE_PREVIEW, refuse (preview consumed/invalidated, no write)
  ↓
if retained state is not READY → refuse (NO_CHANGE/BLOCKED/IDLE rule, no write)
  ↓
commit the exact already-previewed desired state
  ↓
existing v1.2 transaction (§17)
```

Because Apply commits the retained desired arrays without re-reading upstream, upstream source changes after preview MUST NOT silently alter the applied plan; a later explicit Refresh Preview fetches the newer upstream state.

11.3. If upstream sources change after preview, that MUST NOT silently alter the plan being applied. (Follows from §11.2.)

11.4. Server-side Apply refusal table (all refusals perform no write and create no backup):

```text
unknown/consumed/superseded previewId → 409 STALE_PREVIEW
settings digest mismatch              → 409 STALE_PREVIEW (invalidate preview)
retained state NO_CHANGE              → 409 PREVIEW_NOT_READY (no write manufacturing)
retained state BLOCKED                → 409 PREVIEW_NOT_READY (no bypass)
no preview held for this page         → 409 PREVIEW_NOT_READY
Apply while Apply running             → 409 APPLY_BUSY (no second execution)
duplicate Apply of same preview       → 409 STALE_PREVIEW (consumed; MUST NOT execute twice)
missing/invalid token                 → 403 BAD_TOKEN
Origin mismatch                       → 403 BAD_ORIGIN
unexpected Host                       → 403 BAD_HOST
```

11.5. After successful Apply the preview MUST become invalid (consumed). A duplicate Apply of the same `previewId` MUST NOT execute twice.

---

## 12. Production/scratch handling

12.1. The server MUST classify the launch-resolved target once at startup:

```text
resolved absolute normalized target == resolved absolute normalized default production path
    → PRODUCTION
else
    → SCRATCH (any explicit --settings=<path> that does not resolve to the default)
```

12.2. Production mode MUST be visually obvious. The UI MUST show the target path in safely displayable form (inserted with text-safe DOM methods, never as HTML) and MUST show the PRODUCTION/SCRATCH badge on the Settings Target section, the preview summary, and the Apply confirmation. The fact that Apply will write to production MUST NOT be hideable.

12.3. Normal default path is PRODUCTION. Scratch invocations MUST be displayed as SCRATCH unless they resolve to the exact default production target.

---

### 12.4. Apply confirmation

12.4.1. When state is READY, pressing Apply MUST require one explicit confirmation summarizing at least: target path, PRODUCTION/SCRATCH classification, added/removed/moved/metadata-changed counts, preserved-unresolved count, skipped-unresolved count, fallback count, and backup behavior. Example conceptual confirmation:

```text
Apply synchronization?

PRODUCTION
C:\Users\...\.dsh\settings.yaml

Added: 2
Removed: 1
Moved: 1
Metadata changed: 4

Preserved unresolved: 14
Skipped unresolved: 1
Free counterpart fallback: 1

A timestamped backup will be created before replacement.

[Cancel] [Apply]
```

12.4.2. One explicit confirmation is sufficient. Typing arbitrary confirmation phrases MUST NOT be required. Confirmation MUST NOT be skippable, pre-confirmed, or auto-accepted.

---

## 13. HTTP API

13.1. Minimal route table (exact strings; no path parameters, no file mapping, no static directory):

```text
GET  /               serve ui/index.html (must not fetch upstream merely by rendering)
GET  /api/state      server/target status; must not mutate settings or fetch upstream
POST /api/preview    build preview (requires token); invalidates previous preview on success
POST /api/apply      commit retained plan (requires token + previewId + confirmation intent)
```

13.2. Rules:

```text
GET routes MUST NOT mutate settings and MUST NOT fetch upstream sources
Apply MUST require POST (GET /api/apply → 405)
unexpected methods on known routes → 405
unknown routes → 404
no arbitrary filesystem route; no static directory traversal (no request-derived file paths exist)
request Content-Type for POST SHOULD be application/json; malformed JSON → 400
```

13.3. `GET /api/state` response (no upstream fetch, no mutation):

```js
{
  ok: true,
  target: { displayPath: "...", production: true },
  hasPreview: false,          // whether the single retained-preview slot is occupied
  previewState: null,         // null | READY | NO_CHANGE | BLOCKED
  generatedAt: null           // null | ISO-8601 of retained preview
}
```

It MUST NOT expose plan details, desired arrays, digests, tokens, or settings content. A freshly loaded page MUST start in UI state IDLE regardless of `hasPreview`: the page holds no `previewId` after reload, so an orphaned retained preview can only be replaced by Refresh Preview, never applied blindly.

13.4. `POST /api/preview` → 200 with the §9.4 envelope for READY, NO_CHANGE, or BLOCKED outcomes (BLOCKED is a valid preview outcome, not an HTTP error). Transport/internal failure → 5xx with a machine-readable `code` and the UI enters ERROR. A successful response replaces the single retained-preview slot.

13.5. `POST /api/apply` request body MUST be read only for `{ previewId }` (plus ignorable unknown-field rejection per §10.3). Success → 200 `{ ok: true, status: "UPDATED", backupPath, target }`. Refusals use §11.4 codes with HTTP statuses 403/404/405/409/500 as listed; every refusal body MUST carry a machine-readable `code` (e.g. `STALE_PREVIEW`, `PREVIEW_NOT_READY`, `APPLY_BUSY`, `PREVIEW_BUSY`, `BAD_TOKEN`, `BAD_ORIGIN`, `BAD_HOST`) and a safe human message without stack traces or secrets.

13.6. Machine-readable status/code strings (`READY`, `NO_CHANGE`, `BLOCKED`, `STALE_PREVIEW`, `UPDATED`, `ERROR`, refusal codes) MUST match this contract exactly (case-sensitive).

---

## 14. Loopback/security boundary

14.1. The server MUST bind only to loopback, literally:

```text
127.0.0.1
```

It MUST NEVER bind by default to `0.0.0.0`, `::`, or any LAN address. v1.3 does not support remote UI access. Port-unavailable MUST fail clearly (§7.4), never expose elsewhere, never change to a network interface.

14.2. Binding to loopback alone is not sufficient as the sole HTTP trust boundary. The server MUST validate the `Host` header: permit only `127.0.0.1:<port>` and `localhost:<port>` where `<port>` is the actual bound port; reject missing or unexpected Host values with 403 `BAD_HOST`. Browser-supplied Host values MUST NOT be trusted for any other purpose.

14.3. Security response headers (exact policy, all responses unless noted):

```text
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Cache-Control: no-store
```

(`'unsafe-inline'` is allowed ONLY because v1.3 is one self-contained file with embedded script/style; no remote source may ever appear in the policy. `no-store` is REQUIRED because the served page embeds the per-process token.)

14.4. Content serving: exactly one `ui/index.html` with inline CSS/JavaScript. No CDN, no external script tags, no remote stylesheet, no remote font, no third-party analytics, no telemetry.

---

## 15. CSRF/token/origin/host protections

15.1. No CORS wildcard: the server MUST NOT send `Access-Control-Allow-Origin: *` and MUST NOT enable general CORS. CORS MUST NOT be depended on as authorization. (Same-origin page + token + Origin checks are the authorization.)

15.2. Per-process authorization token (MANDATORY):

```text
generated at launch from a cryptographic random source (minimum 256 bits)
exists only in process memory; changes every server start
delivered ONLY inside the HTML served by that process to the local page
   (server-rendered injection; never in a URL, never persisted, never logged)
held by page JavaScript in memory only (no localStorage/sessionStorage/cookie/URL) and sent as the `X-OCMS-Token` request header on POSTs
required on POST /api/preview and POST /api/apply
   — missing/invalid → 403 BAD_TOKEN; comparison SHOULD be constant-time
discarded on process exit; no persistent secret/token state
```

The token MUST NOT appear in URLs (request lines, query strings, Location headers), logs, or error messages.

15.3. Origin checks for state-changing requests: when the browser supplies `Origin`, the server MUST accept only the UI's own loopback origins (`http://127.0.0.1:<port>`, `http://localhost:<port>` with the bound port) and MUST reject cross-origin mutation requests with 403 `BAD_ORIGIN`. Token validation always applies regardless of Origin presence.

---

## 16. Concurrency

16.1. Binding rules:

```text
only one preview build at a time (second concurrent POST /api/preview → 409 PREVIEW_BUSY)
only one Apply at a time (Apply while Apply running → 409 APPLY_BUSY)
preview requested while Apply is running → 409 PREVIEW_BUSY (reject; never run against a half-written target)
duplicate Apply of the same previewId → MUST NOT execute twice (second → 409 STALE_PREVIEW)
after successful Apply the preview MUST become invalid
```

16.2. The UI MUST disable Refresh Preview and Apply controls while APPLYING, and MUST disable Apply while IDLE, NO_CHANGE, BLOCKED, or ERROR.

---

## 17. Transaction reuse

17.1. Apply MUST reuse the proven v1.2 transaction semantics verbatim:

```text
original settings
      ↓
timestamped exact-byte backup
      ↓
generated temp YAML
      ↓
re-read temp
      ↓
parse
      ↓
verify all six managed arrays
      ↓
replace target
```

17.2. The HTML UX MUST NOT have its own YAML writer and the browser MUST never write files. All file effects happen server-side inside the transaction above, using the retained desired arrays.

17.3. `NO_CHANGE` MUST NOT create a backup (Apply is refused; nothing is written). A failed Apply MUST preserve the original target per the existing contract. Detailed development diagnostics (stack traces) MUST remain server-side; the UI shows safe messages only.

---

## 18. Reporting/data exposure

18.1. BLOCKED UX: when planning would produce `NOT WRITTEN`, the UI MUST show state BLOCKED with the exact safe reason (e.g. `CATALOG_INVALID — opencode-go.models map is empty`), disable or hide Apply, create no backup, mutate nothing, and offer no bypass. Example:

```text
Synchronization blocked

CATALOG_INVALID
opencode-go.models map is empty

No configuration has been modified.
```

Stack traces MUST NEVER be the primary user-facing error.

18.2. Unresolved reporting: the UX MUST visibly represent `PRESERVED_UNRESOLVED`, `SKIPPED_UNRESOLVED`, and `FREE_COUNTERPART_FALLBACK` with both counts AND individual model details — never counts only. Each unresolved item MUST expose at least gateway, model ID, reason, and route when applicable; each fallback item MUST expose at least gateway, target model ID, counterpart model ID, and resolved route. Sort all lists by gateway, then exact model ID.

18.3. Change details: preview MUST expose added/removed/moved/metadata-changed items with enough detail to explain each entry; moved models MUST show `old route → new route`. Raw full configuration and unrelated provider configuration MUST NOT be exposed.

18.4. The confirmation, BLOCKED, and STALE_PREVIEW messages MUST follow §§12.4, 18.1, and 10.5 respectively.

---

## 19. HTML UX behavior

19.1. Intended visual language (binding as hierarchy, not palette):

```text
dark
compact
technical
dashboard-like
high information density
clear status hierarchy
minimal decoration
```

Primary statuses (IDLE, READY, NO CHANGE, BLOCKED, APPLYING, UPDATED, ERROR) MUST be visually distinguishable by text label plus iconography/state styling — MUST NOT rely on color alone. The contract MUST NOT depend on specific colors.

19.2. Information architecture (describe IA, not pixel-perfect CSS):

```text
Header / version / server state

Settings Target
- path
- PRODUCTION / SCRATCH

Upstream Sources
- Go roster
- Zen roster
- catalog
- Go docs
- Zen docs

Synchronization Preview
- change counts
- unresolved/fallback counts
- primary Refresh Preview / Apply controls

Details
- added
- removed
- moved
- metadata changed
- preserved unresolved
- skipped unresolved
- fallback resolved
```

Detail groups MAY be collapsible. Target path and server strings MUST be inserted with text-safe DOM methods (e.g. `textContent`), never as HTML (never via `innerHTML`); server strings MUST NOT be passed to script-evaluating sinks.

19.3. Page-load rule (testable): loading or reloading the page MUST issue zero upstream-synchronization requests and MUST leave the UI in IDLE. Only an explicit `Refresh Preview` click may call `POST /api/preview`.

19.4. Control availability (binding):

```text
IDLE:       Refresh Preview available; Apply unavailable
READY:      Refresh Preview available; Apply available only via §12.4 confirmation
NO_CHANGE:  Refresh Preview available; Apply unavailable (server also refuses)
BLOCKED:    Refresh Preview available; Apply unavailable (server also refuses)
APPLYING:   all action controls disabled until completion
UPDATED:    Refresh Preview available; Apply unavailable until a new READY preview
ERROR:      Refresh Preview available; Apply unavailable
```

19.5. No browser-side business logic. The browser MAY: render values; expand/collapse sections; request preview; request Apply; display confirmation; display server responses. The browser MUST NOT: decide placement; calculate desired arrays; decide whether unresolved is safe; classify catalog gaps; migrate compat; decide whether a write is allowed; reconstruct the plan. Server/engine results are authoritative.

---

## 20. Test requirements

20.1. Regression (binding): all existing v1.2 tests remain mandatory. Windows baseline `70/70 PASS` MUST remain green; v1.3 MUST NOT weaken those assertions. New UI/server tests are additive in `tests/ui.test.mjs` (and engine-preview tests where the refactor exposes them).

20.2. Required future test categories (at least):

```text
Engine / Preview
- preview performs no write (settings bytes, directory listing, and backup glob unchanged)
- preview produces the same desired arrays as the CLI planner on identical inputs
- preview exposes all unresolved dispositions
- preview exposes fallback provenance
- NO_CHANGE preview creates no backup
- BLOCKED preview creates no backup

Preview identity
- correct previewId accepted
- unknown previewId refused (STALE_PREVIEW)
- previous preview invalid after new preview
- preview invalid after successful Apply (duplicate Apply refused, single write)
- preview invalid after process restart conceptually (memory-only retention)
- changed settings after preview → STALE_PREVIEW
- browser-tampered preview body cannot change Apply (server ignores client plan data)

HTTP
- binds to 127.0.0.1 (and refuses to start usefully otherwise)
- unexpected Host rejected
- unknown route 404
- wrong method rejected (405)
- no CORS wildcard
- token required (missing/invalid → refused)
- invalid Origin refused
- traversal attempts refused (no request-derived file access)

Concurrency
- double Apply cannot write twice
- concurrent Apply rejected (APPLY_BUSY)
- preview during Apply handled safely (refused)

UI semantics
- page load makes no upstream request
- Refresh Preview causes preview
- Apply unavailable while IDLE
- Apply unavailable when BLOCKED
- confirmation required in READY
- production/scratch badge correct

Existing behavior
- CLI semantics unchanged
- default path semantics unchanged (HOME/OCMS_SETTINGS do not redirect)
- all 70 existing tests remain green
```

20.3. No test against production: all new tests MUST use temp/scratch targets. `%USERPROFILE%\.dsh\settings.yaml` MUST NEVER appear in automated tests and no test may run real production Apply. Public live sources are not required for UI unit/integration testing — stubbed/synthetic sources MUST be preferred.

20.4. No authenticated probes: the UI MUST NOT introduce authenticated model probes, provider account calls, quota calls, inference, or credential discovery. Only the same five public source classes authorized by the synchronization contract may participate in Preview.

---

## 21. Acceptance criteria

A future implementation gate is complete when:

```text
node sync.mjs remains supported with unchanged v1.2 semantics
node ui.mjs serves the loopback UI per this contract
Preview/Apply invariant holds exactly as in §§10–11 (retained-plan model, digest check, single-write)
127.0.0.1-only binding with Host/Origin/token enforcement per §§14–15
no auto-fetch on page load; no polling; no background activity
confirmation, BLOCKED, STALE_PREVIEW, and production/scratch UX per §§12, 18
all 70 existing tests green plus all §20.2 categories covered with scratch targets only
production settings untouched during implementation/testing
no authenticated/inference probing introduced
no unrelated architecture/features added
```

Documentation/version note: a later implementation gate (not this design gate) will update the package version to `1.3.0`, README, and CHANGELOG. Those updates MUST NOT be performed in this contract-design gate.

---

## 22. Explicit prohibitions

The following MUST NOT occur in any compliant v1.3 implementation. This section restates the sharp edges as a checklist; it adds no new scope:

```text
a second planner in browser JavaScript
silent re-plan at Apply (Apply MUST commit the retained plan or refuse)
applying anything different from the previewed desired arrays
honoring stale/superseded/consumed/unknown previewIds for Apply
auto-fetching sources on page load or adding polling/background refresh/retry loops
binding 0.0.0.0 / :: / LAN, or falling back to another interface/port when busy
accepting unexpected Host values (DNS-rebinding surface)
accepting cross-site POSTs (missing/invalid token or mismatched Origin)
trusting browser-supplied settings paths, plan arrays, digests, or source data
writing settings from browser JavaScript (no browser file access at all)
duplicating route/placement/compat logic outside the shared engine
manufacturing a write (or backup) from a NO_CHANGE preview
bypassing BLOCKED / NOT WRITTEN for any reason
creating a backup during Preview
adding a frontend dependency, framework, build tool, CDN, or remote resource
regressing CLI behavior or weakening any v1.2 safety rule
persisting tokens or previews to disk or any log
exposing secrets, tokens, or raw settings in logs, URLs, or error messages
exposing stack traces as primary user-facing errors
reducing unresolved/fallback reporting to counts only
requiring tests against production settings or live authenticated endpoints
```

---

## Appendix A. Challenge record (design-gate diligence, non-normative)

During drafting, the contract was adversarially challenged and repaired:

1. "Preferred model" softness (§12 gate) → repaired: §11.2 mandates the retained-plan model; no alternative permitted.
2. Silent re-plan with stale protection claimed as "equivalent" → closed: Apply MUST NOT fetch upstream or re-plan at all.
3. BLOCKED previews carrying a usable previewId → closed: §11.4 refuses non-READY retained states with PREVIEW_NOT_READY.
4. NO_CHANGE Apply manufacturing a backup → closed: server refusal + disabled control + §17.3.
5. Page reload orphaning a retained preview into blind Apply → closed: §13.3 (page starts IDLE; orphan replaceable, never applicable without its previewId).
6. Token in URL/query for "convenience" → closed: §15.2 forbids URLs, mandates header + memory-only + no-store page.
7. Port-busy silent fallback → closed: §7.4 fail-clearly rule.
8. Localhost/Host trust ambiguity (DNS rebinding) → closed: §14.2 exact allowlist with bound-port matching.
9. CORS wildcard for "dev convenience" → closed: §15.1.
10. Client-supplied plan honored when "equal anyway" → closed: §10.3 (browser plan data never authoritative).
11. Preview creating temp/backup files "temporarily" → closed: §9.3 zero-write rule.
12. Compat/placement helpers reimplemented in page JS for "display" → closed: §19.5 (render only).

Independent second-pass review (least-effort implementer perspective) confirmed no compliant-but-unsafe reading remains for: replanning on Apply, 0.0.0.0 binding, client-generated preview data, page-load fetches, browser-side writes, duplicated route logic, arbitrary filesystem paths, and silent BLOCKED retries. Each maps to a MUST-level refusal or prohibition above.
