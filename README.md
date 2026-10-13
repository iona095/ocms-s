# OpenCode Model Sync — Simple Script (OCMS-S)

A small, manual Node.js utility that synchronizes **OpenCode Go** and **OpenCode Zen** model definitions into DSH `settings.yaml`.

OCMS-S is deliberately narrow. It is **not** a daemon, scheduler, account checker, quota monitor, or model-probing system. v1.4 adds one optional DSH integration: a `Models` conversation-view tab that owns OCMS server lifecycle (status/Start/Stop) and iframe hosting only. All synchronization authority stays in the released engine and Web UX.

Current project version: **v1.4.6-rc4** (release candidate)

Current authoritative specification:

`OpenCode Model Sync — Simple Script Contract v1.4.6-rc4.md`

v1.4.6-rc4 amends v1.4.6-rc3 (S5 profile suites in CI only); earlier contracts remain binding wherever v1.4.6-rc4 is silent. Profile-aware synchronization (S5) is specified in `SPEC_DSH_PROFILE_AWARE_SYNC.md`.

---

## Important warning

Since v1.4.6-rc1 the CLI never writes to an implicit target. A bare run refuses:

```powershell
node sync.mjs
# NOT WRITTEN — PROFILE_REQUIRED: Explicit --profile <name> is required; refusing to write default settings.
```

Every run must select exactly one explicit target, and every write is Previewed and then confirmed (`[y/N]`):

- `--profile <name>` targets the configuration of an existing DSH profile. Production profiles also require an explicit `--live-state=` declaration (see [Run OCMS-S](#run-ocms-s)).
- `--settings=<path>` targets a scratch settings file only. A path under your real DSH home is classified as production and refused.

OCMS-S validates the generated configuration and creates a timestamped backup before replacing a file when an update is required.

If you are evaluating the project for the first time, use an explicitly supplied **scratch settings file**:

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

From the repository directory, select exactly one explicit target:

```powershell
# a DSH profile (profile-aware synchronization, S5)
node sync.mjs --profile <name> --live-state=not-running
node sync.mjs --profile <name> --live-state=overlays:<comma-separated-paths>

# a scratch settings file
node sync.mjs --settings=C:\Temp\ocms-test\settings.yaml

node sync.mjs --help
```

Rules (normative detail in `SPEC_DSH_PROFILE_AWARE_SYNC.md` §8):

- No implicit target: no default profile, no `web` fallback, no environment-derived profile. A bare `node sync.mjs` refuses with `PROFILE_REQUIRED` and fetches nothing.
- `--profile` and `--settings` cannot be combined (`CONFLICTING_TARGETS`).
- The profile must already exist; OCMS-S never creates or initializes a profile directory.
- A production profile requires an explicit `--live-state=` declaration: `not-running` (DSH is not running that profile) or `overlays:<paths>` (the explicit live overlay files). Without it the run refuses. Production outcomes are reported with `liveActivation: UNKNOWN_LIVE_UNVERIFIED`; OCMS-S does not observe the running DSH process.
- `--scratch` is a restriction, never a reclassification: it refuses production targets (`SCRATCH_MODE_PRODUCTION_REFUSED`) instead of downgrading them.
- Each run fetches the five public sources once, shows the Preview, and writes only after an explicit `y` confirmation of that retained Preview. Apply never re-fetches or re-plans.

---

## Safe scratch/test execution

To operate on a deliberately supplied test file instead of production:

```powershell
node sync.mjs --settings=C:\Temp\ocms-test\settings.yaml
```

The explicit `--settings=<path>` interface exists for scratch, testing, and audit workflows. Since v1.4.6-rc1 it accepts scratch-classified paths only (a path under the real DSH home is refused as production), shows the Preview, and asks for confirmation before writing.

OCMS-S does **not** support an environment-variable settings override such as `OCMS_SETTINGS`.

---

## Local Web UX

v1.3 adds a loopback-only browser control surface. It drives the same synchronization engine as the CLI; the browser is a second control surface, not a separate planner.

```powershell
node ui.mjs
node ui.mjs --no-open
node ui.mjs --port=18752
node ui.mjs --settings=C:\Temp\ocms-test\settings.yaml
node ui.mjs --profile=<name> [--live-state=<not-running|overlays:<paths>>] [--scratch]
```

With `--profile`, the Web UX Previews and Applies against that DSH profile (S5): the target identity and live-state attestation are shown, bound to the Preview, and re-displayed at Apply confirmation; the acknowledgment control is never pre-checked. A blocked profile Preview whose refusal carries planning reasons shows BLOCKED with those reasons (same notice format as the legacy path); any other refusal shows ERROR.

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

`node ui.mjs` without `--settings=<path>` or `--profile` uses the legacy production target (unchanged legacy behavior of the Web UX):

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
# records ocms-s-1.4.6-rc1.tgz; tarballs are never committed (*.tgz)
dsh plugin --profile web add .\ocms-s-1.4.6-rc1.tgz
```

Then restart the DSH `web` profile and hard-refresh the browser. Expected:

```text
Chat | Trajectory | Subtitles | Context | Models
OCMS-S OpenCode Model Sync
SERVER OFFLINE
[ Start Server ]
```

Installing the bundle never starts OCMS-S. Only an explicit **Start Server** spawns the single owned child (`STARTING` → `ONLINE` after bounded readiness against `GET /api/state`); the iframe `src` comes only from trusted Host output. `Stop Server` returns to `OFFLINE`. Client-view unmount, session close, and tab switch never stop the child; Host/plugin disposal always stops the exact owned child (disposal invalidates any in-flight Start generation, so no child spawns after disposal and no disposed `STARTING` operation returns to `ONLINE`).

Since v1.4.2, ownership of that child is held until the child's own `exit` event. A termination request, a `kill()` return value, a child `error` event, or elapsed time never release ownership and never produce `OFFLINE`: a child that cannot be confirmed dead stays owned in `ERROR`, and a later `Start` is refused (`ocms/start-failed`) instead of spawning a second child. Since v1.4.4 the obsolete old-runtime HMR lease is removed because DSH 0.2.1-alpha.2 awaits old Fiber disposal (including the exact-exit child cleanup, reported as `STOPPING` while retiring) before replacement; lifecycle Stop/disposal safety semantics remain intact.

The embedded UI targets the standard production settings file unless the Host row carries a scratch `settingsPath` (development only). `Refresh Preview` only reads the five public sources; only an explicit confirmed Apply writes, and only to the displayed target. Do not Preview/Apply production settings unless you intend to modify them.

DSH compatibility (do not shorten):

```text
Supported DSH target:
OCMS-S v1.4.4 supports DSH 0.2.1-alpha.2 exactly.
No support is claimed for 0.1.5-rc.x, 0.2.1-alpha.1, future 0.2.1 alphas, or >=0.2.1-alpha.2.

Plugin-facing tested runtime:
exact resolved DSH package graph recorded by the gate,
with relevant internal packages at 0.2.1-alpha.2 / 4.0.5-alpha.1 / 3.18.5-alpha.1.
```

Bundle constraints: `dsh.bundle.patch` + `dsh.client { platform: "web", inject: [] }`, main `dsh/host.mjs`, pinned peers `@deepseek-ai/dsh-typert-protocol 0.2.1-alpha.2`, `@deepseek-ai/cordis 4.0.5-alpha.1`, `@deepseek-ai/schemastery 3.18.5-alpha.1`, plus release metadata `engines.dsh 0.2.1-alpha.2` (exact peers remain the admission authority; no wildcard, caret, tilde, or range; no runtime fallback). Legacy file-based plugin formats, prepare-tooling flows, and repository-based loader mechanisms are unsupported.

### OCMS-S v1.4.4 (DSH 0.2.1-alpha.2 compatibility release)

v1.4.4 is a release-preparation update on the accepted DSH 0.2.1-alpha.2 compatibility implementation. It adds no new model-sync functionality and changes no sync/planner/Go/Zen transport semantics:

```text
- DSH 0.2.1-alpha.2 is the supported target (exact; see compatibility block above).
- Peer graph repinned to the new runtime (exact pins above; engines.dsh metadata only).
- Obsolete old-runtime HMR lease removed because current DSH awaits old Fiber disposal before replacement.
- Strict browser Typert codecs now use create() schema factories.
- Lifecycle Stop/disposal safety semantics remain intact (exact-exit ownership).
- Live isolated Web smoke passed on the packed artifact (Models tab, OFFLINE/ONLINE/iframe/Stop).
- No sync/planner/Go/Zen transport semantics changed.
```

### OCMS-S v1.4.5 (package reproducibility repair)

v1.4.5 changes no runtime, model-sync, transport, contract, or Apply behavior relative to v1.4.4. It canonicalizes packaged text files to LF in the Git tree, so `npm pack` is byte-identical across the primary worktree, `git archive`/export, and clean checkouts regardless of `core.autocrlf`. The DSH target remains exactly 0.2.1-alpha.2. (v1.4.4 exposed a Windows clean-checkout repacking mismatch that differed solely in line endings; v1.4.5 supersedes it for deterministic package reproduction.)

Developer ergonomics (`npm run build`, `npm run register -- --profile <explicit>`, `npm run watch`, possibly safe `dev:web`) remain post-release follow-up and are not part of v1.4.4.

### OCMS-S v1.4.6-rc1 (release candidate)

v1.4.6-rc1 is a release candidate. It contains two changes:

```text
- Profile-aware synchronization (S5): explicit --profile targets for the CLI and Web UX,
  live-state attestation, scratch/production classification; bare CLI runs refuse.
- Gateway base derivation (contract v1.4.6-rc1): OpenCode's Zen docs now document endpoints
  under https://opencode.ai/inference/v1/...; these are recognized again, so exact docs
  authority applies to Zen. Settings still receive the unchanged /zen and /zen/go base URLs.
  A new non-blocking ENDPOINT_BASE_DRIFT report section shows models documented under an
  alias base.
```

Verified on Windows with Node 22.23.3 and Node 24.15.0: `npm test` 363 tests (360 pass, 0 fail, 3 authorized skips) and `npm run test:smoke` PASS. Known open items (contract v1.4.6-rc1 §10): `/zen/v1` liveness is not probed; a usable catalog hint can still override a genuinely unrecognized documented endpoint; roster fetches send no API key or session header.

### Upgrading to v1.4.2 (historical: two v1.4.2-era boundaries)

1. **Restart DSH once.** A generation that was already running when v1.4.2 was installed does not participate in the generation handoff, so a hot reload across that one transition is not serialized: the replacement reaches publication while the predecessor is still serving and Cordis refuses the duplicate service registration. Restart the DSH profile after installing v1.4.2; under v1.4.2 every later reload was serialized by the OCMS-S coordinator (v1.4.4 removes that coordinator — see above). Nothing else about the installation changes.
2. **An unconfirmable child blocks reload on purpose.** If an owned child never emits `exit`, plugin disposal stays pending, and so does activation of the replacement generation, until DSH's outer forced-exit boundary. This is the intended trade-off: a stalled plugin unload is preferable to two OCMS-S children serving one Host root.

---

## Run the test suite

```powershell
npm test
```

`npm test` runs the complete release suite with explicit cross-platform test paths (no wildcard expansion, so Windows/Node 20 behaves identically): 373 tests total — 70 legacy/v1.2 regression tests, 84 v1.3 engine/server/UI contract tests, 96 v1.4 DSH-integration tests (embed-origin, client view, lifecycle, ownership retention, compat including the two rc2 pins, disposal-race, host/client compatibility, HMR sequencing), 14 v1.4.1 unsupported-protocol tests, 14 v1.4.6-rc1 gateway-base tests, 6 v1.4.6-rc2 blocked-reasons tests, 1 v1.4.6-rc3 freeze test, 1 v1.4.6-rc4 freeze test, and 87 developer-tooling tests (368 pass, 0 fail, 5 authorized pin skips: the two v1.3 byte-identity pins superseded by contract v1.4.1 §14 and the S5-R4 `sync.mjs` pin, RC1 `sync.mjs` pin and S5-R4 `ui/index.html` pin superseded by contract v1.4.6-rc2 §9; the Typert-registry admission test additionally skips with "capability missing" where no DSH runtime is installed). `tests/support/clean-env-run.mjs` runs the same suite under a scrubbed home with no DSH on PATH and asserts no `.dsh` was created there.

The S5 profile suites (`tests/profile-*/`) run via `npm run test:profile` (every profile file by explicit path, no globs; includes the v1.4.6-rc4 stub/real parity test) and in the `profile suites (real DSH)` CI job on windows-latest Node 22, where the pinned `@deepseek-ai/dsh@0.2.1-alpha.2` is installed into a job-local prefix and verified with `dsh --version` before the run. They are not part of `npm test`, which stays hermetic with no dsh on PATH.

You can also run the suites separately:

```powershell
node --test tests/sync.test.mjs
```

### Acceptance smoke test (real children, retirement ordering)

`npm test` is fully deterministic: it drives the lifecycle and the DSH 0.2.1-alpha.2 retirement ordering through injected doubles. `npm run test:smoke` covers what only a real process can show:

```powershell
npm run test:smoke
```

It loads `dsh/host.mjs` through a real Cordis runtime, drives the real `ocmsLifecycleService` Remote methods, spawns a real `ui.mjs` child on an ephemeral port, and reads child liveness and listener cleanup from the operating system rather than from the code under test. It runs two phases:

```text
PHASE 1  real Host / real child lifecycle
         OFFLINE -> Start -> ONLINE -> GET /api/state -> Stop -> OFFLINE
         -> child gone, listener released, second Stop refused (ocms/not-owned)

PHASE 2  real-child retirement-before-replacement (DSH 0.2.1-alpha.2 ordering)
         registry.delete(predecessor): the predecessor keeps owning its child
         until the actual exit, no OFFLINE is reported while that child is
         alive, the port is released, the old Fiber settles -> only then is the
         replacement generation created -> the replacement begins OFFLINE with
         no inherited child -> replacement Start/Stop proven on a new child
```

The smoke does not invoke `@deepseek-ai/dsh-hmr` itself and makes no claim about that package's internals: it validates OCMS-S real-child retirement-before-replacement behavior through a real Cordis runtime. The framework-facing ordering is separately covered by the accepted compatibility test layer (`tests/v1.4/hmr-generation.test.mjs`).

It uses only a scratch settings file, never the production target, performs no Preview/Apply, kills every child it started on all exit paths, and has a watchdog so a hang can never wedge a machine. It is intentionally **not** part of `npm test`: it needs the DSH peer packages, spawns real processes, and takes seconds rather than milliseconds. Exit code 0 means every check passed (or the run was skipped for an environmental reason, which it says explicitly); 1 means at least one check failed. Options: `--host <path>`, `--strict`, `--timeout <seconds>`.

`--strict` (equivalently `OCMS_SMOKE_STRICT=1`) is meant for unattended runners: a missing prerequisite then **fails** the run instead of reporting a green acceptance, so a skipped section can never pass CI. That is how the `acceptance smoke (real child, retirement ordering)` CI job runs it, on Windows / Node 22, with a bounded job timeout and an ordinary shallow checkout (no Git history or tag is required). The ordinary Node 20/22 test matrix is unchanged and remains the regression gate.

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

```powershell
node --test tests/v1.4.6-rc1/gateway-base.test.mjs
```

```powershell
node --test tests/v1.4.6-rc2/blocked-reasons.test.mjs
```

```powershell
node --test tests/v1.4.6-rc3/freeze.test.mjs
```

```powershell
node tests/support/clean-env-run.mjs
```

You can also perform syntax checks:

```powershell
node --check sync.mjs
node --check ui.mjs
node --check tests\sync.test.mjs
```

Tests use synthetic/temp settings files and must never modify production settings.

---

## Developer commands (post-v1.4.5 local workflow)

These four npm commands are local post-v1.4.5 developer ergonomics for working
from a checkout. They are not part of the v1.4.5 release artifact, they never
perform OCMS-S Preview/Apply, and they never modify production settings.

Build the browser client (canonical deterministic build, no DSH involved):

```powershell
npm run build
```

`npm run build` runs only `dsh/build-client.mjs`. Any forwarded argument is
rejected before execution. It never touches a DSH profile or settings file.

Register this local checkout into one explicitly selected, already existing
DSH profile (no implicit `web` profile; missing profiles are never created):

```powershell
npm run register -- --profile <name>
```

Watch the two build inputs and rebuild on change (150 ms trailing debounce,
one builder at a time; `Ctrl-C` cleans up only owned resources).
`npm run watch` takes no profile argument and never interacts with DSH:

```powershell
npm run watch
```

Build, register and launch the selected profile in the foreground
(`dsh --profile <name> --no-open`, build -> register -> launch).
A port conflict is reported, never repaired by terminating another process;
only a directly spawned child is ever signaled:

```powershell
npm run dev:web -- --profile <name>
```

Safety summary: explicit existing profiles only; no automatic process kill,
no port recovery, no network fallback. `npm run dev:web` may change the
selected development profile through DSH's normal plugin-add operation,
which is not an authorization to modify production settings.

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

Since v1.4.6-rc1 the six base URLs are derived from one canonical base per gateway (`GATEWAY_BASE`: `https://opencode.ai/zen/go` and `https://opencode.ai/zen`): `anthropic-messages` routes use the base, every other route uses `<base>/v1`. The values written to settings are unchanged from v1.4.5.

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
| `https://opencode.ai/v2/docs/console/go/` | exact Go endpoint placement |
| `https://opencode.ai/v2/docs/console/models/` | exact Zen endpoint placement |

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

The endpoint suffix is read after a recognized documented base. Recognized bases are a closed list per gateway (`DOC_ENDPOINT_BASES`, contract v1.4.6-rc1):

```text
Go:  /zen/go/v1/
Zen: /zen/v1/          (canonical)
     /inference/v1/    (documented alias, current Zen docs)
```

An alias affects recognition only; it is never written to settings. The lists never overlap across gateways, and an unlisted base is not guessed (`ENDPOINT_UNSUPPORTED`). Live models documented under an alias base are reported in `ENDPOINT_BASE_DRIFT` (see [Reporting](#reporting)).

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

Since v1.4.6-rc1, documentation base drift is also reported. It never blocks a run:

```text
ENDPOINT_BASE_DRIFT (1):
  - zen documented=https://opencode.ai/inference/v1 routed=https://opencode.ai/zen/v1 models=88
```

Every affected model is listed individually. Warnings are not reduced to counts only.

A blocked profile run lists every planning reason as its own `unresolved` entry, verbatim and in order, after the existing `<code>: <message>` line (exit code 1 unchanged). No other planning `detail` is printed.

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
OpenCode Model Sync — Simple Script Contract v1.4.6-rc1.md
OpenCode Model Sync — Simple Script Contract v1.4.6-rc2.md
OpenCode Model Sync — Simple Script Contract v1.4.6-rc3.md
```

**v1.4.6-rc3 is the current authoritative contract** (test hermeticity only; v1.0–v1.4.6-rc2 unchanged).

v1.4 identities (immutable): contract SHA-256 `3a4461d099e8994c773c98cfe3d001b9fb872fc182c64d31eddf8e46d4f27831` (171 lines); `dsh/lifecycle.mjs` `36f65604cd95322ba643d6ba7baa225d459270113ef75298ad9839e8d79a0c47`; `tests/v1.4/disposal-race.test.mjs` `3edbb9a76cb8dc9cb653efb2006f4810177258060f5885223ae40f826e6cb6d9`; v1.3 baseline `sync.mjs` `9211544a0bba60e3e19a78a8d089d84f9eacedb6105631489ebe377285188c07` and `ui/index.html` `6610e7354f64eb1edbd4827df65fa120c1410ba9121e33fcab87637d96deddf8` unchanged; lineage `HEAD`/`v1.3.0` `50968d968ede3c0c847c6d127e1ff8059f790185`.

v1.4.1 identities (immutable): contract SHA-256 `f48e236f40ee5c15202f18c3e812d3f41742804304d0de0d070342c0adeeb05b` (392 lines); `sync.mjs` `cdd56032042775b39e3c09628e8988ef0ce7d6aa45fd9614196189157ef12b7d`; `ui/index.html` `d2383cd3fb545da64dd51a21ad570f1944fee95e8caf8c98286d9d8d85919658`; lineage `HEAD`/`v1.4.0` `48fb7419508f7f3b43266a045537c65c543784e4`.

v1.4.2 identities: implementation commit `8167039d2120f859c79194e8273d08379a3ffa23` (tree `9f9629574d66aad61f4a2f2e586dc400e772324f`), recorded as line-ending-proof Git object ids — `dsh/host.mjs` `d54e53c77b5355de439443a0da5ad03b53e3eff8`, `dsh/lifecycle.mjs` `761a08a80ad5b3c938881f1cdb64c191076fa910`, `tests/v1.4/lifecycle.test.mjs` `04f053d421e3fb078269ff07366f85bfce1cb885`, `tests/v1.4/disposal-race.test.mjs` `a411a7626114b5af0ca9486506fbf25eacf1e411`, `tests/v1.4/ownership.test.mjs` `a1205f884705bde2547887c78814e11c3b8227c1`, `tests/v1.4/hmr-generation.test.mjs` `a264cc4bd9e6451e47c5d597c09455ea42ef23b4`. v1.4.1 authority is unchanged: `sync.mjs` and `ui/index.html` remain byte-identical (`1533be1fa08b017c9f32bce96e89d46498ef5a54`, `a81fc9f1044bb82c3752c57c1f7d59152ce1c7b2`). v1.4.2 is a correctness release against the v1.4.1 contract; it adds no contract text.

v1.4.6-rc1 identities: contract SHA-256 `f041e7540875e53419243316289cd9b98ef52606cdff4c8ec665c3c9df41fa38` (236 lines); `sync.mjs` `e348ad7456e6ea2ddb83515c34a9a444e9d602051721325cf81283f039b70bad`; commits `77380793f9d71ef7c47b3e7b32a8e2dead3a0a80` (S5 profile-aware sync + R1 docs URL repair) and `cec2f19412c8ffff0cdbbc5a8cdb1a8e39bf93de` (rc1), tag `v1.4.6-rc1`.

v1.4.6-rc2 identities: contract SHA-256 `00204930eb1a12a4250a9eaeecd2828ac1fb83b17ffba8b2772c6d81dd56484a` (227 lines); `sync.mjs` `765a56ee26c165be05ab50b2d25ef7cd38b1e53355d328a0228ad6daf5e512f4`; `ui/index.html` `5979979d8d13d556a5dada32814fe6fb22e39810a27b39fdadb2ff0235ca3321`; baseline tag `v1.4.6-rc1`.

v1.4.6-rc3 identities: contract SHA-256 `d31553f23681bb8372ff01a7fefc999d9ea4f4e74a2ac327551a98d4c42399cb` (238 lines); product bytes identical to v1.4.6-rc2 (`sync.mjs` `765a56ee26c165be05ab50b2d25ef7cd38b1e53355d328a0228ad6daf5e512f4`, `ui/index.html` `5979979d8d13d556a5dada32814fe6fb22e39810a27b39fdadb2ff0235ca3321`); baseline tag `v1.4.6-rc2`.

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
- 57 v1.4 DSH-integration tests as of the v1.4 release, including the disposal-vs-Start race fence (no post-disposal spawn, no stale `ONLINE`, exact-child termination, permanent Start refusal after disposal), verified after an independent HOLD→PASS audit cycle.
- Normal `web`-profile installation acceptance: `Models` tab appears, initial `OFFLINE`, explicit Start → `ONLINE` embedded UI, Stop → `OFFLINE`.

OCMS-S v1.4.1 adds generic unsupported-protocol containment on the v1.4 engine: protocol classification (`classifyProtocolSupport`) before model-record construction, the `SKIPPED_UNSUPPORTED_PROTOCOL` disposition (visible in Preview/CLI report and the Web UX), unchanged strict validation for supported protocols, and unsupported `-free` containment. Verified test-first: 14 v1.4.1 tests; full suite 227 tests (225 pass, 2 authorized §14 skips); live scratch Preview accepts Jev 1.13 / Jev 1.13 Free as explicitly skipped with plan `READY`.

OCMS-S v1.4.2 (historical) made child lifetime exact and the HMR handoff safe: ownership is released only by the owned child's own `exit` event, disposal completes only on that exit, and Stop/disposal/Start-abort share one termination sequence. v1.4.2 also added a process-global per-root coordinator that serialized DSH HMR generations; **v1.4.4 removes that coordinator**, because DSH 0.2.1-alpha.2 awaits old Fiber disposal before replacement (see above), and the acceptance smoke now proves the retirement-before-replacement ordering instead. v1.4.2 was verified test-first (controlled RED before each production edit) with 10 new tests, three independent adversarial audits, a clean-checkout suite run of 243 tests (241 pass, 0 fail, 2 authorized §14 skips) as measured at that release, and a real-runtime smoke test with a real `ui.mjs` child, real Remote calls, and OS-level child-liveness observation. Two v1.4.2-era boundaries are intentional and documented above: one cold DSH restart after upgrading, and a deliberately blocking disposal for an unconfirmable child.

OCMS-S v1.4.6-rc1 adds profile-aware synchronization (S5) and restores exact Zen docs authority after OpenCode moved its documented Zen endpoints to `/inference/v1` (gateway base derivation, closed documented-base aliases, non-blocking `ENDPOINT_BASE_DRIFT`). Verified test-first: 14 v1.4.6-rc1 tests; full suite 363 tests (360 pass, 0 fail, 3 authorized skips) on Windows with Node 22 and Node 24; acceptance smoke PASS; two independent five-axis reviews and a three-specialist ship review, all without Critical findings.

OCMS-S v1.4.6-rc2 shows why a profile Preview is blocked: planning reasons already carried as `detail.reasons` are now visible verbatim and in order in the web `/api/preview` refusal (`blockedReasons`, status/code unchanged; page shows BLOCKED with the legacy notice for `VERIFY_FAILED` plus reasons, ERROR otherwise) and in the CLI blocked-profile report (each reason its own `unresolved` entry, exit 1 unchanged); no other `detail` is exposed. Verified test-first: 6 v1.4.6-rc2 tests; full suite 371 tests (365 pass, 0 fail, 6 authorized skips) on Windows with Node 22 (v22.23.3 via node-win-x64) and Node 24 (v24.15.0); acceptance smoke PASS (13 steps) on both. Future gate: retire or re-anchor the S5 snapshot footprint tests (`tests/profile-reader/t19-footprint.test.mjs`, `tests/profile-acceptance/env04-staging.test.mjs`), which hard-code the S5 gate snapshot and already fail at the rc1 baseline.

OCMS-S v1.4.6-rc3 makes `npm test` hermetic with zero product changes: every suite passes on a clean machine (no `~/.dsh`, no `DSH_HOME`, no `dsh` on PATH) via explicit temp homes, stubbed dsh discovery, a test-only composition stub anchor for the rc2 blocked-reasons tests, and bounded barrier waits; the CI test job proves the clean condition and carries a 15-minute timeout. Verified test-first (clean-env RED→GREEN): full suite 372 tests (367 pass, 0 fail, 5 authorized pin skips) identically in the normal and clean-environment runs on Windows Node 24 (v24.15.0), and green on Node 22 (v22.23.3); acceptance smoke PASS (13 steps) on both; S5 profile suites unchanged at 448 tests (438 pass, 5 pre-existing snapshot failures, 5 skipped) before and after. Future gates: a parity check that the stub anchor and the real DSH composition produce the same result for the rc2 fixtures; running the S5 profile suites in CI against pinned DSH packages installed outside package.json.

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
├── OpenCode Model Sync — Simple Script Contract v1.4.6-rc1.md
├── P1_IMPLEMENTATION_READINESS.md
├── README.md
├── SPEC.md
├── SPEC_DSH_PROFILE_AWARE_SYNC.md
├── cordis.patch.yml
├── package.json
├── package-lock.json
├── sync.mjs
├── ui.mjs
├── profile/               # S5 profile-aware target resolution, Preview and commit
├── scripts/
│   └── dev-tools.mjs      # npm run build / register / watch / dev:web
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
    │   └── smoke.mjs     # npm run test:smoke (real child + retirement ordering)
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
    │   ├── hmr-generation.test.mjs
    │   └── host-client-compat.test.mjs
    ├── v1.4.1/
    │   ├── helpers.mjs
    │   └── unsupported-protocol.test.mjs
    ├── v1.4.6-rc1/
    │   ├── helpers.mjs
    │   ├── gateway-base.test.mjs
    │   └── fixtures/      # captured 2026-10-12 Go/Zen docs pages
    ├── dev-tools.test.mjs
    └── profile-*/         # S5 suites: acceptance, cli-ui, commit, reader, render, target
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
