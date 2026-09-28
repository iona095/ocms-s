# OpenCode Model Sync — Simple Script (OCMS-S)

A small, manual Node.js utility that synchronizes **OpenCode Go** and **OpenCode Zen** model definitions into DSH `settings.yaml`.

OCMS-S is deliberately narrow. It is **not** a daemon, scheduler, account checker, quota monitor, or model-probing system. v1.4 adds one optional DSH integration: a `Models` conversation-view tab that owns OCMS server lifecycle (status/Start/Stop) and iframe hosting only. All synchronization authority stays in the released engine and Web UX.

Current project version: **v1.4.2**

Current authoritative specification:

`OpenCode Model Sync — Simple Script Contract v1.4.1.md`

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

## Local Web UX

v1.3 adds a loopback-only browser control surface. It drives the same synchronization engine as the CLI; the browser is a second control surface, not a separate planner.

```powershell
node ui.mjs
node ui.mjs --no-open
node ui.mjs --port=18752
node ui.mjs --settings=C:\Temp\ocms-test\settings.yaml
```

Behavior:

```text
default port 18751
127.0.0.1 only; no remote/LAN UI (remote/LAN exposure is unsupported)
page load does not synchronize; there is no periodic polling and no automatic sync
Refresh Preview fetches the five public sources and builds one retained Preview
Apply is explicit: one confirmation dialog, then one write
PRODUCTION/SCRATCH classification is shown for the active target
timestamped backup before every successful update
STALE_PREVIEW refusal if settings change after Preview
```

`node ui.mjs` without `--settings=<path>` uses the normal production target:

```text
%USERPROFILE%\.dsh\settings.yaml
```

Opening the page never writes anything by itself. `Refresh Preview` only reads; only an explicit confirmed Apply can write, and only to the displayed target.

Security properties:

```text
loopback-only server
per-process browser authorization token (never logged, never in URLs)
Host/Origin protections
no remote assets, no telemetry, no authenticated model probes
```

`node sync.mjs` remains a fully supported non-UI workflow with the same engine semantics.

---

## DSH Models tab (v1.4 bundle)

v1.4 ships the root package as a DSH profile bundle: `cordis.patch.yml` + `dsh/host.mjs` + built `dsh/client.js` (+ `sync.mjs`, `ui.mjs`, `ui/`). The client registers one conversation view (`conversation.view`, id `models`, order `30`, label `Models`); the Host owns exactly one `ui.mjs` child per Host plugin instance.

Build and install into your normal `web` profile:

```powershell
node dsh/build-client.mjs
npm pack
# records ocms-s-1.4.2.tgz; tarballs are never committed (*.tgz)
dsh plugin --profile web add .\ocms-s-1.4.2.tgz
```

Then restart the DSH `web` profile and hard-refresh the browser. Expected:

```text
Chat | Trajectory | Subtitles | Context | Models
OCMS-S OpenCode Model Sync
SERVER OFFLINE
[ Start Server ]
```

Installing the bundle never starts OCMS-S. Only an explicit **Start Server** spawns the single owned child (`STARTING` → `ONLINE` after bounded readiness against `GET /api/state`); the iframe `src` comes only from trusted Host output. `Stop Server` returns to `OFFLINE`. Client-view unmount, session close, and tab switch never stop the child; Host/plugin disposal always stops the exact owned child (disposal invalidates any in-flight Start generation, so no child spawns after disposal and no disposed `STARTING` operation returns to `ONLINE`).

Since v1.4.2, ownership of that child is held until the child's own `exit` event. A termination request, a `kill()` return value, a child `error` event, or elapsed time never release ownership and never produce `OFFLINE`: a child that cannot be confirmed dead stays owned in `ERROR`, and a later `Start` is refused (`ocms/start-failed`) instead of spawning a second child. While a generation is retiring, the status surface reports `STOPPING`, and a replacement generation loaded by DSH HMR publishes nothing and spawns nothing until the retiring generation's child has actually exited.

The embedded UI targets the standard production settings file unless the Host row carries a scratch `settingsPath` (development only). `Refresh Preview` only reads the five public sources; only an explicit confirmed Apply writes, and only to the displayed target. Do not Preview/Apply production settings unless you intend to modify them.

DSH compatibility (do not shorten):

```text
Top-level CLI:
@deepseek-ai/dsh 0.1.5-rc.1

Plugin-facing tested runtime:
exact resolved DSH package graph recorded by the gate,
with relevant internal packages at 0.1.5-rc.2.
```

Bundle constraints: `dsh.bundle.patch` + `dsh.client { platform: "web", inject: [] }`, main `dsh/host.mjs`, pinned peers `@deepseek-ai/dsh-typert-protocol 0.1.5-rc.2`, `@deepseek-ai/cordis 4.0.2`, `@deepseek-ai/schemastery 3.18.2`. Legacy file-based plugin formats, prepare-tooling flows, and repository-based loader mechanisms are unsupported.

### Upgrading to v1.4.2 (two intentional boundaries)

1. **Restart DSH once.** A generation that was already running when v1.4.2 was installed does not participate in the generation handoff, so a hot reload across that one transition is not serialized: the replacement reaches publication while the predecessor is still serving and Cordis refuses the duplicate service registration. Restart the DSH profile after installing, and every later reload is serialized by the coordinator. Nothing else about the installation changes.
2. **An unconfirmable child blocks reload on purpose.** If an owned child never emits `exit`, plugin disposal stays pending, and so does activation of the replacement generation, until DSH's outer forced-exit boundary. This is the intended trade-off: a stalled plugin unload is preferable to two OCMS-S children serving one Host root.

---

## Run the test suite

```powershell
npm test
```

`npm test` runs the complete release suite with explicit cross-platform test paths (no wildcard expansion, so Windows/Node 20 behaves identically): 243 tests total — 70 legacy/v1.2 regression tests, 84 v1.3 engine/server/UI contract tests, 67 v1.4 DSH-integration tests (embed-origin, client view, lifecycle, ownership retention, compat, disposal-race, HMR generation handoff), and 14 v1.4.1 unsupported-protocol tests plus 2 v1.4.1 identity pins (241 pass, 0 fail, 2 authorized §14 skips).

You can also run the suites separately:

```powershell
node --test tests/sync.test.mjs
```

### Acceptance smoke test (real children, real HMR)

`npm test` is fully deterministic: it drives the lifecycle and the DSH HMR generation coordinator through injected doubles. `npm run test:smoke` covers what only a real process can show:

```powershell
npm run test:smoke
```

It loads `dsh/host.mjs` through a real Cordis runtime, drives the real `ocmsLifecycleService` Remote methods, spawns a real `ui.mjs` child on an ephemeral port, replays the installed HMR ordering (`registry.delete()` whose disposer is **not** awaited, then the replacement fiber), and reads child liveness and listener cleanup from the operating system rather than from the code under test. It asserts, among other things, that a replacement generation publishes and spawns nothing while the retiring generation's child is alive, that OS process death and exit-driven reconciliation are distinct events (in the first sample where the process is gone, the retiring generation still reports `STOPPING` and still holds ownership), and that the documented cold-start upgrade boundary really is unserialized.

It uses only a scratch settings file, never the production target, performs no Preview/Apply, kills every child it started on all exit paths, and has a watchdog so a hang can never wedge a machine. It is intentionally **not** part of `npm test`: it needs the DSH peer packages, spawns real processes, and takes seconds rather than milliseconds. Exit code 0 means every check passed (or the run was skipped for an environmental reason, which it says explicitly); 1 means at least one check failed. Options: `--host <path>`, `--prefix-ref <git ref>` (pre-coordinator generation to compare against, default `v1.4.1`), `--no-boundary`, `--strict`, `--timeout <seconds>`.

`--strict` (equivalently `OCMS_SMOKE_STRICT=1`) is meant for unattended runners: a missing prerequisite then **fails** the run instead of reporting a green acceptance, so a skipped section can never pass CI. That is how the `acceptance smoke (real child, real HMR)` CI job runs it, on Windows / Node 22, with a bounded job timeout and full git history (the boundary phase needs the `v1.4.1` ref). The ordinary Node 20/22 test matrix is unchanged and remains the regression gate.

The individual synthetic suites still run on their own:

```powershell
$tests = Get-ChildItem .\tests\v1.3\*.test.mjs | Sort-Object Name | ForEach-Object FullName
node --test $tests
```

```powershell
$tests14 = Get-ChildItem .\tests\v1.4\*.test.mjs | Sort-Object Name | ForEach-Object FullName
node --test $tests14
```

```powershell
node --test tests/v1.4.1/unsupported-protocol.test.mjs
```

You can also perform syntax checks:

```powershell
node --check sync.mjs
node --check ui.mjs
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
SKIPPED_UNSUPPORTED_PROTOCOL
```

or the entire run must stop with a blocking safety condition.

The three skipped/preserved dispositions are reported explicitly:

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

### `SKIPPED_UNSUPPORTED_PROTOCOL` (v1.4.1)

OCMS-S manages only these supported OpenCode protocol surfaces: `chat/completions`, `messages`, and `responses`. A live model whose exact authority (exact docs endpoint, else the exact nested model-local `provider.npm` hint) establishes a protocol outside that set is reported as `SKIPPED_UNSUPPORTED_PROTOCOL` with reason `UNSUPPORTED_PROTOCOL` and its exact endpoint.

- the model is intentionally omitted from all six managed arrays;
- it never blocks unrelated supported models;
- OCMS-S never guesses a supported route for it (no cross-protocol fallback, including from `-free` counterparts);
- supported-protocol models keep strict metadata validation (`limit.output`, modalities, reasoning) and malformed authority still blocks the run;
- an unsupported live model already present in a managed array is removed and reported under `removed`.

The current real-world example is Jev 1.13 / Jev 1.13 Free (Zen), but this is generic behavior, not a Jev-specific rule. No new managed route was added and no inference probing is performed.

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
OpenCode Model Sync — Simple Script Contract v1.3.md
OpenCode Model Sync — Simple Script Contract v1.4.md
OpenCode Model Sync — Simple Script Contract v1.4.1.md
```

**v1.4.1 is the current authoritative contract** (additive over v1.4; v1.0–v1.4 unchanged).

v1.4 identities (immutable): contract SHA-256 `3a4461d099e8994c773c98cfe3d001b9fb872fc182c64d31eddf8e46d4f27831` (171 lines); `dsh/lifecycle.mjs` `36f65604cd95322ba643d6ba7baa225d459270113ef75298ad9839e8d79a0c47`; `tests/v1.4/disposal-race.test.mjs` `3edbb9a76cb8dc9cb653efb2006f4810177258060f5885223ae40f826e6cb6d9`; v1.3 baseline `sync.mjs` `9211544a0bba60e3e19a78a8d089d84f9eacedb6105631489ebe377285188c07` and `ui/index.html` `6610e7354f64eb1edbd4827df65fa120c1410ba9121e33fcab87637d96deddf8` unchanged; lineage `HEAD`/`v1.3.0` `50968d968ede3c0c847c6d127e1ff8059f790185`.

v1.4.1 identities (immutable): contract SHA-256 `f48e236f40ee5c15202f18c3e812d3f41742804304d0de0d070342c0adeeb05b` (392 lines); `sync.mjs` `cdd56032042775b39e3c09628e8988ef0ce7d6aa45fd9614196189157ef12b7d`; `ui/index.html` `d2383cd3fb545da64dd51a21ad570f1944fee95e8caf8c98286d9d8d85919658`; lineage `HEAD`/`v1.4.0` `48fb7419508f7f3b43266a045537c65c543784e4`.

v1.4.2 identities: implementation commit `8167039d2120f859c79194e8273d08379a3ffa23` (tree `9f9629574d66aad61f4a2f2e586dc400e772324f`), recorded as line-ending-proof Git object ids — `dsh/host.mjs` `d54e53c77b5355de439443a0da5ad03b53e3eff8`, `dsh/lifecycle.mjs` `761a08a80ad5b3c938881f1cdb64c191076fa910`, `tests/v1.4/lifecycle.test.mjs` `04f053d421e3fb078269ff07366f85bfce1cb885`, `tests/v1.4/disposal-race.test.mjs` `a411a7626114b5af0ca9486506fbf25eacf1e411`, `tests/v1.4/ownership.test.mjs` `a1205f884705bde2547887c78814e11c3b8227c1`, `tests/v1.4/hmr-generation.test.mjs` `a264cc4bd9e6451e47c5d597c09455ea42ef23b4`. v1.4.1 authority is unchanged: `sync.mjs` and `ui/index.html` remain byte-identical (`1533be1fa08b017c9f32bce96e89d46498ef5a54`, `a81fc9f1044bb82c3752c57c1f7d59152ce1c7b2`). v1.4.2 is a correctness release against the v1.4.1 contract; it adds no contract text.

v1.0 and v1.1 are historical artifacts.

Do not create another file merely because an audit prompt refers logically to `CONTRACT.v1.2.md`.

---

## Project status

OCMS-S v1.4 adds the DSH Models-tab lifecycle bundle on the unchanged v1.3 engine. It has undergone:

- implementation hardening;
- adversarial synthetic tests;
- `FREE_COUNTERPART_FALLBACK` verification;
- synthetic live-source validation;
- controlled production synchronization and idempotence verification (v1.2 line);
- 84 v1.3 engine/server/UI contract tests plus manual scratch-browser hardening of the local Web UX.
- 57 v1.4 DSH-integration tests, including the disposal-vs-Start race fence (no post-disposal spawn, no stale `ONLINE`, exact-child termination, permanent Start refusal after disposal), verified after an independent HOLD→PASS audit cycle.
- Normal `web`-profile installation acceptance: `Models` tab appears, initial `OFFLINE`, explicit Start → `ONLINE` embedded UI, Stop → `OFFLINE`.

OCMS-S v1.4.1 adds generic unsupported-protocol containment on the v1.4 engine: protocol classification (`classifyProtocolSupport`) before model-record construction, the `SKIPPED_UNSUPPORTED_PROTOCOL` disposition (visible in Preview/CLI report and the Web UX), unchanged strict validation for supported protocols, and unsupported `-free` containment. Verified test-first: 14 v1.4.1 tests; full suite 227 tests (225 pass, 2 authorized §14 skips); live scratch Preview accepts Jev 1.13 / Jev 1.13 Free as explicitly skipped with plan `READY`.

OCMS-S v1.4.2 makes child lifetime exact and the HMR handoff safe: ownership is released only by the owned child's own `exit` event, disposal completes only on that exit, Stop/disposal/Start-abort share one termination sequence, and a process-global per-root coordinator serializes DSH HMR generations so a replacement publishes and spawns nothing until its predecessor's child has actually exited. Verified test-first (controlled RED before each production edit) with 10 new tests, three independent adversarial audits, a clean-checkout suite run of 243 tests (241 pass, 0 fail, 2 authorized §14 skips), and a real-runtime smoke test with a real `ui.mjs` child, real Remote calls, the installed HMR ordering, and OS-level child-liveness observation. Two boundaries are intentional and documented above: one cold DSH restart after upgrading, and a deliberately blocking disposal for an unconfirmable child.

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
├── OpenCode Model Sync — Simple Script Contract v1.3.md
├── OpenCode Model Sync — Simple Script Contract v1.4.md
├── OpenCode Model Sync — Simple Script Contract v1.4.1.md
├── README.md
├── cordis.patch.yml
├── package.json
├── package-lock.json
├── sync.mjs
├── ui.mjs
├── dsh/
│   ├── host.mjs
│   ├── lifecycle.mjs
│   ├── client.mjs
│   ├── client.js          # built via node dsh/build-client.mjs; committed
│   └── build-client.mjs
├── ui/
│   └── index.html
└── tests/
    ├── sync.test.mjs
    ├── acceptance/
    │   └── smoke.mjs     # npm run test:smoke (real child + real HMR ordering)
    ├── v1.3/
    │   ├── helpers.mjs
    │   ├── engine-contract.test.mjs
    │   ├── preview-contract.test.mjs
    │   ├── apply-contract.test.mjs
    │   ├── http-security.test.mjs
    │   ├── concurrency.test.mjs
    │   └── ui-contract.test.mjs
    ├── v1.4/
    │   ├── helpers.mjs
    │   ├── embed-origin.test.mjs
    │   ├── client-view.test.mjs
    │   ├── lifecycle.test.mjs
    │   ├── ownership.test.mjs
    │   ├── compat.test.mjs
    │   ├── disposal-race.test.mjs
    │   └── hmr-generation.test.mjs
    └── v1.4.1/
        ├── helpers.mjs
        └── unsupported-protocol.test.mjs
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
node --check ui.mjs
node --check dsh/host.mjs
node --check dsh/lifecycle.mjs
node --check tests\sync.test.mjs
npm test
```

For behavior changes, update or supersede the contract first, then add tests proving the intended behavior.

Do not solve upstream ambiguity by guessing model families or probing authenticated endpoints.
