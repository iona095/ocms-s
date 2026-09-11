# OpenCode Model Sync — Simple Script Contract v1.2

**Task ID:** OCMS-S1.2  
**Folder:** `C:\Users\GNV\.dsh\tools\ocms-s`  
**Main script:** `C:\Users\GNV\.dsh\tools\ocms-s\sync.mjs`  
**Contract:** `C:\Users\GNV\.dsh\tools\ocms-s\OpenCode Model Sync — Simple Script Contract v1.2.md`

This project is independent from:

`C:\Users\GNV\.dsh\tools\opencode-model-sync`

The separate v5.6 DSH-plugin project remains unchanged and is not superseded by this contract.

The physical authoritative contract is the long-name file above. Audit and execution prompts may refer to that file logically as `CONTRACT.v1.2.md`; that logical name does not require a second file to exist.

v1.2 supersedes v1.1 for OCMS-S once ratified. Historical v1.0/v1.1 contract files may remain as non-authoritative artifacts.

### v1.2 design delta

v1.2 keeps the v1.1 architecture and authority order, with two narrow resilience additions for model-local authority gaps.

For a **live roster model with a model-local authority gap**:

- preserve it conservatively when there is exactly one safe existing state to preserve;
- otherwise skip only that model when it is genuinely new;
- always report every preserved/skipped unresolved model explicitly;
- still fail the whole run on ambiguity, conflicting local state, malformed required sources, or any condition where safe preservation/skip cannot be proven.

For an exact live model ID ending in terminal `-free`, if that model's own placement authorities cannot resolve a supported route, v1.2 also permits one exact same-gateway non-free counterpart lookup for **placement only**, under the strict rule in §6. A successful use is reported explicitly as `FREE_COUNTERPART_FALLBACK`.

v1.2 does **not** authorize fuzzy sibling matching, model-family guessing, cross-gateway borrowing, metadata copying from the counterpart, inference probes, authenticated account probes, endpoint trial-and-error, or any new persistence/daemon architecture.

---
## 1. Purpose

Build one small Node.js script that manually synchronizes the OpenCode Go and Zen model definitions inside DSH `settings.yaml`.

The mechanism is:

```text
Go roster
Zen roster
     +
models.opencode.ai/api.json
     +
Go/Zen docs endpoint tables
     ↓
classify every live roster model
     ↓
resolved
or safely preserved unresolved
or safely skipped unresolved
or blocking ambiguity
     ↓
build complete desired managed-array state
     ↓
read existing settings.yaml
     ↓
carry forward local compat / narrow unresolved state where allowed
     ↓
replace six managed model arrays
     ↓
validate
     ↓
backup
     ↓
write
```

Keep the implementation deliberately simple.

Do not build a DSH plugin, daemon, scheduler, database, state file, evidence agent, inference probe, GUI, or other infrastructure.

The script must never silently hide an unresolved live model. Every non-blocking unresolved disposition must be visible in command output by exact gateway/model ID and reason.

---
## 2. Authority

The synchronization authorities are:

```text
Membership
    → Go/Zen live rosters

Metadata
    → exact models.opencode.ai/api.json model record when present

Placement
    → exact docs row
    → exact nested model provider.npm fallback
    → exact terminal `-free` same-gateway non-free counterpart fallback for placement only, when eligible under §6

Existing settings.yaml
    → NOT a general authority for membership
    → NOT a general authority for placement
    → NOT a general authority for model metadata
```

Roster membership remains authoritative.

The current `settings.yaml` may contain stale, duplicate, handwritten, misplaced, or otherwise incorrect model entries.

The script is expected to clean those up by rebuilding the managed model arrays from the upstream sources.

Existing YAML is used only to:

- preserve unrelated configuration;
- preserve applicable local `compat`;
- preserve the current route of an already-existing unsupported Google-style model as described in §7;
- preserve the current unique route of an already-existing `PLACEMENT_UNRESOLVED` live model as described in §9;
- preserve one exact existing model record as opaque local state when that live model is `CATALOG_MISSING`, as described in §9.

Those v1.2 preservation rules are **safety exceptions**, not new upstream authority.

They mean:

```text
upstream cannot currently prove enough to rebuild this one model
        ↓
do not guess
do not destructively move/delete a uniquely preservable existing live model
do not block all other safely resolvable live models
```

They do not mean an existing record is assumed correct.

A model absent from the live roster remains stale and must not be preserved merely because it exists in YAML.

---
## 3. Sources

Fetch these five public sources on every normal synchronization run:

```text
https://opencode.ai/zen/go/v1/models
https://opencode.ai/zen/v1/models
https://models.opencode.ai/api.json
https://opencode.ai/docs/go/
https://opencode.ai/docs/zen/
```

Roles:

```text
Go /models
    → current Go membership

Zen /models
    → current Zen membership

api.json:
    opencode-go.models
        → Go metadata

    opencode.models
        → Zen metadata

docs/go/
    → exact Go model endpoint

docs/zen/
    → exact Zen model endpoint
```

Roster membership is authoritative.

A model appearing only in the catalog or documentation is ignored.

### Whole-source failures

If either roster fails, is malformed, contains duplicates, or is empty:

```text
NOT WRITTEN
```

If the catalog source or either documentation table cannot be fetched or parsed as the expected source type:

```text
NOT WRITTEN
```

Because v1.2 permits model-local coverage gaps, source-wide structural sanity must be checked before treating absence as model-local.

The catalog must contain nonempty mapping/object model collections at:

```text
opencode-go.models
opencode.models
```

Each documentation source must parse into a nonempty exact-ID endpoint table/map.

If one of those required source-wide structures is missing, malformed, or empty:

```text
NOT WRITTEN
```

Do not reinterpret a broken/empty whole-source parse as dozens of independent `CATALOG_MISSING` or `PLACEMENT_UNRESOLVED` models.

### Per-model coverage gaps

A successfully fetched/parsed source may legitimately lack coverage for an individual current live model.

Specifically:

- no exact catalog record for one live roster ID → `CATALOG_MISSING`;
- no usable exact docs row and no usable exact nested `provider.npm` for one live roster ID, and no eligible/successful terminal `-free` counterpart fallback under §6 → `PLACEMENT_UNRESOLVED`.

Those are **model-local authority gaps**, not whole-source failures.

Handle them under §9.

Do not convert a model-local gap into guessed metadata or guessed placement.

---
## 4. DSH settings location

The script reads the complete file:

```text
%USERPROFILE%\.dsh\settings.yaml
```

Current machine:

```text
C:\Users\GNV\.dsh\settings.yaml
```

The managed provider container inside that complete document is:

```text
llm-pi-ai.providers
```

Therefore the six managed arrays are:

```text
llm-pi-ai.providers.opencode-go.models
llm-pi-ai.providers.opencode-go-messages.models
llm-pi-ai.providers.opencode-go-responses.models

llm-pi-ai.providers.opencode-completions.models
llm-pi-ai.providers.opencode-messages.models
llm-pi-ai.providers.opencode.models
```

Do not create or use a root-level:

```text
providers
```

mapping.

If `llm-pi-ai` or `llm-pi-ai.providers` exists but is not a mapping/object:

```text
NOT WRITTEN
```

Preserve all unrelated:

- top-level settings;
- `llm-pi-ai` fields;
- providers;
- managed-route fields outside `models`.

---
## 5. Managed routes

### Go

```text
opencode-go
    api: openai-completions
    baseURL: https://opencode.ai/zen/go/v1
    apiKeyEnv: OPENCODE_GO_API_KEY

opencode-go-messages
    api: anthropic-messages
    baseURL: https://opencode.ai/zen/go
    apiKeyEnv: OPENCODE_GO_API_KEY

opencode-go-responses
    api: openai-responses
    baseURL: https://opencode.ai/zen/go/v1
    apiKeyEnv: OPENCODE_GO_API_KEY
```

### Zen

```text
opencode-completions
    api: openai-completions
    baseURL: https://opencode.ai/zen/v1
    apiKeyEnv: OPENCODE_API_KEY

opencode-messages
    api: anthropic-messages
    baseURL: https://opencode.ai/zen
    apiKeyEnv: OPENCODE_API_KEY

opencode
    api: openai-responses
    baseURL: https://opencode.ai/zen/v1
    apiKeyEnv: OPENCODE_API_KEY
```

For an existing managed route, replace its `models` array and leave its other route-level settings unchanged.

If a route is missing and receives at least one model, create:

```text
displayName
api
baseURL
apiKeyEnv
models
```

with `displayName` initially equal to the route key.

---
## 6. Placement

For every live roster model with usable catalog metadata, determine the desired route from upstream.

### First authority: exact docs row

For the exact model ID:

```text
/chat/completions
    → completions route

/messages
    → messages route

/responses
    → responses route

/models/{model-id}
    → unsupported Google-style protocol
    → handle under §7
```

### Second authority: exact nested catalog hint

Only if the live model has no usable exact docs row, inspect:

```text
catalog[gateway].models[id].provider.npm
```

Map:

```text
@ai-sdk/openai-compatible
    → completions

@ai-sdk/anthropic
    → messages

@ai-sdk/openai
    → responses

@ai-sdk/google
    → unsupported Google-style protocol
    → handle under §7
```

If docs and the nested hint disagree:

```text
docs win
```

### Third authority: exact terminal `-free` counterpart fallback

Only after the target model's own exact docs row and own exact nested `provider.npm` fail to resolve a supported route, an exact live model ID ending in terminal, case-sensitive:

```text
-free
```

may attempt one narrow same-gateway counterpart fallback.

Derive the counterpart ID by removing exactly one terminal `-free`.

Example:

```text
zen/deepseek-v4-flash-free
    → counterpart: zen/deepseek-v4-flash
```

The fallback is eligible only when all of these are true:

1. the target has a usable exact catalog record, so target-local metadata can still be rebuilt from its own authoritative record;
2. the target's own placement remains unresolved after the first and second authorities above;
3. the target has not already been classified as unsupported Google-style under §7;
4. removing one terminal `-free` produces a nonempty counterpart ID that does not itself end in terminal `-free`;
5. the exact counterpart ID is present in the **same gateway's current live roster**;
6. the counterpart resolves a supported non-Google route from its own exact docs row first, otherwise from its own exact nested `provider.npm`;
7. no fuzzy, prefix, suffix, family, alias, cross-gateway, or recursive lookup is used.

The counterpart contributes **placement/protocol only**.

Do not copy from the counterpart:

- name;
- input/modalities;
- context or output limits;
- reasoning metadata;
- `compat`;
- any other model-local metadata.

The target's own exact catalog record remains the metadata authority.

If the target itself is `CATALOG_MISSING`, do not borrow counterpart metadata and do not use this fallback. Apply §9 `CATALOG_MISSING` handling instead.

If the counterpart does not qualify or cannot resolve a supported non-Google route, the target remains:

```text
PLACEMENT_UNRESOLVED
```

and proceeds to §9.

A successful fallback classifies the target as:

```text
RESOLVED
provenance: FREE_COUNTERPART_FALLBACK
```

on the counterpart-derived managed route. It is not `PRESERVED_UNRESOLVED` or `SKIPPED_UNRESOLVED`.

Every successful use must be reported under §17 on both `UPDATED` and `NO CHANGE`.

### Prohibited placement inference

Do not use:

- existing YAML placement as a normal placement authority;
- provider-level `npm`;
- model name;
- model family;
- sibling models other than the exact terminal `-free` counterpart exception defined above;
- the other gateway.

If the first two authorities do not resolve the model and the exact terminal `-free` fallback is not eligible or does not resolve it:

```text
PLACEMENT_UNRESOLVED
```

Then apply the model-local disposition rules in §9.

Do not immediately fail the whole run merely because one live model is `PLACEMENT_UNRESOLVED`.

The only permitted use of existing YAML placement after upstream placement fails is the narrow preservation rule in §9.

### Docs-only rows

Documentation rows for IDs absent from the live roster do not participate in synchronization.

An unusual or unsupported endpoint belonging only to a docs-only ID must not block the run.

Endpoint interpretation matters only when resolving a current live roster ID.

Exact-ID lookup must use own properties only. JavaScript prototype properties such as:

```text
toString
constructor
__proto__
```

must never masquerade as model IDs.

---
## 7. Google-style models

A live model whose exact endpoint is:

```text
/models/{model-id}
```

or whose exact nested hint is:

```text
@ai-sdk/google
```

does not map to the six supported route protocols.

Treat this as reason:

```text
UNSUPPORTED_GOOGLE_STYLE
```

### Already configured model

If that exact `(gateway,id)` already exists on exactly one managed route:

```text
keep that current route
rebuild its supported metadata from the catalog
preserve its applicable compat
classify as PRESERVED_UNRESOLVED
reason: UNSUPPORTED_GOOGLE_STYLE
```

This is a specific unsupported-protocol exception.

It does not make existing YAML an authority for normal model placement.

If the exact catalog record is also missing, do not attempt the metadata rebuild above. Apply the `CATALOG_MISSING` rule in §9 instead.

### New unsupported model

If the live Google-style model has no existing managed placement:

```text
classify as SKIPPED_UNRESOLVED
reason: UNSUPPORTED_GOOGLE_STYLE
do not write that model
continue planning other models
```

Do not fail the entire run merely because a genuinely new live Google-style model cannot be represented by the six supported routes.

### Ambiguous existing placement

If that exact `(gateway,id)` exists across multiple managed routes:

```text
blocking ambiguity
NOT WRITTEN
```

Do not choose a route by array order, first match, model family, or guess.

---
## 8. Model metadata

For every live roster model, first attempt its exact matching catalog record:

```text
Go
    → opencode-go.models[id]

Zen
    → opencode.models[id]
```

When the exact record exists and is usable, generate:

```text
id
name
input
contextWindow
maxTokens
reasoningEfforts
```

plus preserved `compat` when applicable.

Mapping:

```text
catalog.id
    → id

catalog.name
    → name

catalog.modalities.input
    → input

catalog.limit.context
    → contextWindow

catalog.limit.output
    → maxTokens

catalog.reasoning
catalog.reasoning_options
    → reasoningEfforts
```

### Missing exact catalog record

If a live roster model has no exact matching catalog record:

```text
CATALOG_MISSING
```

Do not immediately fail the whole run.

Apply the model-local disposition rules in §9.

Do not copy arbitrary stale metadata from `settings.yaml` to synthesize a new model.

Do not invent values.

### Present but unusable catalog record

v1.2 softens only the explicit model-local coverage gaps defined in §9.

If an exact catalog record exists but cannot satisfy an existing required normalization/validation rule in this contract — for example a blocking unsupported effort value, no supported input modality, or malformed required metadata — retain the corresponding fail-closed behavior defined by that rule:

```text
NOT WRITTEN
```

Do not silently reinterpret malformed metadata as `CATALOG_MISSING`.

---
## 9. Model-local unresolved handling

v1.2 separates **model-local authority gaps** from **whole-run safety failures**.

Every current live roster ID must finish planning in exactly one non-blocking disposition:

```text
RESOLVED

PRESERVED_UNRESOLVED

SKIPPED_UNRESOLVED
```

or planning must stop with a blocking ambiguity/conflict and:

```text
NOT WRITTEN
```

Recognized non-blocking unresolved reason codes in v1.2 are:

```text
PLACEMENT_UNRESOLVED
CATALOG_MISSING
UNSUPPORTED_GOOGLE_STYLE
```

These reason codes must be preserved into the run report.

`FREE_COUNTERPART_FALLBACK` is not an unresolved reason code. It is successful `RESOLVED` placement provenance under §6 and must be reported separately under §17 whenever used.

### A. `PLACEMENT_UNRESOLVED`

Precondition:

- the exact live roster model has a usable exact catalog record;
- §6 cannot resolve a supported route from exact docs, exact nested `provider.npm`, or an eligible successful terminal `-free` counterpart fallback;
- the model is not handled as Google-style under §7.

Inspect only old managed records for the exact `(gateway,id)`.

If the exact model exists on exactly one distinct managed route:

```text
PRESERVED_UNRESOLVED

preserve that route
rebuild supported metadata from the current catalog
preserve compat under §13
reason: PLACEMENT_UNRESOLVED
```

Multiple duplicate records on that same single route do not by themselves create placement ambiguity; their `compat` must still resolve safely under §13.

If the exact model exists on no managed route:

```text
SKIPPED_UNRESOLVED

write no model record
reason: PLACEMENT_UNRESOLVED
```

If the exact model exists on more than one distinct managed route:

```text
blocking placement ambiguity
NOT WRITTEN
```

Do not choose among routes.

### B. `CATALOG_MISSING`

Precondition:

- the exact ID is present in the authoritative live roster;
- the corresponding exact catalog model record is absent.

Because authoritative metadata is unavailable, the script must not fabricate or partially rebuild that model.

Inspect all old managed records for the exact `(gateway,id)`.

If exactly one existing model record exists across all managed routes for that gateway:

```text
PRESERVED_UNRESOLVED

preserve that complete parsed model record unchanged in value
preserve its current route
reason: CATALOG_MISSING
```

This is an opaque carry-forward exception.

Do not:

- regenerate individual metadata fields;
- remove old model-local fields from that opaque record;
- reinterpret its metadata as authoritative;
- move it merely because some other source suggests a route.

The purpose is only to avoid destructively deleting a still-live model while its authoritative catalog record is temporarily unavailable.

If no existing managed record exists:

```text
SKIPPED_UNRESOLVED

write no model record
reason: CATALOG_MISSING
```

If more than one existing managed record exists:

```text
blocking existing-state ambiguity
NOT WRITTEN
```

For `CATALOG_MISSING`, do not choose one of multiple old records even when they appear similar.

### C. `UNSUPPORTED_GOOGLE_STYLE`

Apply §7.

A uniquely placed existing model is:

```text
PRESERVED_UNRESOLVED
```

A genuinely new model is:

```text
SKIPPED_UNRESOLVED
```

Ambiguous existing placement is:

```text
NOT WRITTEN
```

### D. Global behavior

`PRESERVED_UNRESOLVED` and `SKIPPED_UNRESOLVED` are warnings, not whole-run failures.

They may coexist with:

```text
UPDATED
NO CHANGE
```

A blocking ambiguity/conflict still prevents any write and returns:

```text
NOT WRITTEN
```

A model absent from the live roster is stale regardless of any previous unresolved status and must not be preserved under this section.

All unresolved reporting must be deterministic and sorted by:

```text
gateway
then exact model ID
```

No unresolved model may disappear into only a count.

---
## 10. Input normalization

Keep one obvious allowlist in `sync.mjs`:

```js
const DSH_INPUT_MODALITIES = ["text", "image"];
```

Projection is:

```text
OpenCode modalities.input
        ↓
keep only values supported by DSH_INPUT_MODALITIES
        ↓
DSH input
```

Examples:

```text
[text]
→ [text]

[text, image, video]
→ [text, image]

[text, image, video, audio, pdf]
→ [text, image]
```

This does not mean OpenCode or the model lacks the dropped modalities.

It means only that the current DSH field cannot represent them.

If no supported input remains, that is a blocking metadata-normalization failure:

```text
NOT WRITTEN
```

Do not reinterpret it as one of the non-blocking §9 coverage-gap reasons.

---
## 11. Future input modality support

`README.md` must document the extension mechanism.

The complete upstream source remains:

```text
modalities.input
```

The DSH compatibility gate is:

```js
const DSH_INPUT_MODALITIES = ["text", "image"];
```

If DSH later supports `video`:

### Step 1

Verify the installed DSH schema accepts the literal:

```text
video
```

### Step 2

Change only the normalization allowlist:

```js
const DSH_INPUT_MODALITIES = ["text", "image", "video"];
```

### Step 3

Update the normalization test.

Input:

```json
{
  "modalities": {
    "input": ["text", "image", "video"]
  }
}
```

must then generate:

```yaml
input:
  - text
  - image
  - video
```

### Step 4

Run:

```powershell
npm test
```

Adding another supported input modality should not require changing:

- roster acquisition;
- catalog acquisition;
- docs acquisition;
- placement;
- YAML writing.

If OpenCode and DSH use different names for a future modality, add an explicit translation at this normalization point.

---
## 12. Reasoning normalization

`models.opencode.ai/api.json` is the metadata authority.

### Explicit non-reasoning

If:

```json
"reasoning": false
```

write:

```yaml
reasoningEfforts: false
```

Ignore irrelevant, absent, or null `reasoning_options` in this case.

### Reasoning model

If:

```json
"reasoning": true
```

find the option whose:

```text
type === "effort"
```

Do not assume array position.

For example:

```json
[
  {"type":"toggle"},
  {"type":"effort","values":["none","low","medium","high"]},
  {"type":"budget_tokens"}
]
```

uses only:

```json
{"type":"effort","values":["none","low","medium","high"]}
```

Map values directly except:

```text
none
    → off: none
```

Therefore:

```text
["none","low","medium","high"]
```

becomes:

```yaml
reasoningEfforts:
  off: none
  low: low
  medium: medium
  high: high
```

A sole:

```text
["none"]
```

is valid and becomes:

```yaml
reasoningEfforts:
  off: none
```

Recognized DSH effort keys:

```text
off
minimal
low
medium
high
xhigh
max
```

An unsupported effort value is a blocking metadata-normalization failure:

```text
NOT WRITTEN
```

Do not reinterpret it as one of the non-blocking §9 coverage-gap reasons.

Ignore:

```text
toggle
budget_tokens
```

Do not generate:

```text
thinkingBudgets
```

If `reasoning:true` contains no effort entry, omit `reasoningEfforts`.

Do not invent effort levels.

---
## 13. Preserve `compat`

`compat` is local DSH/provider configuration.

It is the only old model-local field intentionally carried forward for models whose metadata is rebuilt.

The current YAML may contain duplicate or incorrectly routed model records. Therefore existing route order must not decide which record is authoritative.

First determine the model's final disposition and route:

```text
RESOLVED
    → desired upstream route from §6

PRESERVED_UNRESOLVED / PLACEMENT_UNRESOLVED
    → unique preserved route from §9

PRESERVED_UNRESOLVED / UNSUPPORTED_GOOGLE_STYLE
    → unique preserved route from §7
```

Then inspect all old records for that exact `(gateway,id)`.

### Compat selection

If the record already present on the final desired/preserved route has a defined `compat` value:

```text
preserve that value
```

If multiple records on that route define `compat`:

```text
all equal
    → preserve it

conflicting
    → unresolved conflict
    → NOT WRITTEN
```

If no record on that route defines `compat`, inspect defined `compat` values on the other old routes in the same gateway:

```text
none defined
    → preserve none

one distinct defined value
    → carry it to the final route

multiple deeply equal values
    → preserve that value

multiple conflicting values
    → unresolved conflict
    → NOT WRITTEN
```

This permits a legitimate model move or a v1.2 unique-route preservation to retain local compatibility tuning without treating stale route placement as general upstream authority.

Example:

```text
CURRENT:

opencode-go
    muse-x
        no compat

opencode-go-responses
    muse-x
        compat: {...}

UPSTREAM PLACEMENT:
    /responses

DESIRED:

opencode-go
    muse-x removed

opencode-go-responses
    muse-x
        regenerated upstream metadata
        compat: {...}
```

The duplicate stale record is simply removed by the rebuild.

The script does not interpret, modify, or regenerate the contents of `compat`.

### `CATALOG_MISSING` exception

For `PRESERVED_UNRESOLVED / CATALOG_MISSING`, §9 preserves the entire sole existing model record unchanged in value.

Do not separately run compat migration/selection for that opaque record.

Its existing `compat`, if any, survives only because the complete record survives.

For all models whose metadata is rebuilt, all other old model-local fields are discarded.

---
## 14. Complete desired-array rebuild

Do not incrementally patch managed arrays in place.

Build all six desired arrays from scratch from the final per-model dispositions.

Include:

```text
RESOLVED
    → regenerated model on authoritative upstream route
    → when provenance is FREE_COUNTERPART_FALLBACK, route comes only from the exact §6 counterpart rule while metadata remains target-local

PRESERVED_UNRESOLVED / PLACEMENT_UNRESOLVED
    → regenerated metadata on unique preserved existing route
    → compat preserved under §13

PRESERVED_UNRESOLVED / UNSUPPORTED_GOOGLE_STYLE
    → regenerated metadata on unique preserved existing route
    → compat preserved under §13

PRESERVED_UNRESOLVED / CATALOG_MISSING
    → sole existing model record preserved unchanged in value
    → current route preserved
```

Exclude:

```text
SKIPPED_UNRESOLVED
```

Then replace:

```text
llm-pi-ai.providers.opencode-go.models
llm-pi-ai.providers.opencode-go-messages.models
llm-pi-ai.providers.opencode-go-responses.models

llm-pi-ai.providers.opencode-completions.models
llm-pi-ai.providers.opencode-messages.models
llm-pi-ai.providers.opencode.models
```

The rebuild intentionally removes:

- models absent from the live roster;
- stale duplicates for fully resolved/rebuildable models;
- wrongly placed resolved models;
- stale resolved-model metadata;
- old model-local fields other than preserved `compat`;
- old records for a live model that is safely represented by its single final record.

The narrow opaque `CATALOG_MISSING` preservation in §9 is the only exception to normal old-model-field cleanup.

### Membership invariant

Every live roster ID must be classified exactly once.

After planning:

```text
RESOLVED
PRESERVED_UNRESOLVED
    → exact model occurs once within its gateway

SKIPPED_UNRESOLVED
    → exact model occurs zero times within its gateway
```

Therefore desired managed membership is:

```text
live roster
minus SKIPPED_UNRESOLVED IDs
```

No live ID may accidentally disappear without an explicit `SKIPPED_UNRESOLVED` report entry.

No live ID may occur more than once after planning.

Sort each generated array by exact model ID.

### `NO CHANGE`

Return `NO CHANGE` only when all six current managed model arrays are exactly equal in value to the six generated desired arrays.

The comparison must include:

- cardinality;
- order;
- complete generated/preserved model records;
- preserved `compat`.

A reduced diff/report is not sufficient to decide `NO CHANGE`.

A run may legitimately return:

```text
NO CHANGE
```

while also reporting nonzero:

```text
PRESERVED_UNRESOLVED
SKIPPED_UNRESOLVED
FREE_COUNTERPART_FALLBACK
```

`NO CHANGE` means the writable managed arrays already equal the safe desired state. Warning/provenance reporting may still be nonzero.

It does **not** mean every live upstream model was fully resolved or written.

---
## 15. YAML write

Use a YAML library.

Do not modify nested YAML using regex.

Before any write:

1. all five source inputs must be fetched and parsed successfully;
2. both rosters must be nonempty and valid;
3. every live roster ID must have exactly one final disposition;
4. no blocking placement ambiguity, existing-record ambiguity, or `compat` conflict may remain;
5. every `RESOLVED` model must have valid required metadata and placement; a `FREE_COUNTERPART_FALLBACK` resolution must also satisfy every §6 fallback prerequisite and must use target-local metadata;
6. every rebuildable `PRESERVED_UNRESOLVED` model must satisfy its §7/§9 prerequisites;
7. every `CATALOG_MISSING` preserved model must have exactly one opaque existing record;
8. desired membership must equal each live roster minus that gateway's `SKIPPED_UNRESOLVED` IDs;
9. every non-skipped live ID must occur exactly once within its gateway;
10. generated YAML must parse successfully.

Then:

```text
original settings.yaml
        ↓
exact-byte timestamped backup

settings.yaml.bak-<timestamp>

        ↓

write complete generated document to

settings.yaml.tmp

        ↓

read + parse settings.yaml.tmp

        ↓

verify its six managed arrays equal the desired arrays

        ↓

rename/replace settings.yaml
```

If any pre-write or temporary-file validation fails:

```text
NOT WRITTEN
```

and the original settings file remains in place.

Nonzero `PRESERVED_UNRESOLVED` or `SKIPPED_UNRESOLVED` counts do not by themselves prevent a write when all rules above pass.

---
## 16. Settings path

Normal execution targets:

```text
%USERPROFILE%\.dsh\settings.yaml
```

Do not support an environment-variable override such as:

```text
OCMS_SETTINGS
```

Keep the explicit:

```text
--settings=<path>
```

option solely for intentionally supplied scratch/test/audit files.

Examples:

```powershell
node sync.mjs
```

targets normal DSH settings.

```powershell
node sync.mjs --settings=C:\Temp\ocms-test\settings.yaml
```

targets only that explicitly supplied file.

---
## 17. Output

Print the normal change summary:

```text
added
removed
moved
metadata changed
```

Also always print an unresolved-disposition summary with deterministic counts:

```text
preserved unresolved
skipped unresolved
```

If either unresolved count is nonzero, print **every affected live model** individually.

Required information for a preserved unresolved item:

```text
gateway/model-id
reason code
preserved route
```

Required information for a skipped unresolved item:

```text
gateway/model-id
reason code
```

Example shape:

```text
PRESERVED_UNRESOLVED 2
- go/glm-x reason=PLACEMENT_UNRESOLVED route=opencode-go
- zen/model-y reason=CATALOG_MISSING route=opencode

SKIPPED_UNRESOLVED 1
- go/new-model reason=PLACEMENT_UNRESOLVED
```

Exact punctuation/layout may remain simple, but the exact gateway/model ID and reason must be visible.

Sort unresolved items by:

```text
gateway
then exact model ID
```

Do not reduce unresolved reporting to counts only.

Do not suppress unresolved reporting when the final status is `NO CHANGE`.

### Free-counterpart fallback reporting

Every successful §6 terminal `-free` counterpart placement fallback must also be visible in command output, including when the final status is `NO CHANGE`.

Print a deterministic count and every affected target individually.

Required information:

```text
exact gateway/free target ID
exact same-gateway counterpart ID
selected managed route
provenance: FREE_COUNTERPART_FALLBACK
```

Example shape:

```text
FREE_COUNTERPART_FALLBACK 1
- zen/deepseek-v4-flash-free counterpart=zen/deepseek-v4-flash route=opencode-completions
```

Sort fallback items by:

```text
gateway
then exact free target ID
```

A fallback-resolved model remains part of the normal resolved desired state. The separate fallback report is provenance/audit output and does not make the model unresolved.

If a blocking condition causes refusal, print the blocking exact gateway/model ID(s) and reason without exposing unrelated settings or secrets.

Finish with exactly one:

```text
UPDATED
NO CHANGE
NOT WRITTEN
```

`UPDATED` and `NO CHANGE` may both coexist with nonzero preserved/skipped unresolved warnings and/or nonzero `FREE_COUNTERPART_FALLBACK` provenance entries.

Existing dirty or duplicate YAML entries may appear in the normal diff because the desired state is reconstructed from upstream plus only the narrow v1.2 preservation rules.

No interactive confirmation is required.

Manual execution is the instruction to synchronize the selected settings file.

---
## 18. Files

Keep the project small:

```text
C:\Users\GNV\.dsh\tools\ocms-s\
│
├── OpenCode Model Sync — Simple Script Contract v1.2.md
├── sync.mjs
├── README.md
├── package.json
├── package-lock.json
└── tests\
```

Historical v1.0/v1.1 contract files may remain in the folder as non-authoritative artifacts.

Runtime code, README, implementation reports, and new audit gates must treat:

```text
OpenCode Model Sync — Simple Script Contract v1.2.md
```

as the current authority after ratification.

A logical reference such as:

```text
CONTRACT.v1.2.md
```

means that physical long-name file unless the operator explicitly creates a second file.

Do not create a duplicate contract merely to satisfy that logical shorthand.

Dependencies remain limited to what is needed for:

```text
YAML parsing/writing
HTML table parsing
```

No framework.

Importing `sync.mjs` must not start synchronization.

---
## 19. Tests

Tests use the real full-document structural shape:

```yaml
llm-pi-ai:
  providers:
    ...
```

Do not model the target file as a root-level:

```yaml
providers:
```

mapping.

At minimum prove:

1. all five required sources are required;
2. source-wide catalog/docs structures must be present, valid, and nonempty before per-model gaps are softened;
3. roster-only membership;
4. docs-first placement;
5. exact nested `provider.npm` fallback;
6. docs-only unsupported rows do not block;
7. prototype-sensitive IDs cannot use inherited object properties;
8. input modality filtering;
9. reasoning extraction independent of option position;
10. `none → off:none`, including `["none"]`;
11. `reasoning:false → reasoningEfforts:false`;
12. existing Google-style unique placement is preserved and reported `PRESERVED_UNRESOLVED`;
13. new Google-style model is omitted and reported `SKIPPED_UNRESOLVED` rather than blocking the whole run;
14. ambiguous existing Google-style placement causes `NOT WRITTEN`;
15. duplicate/stale/wrongly routed resolved records are cleaned by desired-array rebuild;
16. unsorted arrays are rewritten sorted;
17. stale resolved-model-local fields are removed;
18. `compat` on the desired/final route is preserved;
19. unique old-route `compat` follows a legitimate move;
20. conflicting ambiguous `compat` causes `NOT WRITTEN`;
21. unrelated complete-document configuration is preserved;
22. malformed `llm-pi-ai.providers` or managed route structures fail closed;
23. generated temporary YAML is reparsed and its six arrays verified before replacement;
24. explicit `--settings` scratch path works;
25. `OCMS_SETTINGS` does not redirect the target;
26. importing `sync.mjs` performs no synchronization;
27. `PLACEMENT_UNRESOLVED` + exactly one existing route → preserved route, rebuilt metadata, explicit `PRESERVED_UNRESOLVED` report;
28. `PLACEMENT_UNRESOLVED` + no existing route → model omitted, explicit `SKIPPED_UNRESOLVED` report, other resolvable models still synchronize;
29. `PLACEMENT_UNRESOLVED` + multiple existing routes → `NOT WRITTEN`;
30. `CATALOG_MISSING` + exactly one existing model record → complete record preserved unchanged in value on its current route and explicitly reported;
31. `CATALOG_MISSING` + no existing record → model omitted and explicitly reported `SKIPPED_UNRESOLVED`;
32. `CATALOG_MISSING` + multiple existing records → `NOT WRITTEN`;
33. a stale old model absent from the live roster is removed even when other live models are preserved/skipped unresolved;
34. every live roster ID is classified exactly once;
35. desired membership equals roster membership minus only `SKIPPED_UNRESOLVED` IDs;
36. each non-skipped live model occurs exactly once within its gateway;
37. unresolved report entries expose exact gateway/model ID and reason;
38. unresolved report entries are deterministically sorted;
39. `UPDATED` may coexist with preserved/skipped unresolved warnings;
40. `NO CHANGE` may coexist with preserved/skipped unresolved warnings and still lists every affected model;
41. `NO CHANGE` does not create/write a backup when the contract otherwise requires no write;
42. backup bytes exactly equal the original when an update occurs;
43. temporary-file/write failure leaves the original target intact;
44. same model ID under Go and Zen is isolated by gateway;
45. dependencies remain limited to the permitted package surface;
46. normal default path derives from `%USERPROFILE%` and ambient `HOME`/`OCMS_SETTINGS` cannot redirect it;
47. terminal `-free` target whose own docs/hint are unresolved can resolve from the exact same-gateway live non-free counterpart's exact docs row;
48. counterpart exact nested `provider.npm` is considered only when that counterpart has no usable exact docs row;
49. target's own exact docs/hint always outrank the free-counterpart fallback;
50. free-counterpart fallback uses counterpart placement only and never copies counterpart model metadata or `compat`;
51. `CATALOG_MISSING` free target does not borrow counterpart metadata and continues through §9;
52. counterpart absent from the same gateway live roster does not qualify, and a counterpart found only in the other gateway never qualifies;
53. fuzzy/family/prefix/suffix or recursive `-free` sibling matching is never used;
54. Google-style/unsupported counterpart does not qualify as a fallback route;
55. successful fallback is `RESOLVED` with provenance `FREE_COUNTERPART_FALLBACK`, not preserved/skipped unresolved;
56. fallback provenance is explicitly reported on `UPDATED` and `NO CHANGE`, with exact target, counterpart, and selected route, deterministically sorted.

Run:

```powershell
npm test
```

All tests must pass using scratch/temp settings files only.

Do not use the production settings file in implementation tests.

The existing v1.1 test count is not a contractual target. Add only tests needed to prove v1.2 behavior; do not inflate counts for appearance.

---
## 20. Acceptance

Implementation is complete when:

```text
sync.mjs satisfies this v1.2 contract
README documents the future-modality mechanism
README documents PRESERVED_UNRESOLVED / SKIPPED_UNRESOLVED behavior
README documents the exact terminal `-free` same-gateway placement-only fallback and `FREE_COUNTERPART_FALLBACK` reporting
README makes clear that NO CHANGE can still carry unresolved warnings and/or fallback provenance reporting
npm test passes
production settings were not touched during implementation/hardening
no authenticated/model inference probing was introduced
no unrelated architecture/features were added
```

The separate v5.6 project remains untouched.

A v1.2 implementation/hardening gate must first use scratch/temp settings only.

A later controlled production gate requires separate explicit authorization.

Then STOP and return the implementation/hardening report.
