# OpenCode Model Sync — Simple Script Contract v1.1

**Task ID:** OCMS-S1  
**Folder:** `C:\Users\GNV\.dsh\tools\ocms-s`  
**Main script:** `C:\Users\GNV\.dsh\tools\ocms-s\sync.mjs`  
**Contract:** `C:\Users\GNV\.dsh\tools\ocms-s\OpenCode Model Sync — Simple Script Contract v1.1.md`

This project is independent from:

`C:\Users\GNV\.dsh\tools\opencode-model-sync`

The separate v5.6 DSH-plugin project remains unchanged and is not superseded by this contract.

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
build complete desired model state
     ↓
read existing settings.yaml
     ↓
carry forward local compat where appropriate
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

---

## 2. Authority

The synchronization authorities are:

```text
Membership
    → Go/Zen live rosters

Metadata
    → models.opencode.ai/api.json

Placement
    → exact docs row
    → exact nested model provider.npm fallback

Existing settings.yaml
    → NOT an authority for membership
    → NOT an authority for placement
    → NOT an authority for model metadata
```

The current `settings.yaml` may contain stale, duplicate, handwritten, misplaced, or otherwise incorrect model entries.

The script is expected to clean those up by rebuilding the managed model arrays from the upstream sources.

Existing YAML is used only to:

- preserve unrelated configuration;
- preserve applicable local `compat`;
- preserve the current route of an already-existing unsupported Google-style model as described in §7.

Do not treat an existing model record as proof that its route or metadata is correct.

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

If either roster fails, is malformed, contains duplicates, or is empty:

```text
NOT WRITTEN
```

If the catalog or either documentation table cannot be fetched or parsed:

```text
NOT WRITTEN
```

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

For every live roster model, determine the desired route from upstream.

### First authority: exact docs row

For the exact model ID:

```text
/chat/completions
    → completions route

/messages
    → messages route

/responses
    → responses route
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
```

Do not use:

- existing YAML placement;
- provider-level `npm`;
- model name;
- model family;
- sibling models;
- the other gateway.

If docs and the nested hint disagree:

```text
docs win
```

If neither resolves the live model:

```text
unresolved
NOT WRITTEN
```

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

### Already configured model

If that exact `(gateway,id)` already exists on exactly one managed route:

```text
keep that current route
rebuild its supported metadata
preserve its applicable compat
```

This is a specific unsupported-protocol exception.

It does not make existing YAML an authority for normal model placement.

### New unsupported model

If the live Google-style model has no existing managed placement:

```text
UNSUPPORTED_NEW_MODEL
NOT WRITTEN
```

If its current placement is ambiguous across multiple managed routes:

```text
unresolved
NOT WRITTEN
```

---

## 8. Model metadata

For every live roster model use its exact matching catalog record:

```text
Go
    → opencode-go.models[id]

Zen
    → opencode.models[id]
```

Generate:

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

If a live roster model has no matching catalog record:

```text
unresolved
NOT WRITTEN
```

Do not copy stale metadata from `settings.yaml` to fill missing upstream metadata.

Do not invent values.

---

## 9. Input normalization

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

If no supported input remains:

```text
unresolved
NOT WRITTEN
```

---

## 10. Future input modality support

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

## 11. Reasoning normalization

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

An unsupported effort value makes that model unresolved.

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

## 12. Preserve `compat`

`compat` is local DSH/provider configuration.

It is the only old model-local field intentionally carried forward.

The current YAML may contain duplicate or incorrectly routed model records. Therefore existing route order must not decide which record is authoritative.

First determine the model's desired route from §6. For a permitted already-existing Google-style model, determine and preserve its current route under §7.

Then inspect all old records for that exact `(gateway,id)`.

### Compat selection

If the record already present on the authoritative desired route has a defined `compat` value:

```text
preserve that value
```

If multiple records on the desired route define `compat`:

```text
all equal
    → preserve it

conflicting
    → unresolved
    → NOT WRITTEN
```

If no record on the desired route defines `compat`, inspect defined `compat` values on the other old routes in the same gateway:

```text
none defined
    → preserve none

one distinct defined value
    → carry it to the desired route

multiple deeply equal values
    → preserve that value

multiple conflicting values
    → unresolved
    → NOT WRITTEN
```

This permits a legitimate model move to retain local compatibility tuning without treating stale route placement as authoritative.

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

All other old model-local fields are discarded.

---

## 13. Complete rebuild

Do not incrementally add/remove/move model records.

Build all six desired arrays from scratch.

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

- stale models;
- duplicate models;
- wrongly placed models;
- stale model metadata;
- old model-local fields other than preserved `compat`.

Every live roster ID must occur exactly once within its gateway after planning, except for a blocking unresolved condition.

Sort each generated array by exact model ID.

### `NO CHANGE`

Return `NO CHANGE` only when all six current managed model arrays are exactly equal in value to the six generated desired arrays.

The comparison must include:

- cardinality;
- order;
- complete generated model records;
- preserved `compat`.

A reduced diff/report is not sufficient to decide `NO CHANGE`.

---

## 14. YAML write

Use a YAML library.

Do not modify nested YAML using regex.

Before any write:

1. all five source inputs must be valid;
2. both rosters must be nonempty;
3. every live roster model must have required catalog metadata;
4. every live model must have a valid placement or permitted Google preservation;
5. desired membership must match both rosters exactly;
6. generated YAML must parse successfully.

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

---

## 15. Settings path

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

## 16. Output

Print:

```text
added
removed
moved
metadata changed
unresolved
```

Finish with exactly one:

```text
UPDATED
NO CHANGE
NOT WRITTEN
```

Existing dirty or duplicate YAML entries may appear in the diff because the desired state is reconstructed from upstream rather than accepted from current configuration.

No interactive confirmation is required.

Manual execution is the instruction to synchronize the selected settings file.

---

## 17. Files

Keep the project small:

```text
C:\Users\GNV\.dsh\tools\ocms-s\
│
├── OpenCode Model Sync — Simple Script Contract v1.1.md
├── sync.mjs
├── README.md
├── package.json
└── tests\
```

Dependencies remain limited to what is needed for:

```text
YAML parsing/writing
HTML table parsing
```

No framework.

Importing `sync.mjs` must not start synchronization.

---

## 18. Tests

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
2. roster-only membership;
3. docs-first placement;
4. exact nested `provider.npm` fallback;
5. docs-only unsupported rows do not block;
6. prototype-sensitive IDs cannot use inherited object properties;
7. input modality filtering;
8. reasoning extraction independent of option position;
9. `none → off:none`, including `["none"]`;
10. `reasoning:false → reasoningEfforts:false`;
11. existing Google-style placement preservation;
12. new Google-style model refusal;
13. duplicate/stale/wrongly routed records are cleaned by full rebuild;
14. unsorted arrays are rewritten sorted;
15. stale model-local fields are removed;
16. `compat` on the desired route is preserved;
17. unique old-route `compat` follows a legitimate move;
18. conflicting ambiguous `compat` causes `NOT WRITTEN`;
19. unrelated complete-document configuration is preserved;
20. malformed `llm-pi-ai.providers` or managed route structures fail closed;
21. generated temporary YAML is reparsed and its six arrays verified before replacement;
22. explicit `--settings` scratch path works;
23. `OCMS_SETTINGS` does not redirect the target;
24. importing `sync.mjs` performs no synchronization.

Run:

```powershell
npm test
```

All tests must pass using scratch/temp settings files only.

---

## 19. Acceptance

Implementation is complete when:

```text
sync.mjs satisfies this contract
README contains the future-modality mechanism
npm test passes
production settings were not touched during implementation
no unrelated architecture/features were added
```

The separate v5.6 project remains untouched.

Then STOP and return the implementation/hardening report.
