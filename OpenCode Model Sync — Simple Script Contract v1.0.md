# OpenCode Model Sync — Simple Script Contract v1.0

**Task ID:** OCMS-S1  
**Folder:** `C:\Users\GNV\.dsh\tools\ocms-s`  
**Main script:** `C:\Users\GNV\.dsh\tools\ocms-s\sync.mjs`

This project is independent from:

`C:\Users\GNV\.dsh\tools\opencode-model-sync`

The existing v5.6 DSH-plugin project remains unchanged and is not superseded by this contract.

## 1. Purpose

Build one small Node.js script that manually synchronizes the OpenCode Go and Zen model definitions in DSH `settings.yaml`.

The mechanism is:

```text
Go roster
Zen roster
     +
models.opencode.ai/api.json
     +
Go/Zen docs endpoint tables
     ↓
build complete desired model lists
     ↓
read settings.yaml
     ↓
preserve compat
     ↓
replace six OpenCode models arrays
     ↓
validate
     ↓
backup
     ↓
write settings.yaml
```

No more architecture than necessary.

## 2. Sources

Fetch on every run:

```text
https://opencode.ai/zen/go/v1/models
https://opencode.ai/zen/v1/models
https://models.opencode.ai/api.json
https://opencode.ai/docs/go/
https://opencode.ai/docs/zen/
```

Roles:

```text
Go /models     → current Go membership
Zen /models    → current Zen membership

api.json:
  opencode-go.models → Go metadata
  opencode.models    → Zen metadata

docs/go/       → exact Go endpoint per model ID
docs/zen/      → exact Zen endpoint per model ID
```

The roster decides what models exist.

Catalog-only or docs-only models are ignored.

If either roster fails or is empty, do not write.

If the catalog or either documentation page cannot be fetched or parsed, do not write.

## 3. Managed routes

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

Existing route-level settings outside `models` stay untouched.

If one of these routes is missing but needs models, create it with:

```text
displayName
api
baseURL
apiKeyEnv
models
```

## 4. Placement

For each live model ID:

### First: exact docs row

```text
/chat/completions → completions route
/messages         → messages route
/responses        → responses route
```

### Otherwise: exact model catalog hint

Use only:

```text
catalog[gateway].models[id].provider.npm
```

Map:

```text
@ai-sdk/openai-compatible → completions
@ai-sdk/anthropic         → messages
@ai-sdk/openai            → responses
@ai-sdk/google            → unsupported Google-style protocol
```

Do not use provider-level `npm`.

Do not route by model name, family or sibling model.

Docs win if docs and `provider.npm` disagree.

If neither docs nor the exact model hint resolves placement:

```text
unresolved
→ do not write settings.yaml
```

No agent lookup and no guessing.

## 5. Google-style models

A documented:

```text
/models/{model-id}
```

or:

```text
provider.npm: @ai-sdk/google
```

does not map to the six supported DSH routes.

If that model already exists in the current managed Go/Zen configuration:

```text
keep its current route
rebuild its metadata
```

If it is a new model with no existing placement:

```text
unresolved
→ do not write
```

## 6. Model metadata

For each roster model, get the exact matching catalog record from:

```text
Go  → opencode-go.models[id]
Zen → opencode.models[id]
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

Mapping:

```text
id                     → id
name                   → name
modalities.input       → input
limit.context          → contextWindow
limit.output           → maxTokens
reasoning +
reasoning_options      → reasoningEfforts
```

A live model without a matching catalog record is unresolved.

Do not invent missing information.

## 7. Input normalization

The current DSH model schema accepts only the input modalities we explicitly support.

Keep this in one obvious place in `sync.mjs`:

```js
const DSH_INPUT_MODALITIES = ["text", "image"];
```

Normalize with:

```text
OpenCode modalities.input
       ↓
keep values present in DSH_INPUT_MODALITIES
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

This filtering does **not** mean OpenCode or the model lacks the dropped capability.

It only reflects what the current DSH target schema can represent.

If no supported modality remains, mark the model unresolved and do not write.

## 8. Future input modality support

`README.md` must explain exactly how this mechanism can be extended.

OpenCode remains the source of the complete modality list:

```text
modalities.input
```

The only compatibility gate is:

```js
const DSH_INPUT_MODALITIES = ["text", "image"];
```

For example, if a future DSH version adds support for `video`:

### 1. Confirm DSH accepts `video`

Verify that the installed DSH model schema accepts the literal:

```text
video
```

### 2. Change the allowlist

In:

```text
C:\Users\GNV\.dsh\tools\ocms-s\sync.mjs
```

change:

```js
const DSH_INPUT_MODALITIES = ["text", "image"];
```

to:

```js
const DSH_INPUT_MODALITIES = ["text", "image", "video"];
```

### 3. Update the test

Input:

```json
{
  "modalities": {
    "input": ["text", "image", "video"]
  }
}
```

must then produce:

```yaml
input:
  - text
  - image
  - video
```

### 4. Run

```powershell
npm test
```

Nothing else should need changing.

Do not modify roster fetching, catalog fetching, docs parsing, placement or YAML writing merely to add another input modality.

If DSH uses a different name for a future modality, add the translation in this same normalization section.

## 9. Reasoning normalization

`models.opencode.ai/api.json` provides the reasoning metadata.

Use it directly.

### `reasoning: false`

```json
"reasoning": false
```

becomes:

```yaml
reasoningEfforts: false
```

### `reasoning: true`

Find:

```text
reasoning_options entry where type === "effort"
```

Never assume its array position.

Example:

```json
"reasoning_options": [
  {"type":"toggle"},
  {"type":"effort","values":["none","low","medium","high"]},
  {"type":"budget_tokens"}
]
```

Use only:

```json
{"type":"effort","values":["none","low","medium","high"]}
```

Map values directly, except:

```text
none → off: none
```

Result:

```yaml
reasoningEfforts:
  off: none
  low: low
  medium: medium
  high: high
```

Another example:

```text
[low, high, max]
```

becomes:

```yaml
reasoningEfforts:
  low: low
  high: high
  max: max
```

Supported DSH effort keys:

```text
off
minimal
low
medium
high
xhigh
max
```

If a new unsupported effort appears, report the model unresolved and do not write.

Ignore:

```text
toggle
budget_tokens
```

Do not generate `thinkingBudgets`.

If `reasoning:true` has no `type:"effort"` option, omit `reasoningEfforts`.

Do not invent effort levels.

## 10. Preserve `compat`

`compat` is local DSH/provider configuration.

It is not OpenCode catalog metadata and must not be destroyed when the model arrays are rebuilt.

Before rebuilding, index existing model records by:

```text
gateway + model ID
```

When generating the new model record:

```js
if (oldModel?.compat !== undefined) {
    newModel.compat = oldModel.compat;
}
```

If the model moves between routes inside the same gateway, its `compat` moves with it.

Example:

```text
OLD
opencode-go
  model-x
    compat: {...}

DOCS NOW SAY /messages

NEW
opencode-go-messages
  model-x
    compat: {...}
```

The script does not interpret or regenerate `compat`.

It only copies the existing value unchanged.

All other old model metadata is replaced by the newly generated OpenCode metadata.

## 11. Rebuild the arrays

Do not incrementally patch individual models.

Build all six desired arrays from the current sources.

Then replace:

```text
providers.opencode-go.models
providers.opencode-go-messages.models
providers.opencode-go-responses.models

providers.opencode-completions.models
providers.opencode-messages.models
providers.opencode.models
```

Every current roster model must appear exactly once inside its Go or Zen managed routes.

Models no longer present in the roster disappear automatically.

Sort arrays by exact model ID.

## 12. YAML write

Read:

```text
%USERPROFILE%\.dsh\settings.yaml
```

Current machine:

```text
C:\Users\GNV\.dsh\settings.yaml
```

Use a YAML library.

Do not use regex to modify nested YAML.

Before writing:

1. all five sources must be valid;
2. no model may remain unresolved;
3. generated model membership must match the two rosters;
4. generated YAML must parse.

Then:

```text
copy original bytes
    ↓
settings.yaml.bak-<timestamp>

write new config
    ↓
settings.yaml.tmp

parse settings.yaml.tmp
    ↓
replace settings.yaml
```

If validation fails:

```text
NOT WRITTEN
```

The original remains untouched.

## 13. Output

Print:

```text
added
removed
moved
metadata changed
unresolved
```

Final result is one of:

```text
UPDATED
NO CHANGE
NOT WRITTEN
```

No interactive confirmation is required.

Manual execution of `sync.mjs` is the instruction to perform the synchronization.

## 14. Files

Keep it small:

```text
C:\Users\GNV\.dsh\tools\ocms-s\
│
├── CONTRACT.v1.0.md
├── sync.mjs
├── README.md
├── package.json
└── tests\
```

Dependencies only for:

```text
YAML parsing/writing
HTML table parsing
```

No framework.

Importing `sync.mjs` must not execute synchronization automatically so its normalization functions can be tested.

## 15. Minimal tests

Test only the important transformation behavior:

1. exact docs placement;
2. nested `provider.npm` fallback;
3. input modality normalization;
4. reasoning effort extraction regardless of array position;
5. `none → off: none`;
6. `reasoning:false → reasoningEfforts:false`;
7. `compat` survives a route move;
8. unresolved model prevents writing;
9. generated YAML parses.

Run:

```powershell
npm test
```

Tests use temporary fixture YAML only.

They must not modify production:

```text
C:\Users\GNV\.dsh\settings.yaml
```

## 16. Acceptance

Done means:

```text
sync.mjs works as specified
README explains future modality extension
npm test passes
production settings were not touched during implementation
no unrelated features were added
```

Then STOP and return the implementation report.