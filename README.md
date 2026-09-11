# OpenCode Model Sync — Simple Script (OCMS-S)

A small, manual Node.js utility that synchronizes **OpenCode Go** and **OpenCode Zen** model definitions into DSH `settings.yaml`.

OCMS-S is deliberately narrow. It is **not** a DSH plugin, daemon, scheduler, account checker, quota monitor, or model-probing system.

Current project version: **v1.2.0**

Current authoritative specification:

`OpenCode Model Sync — Simple Script Contract v1.2.md`

---

## Important warning

Running:

```powershell
node sync.mjs
```

targets your real DSH configuration at:

```text
%USERPROFILE%\.dsh\settings.yaml
```

OCMS-S validates the generated configuration and creates a timestamped backup before replacing the production file when an update is required.

If you are evaluating the project for the first time, use an explicitly supplied **scratch settings file** instead:

```powershell
node sync.mjs --settings=C:\Temp\ocms-test\settings.yaml
```

Do not point `--settings` at a file you are not prepared to modify.

---

## Disclaimer

This repository is provided for **educational, research, and personal experimentation purposes**.

It is provided **as-is**, without warranties or guarantees of any kind. The authors and contributors accept no responsibility or liability for loss of data, configuration damage, service disruption, account action, provider-policy violations, financial loss, or any other direct or indirect consequences arising from use of this software.

You are responsible for:

- reviewing the source before use;
- keeping backups of important configuration;
- protecting your credentials and API keys;
- complying with the terms, policies, and acceptable-use rules of every service you use;
- deciding whether this software is appropriate for your environment.

OCMS-S is an independent community utility. It is not an official OpenCode or DSH project and is not endorsed by the providers whose public metadata it reads.

See [`DISCLAIMER.md`](DISCLAIMER.md) for the full disclaimer.

---

## What OCMS-S does

On each manual run, OCMS-S reads five public OpenCode sources:

```text
Go roster
Zen roster
     +
models.opencode.ai/api.json
     +
Go/Zen documentation endpoint tables
     ↓
classify each live roster model
     ↓
build the safe desired state
     ↓
read settings.yaml
     ↓
preserve allowed local state
     ↓
replace six managed model arrays
     ↓
validate
     ↓
backup if needed
     ↓
write
```

The **live rosters decide membership**.

The catalog provides model metadata.

The documentation tables, followed by exact model-local catalog hints, determine protocol/route placement.

When upstream authority is incomplete, v1.2 can conservatively preserve or skip the affected model instead of guessing.

---

## Requirements

OCMS-S is currently designed and tested for:

- **Windows**
- **Node.js** with modern built-in `fetch` support
- npm
- DSH with a YAML settings file at:

```text
%USERPROFILE%\.dsh\settings.yaml
```

The project uses Windows `%USERPROFILE%` semantics for the default settings path.

### Runtime dependencies

The project intentionally has a small dependency surface:

- `yaml`
- `node-html-parser`

Dependencies are defined in `package.json` and pinned by `package-lock.json`.

---

## Installation

Clone the repository and install the exact locked dependencies:

```powershell
git clone https://github.com/iona095/ocms-s.git
cd ocms-s
npm ci
```

`npm ci` recreates the local `node_modules` directory from `package-lock.json`.

`node_modules` is generated locally and should not be committed to Git.

---

## Run OCMS-S

From the repository directory:

```powershell
node sync.mjs
```

Normal execution targets:

```text
%USERPROFILE%\.dsh\settings.yaml
```

No interactive confirmation is shown. Running the command is the instruction to synchronize the production settings file.

---

## Safe scratch/test execution

To operate on a deliberately supplied test file instead of production:

```powershell
node sync.mjs --settings=C:\Temp\ocms-test\settings.yaml
```

The explicit `--settings=<path>` interface exists for scratch, testing, and audit workflows.

OCMS-S does **not** support an environment-variable settings override such as `OCMS_SETTINGS`.

---

## Run the test suite

```powershell
npm test
```

You can also perform syntax checks:

```powershell
node --check sync.mjs
node --check tests\sync.test.mjs
```

Tests use synthetic/temp settings files and must never modify production settings.

---

## Result statuses

Every run finishes with exactly one of:

### `UPDATED`

The safe desired managed state differed from the selected settings file and the update was written successfully.

### `NO CHANGE`

The managed arrays already matched the safe desired state.

`NO CHANGE` does **not** mean every live upstream model was fully resolved. Preserved/skipped warnings and fallback provenance can still be reported.

### `NOT WRITTEN`

OCMS-S refused to write because a contract-required safety condition failed.

Examples include:

- malformed required upstream data;
- an empty required upstream catalog model map (whole-source refusal);
- malformed settings structure;
- ambiguous existing placement;
- conflicting local `compat`;
- unsupported metadata normalization;
- failed temporary-file verification.

`NOT WRITTEN` is intentional fail-closed behavior.

---

## What OCMS-S manages

The managed provider container is:

```text
llm-pi-ai.providers
```

OCMS-S manages exactly six model arrays.

### OpenCode Go

| Route | API | Base URL |
| --- | --- | --- |
| `opencode-go` | `openai-completions` | `https://opencode.ai/zen/go/v1` |
| `opencode-go-messages` | `anthropic-messages` | `https://opencode.ai/zen/go` |
| `opencode-go-responses` | `openai-responses` | `https://opencode.ai/zen/go/v1` |

### OpenCode Zen

| Route | API | Base URL |
| --- | --- | --- |
| `opencode-completions` | `openai-completions` | `https://opencode.ai/zen/v1` |
| `opencode-messages` | `anthropic-messages` | `https://opencode.ai/zen` |
| `opencode` | `openai-responses` | `https://opencode.ai/zen/v1` |

Existing unrelated configuration is preserved.

For an existing managed route, only its `models` array is replaced. Route-level configuration outside `models` is preserved.

If a required managed route is missing and receives models, OCMS-S creates the minimal route definition required by the contract.

---

## Public upstream sources

OCMS-S reads these public sources on every normal synchronization run:

| Source | Purpose |
| --- | --- |
| `https://opencode.ai/zen/go/v1/models` | current Go roster |
| `https://opencode.ai/zen/v1/models` | current Zen roster |
| `https://models.opencode.ai/api.json` | model metadata |
| `https://opencode.ai/docs/go/` | exact Go endpoint placement |
| `https://opencode.ai/docs/zen/` | exact Zen endpoint placement |

OCMS-S does not need authenticated model probes to determine placement.

It does not send inference requests as part of synchronization.

---

## Placement authority

For a live model with usable catalog metadata, supported placement is resolved in this order:

```text
1. exact model row in the matching OpenCode docs
2. exact model-local catalog provider.npm hint
3. exact terminal -free counterpart fallback, when eligible
4. v1.2 unresolved preserve/skip handling
```

Earlier authority always wins.

### Exact documentation endpoint mapping

```text
/chat/completions → completions route
/messages         → messages route
/responses        → responses route
/models/{id}      → unsupported Google-style protocol
```

### Exact model-local `provider.npm` mapping

```text
@ai-sdk/openai-compatible → completions
@ai-sdk/anthropic         → messages
@ai-sdk/openai            → responses
@ai-sdk/google            → unsupported Google-style protocol
```

OCMS-S does not infer placement from model families, names, neighboring models, or another gateway.

---

## `FREE_COUNTERPART_FALLBACK`

v1.2 contains one narrow placement fallback for eligible model IDs ending in the exact, case-sensitive suffix:

```text
-free
```

If the free target has no usable exact docs placement and no usable exact nested `provider.npm`, OCMS-S may derive exactly one counterpart by removing one terminal `-free`.

Example:

```text
target:      zen/deepseek-v4-flash-free
counterpart: zen/deepseek-v4-flash
```

The counterpart must:

- be in the same gateway;
- currently exist in that gateway's live roster;
- independently resolve to a supported route from its own exact docs row or own nested catalog hint;
- not resolve as Google-style.

The counterpart supplies **placement only**.

It does **not** supply:

- the target's name;
- limits;
- modalities;
- reasoning metadata;
- `compat`;
- arbitrary model fields.

A successful fallback is still a normal `RESOLVED` target and is reported with provenance:

```text
FREE_COUNTERPART_FALLBACK
```

---

## Unresolved model handling

Every live roster model must finish planning as exactly one of:

```text
RESOLVED
PRESERVED_UNRESOLVED
SKIPPED_UNRESOLVED
```

or the entire run must stop with a blocking safety condition.

The two unresolved dispositions are reported explicitly:

### `PRESERVED_UNRESOLVED`

The model kept its unique existing managed record: an existing placement route is kept with rebuilt metadata, or a `CATALOG_MISSING` record is preserved complete and unchanged.

### `SKIPPED_UNRESOLVED`

The model has no existing managed record to preserve safely, so it is omitted from the new managed state instead of being placed by guesswork.

### `PLACEMENT_UNRESOLVED`

The exact target has usable catalog metadata, but no supported placement authority can be established.

- exactly one existing managed route → preserve that route, rebuild metadata, preserve applicable target-local `compat`
- no existing managed route → skip only that model
- multiple existing managed routes → `NOT WRITTEN`

### `CATALOG_MISSING`

The live roster contains the model but the exact catalog record is absent.

- exactly one existing model record → preserve the complete record unchanged in value
- no existing record → skip only that model
- multiple existing records → `NOT WRITTEN`

OCMS-S never manufactures target metadata from another model.

### `UNSUPPORTED_GOOGLE_STYLE`

A live model maps to the Google-style protocol, which is not represented by the six managed routes.

- unique existing route → preserve it conservatively
- no existing route → skip only that model
- ambiguous existing placement → `NOT WRITTEN`

---

## Reporting

OCMS-S prints a normal change summary such as:

```text
added
removed
moved
metadata changed
```

It also reports unresolved dispositions explicitly.

Example:

```text
PRESERVED_UNRESOLVED 2
- go/model-a reason=PLACEMENT_UNRESOLVED route=opencode-go
- zen/model-b reason=UNSUPPORTED_GOOGLE_STYLE route=opencode

SKIPPED_UNRESOLVED 1
- go/model-c reason=CATALOG_MISSING
```

Successful free-counterpart resolutions are also reported:

```text
FREE_COUNTERPART_FALLBACK 1
- zen/deepseek-v4-flash-free counterpart=zen/deepseek-v4-flash route=opencode-completions
```

Every affected model is listed individually. Warnings are not reduced to counts only.

---

## Backup and write safety

When an update is required, the write process is backup-first:

```text
original settings.yaml
        ↓
exact-byte timestamped backup

settings.yaml.bak-<timestamp>

        ↓
write generated document to

settings.yaml.tmp

        ↓
re-read + parse temp YAML
        ↓
verify all six managed arrays
        ↓
replace settings.yaml
```

A `NO CHANGE` run does not create a new backup merely for reporting.

On a blocking validation failure, the result is `NOT WRITTEN`.

---

## Local `compat` preservation

`compat` is treated as opaque local DSH/provider configuration.

OCMS-S does not interpret or regenerate it.

For rebuilt models, target-local `compat` can follow a legitimate authoritative move or unique-route preservation under the contract's conflict rules.

Conflicting `compat` values that cannot be selected safely cause:

```text
NOT WRITTEN
```

A `CATALOG_MISSING` opaque preservation keeps the complete existing model record as-is instead of separately migrating `compat`.

---

## Input normalization

The current implementation allows these DSH input modalities:

```js
const DSH_INPUT_MODALITIES = ["text", "image"];
```

Upstream modalities not representable by the current DSH target schema are filtered at this normalization boundary.

If DSH later supports another modality, such as `video`, update the allowlist and its tests after confirming the installed DSH schema accepts that literal.

Do not change roster acquisition, placement logic, or YAML transaction behavior merely to add another supported input modality.

---

## Reasoning normalization

OpenCode catalog metadata is the authority for reasoning metadata.

Examples:

```text
reasoning: false
→ reasoningEfforts: false
```

For reasoning models, OCMS-S finds the `reasoning_options` entry whose type is exactly:

```text
effort
```

It does not assume array position.

The upstream value:

```text
none
```

maps to:

```yaml
off: none
```

Unsupported effort values fail closed rather than being guessed.

---

## Project contracts

The repository retains the historical specifications for provenance:

```text
OpenCode Model Sync — Simple Script Contract v1.0.md
OpenCode Model Sync — Simple Script Contract v1.1.md
OpenCode Model Sync — Simple Script Contract v1.2.md
```

**v1.2 is the current authoritative contract.**

v1.0 and v1.1 are historical artifacts.

Do not create another file merely because an audit prompt refers logically to `CONTRACT.v1.2.md`.

---

## Project status

OCMS-S v1.2 has undergone:

- implementation hardening;
- adversarial synthetic tests;
- `FREE_COUNTERPART_FALLBACK` verification;
- synthetic live-source validation;
- controlled production synchronization and idempotence verification.

Future changes should remain narrow and contract-driven.

A change to model authority, placement semantics, transaction behavior, or preservation rules should be specified and tested before production use.

---

## Repository layout

```text
ocms-s/
├── .github/
│   └── workflows/
│       └── ci.yml
├── .gitattributes
├── .gitignore
├── CHANGELOG.md
├── DISCLAIMER.md
├── OpenCode Model Sync — Simple Script Contract v1.0.md
├── OpenCode Model Sync — Simple Script Contract v1.1.md
├── OpenCode Model Sync — Simple Script Contract v1.2.md
├── README.md
├── package.json
├── package-lock.json
├── sync.mjs
└── tests/
    └── sync.test.mjs
```

`node_modules/` is generated by `npm ci` and is intentionally excluded from Git.

---

## License

OCMS-S is licensed under the [MIT License](LICENSE).

The separate [DISCLAIMER.md](DISCLAIMER.md) describes risk, responsibility,
third-party terms, and the project's independent/community status. The
disclaimer does not modify the permissions granted by the MIT License.

---

## Contributing / changes

Keep changes small.

Before accepting a change:

```powershell
npm ci
node --check sync.mjs
node --check tests\sync.test.mjs
npm test
```

For behavior changes, update or supersede the contract first, then add tests proving the intended behavior.

Do not solve upstream ambiguity by guessing model families or probing authenticated endpoints.
