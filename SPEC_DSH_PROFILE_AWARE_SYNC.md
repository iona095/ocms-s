# SPEC — OCMS-S DSH Profile-Aware Synchronization (Gate P0)

Status: SPECIFICATION ONLY. No runtime, UI, test, or configuration file is changed by this phase.
Baseline: OCMS-S `v1.4.5` (HEAD `85027c35605e966cbacfe02a9a2f3c762403659c`), DSH `0.2.1-alpha.2` EXACTLY.
Output of this phase: this file only (`SPEC_DSH_PROFILE_AWARE_SYNC.md` at repository root).
HARD STOP after acceptance: no implementation, no commit/push/tag, no production Apply, no further gate.

Frozen predecessor: `SPEC.md` (post-v1.4.5 ergonomics) is NOT modified by this document.
Authoritative sync contract: `OpenCode Model Sync — Simple Script Contract v1.4.1.md` (unchanged).

---

## 1. Purpose / scope / non-goals

### Purpose

Determine, from the actually installed DSH `0.2.1-alpha.2`, how OCMS-S can safely synchronize its
six managed OpenCode Go/Zen provider model arrays into DSH's real profile configuration, replacing
the current assumption that the target is the legacy mapping-root file
`%USERPROFILE%\.dsh\settings.yaml` (which is absent on this machine), and select exactly one
implementation-ready architecture — or return `ARCHITECTURE_HOLD`.

### Scope (this gate)

- Verify entry baseline and clean tree.
- Read OCMS-S contracts, source, and tests; freeze unrelated behavior.
- Inspect the installed DSH `ConfigEditor`, atomic-write, HMR, and profile-composition sources read-only.
- Inspect the live profile structure read-only (counts, ids, shapes — never credential values).
- Run narrowly scoped synthetic scratch-fixture checks in `%TEMP%\ocms-spec-scratch` only (outside the repo,
  never against a live profile).
- Produce this single specification document.

### Non-goals (explicitly excluded, frozen)

- Rewriting model discovery; changing routing precedence; adding OMP model overrides.
- Account/entitlement probing; automatic inference probes; background synchronization; scheduler/daemon changes.
- Developer-ergonomics changes (`SPEC.md` scope); release/installation changes.
- Any live profile editing, Preview/Apply run, DSH restart/reconfiguration, dependency install/upgrade,
  commit/push/tag/release.

---

## 2. Verified baselines

### 2.1 Repository entry gate — PASS

| Item | Expected | Observed | Verdict |
| --- | --- | --- | --- |
| Repository | `C:\Users\GNV\.dsh\tools\ocms-s` | same | match |
| Branch | `main` | `main` | match |
| HEAD commit | `85027c35605e966cbacfe02a9a2f3c762403659c` | `git rev-parse HEAD` → identical | match |
| HEAD tree | `1d535dd50260ccda0fce67bb7a09f41eddd09b4b` | `git rev-parse 'HEAD^{tree}'` → identical | match |
| Working tree | clean | `git status --porcelain=v1` → empty | clean |
| Release baseline | `v1.4.5` | `package.json:3` `"version": "1.4.5"`; tags `v1.2.0`–`v1.4.5` present | match |
| DSH | `0.2.1-alpha.2` EXACTLY | `dsh --version` → `0.2.1-alpha.2`; install manifest `name @deepseek-ai/dsh, version 0.2.1-alpha.2` | match |

No baseline drift. No HOLD triggered by §0. No history rewrite performed.

### 2.2 Files examined (OCMS-S)

- `sync.mjs` (full read, §§2–12 engine: sources, `MANAGED_ROUTES`, planning, `buildPlan`, `commitPlan`).
- `ui.mjs` (full read: retained Preview slot, `/api/preview`, `/api/apply`, target classification).
- `dsh/host.mjs` (185 lines, full read: Host plugin owns one lifecycle controller; no config editing).
- `dsh/lifecycle.mjs` (516 lines, full read: exact-exit child ownership).
- `README.md` (full read: v1.4.1 authority, six routes, backup/write safety, compat rules).
- `cordis.patch.yml` (8 lines: OCMS-S bundle row `ocms-s`, Host-owned `config` scratch escape hatch only).
- `package.json` (pins: peers `@deepseek-ai/dsh-typert-protocol 0.2.1-alpha.2`,
  `@deepseek-ai/cordis 4.0.5-alpha.1`, `@deepseek-ai/schemastery 3.18.5-alpha.1`; `engines.dsh 0.2.1-alpha.2`).
- `SPEC.md` (read; frozen, untouched).
- Test inventory listed: `tests/sync.test.mjs`, `tests/dev-tools.test.mjs`, `tests/v1.3/*` (6 files),
  `tests/v1.4/*` (8 files), `tests/v1.4.1/unsupported-protocol.test.mjs`. No test was executed in this gate.

### 2.3 Files examined (installed DSH, read-only)

Install root: `C:\Users\GNV\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh`
(nested runtime packages under `node_modules\@deepseek-ai\`).

- `dsh-config-editor@0.2.1-alpha.2`: `lib/index.js` (138 lines, full read), `lib/types/index.d.ts`,
  `README.md`, `package.json` (deps: `dsh-atomic-write 0.2.1-alpha.2`, `yaml ^2.8.1`, `js-yaml ^4.3.2`;
  peers pin cordis / loader / hmr / include / app-boot at the `0.2.1-alpha.2`-era graph).
- `dsh-atomic-write@0.2.1-alpha.2`: `lib/index.js` (217 lines, full read) — `withFileLock`, `writeFileAtomic`.
- `dsh-app-boot@0.2.1-alpha.2`: `lib/index.js` excerpts (profile composition, patch I/O, reconciliation),
  `lib/types/profile-context.d.ts` (full read).
- `dsh-hmr@0.2.1-alpha.2`: `lib/index.js` excerpts (`runExclusive`, `watchConfig`, profile file watching).
- `dsh-base@0.2.1-alpha.2`: `cordis.patch.yml` excerpt around `llm-pi-ai` (ownership evidence).
- CLI: `dsh --help` (launcher flags), `dsh --version`.

### 2.4 Live profile structure (read-only, values never copied)

- `%USERPROFILE%\.dsh\settings.yaml` — ABSENT (`ENOENT`). Confirms `defaultSettingsPath()`
  (`sync.mjs:1005-1009`) currently selects a missing file.
- `%USERPROFILE%\.dsh\settings.yaml.imported` — present (153,005 bytes). Root is a YAML **mapping**
  with keys including `llm-pi-ai`; `llm-pi-ai.providers` is a mapping containing the six managed route keys
  among others. **Correction to the gate's §2 input:** this archived file contains **zero** `!!` custom-tag
  occurrences (verified by byte scan). The `!!js` tags live in the live profile patch (see below), not in
  the archived legacy file. This discrepancy is recorded here; it does not affect the entry gate.
- Home patch `%USERPROFILE%\.dsh\cordis.patch.yml` — ABSENT.
- Active web profile patch `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml` — present (171,978 bytes,
  5,029 lines). Root is a YAML **sequence** with **21** root entries. `llm-pi-ai` is at root index **12**
  today (single occurrence; index is coincidental, never authoritative). The entry carries a `config:` mapping.
  Two `!!js` expressions exist in unrelated entries (lines 4890/4893, platform-conditional `disabled` flags).
- Web `package.json` — 12 bundles including `ocms-s`; base bundles `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`.
- Bundled `dsh-base/cordis.patch.yml` mounts `- id: llm-pi-ai / name: '@deepseek-ai/dsh-llm-pi-ai'` with
  **no `config:`** — mounted dormant ("zero routes … until a `llm-pi-ai:` settings section supplies provider
  profiles", per the in-file comment). Effective provider definitions therefore come from a later patch layer.

### 2.5 Module resolvability probe (read-only, no execution of DSH)

- From the OCMS-S checkout: `@deepseek-ai/dsh-atomic-write`, `@deepseek-ai/dsh-app-boot`,
  `@deepseek-ai/cordis-plugin-include` are all `MODULE_NOT_FOUND` (OCMS-S ships only `yaml` +
  `node-html-parser`). Any implementation that reuses DSH's lock/composition code MUST resolve these
  from the DSH installation anchor or the target profile directory, with fail-closed refusal — it cannot
  rely on bare-specifier resolution from the checkout. This is a specified dependency consequence (§11.6).
- From the web profile directory and from the DSH install root: all three resolve at
  `0.2.1-alpha.2` / `1.0.10-alpha.1` (include). SOURCE-VERIFIED.

### 2.6 Synthetic scratch fixtures (outside the repo, no live profile touched)

Location: `%TEMP%\ocms-spec-scratch\` (scan, structural, YAML-preservation, and resolve probes only).
A `yaml` Document edit replicating the editor's exact parse/edit/serialize steps was run against a
hand-written 3-entry fixture. Results are cited in §5 (N3/N4) as SCRATCH-VERIFIED. No DSH Loader, HMR,
or profile process was started; no live file was read for content beyond the structural scans of §2.4.

---

## 3. Current OCMS-S architecture (frozen)

### 3.1 Responsibilities and boundaries

- **Five public source acquisition contracts** (`sync.mjs:28-34`, `fetchSources` at `sync.mjs:1356-1376`):
  Go roster, Zen roster, `models.opencode.ai/api.json` catalog, Go docs table, Zen docs table. Fetched on
  every run; failures are fail-closed (`FETCH_FAILED`, `ROSTER_INVALID`, `CATALOG_INVALID`, `DOCS_INVALID`).
- **Six managed route definitions** (`sync.mjs:42-81`): `opencode-go`, `opencode-go-messages`,
  `opencode-go-responses` (gateway `go`); `opencode-completions`, `opencode-messages`, `opencode` (gateway `zen`).
  `MANAGED_ROUTE_KEYS` is the closed set. Managed container: `llm-pi-ai.providers`.
- **Strict model metadata validation** (`buildModelRecord`, `sync.mjs:372-408`): exact catalog id match,
  name, `limit.context`/`limit.output`, input modalities allowlist (`DSH_INPUT_MODALITIES`, `sync.mjs:92`),
  reasoning-effort projection. Anything uninventable is `unresolved(...)` (blocking) — never guessed.
- **Model protocol/placement authority** (`endpointApi` `sync.mjs:227-253`, `resolvePlacement` `sync.mjs:465-507`,
  `classifyProtocolSupport` `sync.mjs:542-562`, `-free` counterpart fallback `sync.mjs:607-648`): exact docs row
  first, then exact model-local `provider.npm` hint; Google-style is unsupported, never placed.
- **Unsupported/unresolved containment** (`planDesired`, `sync.mjs:662-812`): every live id finishes as
  `RESOLVED`, `PRESERVED_UNRESOLVED`, `SKIPPED_UNRESOLVED`, or `SKIPPED_UNSUPPORTED_PROTOCOL`, or the run blocks.
  `compat` is opaque local config copied target-locally under conflict rules (`selectCompat`, `sync.mjs:438-454`).
- **Preservation of existing compat** (`README.md` "Local `compat` preservation"; `sync.mjs:790-803`): rebuilt
  models carry target-local `compat`; `CATALOG_MISSING` keeps the complete existing record unchanged.
- **One retained Preview plan** (`ui.mjs:237-239`, `349-360`): single `activePreview` slot with `previewId`,
  frozen `plan` (deep-frozen structured clone), `settingsDigest`, `sourceSnapshotDigest`, `generatedAt`.
  `Preview` busy-guarded (`previewBusy`/`applyBusy`, `ui.mjs:286-289`); fetch failures yield retained `BLOCKED`.
- **Explicit user-confirmed Apply** (`ui.mjs:369-427`): exactly one `previewId` key accepted; `STALE_PREVIEW`
  unless the presented id equals the retained id and state is `READY`; success clears the slot (`activePreview = null`).
- **Source snapshot digest** (`planningSourceBundle` + `canonicalJson` + `sha256Hex`, `sync.mjs:122-160`):
  bound at plan time over the normalized planning bundle.
- **Exact target-byte stale digest** (`buildPlan` `sync.mjs:1115-1196` reads target bytes once, digests exact
  bytes at `sync.mjs:1132`; `commitPlan` re-reads and byte-compares at `sync.mjs:1237-1247` before any backup/temp
  file exists — even parse-equivalent edits refuse).
- **NO CHANGE idempotence** (`managedArraysMatch`, `sync.mjs:895-910`; `NO_CHANGE` path `sync.mjs:1311-1323`):
  write authority is actual array equality (order, multiplicity, fields), not the report diff; no backup on NO CHANGE.
- **Exact-byte backup** (`commitPlan`, `sync.mjs:1259-1271`): timestamped `settingsPath + '.bak-<stamp>'` written
  with the exact pre-commit bytes before temp-file work.
- **Temporary write validation** (`sync.mjs:1272-1278`): candidate must YAML round-trip, re-parse, and expose
  exactly the six desired arrays (`assertGeneratedManagedArrays`, `sync.mjs:912-919`) both in memory and from
  the temp file before `renameSync` (`sync.mjs:1279`).
- **Blocked/refused outcome reporting** (`NOT WRITTEN` with reasons; `STALE_SETTINGS`; `COMMIT_REFUSED:*`).
- **Host/UI process ownership** (`dsh/host.mjs:140-176`, `dsh/lifecycle.mjs:42-516`): exactly one lifecycle
  controller per Host plugin instance; owned child identified by handle; ownership released only by that handle's
  own `exit` event (`lifecycle.mjs:96-101`, `183-207`); disposal awaits exact exit; no process-table inference.

### 3.2 Mapping-root assumptions that MUST move (and only these)

1. `defaultSettingsPath()` / `resolveSettingsPath()` (`sync.mjs:1005-1016`) — target is a missing legacy
   mapping-root file. Superseded by explicit `ProfileTargetResolver` (§11.1); the `--settings=` escape hatch
   is retained for scratch only.
2. `readSettingsFile()` (`sync.mjs:1018-1026`) — asserts a mapping root. Superseded by
   `ManagedConfigReader` over a sequence-root patch (ID-selected entry).
3. `validateExistingProviderShapes()` / `currentModelsArray()` / `buildNewConfig()` (`sync.mjs:855-1052`) —
   assume `config['llm-pi-ai'].providers`. Reused for the *config-object* half (pure desired-state logic),
   but the *document* half (parse/locate/serialize a sequence-root patch) is new work (§11).
4. `ui.mjs` target classification (`ui.mjs:216-218`, production = path-equals-default) — superseded by
   SCRATCH-vs-PRODUCTION classification on profile identity (§8.7).
5. Everything else (planning, placement, validation, Preview/Apply state machine, lifecycle) is FROZEN and reused
   verbatim. No contract amendment to planning/placement/compat semantics is proposed.

### 3.3 Public-contract amendments (TWO proposed, both pending approval — C4)

**A-1 (proposed): target relocation amendment.** The commit target changes from "the legacy
mapping-root `settings.yaml` file" to "the `config` of the ID-selected `llm-pi-ai` entry in the
explicitly selected profile's writable patch file, subject to override refusal (§8.5)". All other
guarantees (exact-byte stale digest, exact-byte backup, temp validation, NO CHANGE idempotence,
explicit Apply) are preserved with profile-bound identity. This amendment is NOT in force until a later
implementation gate approves it; this spec only defines its shape.

**A-2 (proposed): temp-verification relocation amendment (R3).** The v1.x explicit-`.tmp`-file
pre-rename re-parse (`sync.mjs:1272-1278`) is NOT replicated file-for-file: `writeFileAtomic` owns its
internal temp sibling and exposes no handle to it. Instead the safety guarantee is relocated without
weakening its outcome: (i) pre-write verification applies to the EXACT byte-identical commit string
passed to `writeFileAtomic` (schema-dialect parse + six-array asserts + footprint asserts, §7.2 steps 8–9);
(ii) the rename is atomic (old-complete or new-complete, never partial); (iii) post-write re-read
verification asserts the file bytes (§7.2 step 12), and any post-write verification failure enters the
explicit safe-error state of §12.4 (backup retained, operator-confirmed recovery, no auto-revert). "Temp
verification satisfied" MUST never be claimed merely because `writeFileAtomic` uses an internal temp.
A-2 is NOT in force until approved alongside A-1 at the §15 gate; until then the current `commitPlan`
temp-file contract stands unmodified for the legacy path.

---

## 4. DSH effective configuration and ownership map (verified from source)

Composition rule (source): a profile is a directory under `$DSH_HOME/profiles/<name>` holding
`package.json` (ordered `dsh.profile.bundles`) plus `cordis.patch.yml` (user patch layer). The tree is
composed by applying each bundle's patch lists in bundle order over an empty entry list, then the
profile's own patches, then launcher layers (`app-boot/lib/index.js:478-484`).

### 4.1 Layer ordering (gate's stated order CONFIRMED, one label corrected)

`readProfilePatches` (`app-boot/lib/index.js:1104-1115`) concatenates, in application order:

1. bundled configuration — `profile.layers[].patches` in `dsh.profile.bundles` order;
2. profile configuration — the selected profile's `cordis.patch.yml` (user layer);
3. home patch — `<DSH_HOME>/cordis.patch.yml` (absent on this machine; missing file = "no layer",
   `loadOptionalPatches`, `app-boot/lib/index.js:3663-3672`);
4. `--patch` overlays — `context.overlays`, parsed CLI overlays in given order (repeatable,
   `dsh --help`: "`--patch <path>` extra patch-list overlay applied after the profile layer");
5. telemetry hard-disable patch (only when `DSH_TELEMETRY_DISABLED` is non-empty and the row exists).

`composeEntries` applies the flattened list through the include's own patch algorithm (`app-boot/lib/index.js:1070-1075`);
later layers win. "Home patch" in the gate text means the DSH-home-level `cordis.patch.yml`, not the profile file.

### 4.2 Ownership answers A–I

**A. Profile identity resolution.** By explicit launcher selection: `dsh --profile <name>` (or positional
`dsh <name>`), resolved by `resolveProfileDir(name, home)` (`app-boot/lib/index.js:533-536`, rejects empty /
separators / `.` / `..` / `node_modules`) to `$DSH_HOME/profiles/<name>`. At runtime the fact is
`profileContext.name` / `.dir` / `.patchPath` (`profile-context.d.ts:10-25`). SOURCE-VERIFIED.
Never infer the active profile from directory enumeration or from a running web server's port.

**B. Owner of the persisted `llm-pi-ai` provider definitions.** The selected profile's writable patch file
`<profileDir>/cordis.patch.yml` (the user layer), because: the bundled `dsh-base` layer mounts `llm-pi-ai`
with no `config:` (dormant, §2.4); the web profile's user layer supplies the `config:` with `providers`
(verified structurally); no home patch exists; `--patch` overlays are launch-time only and not persisted by
the editor (editor writes `profileContext.patchPath` exclusively). SOURCE-VERIFIED (bundle excerpt + editor
`documentPath`, `config-editor/lib/index.js:24-26`).

**C. Writable vs overridden.** The patch file is writable, but the *entry* may be overridden by a
higher-priority layer (home patch `config` for the same id, or `--patch` overlay `config`). The editor
detects this AFTER rendering the candidate and BEFORE writing: it recomposes with the candidate and throws
`Configuration for "<id>" is overridden by a home patch or command-line overlay` leaving the file unchanged
(`config-editor/lib/index.js:117-122`). A standalone adapter must perform the same file-based composition
check (§8.5). SOURCE-VERIFIED mechanism; any live-overlay state on this machine is UNKNOWN (launch args of a
running DSH were not inspected, per the no-process-interference rule).

**D. Duplicate IDs.** Several entries MAY share one id in the file (patch lists are append-ordered; group
children also carry ids). Resolution rules, source-verified: (i) composition is single-pass apply in order,
later wins; (ii) the editor's `entries()` exposes ONLY loader entries whose id occurs exactly once among
root-Include-owned candidates (`config-editor/lib/index.js:30-35`) — a duplicated `llm-pi-ai` is therefore
*not editable* natively ("no longer available" refusal path); (iii) the editor's document locator uses
`findLastIndex` on `(id, name)` without `insert` (`config-editor/lib/index.js:98`). OCMS-S MUST refuse on
missing/duplicate `llm-pi-ai` rather than pick first/last (§8.4). SOURCE-VERIFIED.

**E. Source patch vs effective config CAN legitimately disagree.** Yes: higher-layer `config` override (C),
`disabled:` rows, group-child composition, Loader admission (compat-denied bundles contribute no layer),
and the telemetry patch. A syntactically valid patch is not proof of effective correctness — Preview MUST
report stored-vs-effective distinctly (§8.8). SOURCE-VERIFIED (composition + `configuration()` inherited/override
split, `config-editor/lib/index.js:39-63`).

**F. File observation of profile edits (C3-corrected).** A file-watching code path exists in HMR
(`watchConfig` registration of the profile `patchPath`, home patch, and manifest with refresh via
`reconcileProfilePatches`, `hmr/lib/index.js:696-719`). HMR SOURCE TEXT IS NOT RUNTIME OBSERVATION:
whether a running profile reconciles an external patch write, when, and with what result is UNKNOWN
(no DSH process was started, touched, or probed — claiming live integration from static inspection is
forbidden). The specification therefore claims NO production activation fact (§7.5): safety rests on
file-truth + verification + UNKNOWN-flagging, with scratch-runtime observation reserved to T16/T20 and
labeled `SCRATCH-VERIFIED`, never generalized.

**G. Active-profile identification without guessing.** Via explicit user selection (`--profile <name>`) validated
by `resolveProfileDir` grammar, bound at runtime to `profileContext.name`; never by directory-name heuristics
or by probing a running server. The CLI additionally offers `--dump-config` / `--dump-default-config` for
non-mutating composition inspection (not invoked in this gate). SOURCE-VERIFIED.

**H. Disconnected/offline profile.** File-based composition (`loadProfileDirectory`, `readProfilePatches`,
`composeEntries`) needs no running process: an offline profile's stored and effective (minus launch-time
`--patch`/telemetry layers, which must be declared explicitly) configuration is fully determinable from its
directory. Native *editing* is unavailable offline (§5, N14). SOURCE-VERIFIED for reads; editing limitation
SOURCE-VERIFIED.

**I. Target resolution independent of an active DSH process.** YES for read/plan (directory + files +
`resolveProfileDir` grammar). NO for native commit (requires live Loader/Fiber/HMR). Hence Preview is
offline-safe in all candidate architectures; only the commit transport differs (§10). SOURCE-VERIFIED.

---

## 5. ConfigEditor feasibility matrix N1–N17

Evidence labels: **SOURCE-VERIFIED** (read from installed `0.2.1-alpha.2` source),
**SCRATCH-VERIFIED** (replicated in `%TEMP%\ocms-spec-scratch` against synthetic fixtures only),
**UNKNOWN** (cannot be verified without touching a live profile/runtime — not done in this gate).
No item is marked verified by live integration.

Calling interface (source): `edit(entry, change)` where `entry` is a current Loader entry and
`change(current, inherited) => next` derives the complete raw config
(`dsh-config-editor/lib/types/index.d.ts:28-34`). The service requires Cordis injection
`["loader", "profileContext"]` (`config-editor/lib/index.js:17-18`) and optional HMR exclusivity.

| # | Question | Verdict | Evidence |
| --- | --- | --- | --- |
| N1 | All six arrays in ONE logically atomic edit? | **YES, with stated limits** | SOURCE-VERIFIED: one `edit()` call derives one complete `next` config, holds `withFileLock` + `hmr.runExclusive` across derive→validate→write→reconcile (`config-editor/lib/index.js:69-135`). Six `models` arrays live inside one plugin `config`, so one call covers all six. "Atomic" = single-file atomic replacement + serialized reconcile with best-effort restore (§5.1, N12) — NOT multi-file atomicity. No live six-array call was performed. |
| N2 | ID-based selection, not offset? | **YES** | SOURCE-VERIFIED: `findLastIndex` on `(id, name)` excluding `insert` rows (`config-editor/lib/index.js:98`); `entries()` exposes unique ids only (ll.30-35). Index 12 is never referenced. |
| N3 | Preserve unrelated entries, comments, custom tags, anchors, scalar styles, unknown fields? | **PARTIAL — boundary drawn** | SOURCE-VERIFIED + SCRATCH-VERIFIED: the edit is a `yaml` `Document` mutation (`parseDocument` ll.91-96, `setIn` l.110, `String(document)` l.123); the README states comments and `!!js` *outside replaced values* are preserved (`config-editor/README.md:41`). Scratch probe confirmed: top/unrelated comments, inline comments in untouched entries, and `!!js` in an untouched entry all survive; the file root sequence and unrelated entries are otherwise untouched. **Inside the replaced `config` subtree, comments/formatting are normalized away** (scratch: route/model comments lost; `createNode(next)` rebuilds the subtree — anchors/styles inside it cannot survive by construction). Unknown fields *outside* `config` survive; anything inside `config` survives only if the caller carries it in `next`. |
| N4 | Preserve provider-specific settings, credentials, compat, route metadata? | **CALLER-DEPENDENT (mechanism supports it)** | SOURCE-VERIFIED: the editor replaces the whole `config` node with `next` (l.110) and validates the complete candidate through the Loader `internal/config` waterfall + `resolveConfig` (ll.82-83). Nothing inside `config` is merged. Preservation of unrelated providers, route-level fields, `compat`, and credential *references* is therefore the caller's duty via `change(current, inherited)`; the editor guarantees only that what the caller returns is what gets validated, override-checked, and written. |
| N5 | Refuse overlay-overridden target? | **YES (pre-write)** | SOURCE-VERIFIED: candidate recomposed through `readProfilePatches` + `composeEntries`; mismatch with `next` throws the `overridden by a home patch or command-line overlay` error BEFORE `writeFileAtomic` (ll.117-123). File left unchanged on this path. |
| N6 | Require live Loader/Fiber state? Exact state? | **YES — strictly online** | SOURCE-VERIFIED: needs `entries()` to contain `entry` (unique, root-Include-owned, l.73), `entry.fiber !== undefined`, `fiber.state === 2` (active, l.81), plus pre/post `reconcileProfilePatches` against `ownerContext.root` (ll.75, 125) which requires the root Include entry (`app-boot/lib/index.js:3623-3626`). No offline path exists in the function. |
| N7 | Invocable from OCMS-S's process architecture without crossing an ownership boundary? | **HOST-ONLY, with plumbing** | SOURCE-VERIFIED mechanism, integration UNKNOWN: `ConfigEditor` is a Cordis service in the DSH Host process (`ctx.configEditor`, `index.d.ts:1-8`). OCMS-S `dsh/host.mjs` already runs IN that process (`apply(ctx)`, `host.mjs:140`) but declares no `inject` and never touches `loader`/`profileContext`/`configEditor`. Calling natively requires: Host-side injection/plumbing + a new Typert Remote method + UI-child→Host transport. The `ui.mjs` child (separate Node process, spawned by the lifecycle controller) CANNOT call it directly. No live call was made; cross-process design is specified, not proven. |
| N8 | How does the UI child reach the native editor? | **Only via a new Host Remote method** | Design (proposed, §11.4): extend `OcmsLifecycleService` (`host.mjs:92-131`) with an explicit plan-bound apply method; the `ui.mjs` child POSTs the retained plan reference over the existing loopback token channel; ALL Loader interaction stays in the Host process. No such method exists today — SOURCE-VERIFIED absence. |
| N9 | Lock acquired? Path and scope? | **Exact** | SOURCE-VERIFIED: `withFileLock(join(profileContext.dir, "package.json"))` (l.72) → sibling lock `<profileDir>/package.json.lock`, mode `0o600`, PID record, cross-process (`atomic-write/lib/index.js:188-215`). Scope: serializes **writers** of the profile manifest/patch cycle; readers stay lock-free. Default contender wait 2 s (`DEFAULT_LOCK_WAIT_MS`, l.163); stale-holder takeover only on proven process exit (`ESRCH`, ll.121-146). Protects the whole read→derive→validate→write→reconcile cycle of one `edit()`. It does NOT lock home-patch or `--patch` overlay files. |
| N10 | Can an outside OCMS-S writer coordinate with the SAME protocol? | **YES, by importing the same package** | SOURCE-VERIFIED protocol; integration UNBUILT: `withFileLock`/`writeFileAtomic` are importable (`@deepseek-ai/dsh-atomic-write`), resolvable from the profile dir / DSH install at `0.2.1-alpha.2` (§2.5) but NOT from the OCMS-S checkout. A standalone adapter that locks the identical `<profileDir>/package.json` path with the identical package coordinates exactly with native writers. Vendoring/reimplementing the protocol is FORBIDDEN by this spec (drift risk). Dynamic resolution + exact-version admission + fail-closed refusal specified in §11.6. |
| N11 | Validation / cancellation / filesystem / reconcile / rollback-failure behavior? | **Mapped from source; rollback-restore is best-effort** | SOURCE-VERIFIED: (a) Loader validation failure (`waterfall`/`resolveConfig` throw, ll.82-83) → throws, file untouched. (b) Stale/replaced entry (`entries()` exclusion, `fiber.state !== 2`, ll.73-81) → throws, file untouched. (c) Missing patch file → defaults to `"[]\n"` (ll.87-90); other read errors, YAML errors (`document.errors[0]`, l.95), non-sequence root (l.96) → throw, untouched. (d) Reconcile failure AFTER write → restores `before` via `writeFileAtomic` + re-reconciles `beforePatches`, then rethrows (ll.124-130). (e) **Restore/re-reconcile failure itself → propagates; the file/runtime may then disagree** — no second fallback exists in source. Cancellation: no token; HMR-closed → `HMR is disposed`; lock contention → timeout error after deadline; nested HMR transaction → `HMR transactions cannot be nested` (`hmr/lib/index.js:633-641`). Spec mandates an explicit safe-error state for (e) (§12.4). |
| N12 | Atomic commit guarantee vs single-file replacement? | **Single-file atomic replacement ONLY** | SOURCE-VERIFIED: `writeFileAtomic` = exclusive-create random-suffix sibling + rename (`atomic-write/lib/index.js:61-77`), with bounded Windows transient-rename retries (ll.31-44). The module's own docs state **"Crash durability (fsync) is out of scope"** (l.56). Runtime reconciliation is a separate post-commit step; its rollback is file-restore + re-reconcile (best-effort, N11e). This spec distinguishes `ATOMIC_REPLACEMENT` / `CONSISTENT_RUNTIME_RECONCILIATION` / `ROLLBACK` / `CRASH_DURABILITY` (§7.5) and claims only the first (plus serialized reconciliation). |
| N13 | Offline Preview via the editor? | **NO** | SOURCE-VERIFIED: `entries()`/`configuration()`/`inherited()` all require live Loader + `profileContext` + composition inputs. Offline Preview MUST use the file-based path (`loadProfileDirectory`/`readProfilePatches`/`composeEntries` need no process, §4 H/I) — available to every candidate architecture without the editor. |
| N14 | Offline Apply via the editor? | **NO** | SOURCE-VERIFIED: same requirements as N6 plus post-write live reconcile. Any offline Apply MUST be a standalone file transaction (candidate C), never a native call. This single fact rejects architecture B as a sole path if the offline-Apply contract is retained (it is — §3.1, existing CLI/scratch behavior). |
| N15 | Supported public interface vs internal detail? | **Documented intra-DSH interface, version-pinned — not a general public API** | SOURCE-VERIFIED: the package README documents `ctx.configEditor.edit()` as THE caller API for complete-configuration edits (`config-editor/README.md:28-34`, `:41`), with typed declarations and stated limitations (`:63-69`: active-profile-only, override refusal, unique-entries-only). It is nevertheless a DSH-internal package (no semver stability promise to external tools; breaking change arrives with the pinned DSH version). Integration must pin exactly and treat version skew as refusal (§11.6). |
| N16 | Version/pinning sufficient for stable integration? | **CONDITIONAL** | SOURCE-VERIFIED facts: installed DSH is exactly `0.2.1-alpha.2` (§2.1); OCMS-S peers pin the era graph (`package.json:43-50`); `dsh-config-editor` itself is `0.2.1-alpha.2`-pinned to the same graph. Gap: OCMS-S does NOT currently pin `dsh-config-editor` / `dsh-atomic-write` / `dsh-app-boot` (not resolvable from the checkout, §2.5). Sufficient ONLY with the added exact pins + install-anchor resolution + runtime version assertion specified in §11.6. |
| N17 | Match OCMS-S stale-Preview/backup contract? | **NO — gaps must be layered, not assumed** | SOURCE-VERIFIED gaps: the editor performs NO exact-byte stale digest (it re-reads + reconciles inside the lock, but never binds to a Preview-time digest) and writes NO exact-byte backup (rollback restores `before` text in place — the pre-edit bytes are held only in memory for the call duration). Both OCMS-S guarantees must be re-provided by the adapter: digest check INSIDE the protected boundary and backup ordering are specified in §7 (and are the reason §10 prefers an adapter that owns its transaction). |

### 5.1 "Exists" ≠ "suitable" (explicit)

`ConfigEditor` exists, is documented, and handles ID selection, `!!js` round-trip, override refusal,
locking, HMR exclusivity, atomic replacement, and reconcile-with-restore. It is nevertheless unsuitable as
OCMS-S's SOLE commit path because: it is online-only (N6/N13/N14), it provides no Preview-bound stale digest
or backup (N17), preservation inside `config` is entirely caller-side (N4), its rollback-restore can itself
fail into a file/runtime-disagreement state (N11e), it is reachable only from the Host process (N7/N8), and
it is a version-pinned internal interface (N15/N16). A single-plugin smoke test — never performed here —
would additionally prove nothing about six-array updates (N1 requires the complete-`next` discipline, not a demo).

---

## 6. Native API and process-boundary findings

### 6.1 Exact calling interface (source)

```ts
// dsh-config-editor/lib/types/index.d.ts:28-34
edit(
  entry: Entry,  // current Loader entry; also the replacement detector
  change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
): Promise<void>;
```

`entry` is obtained from `configEditor.entries()` (unique, root-Include-owned) or `configuration()[i].entry`.
`current` = live entry config; `inherited` = composed sub-profile layers below the user patch.
`next` = the COMPLETE desired plugin config (OCMS-S would return `{...carried, providers: {...with six models
arrays replaced...}}`). Pre-conditions enforced inside the lock: entry still listed, `entry.fiber` defined,
`fiber.state === 2`, candidate passes Loader validation, candidate not overridden. Post-conditions: single
patch-file replacement + scoped reconcile of `[entry.options.id]`, or throw with file restored.

### 6.2 Process map (source)

- **DSH Host process** (Cordis root, Loader, `profileContext`, optional HMR, `configEditor` service):
  the ONLY process that may call `edit()`. OCMS-S's `dsh/host.mjs:140-176` already executes here but uses
  none of these capabilities today (verified absence: no `inject`, no `loader`/`profileContext` reference
  in the 185-line file).
- **`ui.mjs` child process** (plain Node, spawned by the lifecycle controller with
  `--port/--embed-origin/--settings`, `lifecycle.mjs:327-332`): MUST NOT touch Loader state; reaches native
  editing only through a new Host Remote method (§11.4). Current Remote surface is
  `status/start/stop` only (`host.mjs:92-131`).
- **CLI process** (`node sync.mjs --settings=...`): offline file actor; never Loader-adjacent. Under every
  candidate it keeps working against scratch files and (for C) against explicit profile targets via the
  standalone transaction.

### 6.3 Ownership and dependency-boundary rules (normative, R6-reconciled)

1. Loader/Fiber/HMR SERVICE interaction — `ctx.loader`, `ctx.get("hmr")`, `ctx.configEditor`,
   `reconcileProfilePatches`, Loader waterfalls — occurs ONLY in the Host process, ONLY through `ctx.*`
   services, and NEVER from the UI child or CLI. No new service architecture is created for any candidate.
2. Standalone file-utility allowlist (exhaustive — the ONLY DSH code loadable in CLI or UI-child
   processes, and ONLY as pure file/format/lock utilities, never as runtimes):
   - `@deepseek-ai/dsh-atomic-write`: `withFileLock` and `writeFileAtomic` ONLY;
   - `@deepseek-ai/dsh-app-boot`: `loadProfileDirectory`, `readProfilePatches`, `composeEntries` ONLY
     (pure profile-path/composition readers; any further symbol needs a spec amendment);
   - `@deepseek-ai/cordis-plugin-include`: `entryListSchema` ONLY (patch-list schema dialect);
   - `yaml` / `js-yaml`: Document handling and schema-dialect parsing.
   FORBIDDEN in CLI/UI-child processes: `reconcileProfilePatches` (requires the root Include entry and
   throws outside a booted Host, `app-boot/lib/index.js:3623-3626` — defense in depth), `ConfigEditor`,
   any `cordis` Service/Context import, any `dsh-hmr` import, any Loader import, and any other symbol of
   the three admitted packages. The UI child and the CLI use the IDENTICAL commit function, resolution
   order, exact-version admission, and refusals (T15); resolution uses absolute anchors only (target
   profile `node_modules` → DSH install anchor derived from the resolved `dsh` executable location, per
   §11.6), never bare-specifier hope and never `cwd`-dependent lookup.
3. The UI child speaks Preview/Apply over the loopback token channel exactly as today; it performs file
   reads/writes ONLY through the shared `ProfileAwareCommit` function under §6.3.2 — never through
   Host/Loader calls (no such calls are introduced for architecture C; the N8 native-transport design is
   NOT pursued).
4. No OCMS-S code nests `hmr.runExclusive` inside another exclusive section, and no code holds
   `withFileLock(package.json)` while calling `edit()` (which acquires the same non-reentrant lock) — §7.4.
   The adapter NEVER calls `edit()`.
5. Installed DSH files are NEVER edited; DSH packages are only imported within §6.3.2 (read/executed as
   libraries).

---

## 7. Concurrency and transaction design (acceptance gate)

### 7.1 The shared resource under lock (normative)

The EXACT shared resource is the file `<profileDir>/package.json` lock sibling
`<profileDir>/package.json.lock`, via the installed `@deepseek-ai/dsh-atomic-write@0.2.1-alpha.2`
`withFileLock` (never a reimplementation, never a lock on `cordis.patch.yml` alone — a patch-file lock
does NOT coordinate with the native writer, which locks the manifest path:
`config-editor/lib/index.js:72`).

- Acquisition: `wx`-create with PID record; contention backs off 20→200 ms; default deadline 2 s
  (callers MUST pass an explicit `waitMs` sized for plan+render work and surface timeout as safe refusal T12).
- Stale-holder takeover exists but proves only process exit (`ESRCH`); PID-reuse and cross-namespace
  writers are documented non-goals of the protocol (`atomic-write/lib/index.js:172-183`) and MUST be
  surfaced as limitations, not worked around.
- Release ownership: the `withFileLock` holder ONLY (finally-remove, l.210-214). Lock files MUST never be
  deleted by hand or by timeout-watchdogs.

### 7.2 Normative transaction ordering (standalone profile commit, R2-consistent)

One internally consistent sequence. Steps 1–12 execute inside ONE `withFileLock(<profileDir>/package.json)`
hold, which is itself the exclusion boundary. The candidate is FULLY DERIVED (step 5) and VALIDATED
(step 6) BEFORE the effective/override check (step 7) — mirroring the native editor, which derives `next`
(`config-editor/lib/index.js:79`) before re-reading, rendering, and override-checking (ll.84-122).
`HMR.runExclusive` MUST NOT wrap this (non-reentrant, and the adapter runs outside the Host process).
No network I/O occurs under the lock (plan/desired are computed BEFORE acquiring).

1. **Lock**: acquire `withFileLock(<profileDir>/package.json)` with an explicit measured `waitMs` (Q5;
   never the silent default). Timeout → `LOCK_TIMEOUT` refusal, zero side effects (T12).
2. **Re-read**: read the exact patch-file bytes. Missing file → refuse (unlike the native editor, the
   adapter MUST NOT default-create a profile patch; creation is profile management, out of scope).
3. **Stale digest**: assert `sha256Hex(currentBytes) === plan.targetDigest`, else zero-side-effect
   `STALE_TARGET` refusal (`stale: true`, slot cleared, T10). The Preview-time digest binds to
   (profile, patchPath, bytes); this step re-verifies the same bytes under the lock, closing the
   Preview→Apply TOCTOU that `commitPlan` (`sync.mjs:1237-1247`) handles only in the single-actor case.
4. **Parse + locate**: `parseDocument` with the `!!js` custom tag (same tag line as the editor,
   `config-editor/lib/index.js:91-94`); assert sequence root; locate the single `llm-pi-ai` entry by
   `(id, name)` without `insert`; admit provider shapes (`validateExistingProviderShapes` semantics,
   `sync.mjs:855-875`). Refuse on missing/duplicate/malformed (§8.4, §9.3–9.4, T03/T07) — nothing written.
5. **Derive**: build the COMPLETE candidate — desired six arrays (from the retained READY plan; no
   refetch, no replanning) plus the exact six-array Document mutation plan per the §9 footprint (node
   replacements/additions F1–F2 only). Pure computation; the Document is not mutated yet.
6. **Validate** (pre-render, all zero-side-effect): six-array membership/duplicates (`checkMembership`
   semantics, `sync.mjs:818-835`); anchor/alias-intersection pre-scan → `ANCHOR_IN_MANAGED_SCOPE` refusal;
   custom-tag scan inside replaced models subtrees → `TAG_IN_MANAGED_ARRAY` refusal (§9.14–9.15);
   route-creation legitimacy (§9.2). Any failure → refusal, nothing written, no backup.
7. **Effective/override check**: render the candidate config OBJECT (not yet the Document), recompose
   file-based layers (`loadProfileDirectory` + candidate user patch + home patch if present + EXPLICITLY
   DECLARED overlays/attestation only, §8.5) and assert the composed `llm-pi-ai.config` deep-equals the
   candidate; else `OVERRIDDEN` refusal (mirroring `config-editor/lib/index.js:117-122`). Undeclared
   launch-time overlays of a possibly-running DSH CANNOT be seen file-side — production targets additionally
   require live-state attestation (§8.5); without it → `LIVE_OVERLAY_UNKNOWN` refusal here.
8. **Render (byte-surgical, C2)**: build the commit string by TEXT SPLICING the original bytes —
   replace exactly the owned value spans (§9.16) with the rendered fragments (indented to the computed
   columns); insert F1-add/F2 lines at their sites. The whole-Document serializer MUST NOT produce the
   commit string (proven lossy for unowned bytes). Fragments render standalone in block style.
9. **Verify** (pre-write): parse the commit string with the patch-list schema dialect (`js-yaml` +
   `entryListSchema`, as the editor does at ll.118-121) → assert sequence root → assert six arrays
   deep-equal desired (`assertGeneratedManagedArrays` semantics) → assert the §9.16 span-excision
   invariant (original bytes minus original owned spans BYTE-EQUAL candidate bytes minus candidate owned
   spans). Failure →
   `VERIFY_FAILED` / `UNRELATED_CONTENT_CHANGED` refusal, nothing written, no backup. Per A-2, this
   verification applies to the EXACT bytes handed to step 11; the internal temp of `writeFileAtomic` is
   not separately parsed and MUST NOT be claimed as verified.
10. **Backup**: exact-byte copy of the step-2 bytes to `<patchPath>.bak-<UTC-stamp>` (same directory;
    same "exact bytes read immediately before commit" semantics as `sync.mjs:1271`). This step ENDS the
    side-effect-free zone: every refusal at steps 1–9 creates no backup, no temp, no mtime change.
    Backup-write failure → `BACKUP_FAILED` refusal; `writeFileAtomic` is never invoked, no temp exists (§12.4).
11. **Atomic commit**: `writeFileAtomic(patchPath, commitString, { mode: 0o600 })` — same mode the editor
    uses (l.123). Single-file atomic replacement with bounded Windows rename retries; fsync explicitly out
    of scope. Write failure → `WRITE_FAILED` refusal; original intact (package removes its temp); the step-10
    backup is RETAINED and reported (recovery artifact, not a side-effect violation — the target file is
    unmodified, §12.4).
12. **Post-write verification**: re-read the file bytes; assert six arrays + footprint on the re-read bytes;
    record the new target digest. Failure → `POST_WRITE_VERIFY_FAILED` safe-error state (backup retained,
    operator-confirmed recovery, no auto-revert, §12.4).
13. **Post-commit recording (C3 — no activation claim)**: record the new target digest and the
    verified file facts ONLY: `UPDATED` + `fileVerified: true` + `effectiveComposition: MATCHED` (the
    §7.2-step-7 composition re-checked against the post-write bytes) + `liveActivation:
    UNKNOWN_LIVE_UNVERIFIED`. The adapter MUST NOT trigger Loader reconciliation from outside the Host
    process, and MUST NOT report `RECONCILE_OBSERVED` / `RECONCILE_DEFERRED` in production — those tokens
    are RETIRED from the production vocabulary (attestation admits the write; HMR source text observes
    nothing). If a running DSH later reconciles the file, that activation is DSH's own act, observed only
    through authorized mechanisms (§12.4 item 6).

Lost-update freedom: any two writers (native `edit()` vs adapter commit, or two adapter commits) serialize on
the SAME lock; each re-reads + stale-checks inside the hold, so the loser refuses rather than resurrecting a
replaced state. Readers stay lock-free (rename commit is atomic). Deadlock avoidance: single lock, no nesting
(§6.3.4), bounded wait, derivation inputs computed before acquiring.

### 7.3 Cancellation and failure inside the boundary (R3-separated)

Side-effect-free zone = steps 1–9: any refusal here creates no backup, no temp, no mtime change
(T08/T10 semantics).

- Lock-acquisition timeout (step 1) → `LOCK_TIMEOUT` refusal, zero side effects (T12).
- Stale digest (step 3) → `STALE_TARGET` refusal, zero side effects including NO backup (T10).
- Parse/locate/admission failure (step 4) → typed refusal, zero side effects (T03/T07).
- Derive/validate failure (steps 5–6, incl. `ANCHOR_IN_MANAGED_SCOPE`, `TAG_IN_MANAGED_ARRAY`,
  membership/shape refusals) → refusal, zero side effects.
- Override/live-state failure (step 7: `OVERRIDDEN`, `LIVE_OVERLAY_UNKNOWN`) → refusal, zero side effects.
- Render/verify failure (steps 8–9: `VERIFY_FAILED`, `UNRELATED_CONTENT_CHANGED`,
  `MEMBERSHIP`/`GENERATED_MEMBERSHIP_MISMATCH`) → refusal; original intact; no backup; no temp
  (`writeFileAtomic` never invoked).
- Backup-write failure (step 10) → `BACKUP_FAILED` refusal; the commit is NOT attempted (no write without
  a backup — the `commitPlan` backup-first rule, `sync.mjs:1270-1271`, retained strictly); no temp exists
  because `writeFileAtomic` was never called (§12.4).
- Atomic-write failure (step 11) → `WRITE_FAILED` refusal; original intact (the package removes its
  internal temp sibling and rethrows, `atomic-write/lib/index.js:73-76`); the step-10 backup is RETAINED
  on disk and reported — a recovery artifact, not a side-effect violation (the target file is unmodified).
  An orphan internal temp sibling (`<file>.<rand>.tmp`) can remain only if the package's own cleanup
  throws; such siblings are inert (unique random names, never read by any actor), are never pruned
  cross-run, and are reported when detected (§12.4).
- Post-write verification failure (step 12) → `POST_WRITE_VERIFY_FAILED` safe-error state: backup
  retained, operator-confirmed restore + re-Preview recovery, NO auto-revert (§12.4).
- Backups are NEVER auto-deleted by any run (retention is the safety property); consequently there is no
  "backup cleanup failure" mode by construction, and any future retention-pruning needs a spec amendment.
- Windows rename contention → bounded retries inside the package (ll.31-44, T13 via failure injection).
- No cancellation token exists in the underlying primitives; Apply-in-flight is guarded by the existing
  `applyBusy` single-flight (`ui.mjs:239`, `380-383`) plus the retained-Preview single slot.

### 7.4 Re-entrancy prohibitions (normative)

- FORBIDDEN: holding `withFileLock(package.json)` and then calling `ConfigEditor.edit()` (same lock,
  non-reentrant → self-deadlock to timeout). The adapter therefore NEVER calls `edit()`; the Host-side native
  path is NOT pursued for architecture C. One lock holder per commit, exactly one acquisition.
- FORBIDDEN: nesting `hmr.runExclusive` (rejects with `HMR transactions cannot be nested`); the adapter runs
  outside the Host process and never touches HMR.
- FORBIDDEN: assuming `writeFileAtomic` gives power-loss durability, multi-file atomicity, or fsync.

### 7.5 Property distinctions (normative vocabulary)

- `ATOMIC_REPLACEMENT`: readers see old or new complete file (rename). CLAIMED (package-guaranteed).
- `CONSISTENT_RUNTIME_RECONCILIATION`: the running Loader activates the new config. EXPLICITLY UNCLAIMED in
  production (C3): architecture C has no verified live-state sensor, so post-write success is reported as
  `UPDATED` with `liveActivation: UNKNOWN_LIVE_UNVERIFIED`, never as live activation. Scratch-runtime
  harness observations are labeled `SCRATCH-VERIFIED` and never generalized (T16/T20).
- `ROLLBACK`: restore of pre-commit file bytes from the exact-byte backup (operator-invoked or
  error-state-prescribed, §12.4). AVAILABLE as artifact + procedure, NOT automatic post-write.
- `CRASH_DURABILITY`: fsync-level power-loss safety. EXPLICITLY NOT CLAIMED (package scope exclusion,
  `atomic-write/lib/index.js:56`).

---

## 8. Profile target + Preview/Apply contract (minimum, explicit)

### 8.1 Profile selection (normative)

- Every profile-targeting operation takes an EXPLICIT `--profile <name>` (CLI) or explicit profile picker
  value (UI/Host config). No default, no `web` fallback, no env-derived profile, no positional guessing.
- Validation reuses DSH's grammar exactly (`resolveProfileDir`, `app-boot/lib/index.js:533-536`): reject empty,
  separators, `.`, `..`, `node_modules`; wrapper-narrowing (length/charset, leading-dash) is permitted
  fail-closed additions and MUST be recorded as such (same posture as `SPEC.md` §11).
- Existence: the resolved directory MUST contain an initialized `package.json`; otherwise refuse BEFORE any
  mutation (mirrors the `SPEC.md` P4 guard against silent auto-init). The check MUST NOT create directories.

### 8.2 Configuration-owner discovery (normative)

1. Resolve profile dir; read manifest (bundles list) — read-only.
2. `loadProfileDirectory("dsh", dir, installAnchor)` (install anchor resolved per §11.6).
3. Locate candidate `llm-pi-ai` rows across bundle layers + user patch: the persisted provider definitions
   MUST come from the user patch (`profileContext.patchPath`); if the ONLY `config:` for `llm-pi-ai` comes
   from a bundle layer or the home patch, refuse (`NOT_PROFILE_OWNED`) — OCMS-S writes only the user layer.
4. Symlinks/reparse points/path escapes: resolve the real path of profile dir + patch path; refuse if the
   real patch path escapes the real profile dir, if the patch path itself is a symlink to outside the profile,
   or if temp/backup sibling creation would leave the directory (`SYMLINK_ESCAPE` refusal; T03-adjacent).

### 8.3 Target identity in the UI (normative)

The UI displays and binds ALL of: `profile name`, `profile dir (real path)`, `patch file (real path)`,
`llm-pi-ai entry name`, and `SCRATCH vs PRODUCTION` classification. The retained Preview binds this full
identity, not just a file path.

### 8.4 Missing/duplicate entries (normative)

- Zero non-`insert` `llm-pi-ai` rows with a `config:`-capable position → refuse `PLUGIN_ENTRY_MISSING`
  (never create the row: row creation is profile management, out of scope).
- Two or more candidate rows (any layer) → refuse `PLUGIN_ENTRY_DUPLICATE` (never first/last-pick, §4 D).
- Row present but Loader-unique-addressability unknown offline → record `ADDRESSABILITY_UNVERIFIED` warning;
  commit still allowed file-side (uniqueness was verified file-side); native-addressability is a T16
  scratch-runtime check, not a commit precondition for path C.

### 8.5 Inherited/overridden data + live-state admission (normative, R5)

File-side override check (all targets): if composed effective `llm-pi-ai.config` (file-based layers +
declared overlays) disagrees with the stored user-patch `config` before planning → Preview MUST surface
`EFFECTIVE_DIFFERS_FROM_STORED` with both digests and refuse Apply until the user re-Previews with explicit
overlay declaration (`OVERRIDDEN` family, §12; commit-time re-check at §7.2 step 7).

Live-state admission (production targets — R5): the adapter, running in CLI/UI-child processes, has NO
reliable sensor for (i) whether a DSH process currently owns the target profile or (ii) the exact
launch-time overlays (`--patch` repeats, telemetry env) of such an owner. The following inferences are
FORBIDDEN: TCP port state (a free port proves nothing about profile ownership; an occupied port proves nothing about WHICH profile
is owned), present/absent lock file (HMR holds no lock at rest; a held lock proves only a mid-cycle writer,
never DSH ownership), directory enumeration, and process-name scans (additionally forbidden by §6.3).
No Host/Loader query is introduced for architecture C (that transport belongs to the rejected path B and
would need an explicitly amended architecture). The telemetry layer is excluded from live-state
consideration BY CONSTRUCTION: `resolveTelemetryPatch` can emit only the telemetry row id, never
`llm-pi-ai` content — SOURCE-VERIFIED, no attestation needed for it.

Therefore production-target commits distinguish two admission modes, and NOTHING else:

- OFFLINE admission: SCRATCH-classified targets only. The harness (tests) or operator controls the fixture
  environment and never boots DSH against it; composition uses explicitly declared overlays only.
  Liveness attestation is not applicable; fixture control is the harness's contract (T-matrix).
- LIVE admission: PRODUCTION-classified targets. Live-owner/overlay state defaults to UNKNOWN →
  `LIVE_OVERLAY_UNKNOWN` pre-write refusal (zero-side-effect, §7.2 step 7) UNLESS the run carries explicit
  operator live-state attestation bound into the retained Preview: EITHER (a) "no running DSH process owns
  this profile" (operator-verified by their own means, e.g. stopped DSH) OR (b) "the running owner was
  launched with exactly these overlay files `<list>` and no others", which are folded into composition for
  both Preview and commit. The attestation text is recorded in the Preview binding and re-displayed at Apply
  confirmation; a false attestation is operator error (surfaced where possible by post-write effective
  checks, never silently absorbed). Attestation PERMITS the admission path; it PROVES NO activation (C3):
  production outcomes always carry `liveActivation: UNKNOWN_LIVE_UNVERIFIED` (§8.8). CLI form: an explicit `--live-state=` flag (absent → refusal for
  production targets); UI form: an explicit acknowledgment control (never pre-checked) bound to `previewId`.
  Scratch mode (§8.7) additionally refuses production targets outright, attestation or not.

Effective-config source for the file-side check is file composition; Loader `configuration()`
inherited/override agreement remains a T16/T20 scratch-runtime cross-check (T20), not a commit precondition.

### 8.6 Preview binding (normative)

A retained Preview binds: full target identity (§8.3) + `targetDigest` (sha-256 over EXACT patch-file bytes,
the direct analogue of `settingsDigest`, `sync.mjs:1132`) + `sourceSnapshotDigest` (unchanged,
`sync.mjs:1123`) + `generatedAt` + frozen desired six arrays + stored-vs-effective digests (§8.5) +
declared overlays + live-state attestation text for production targets (§8.5).
Any profile switch, target-path change, or target-byte change invalidates the slot (T09/T10); the next Apply
with the old id gets `STALE_PREVIEW` exactly as today (`ui.mjs:388-391`, `407-410`).

### 8.7 SCRATCH vs PRODUCTION (normative, R4-repaired)

Classification is derived SOLELY from the bound target's real path versus the real DSH home directory
(`resolveDshHome` evaluated at bind time; both recorded in the binding). No flag, mode, name, or history
influences it.

- `PRODUCTION` = the bound target's real path lies under the real DSH home directory. ALWAYS PRODUCTION,
  regardless of `--scratch`, `--settings`, picker labels, or any other flag. (`web` is production iff its
  path is under the home — which it normally is — and iff the user explicitly selected it.)
- `SCRATCH` = the bound target's real path lies OUTSIDE the real DSH home (synthetic fixture dirs,
  `%TEMP%` profiles). Scratch targets exercise the identical transaction (§7.2) against fixture profiles
  and are the ONLY permitted Apply targets in tests.
- Scratch mode (`--scratch`): a RESTRICTION mode, not a reclassification. When active, only
  SCRATCH-classified targets are admittable; a PRODUCTION-classified target is refused at admission
  (`SCRATCH_MODE_PRODUCTION_REFUSED`) before any planning. Scratch mode MUST NEVER downgrade a
  production target to scratch and MUST NEVER widen production protection downward — it only narrows the
  permitted set.
- The classification is displayed and bound into the retained Preview; dwell-time, "recently used", or
  operator assertion MUST NOT influence it.

### 8.8 Stored vs effective vs live-activation reporting (normative, C3)

Preview and Apply responses distinguish three facts, never conflated:

1. `storedDigest` — sha-256 over the patch-file bytes (file commit fact).
2. `effectiveDigest` — sha-256 over the composed Loader-effective `llm-pi-ai.config` from available
   declared layers (effective file-composition fact).
3. `liveActivation` — ALWAYS `UNKNOWN_LIVE_UNVERIFIED` in every production and offline run. The retired
   tokens `RECONCILE_OBSERVED` / `RECONCILE_DEFERRED` MUST NOT be returned: attestation is not observation,
   HMR source text is not observation, and an offline file write verifies no future boot. A successful Apply
   returns `UPDATED` + `fileVerified: true` + `effectiveComposition: MATCHED` + `liveActivation:
   UNKNOWN_LIVE_UNVERIFIED` — post-write success is NEVER misreported as successful live activation.
   Scratch-runtime harness runs (T16/T20) may additionally record `scratchActivation: OBSERVED | FAILED`,
   labeled `SCRATCH-VERIFIED` and never generalized to production.

"Same YAML syntax" is never the success criterion; T20 requires same effective configuration after an
accepted update.

### 8.9 NO CHANGE and pre-write refusal (normative)

- `NO_CHANGE` iff all six actual stored models arrays deep-equal desired (order/multiplicity/fields), reusing
  `managedArraysMatch` object semantics (`sync.mjs:895-910`) on the located entry's config. No backup, no write.
- Apply refuses before any write on: non-`READY` state, id mismatch, stale target digest, target-identity
  mismatch, classification mismatch (Apply to a differently-classified target than Previewed),
  scratch-mode production target (`SCRATCH_MODE_PRODUCTION_REFUSED`), missing/duplicate entry, override
  detection (`OVERRIDDEN`), missing live-state attestation on production targets (`LIVE_OVERLAY_UNKNOWN`),
  write-lock timeout. All pre-write refusals are zero-side-effect (no backup, no temp, no mtime change);
  backup artifacts exist ONLY after §7.2 step 10 passes or after a post-backup infrastructure failure (§12.4).

Source acquisition gains NO configuration-write permission: `fetchSources`/`buildPlan` remain read-only;
only the explicit confirmed Apply commits, and only to the bound target.

---

## 9. Six-array editing contract (R1-precise Document-editing invariants)

Managed keys, frozen exactly (`sync.mjs:42-81`): `opencode-go`, `opencode-go-messages`,
`opencode-go-responses`, `opencode-completions`, `opencode-messages`, `opencode`.

Replacement unit (normative, R1): ONLY the six `config.providers[route].models` SEQUENCE NODES within the
verified `llm-pi-ai` entry, plus the narrowly permitted ancestor creation of §9.14 F2. The adapter MUST NOT
replace the whole `config` node (the native editor's `setIn([index, "config"])`,
`config-editor/lib/index.js:110`, is FORBIDDEN for the adapter): whole-config replacement rebuilds
unowned subtrees via `createNode` and silently normalizes unrelated providers' comments, tags, anchors,
and styles. That normalization allowance is hereby REMOVED, not expanded.

1. **Entry identity**: locate by stable `(id == "llm-pi-ai", name match when present, no `insert`)` via
   `findLastIndex` semantics; NEVER a fixed sequence index (index 12 is today's coincidence). Refuse on
   zero/multiple candidates (§8.4).
2. **Missing route**: a managed route absent from `providers` is created ONLY when it receives models, with the
   minimal route definition (`displayName/api/baseURL/apiKeyEnv` from `MANAGED_ROUTES`, same rule as
   `buildNewConfig`, `sync.mjs:1041-1049`). A managed route present with models `[]` and desired `[]` is NO CHANGE.
3. **Missing `models` array** on an existing managed route: ADD the single `models` key (footprint F1);
   malformed-shape rules of `validateExistingProviderShapes` (`sync.mjs:855-875`) still fail closed on
   non-mapping/non-array shapes.
4. **Unsupported existing structures**: non-mapping `config`, non-mapping `providers`, non-mapping provider,
   non-sequence existing `models` → refuse (`SETTINGS_INVALID` family), never discard-and-recreate.
5. **Field/order preservation (byte-surgical, C2)**: route-level fields outside `models`, unrelated
   providers, and every byte outside the §9.14 footprint are preserved BYTE-IDENTICALLY by construction
   (§9.16 splice method) — not merely object-equal, and never via whole-Document re-serialization (which the
   P0-R2 probe proved lossy: an untouched `[1, 2]` flow span re-serializes as `[ 1, 2 ]`). Desired `models`
   arrays carry the planner's exact order (sorted by id, `sync.mjs:809`) and exact fields (including
   target-local `compat` under existing conflict rules).
6. **Custom YAML tags**: `!!js` (and any other tag) OUTSIDE the six replaced `models` value spans is preserved
   byte-identically by the §9.16 splice (untouched source bytes are never re-serialized) — stronger than the
   native editor's outside-value preservation. A custom tag INSIDE a replaced `models` value span (current
   file carries behavior-bearing markup where plain planner data will land) → pre-write `TAG_IN_MANAGED_ARRAY`
   refusal (§9.15): planner records are plain data and MUST NOT silently extinguish tagged content.
7. **Comments/formatting**: comments and scalar styles EVERYWHERE outside replaced `models` value spans —
   including inside `llm-pi-ai.config` (unrelated providers, route-level remarks) — are preserved
   byte-identically per §9.16 (T05/T06). Comments on lines strictly interior to a replaced value span concern
   OCMS-S-owned array content being wholesale replaced (identical to current `commitPlan` array replacement);
   their normalization is ALLOWED but MUST be surfaced as the `REPLACED_SUBTREE_NORMALIZATION` warning when
   the prior span carried comments. Comments intersecting a value-span boundary ambiguously (trailing text
   after the span on a boundary line that cannot be attributed exclusively to the owned value) →
   `UNOWNED_COMMENT_AMBIGUOUS` pre-write refusal, never silent loss (§9.15). No `flow` flag on any existing
   node is mutated; newly rendered fragments default to block style. Byte-identical formatting of the FILE is
   not required; byte-identity of all NON-OWNED spans is.
8. **Array equality/idempotence**: deep equality incl. order/multiplicity/fields; same desired state → NO CHANGE
   with zero file modification (mtime-preserving: no write at all, T08).
9. **Post-write verification**: exact six-array assertion on re-read bytes (`assertGeneratedManagedArrays`
   semantics, `sync.mjs:912-919`) PLUS §9.16 footprint assertion PLUS duplicate-managed-ID scan.
10. **Duplicate managed IDs**: any model id occurring in more than one managed route post-derive → refuse
    (`MEMBERSHIP` family, cf. `checkMembership`, `sync.mjs:818-835`) at §7.2 step 6, before any render.
11. **Unrelated providers/plugins**: other `providers.*`, other patch entries, other files — untouched by
    construction (text splice at owned spans only, §9.16) and by excision assertion (T05).
12. **Non-ASCII ids/labels**: preserved via UTF-8 end-to-end (read/write `utf8`, no escaping normalization
    beyond YAML serialization of new nodes); covered by deterministic fixtures (T04-adjacent).
13. **Malformed YAML / unresolvable tags**: parse errors, non-sequence root, custom tags the `!!js`-only tag
    table cannot resolve → refuse WITHOUT writing (T07). Unresolvable tags OUTSIDE the edited entry still
    refuse (safe: the Document cannot round-trip them faithfully).
14. **Permitted write footprint (exhaustive, normative; C1-corrected)** — for each of the six managed
    routes, exactly one of:
    - F1: the route EXISTS with a `models` sequence AND actual/desired differ (deep equality incl. order,
      multiplicity, fields) → REPLACE the `models` Seq node at
      `[entryIdx, "config", "providers", route, "models"]` with the desired array, INCLUDING desired `[]`
      (model removal empties the array; the route and all its other fields remain). Cases A (non-empty
      desired) and B (empty desired) of the corrigendum.
    - F1-add: the route EXISTS but the `models` key is ABSENT → ADD that single key with the desired array
      (desired `[]` or non-empty, case C). Malformed shapes still refuse per §9.4.
    - F2: the route is ABSENT and desired is non-empty (case E) → create the route Map with EXACTLY the five
      minimal keys (`displayName/api/baseURL/apiKeyEnv/models`, §9.2), creating missing `config`/`providers`
      ancestor Maps only as needed. Absent route with empty desired (case D) → create NOTHING.
    - F0: actual and desired already identical (case F, incl. both `[]` and both missing-with-empty-desired) →
      NO CHANGE contribution: no node touched for that route; if all six routes are F0 the run is NO CHANGE
      (no write, no backup, mtime preserved, §9.8).
    - F3: NOTHING else. No node added, removed, reordered, retagged, restyled, or re-anchored outside F1/F1-add/F2.
    Membership, duplicate-managed-ID, and NO CHANGE semantics (§§9.8, 9.10) are unchanged; the footprint is
    still confined to the six managed arrays plus authorized ancestor creation — nothing broader.
15. **Unsafe-structure pre-write refusals (normative, R1)** — all evaluated at §7.2 step 6, zero-side-effect:
    - `ANCHOR_IN_MANAGED_SCOPE`: an anchor is defined ON or WITHIN an owned value span to be replaced (found
      via `visit` + CST ranges), or any `Alias` node anywhere in the Document references such an anchor.
      (Aliases referencing anchors OUTSIDE owned spans are untouched and safe.) Rationale: replacement would
      silently break referential integrity the planner cannot see.
    - `TAG_IN_MANAGED_ARRAY`: a custom tag (incl. `!!js`) occurs INSIDE a current `models` value span being
      replaced (§9.6).
    - `UNOWNED_COMMENT_AMBIGUOUS` (C2): a comment token intersects an owned-span boundary such that ownership
      cannot be decided — trailing text on a boundary line outside the owned value span that shares the line
      with replaced content (e.g. trailing remarks on the `models:` key line when the value starts on a later
      line, or trailing text after a replaced value on its end line). Interior-line comments are owned
      (warning per §9.7); exterior comments are preserved by splice. Ambiguity refuses; it is never resolved
      by guessing.
    - `UNPRESERVABLE_STRUCTURE` (C2): the footprint cannot be spliced byte-safely — a managed path's ancestor
      chain is flow-styled (splice would require restyling), or an F1-add/F2 insertion has no reference column
      to derive indentation from (empty or absent maps with no block-style sibling keys), or computed
      indentation is ambiguous. Never infer formatting; refuse.
    - Structural refusals of §9.4 (`SETTINGS_INVALID` family) are evaluated at the same step.
16. **Source-byte preservation invariant (normative, C2)** — construction is byte-surgical text splicing, and
    verification is span excision on real bytes (never re-serialization comparison):
    - *Owned spans (original)*: for each F1 route, the exact CST token span of the existing `models` VALUE
      node (`range[0]` → `range[2]`, `yaml` v2 CST — SCRATCH-VERIFIED available on synthetic fixtures). For
      F1-add/F2, the zero-width insertion site (line-anchored, indent-computed per §9.16-construction).
    - *Construction*: replace EXACTLY the owned spans with the rendered fragments (new `models` sequences /
      created ancestor maps, rendered standalone in block style and indented to the computed column);
      insertions add whole lines at their sites. The original bytes outside owned spans are COPIED, never
      re-serialized — ordinary whole-Document serialization is assumed LOSSY (proven: untouched flow spans
      normalize) and MUST NOT be used to produce the commit string. The `!!js` `visit` restoration
      (`config-editor/lib/index.js:111-116`) still applies when a fragment render needs it; it never touches
      unowned bytes because unowned bytes never pass through the serializer.
    - *Construction rules*: insertion indentation derives from existing block-style sibling key columns;
      flow-style managed parents, missing reference columns, and ambiguous indents refuse per §9.15
      (`UNPRESERVABLE_STRUCTURE`). F1 value replacement uses token-exact spans, so key-line prefixes and
      same-line trailing comments outside the value span are preserved byte-identically.
    - *Verification* (§7.2 step 9): re-parse the candidate; assert six arrays deep-equal desired; then
      EXCISE the candidate owned spans (candidate CST: new `models` value spans + created-node spans) and the
      original owned spans, and assert the two remainders are BYTE-EQUAL. Failure → `UNRELATED_CONTENT_CHANGED`
      refusal, nothing written, no backup. T05/T06 prove this deterministically on fixtures containing
      comments, `!!js`, anchors/aliases, flow spans, and unknown fields outside the footprint.

---

## 10. Architecture decision record

### Candidate B — DSH NATIVE CONFIGEDITOR

- **Invocation boundary**: new Host Remote method → `ctx.configEditor.edit(entry, change)` in the DSH Host
  process; UI child transports a plan reference; CLI cannot use it.
- **Ownership**: DSH owns validation, locking, write, and reconcile. OCMS-S owns desired-state derivation only.
- **Online/offline**: online-only (N6/N13/N14 all NO offline). Offline Preview/Apply impossible through this path.
- **Locking**: correct by construction (native lock), but OCMS-S's Preview digest/backup CANNOT be placed inside
  the native boundary without side-effecting `change()` hacks (§7 discussion); no re-entrant pre-lock allowed.
- **YAML preservation**: best available for its path (N3) — but OCMS-S-specific invariants (§9.16 byte-identity
  assertions, normalization flagging) still need adapter-side verification reads.
- **Atomicity/rollback**: single-file replacement + reconcile-with-restore; restore-failure state unresolved (N11e).
- **Dependency/API stability**: requires new exact pins (`dsh-config-editor`, transitive `dsh-atomic-write`,
  `dsh-app-boot`); internal interface (N15); Host `inject` + Remote surface growth.
- **Failure/refusal**: strong pre-write validation (Loader waterfall) + override refusal; weak on stale-Preview
  binding and backup (must be bolted on outside the lock — TOCTOU remains).
- **UX/Host/UI**: Host Remote growth, UI-child→Host plan transport, online-only UX (server must run to Apply).
- **Complexity**: medium (plumbing) + subtle (digest/backup placement problem has no clean solution).
- **Contract amendments**: A-1 plus Remote-surface growth plus online-only Apply (a REGRESSION of the existing
  offline CLI contract — unacceptable without a versioned justification that does not exist).
- **Testability**: online paths need a controlled scratch DSH runtime for every commit test; offline tests
  cannot exercise the commit at all.
- **Verdict: REJECTED as sole path.** Fails mandatory gates N14 (offline Apply), N17 (stale/backup contract),
  and §6.3.4 (no clean lock/digest composition). Precise rejection reason recorded.

### Candidate C — STANDALONE PROFILE-AWARE ADAPTER (PREFERRED)

- **Invocation boundary**: OCMS-S-owned file transaction (`ProfileAwareCommit`, §11.4) running in the CLI
  process, the UI child process, or (explicitly NOT required) the Host process — all three use the IDENTICAL
  function against an explicit profile target. No Loader handle anywhere in OCMS-S code.
- **Ownership**: OCMS-S owns read/plan/verify/backup/commit of the user-patch file; DSH owns runtime
  reconciliation (observed via HMR when online, deferred when offline). Effective-config authority stays
  compositional (file layers), never guessed.
- **Online/offline**: fully offline-capable (reads + commits need only files + installed DSH library code for
  lock/composition). Online behavior runs the identical transaction; any live activation by a running
  DSH is DSH's own act and is reported as `UNKNOWN_LIVE_UNVERIFIED`, never as observed (§8.8).
- **Locking**: the SAME `withFileLock(<profileDir>/package.json)` from the SAME installed package version —
  exact coordination with concurrent native writers (N10). Single acquisition, stale-check inside (§7.2).
- **YAML preservation**: precise six-array node editing (§9.14 footprint F1–F3) — strictly narrower
  than the native whole-`config` replacement, with byte-identity assertions on all non-owned spans (§9.16)
  plus anchor/tag pre-write refusals (§9.15) that the native editor lacks.
- **Atomicity/rollback**: `ATOMIC_REPLACEMENT` via the same `writeFileAtomic`; OCMS-S stale-digest-inside-lock
  + exact-byte backup + commit-string + post-write verification preserved per the R2/R3 order (§7.2) and the
  A-2 relocation (no false temp-verification claim); rollback = backup artifact + prescribed procedure
  (§12.4), with `CRASH_DURABILITY` explicitly unclaimed.
- **Dependency/API stability**: dynamic import strictly within the §6.3.2 allowlist with exact-version
  admission (`0.2.1-alpha.2` / include `1.0.10-alpha.1`) and fail-closed refusal; no DSH runtime needed; no
  Remote growth; no Loader/HMR/Cordis SERVICE coupling (file utilities only, per allowlist). Version skew → refusal, never fallback.
- **Failure/refusal**: full OCMS-S taxonomy retained and extended (§12); override refusal replicated file-side;
  Loader-waterfall pre-validation is the ONE native advantage C cannot replicate — mitigated by narrow
  models-only edits + schema-dialect render check + post-write six-array verification + T16/T20
  scratch-runtime cross-checks. Residual risk documented (§14 Q2).
- **UX/Host/UI**: Preview/Apply workflow unchanged and recognizable; Host/UI untouched except target-identity
  display + stored/effective reporting. No new process architecture.
- **Complexity**: lowest that meets all gates (one commit path, shared by CLI/UI).
- **Contract amendments**: A-1 and A-2, both proposed and both pending §15 approval (neither in force,
  neither silently activated).
- **Testability**: deterministic offline tests for T01–T10/T12–T13/T15/T17–T19; controlled scratch runtime only
  for T11/T16/T20 (and those assert coordination/observation, not basic safety).
- **Verdict: SELECTED**, conditional on the implementation gate (§15) and the refusal taxonomy (§12).

### HYBRID — NATIVE LIVE + STANDALONE OFFLINE

- Considered: native commit when a Live DSH owns the profile (Loader pre-validation + scoped reconcile),
  standalone commit when offline, sharing one PlanBuilder/verification core.
- **Rejected.** The two paths cannot share ONE consistency contract without divergence: native cannot host the
  Preview-digest check or exact-byte backup inside its lock (N17), so live commits would have weaker
  staleness/backup semantics than offline commits — a split-brain Preview/Apply behavior the gate explicitly
  forbids. Two failure taxonomies, two verification stories, HMR-re-entrancy hazards at the seam, and double
  test matrices buy only Loader pre-validation online — which C mitigates more cheaply (§10 C). If a future
  DSH exposes digest/backup hooks inside `edit()`, revisit; on `0.2.1-alpha.2` the seam is unsound.

### Decision summary

**Preferred: C. Rejected: B (mandatory-gate failures N14/N17 + lock composition), Hybrid (split-brain,
unshared consistency contract).** No HOLD: the evidence suffices to specify C implementation-ready, with the
explicit open questions (§14) and implementation gate (§15) as binding preconditions for code.

---

## 11. Proposed interfaces and change footprint (future only — no code in this gate)

Conceptual responsibilities (names are illustrative, not mandated). All new modules are pure file/plan
actors; none may access Loader/HMR/Cordis services or reconciliation. DSH file-utility imports are limited
to the §6.3.2 allowlist (exact symbols, exact versions, absolute-anchor resolution).

### 11.1 `ProfileTargetResolver` (new)

- Input: explicit `--profile <name>` (CLI) or picker value (UI) + optional explicit overlay declarations +
  scratch mode flag + (production only) live-state attestation (§8.5).
- Output: bound target `{ profileName, profileDirReal, patchPathReal, pluginEntryName, classification,
  declaredOverlays, liveAttestation }`
  or typed refusal (`INVALID_PROFILE_NAME`, `PROFILE_NOT_INITIALIZED`, `SYMLINK_ESCAPE`,
  `SCRATCH_MODE_PRODUCTION_REFUSED`, `LIVE_OVERLAY_UNKNOWN` at commit when attestation absent for production).
- Rules: DSH grammar validation (§8.1); real-path escape checks (§8.2); manifest existence pre-check
  (no auto-init); classification by real-path-vs-real-home ONLY (§8.7 — flags never reclassify); scratch
  mode narrows admission, never protection.

### 11.2 `ManagedConfigReader` (new)

- Input: bound target.
- Output: `{ patchBytes, patchDigest, documentModel, llmEntryIndex, storedConfig, effectiveConfig,
  effectiveDigest, overriddenBy }` or refusal (`PATCH_UNREADABLE/PARSE`, `PLUGIN_ENTRY_MISSING/DUPLICATE`,
  `OVERRIDDEN`, `NOT_PROFILE_OWNED`).
- Rules: exact-byte digest; `!!js`-aware Document parse; ID locate (§9.1); file-based composition for
  effective config + override source attribution (§8.5). Reuses NOTHING from `readSettingsFile` except the
  digest primitive `sha256Hex` (`sync.mjs:122-124`).

### 11.3 `ProfileAwarePlanBuilder` (new thin wrapper — maximal reuse)

- Reuses VERBATIM: `validateSourceBundle`, `planDesired`, `checkMembership`, `diffDesired`,
  `planningSourceBundle`/`canonicalJson`/`sha256Hex`, `buildNewConfig`-object-logic (applied to the located
  entry's config object), `assertYamlRoundTrip`/`assertGeneratedManagedArrays` object semantics.
- Binds: target identity + `targetDigest` + `sourceSnapshotDigest` + stored/effective digests + `generatedAt`.
- States: `READY` / `NO_CHANGE` (six-array equality on stored config) / `BLOCKED` (reasons). No disk mutation.

### 11.4 `ProfileAwareCommit` (new — §7.2 ordering normative)

- Input: retained READY plan (with bound target identity, digests, declared overlays, live attestation) +
  live re-resolution of the bound target.
- Executes §7.2 steps 1–13 under one `withFileLock`. Returns `UPDATED` (with `backupPath`, `newDigest`,
  `liveActivation: UNKNOWN_LIVE_UNVERIFIED`) or zero-side-effect refusal (§12, §7.3).
- UI exposure: NO new Host Remote surface is required for C. (The N8 native-transport design is NOT pursued.)

### 11.5 `ProfileChangeReconciler` (NOT NEEDED for C — explicitly declined)

- Rationale: reconciliation is DSH-owned (HMR auto-observe when online, boot application when offline).
  OCMS-S specifies observation + reporting (§8.8, T16/T20), never triggering. No such module shall be built.

### 11.6 Dependency and compatibility consequences (normative, R6)

- Admitted DSH file utilities are EXACTLY the §6.3.2 allowlist (`withFileLock`/`writeFileAtomic`;
  `loadProfileDirectory`/`readProfilePatches`/`composeEntries`; `entryListSchema`; `yaml`/`js-yaml`) —
  used as file-format/lock utilities, never as runtimes, and identically by the CLI and UI-child commit
  path. Admission: exact `dsh-atomic-write@0.2.1-alpha.2`, `dsh-app-boot@0.2.1-alpha.2`,
  `include@1.0.10-alpha.1` (runtime version assertion; mismatch → `INCOMPATIBLE_DSH` refusal).
  Resolution order (absolute anchors only): target profile `node_modules` → DSH install anchor directory
  (sibling of the resolved `dsh` executable; executable located via `PATH` lookup exactly as `SPEC.md`
  §DX-2, no bunx/npx fallback) → refuse. Any symbol beyond the allowlist needs a spec amendment.
  No `package.json` dependency addition and no install is authorized by THIS gate; the implementation
  gate (§15) decides between (a) dynamic resolution (no manifest change) or (b) versioned amendment
  adding exact pins — with reproducibility proof either way.
- `engines.dsh 0.2.1-alpha.2` bound retained; any other DSH version → refusal.

### 11.7 Change footprint

Likely to change (future): `sync.mjs` (ADD profile-target modules alongside; `defaultSettingsPath` retained
as scratch fallback only), `ui.mjs` (ADD target identity + stored/effective reporting; state machine reused),
new `profile/*.mjs` modules, new tests, README/CHANGELOG notes.
MUST NOT change: planning/placement/validation semantics (`sync.mjs:166-920` logic), `dsh/host.mjs`,
`dsh/lifecycle.mjs`, `dsh/client.*`, `cordis.patch.yml`, existing contract docs, `SPEC.md`,
`package.json` pins (without §15 approval), any test's existing assertions (additive tests only).

---

## 12. Refusal and recovery taxonomy (normative)

All refusals are `NOT WRITTEN`-family with stable codes. Pre-write refusals (§7.2 steps 1–9) are
zero-side-effect (no backup, no temp, no mtime change). Backup artifacts exist ONLY after §7.2 step 10
passes or after a post-backup infrastructure failure. Post-write anomalies use §12.4.

- `INVALID_PROFILE_NAME` / `PROFILE_NOT_INITIALIZED` / `SYMLINK_ESCAPE` — target admission (§8.1–8.2).
- `SCRATCH_MODE_PRODUCTION_REFUSED` — scratch mode + production-classified target, refused at admission (§8.7).
- `PATCH_UNREADABLE` / `PATCH_PARSE_ERROR` / `PATCH_ROOT_NOT_SEQUENCE` — file admission (T07).
- `PLUGIN_ENTRY_MISSING` / `PLUGIN_ENTRY_DUPLICATE` — identity (§8.4, T03).
- `NOT_PROFILE_OWNED` — persisted definitions not in the user patch (§8.2).
- `ANCHOR_IN_MANAGED_SCOPE` / `TAG_IN_MANAGED_ARRAY` — unsafe YAML structures in the footprint (§9.15, T06).
- `UNOWNED_COMMENT_AMBIGUOUS` — boundary-line comment ownership undecidable; refuse, never guess (§9.15, T06).
- `UNPRESERVABLE_STRUCTURE` — flow-style managed parents / missing indent reference; splice unsafe (§9.15, T06).
- `OVERRIDDEN` (with layer attribution: home/`--patch`/telemetry) — effective-vs-stored disagreement (§8.5).
- `LIVE_OVERLAY_UNKNOWN` — production target without live-state attestation, or attestation contradicted
  at commit (§8.5, T11/T16).
- `STALE_TARGET` (`stale: true`, clears retained Preview) — byte digest mismatch inside the lock (T10).
- `STALE_PREVIEW` / `PREVIEW_NOT_READY` / `TARGET_MISMATCH` — slot binding (`ui.mjs` semantics extended, T09).
- `NO_CHANGE` — not a refusal; idempotent success without writes (T08).
- `LOCK_TIMEOUT` — contention deadline; safe refusal, no partial state (T12).
- `BACKUP_FAILED` — backup could not be written; commit never attempted, no temp exists (§7.3, §12.4).
- `WRITE_FAILED` — `writeFileAtomic` failure after backup; original intact; backup retained + reported (T13).
- `VERIFY_FAILED` — pre-write commit-string verification failure; nothing written, no backup (§7.2 step 9).
- `POST_WRITE_VERIFY_FAILED` — post-write re-read verification failure; safe-error state, backup retained,
  no auto-revert (§12.4).
- `INCOMPATIBLE_DSH` — version/dependency admission (§11.6).
- `MEMBERSHIP_MISMATCH` / `GENERATED_MEMBERSHIP_MISMATCH` — post-derive/post-render six-array checks.
- `UNRELATED_CONTENT_CHANGED` — §9.16 footprint violation (fail the commit even if six arrays match).
- `REPLACED_SUBTREE_NORMALIZATION` — WARNING (not refusal): comments on replaced model items were normalized;
  surfaced in Preview diff (§9.7).

### 12.4 Safe error states and recovery boundary (normative, R3)

1. **Pre-write failure (§7.2 steps 1–9)** → typed refusal + nothing on disk: no backup, no temp, no mtime
   change. Recovery: fix cause, re-Preview.
2. **Backup-write failure (§7.2 step 10)** → `BACKUP_FAILED` refusal; the commit is never attempted
   (no write without a backup — `sync.mjs:1270-1271` retained strictly); no temp exists. Recovery: fix
   the filesystem cause, re-Preview (the retained Preview is stale-cleared only on `STALE_TARGET`; a
   `BACKUP_FAILED` keeps the slot so a retry needs no refetch — implementation detail, behavior-neutral).
3. **Atomic-write failure (§7.2 step 11)** → `WRITE_FAILED` refusal; original file intact (package removes
   its internal temp); the step-10 backup REMAINS on disk and is reported with its path. Possible orphan
   internal temp sibling (only if the package's own cleanup throws): inert, unique-named, never pruned
   cross-run, reported when detected. Recovery: inspect, retry Apply (fresh Preview if bytes changed).
4. **Post-write verification failure (§7.2 step 12)** → `POST_WRITE_VERIFY_FAILED` safe-error state: file
   holds unverified bytes; backup retained; NO auto-revert (a revert is itself a write needing explicit
   confirmation). Recovery boundary: operator re-Previews to confirm file-truth, then EITHER explicitly
   restores the backup (file operation outside Apply, then re-Preview) OR accepts the bytes after cause
   analysis. Backup files are NEVER auto-deleted — there is no "backup cleanup failure" mode by construction.
5. **Post-write, post-verify OK** → `UPDATED` with `fileVerified: true`, `effectiveComposition: MATCHED`
   (composition re-checked against post-write bytes), backup retained, and `liveActivation:
   UNKNOWN_LIVE_UNVERIFIED` — in offline AND online runs alike (C3). No future-boot behavior is claimed;
   the `RECONCILE_DEFERRED` token is retired. No further action required for the file facts.
6. **Authorized-observation reconcile failure ONLY** → `UPDATED_WITH_RECONCILE_FAILURE` safe-error state,
   entered ONLY when an authorized observation mechanism actually supplies failure evidence (C3): the
   controlled scratch-runtime harness Loader diagnostics (T14/T16, labeled `SCRATCH-VERIFIED`), or a
   future explicitly amended reporter (not introduced here). Operator suspicion, HMR source text, and
   attestation NEVER satisfy this gate — without authorized evidence the outcome stays `UPDATED` with
   `UNKNOWN_LIVE_UNVERIFIED` plus operator guidance to re-Preview. When entered: recovery boundary is
   operator-run documented recovery (re-Preview to confirm file-truth, then EITHER restore backup + allow
   DSH to re-reconcile to prior state, OR fix the activating cause and allow re-reconcile). OCMS-S MUST NOT auto-revert
   (a revert is itself a write needing explicit confirmation) and MUST NOT auto-retry reconciliation from
   outside the Host process.
7. **Lock/infrastructure failure before backup** (lock timeout) → refusal with zero side effects; no artifact.

---

## 13. Test matrix T01–T20 (future implementation — NOT executed in this gate)

All tests run WITHOUT touching live settings, accounts, or production profiles: synthetic profile directories
under `%TEMP%` (sequence-root `cordis.patch.yml` fixtures + minimal `package.json`), plus failure injection
seams. Tests needing a controlled DSH scratch runtime are marked **(R)**; all others are deterministic and
offline. Negative/adversarial cases are included per row.

- **T01** Profile patch root sequence: mapping-root and scalar-root fixtures refuse (`PATCH_ROOT_NOT_SEQUENCE`);
  21-entry realistic fixture accepted. Deterministic.
- **T02** `llm-pi-ai` not at index 12: fixtures place the entry at 0 / middle / last; commit finds it by id;
  fixed-index regression test asserts no numeric literal locates the entry (static assert on implementation).
- **T03** Missing/duplicate/overridden plugin entry: zero rows → `PLUGIN_ENTRY_MISSING`; two rows (same file, or
  user+home layers) → `PLUGIN_ENTRY_DUPLICATE`; home-patch `config` override → `OVERRIDDEN` with attribution;
  insert-row with same id ignored for identity but flagged. No file modification in any refusal (byte + mtime assert).
- **T04** Six managed arrays replaced correctly (C1): golden desired arrays land exactly (deep equal, order, fields,
  `compat` carried under existing rules); route-level fields (`displayName/api/baseURL/apiKeyEnv`) preserved;
  missing-route-created-only-with-models (§9.14 F2/case E); absent-route-with-empty-desired creates nothing
  (case D); existing-route-with-removed-models lands as `models: []` with the route and its other fields
  intact (case B); missing-`models`-key route gains exactly that key (case C); non-ASCII ids round-trip.
- **T05** Unrelated content untouched (R1/C2): non-managed `providers.*`, all other root entries, file
  header/trailer, route-level fields outside `models` — enforced by the §9.16 span-excision assertion
  (original-minus-owned-spans BYTE-EQUAL candidate-minus-owned-spans); any violation is
  `UNRELATED_CONTENT_CHANGED` with nothing written and no backup. Fixtures include decoy providers +
  credentials-shaped references (values synthetic) + comments/`!!js`/anchors/aliases/flow spans outside the
  footprint, all byte-identical post-render.
- **T06** Comments, `!!js` tags, anchors, unknown fields (R1/C2): `!!js` + comments + unknown fields +
  anchors/aliases + scalar styles outside owned value spans survive byte-identically (excision-proven, not
  eyeballed); comments on lines strictly interior to replaced spans raise `REPLACED_SUBTREE_NORMALIZATION`
  warning (not refusal); boundary-line comment ambiguity → `UNOWNED_COMMENT_AMBIGUOUS` refusal; a custom tag
  inside a replaced span → `TAG_IN_MANAGED_ARRAY` refusal; an anchor defined in (or an alias referencing) a
  replaced span → `ANCHOR_IN_MANAGED_SCOPE` refusal; flow-style managed parent / missing indent reference →
  `UNPRESERVABLE_STRUCTURE` refusal; unknown unresolvable tag anywhere → refusal without writing. All
  refusals byte- + mtime-clean.
- **T07** Invalid YAML refuses without writing: unparsable patch, non-sequence root, schema-dialect render failure —
  each refuses with bytes+mtime unchanged.
- **T08** Same desired state → NO CHANGE: second commit with identical sources refuses to write (no backup file,
  mtime unchanged), reports preserved/skipped dispositions.
- **T09** Profile switch invalidates Preview: retained Preview for profile A + Apply presenting (A-stale after
  selecting B / B's id) → `STALE_PREVIEW`/`TARGET_MISMATCH`, zero writes.
- **T10** Stale target digest → zero-side-effect refusal: external byte edit (even parse-equivalent whitespace)
  between Preview and Apply → `STALE_TARGET`, no backup, no temp residue, slot cleared.
- **T11** Concurrent native DSH writer → no lost update **(R)**: controlled scratch runtime performs a native
  `edit()` mid-window (or a second adapter commit holding the same lock path); the loser refuses (`STALE_TARGET`
  or `LOCK_TIMEOUT`-then-restale) and the winner's bytes verify; history shows no resurrection. Also asserts the
  SAME lock path (`package.json.lock`) is contended by both sides. The harness boots the scratch runtime with a
  KNOWN overlay list that doubles as the satisfied live-state attestation (§8.5); a companion case withholds a
  launch overlay → `LIVE_OVERLAY_UNKNOWN` refusal with zero side effects.
- **T12** Lock timeout/cancellation → safe refusal: pre-held lock (fixture `package.json.lock` with live-holder
  record) + short `waitMs` → `LOCK_TIMEOUT`, zero side effects; Apply single-flight retained (second Apply while
  busy → `APPLY_BUSY`).
- **T13** Atomic write/rename/backup failure: injected `writeFileAtomic` failure → `WRITE_FAILED` with
  original bytes intact and the step-10 backup retained + reported; injected backup-write failure →
  `BACKUP_FAILED` with `writeFileAtomic` never invoked (assert via seam: no temp sibling ever created);
  Windows-contention retry exhaustion (mocked `rename` EPERM×N) → `WRITE_FAILED`; orphan-temp-inertness
  asserted (stale `<rand>.tmp` sibling, if forced, is never read and never pruned cross-run).
- **T14** Authorized-observation reconcile failure **(R)** (C3): scratch harness Loader rejects the new
  config at activation — the harness diagnostic IS authorized observation evidence, so Apply reports
  `UPDATED_WITH_RECONCILE_FAILURE` (§12.4 item 6) with backup path; file bytes remain the verified new
  bytes (no silent auto-revert); recovery procedure (restore + re-Preview) tested file-side. Companion
  negative: identical file facts with the harness observation channel muted → `UPDATED` +
  `UNKNOWN_LIVE_UNVERIFIED`, proving the failure code requires evidence, not suspicion.
- **T15** UI child/Host privilege boundary (R6): static assert — the CLI/UI-child commit path imports
  DSH code ONLY within the §6.3.2 allowlist (exact package + exact symbol set; `reconcileProfilePatches`,
  `ConfigEditor`, any Cordis/Loader/HMR-service import fails the test) + behavioral test (commit works with
  DSH packages resolvable at absolute anchors AND refuses cleanly `INCOMPATIBLE_DSH` when unresolvable;
  CLI and UI child share the identical function — asserted by importing one module from both harnesses).
- **T16** Live HMR active vs offline profile **(R)** (C3): same commit against (a) scratch profile booted in a controlled
  DSH runtime with known overlays (attestation satisfied by construction) and (b) offline fixture → both
  report `UPDATED` + `fileVerified: true` + `effectiveComposition: MATCHED` + `liveActivation:
  UNKNOWN_LIVE_UNVERIFIED`; case (a) ADDITIONALLY records harness-observed `scratchActivation: OBSERVED`
  with effective-config agreement (dump-composed, never credential-bearing), labeled `SCRATCH-VERIFIED`
  and never generalized. Both verify six arrays file-side.
  Companion case (a2): booted runtime with an overlay withheld from the attestation → file-side composition
  cannot see it by design; the test asserts the harness (not the adapter) catches the mismatch — documenting
  exactly why production runs require operator attestation (§8.5).
- **T17** Production/scratch classification (R4): profile dir under the real home → `PRODUCTION` EVEN WITH
  `--scratch` (the flag MUST NOT downgrade; scratch mode instead refuses at admission with
  `SCRATCH_MODE_PRODUCTION_REFUSED`); temp-dir fixture → `SCRATCH` in both modes; Apply-to-differently-classified-target-than-Previewed refuses; classification shown in state payload and bound in Preview.
- **T18** Go/Zen placement golden fixtures unchanged: existing `tests/sync.test.mjs` + v1.3/v1.4.1 suites pass
  unmodified (reuse proof; new tests are additive files only).
- **T19** v1.4.5 runtime/package compatibility boundary: `dsh/host.mjs`, `dsh/lifecycle.mjs`, client bundle,
  `cordis.patch.yml`, contract docs byte-identical; pins unchanged without §15 approval; packs list unchanged.
- **T20** Same effective configuration after update **(R)** (C3): file-side six arrays + scratch-runtime composed
  effective `llm-pi-ai.config` both equal desired (not merely same YAML text); `EFFECTIVE_DIFFERS_FROM_STORED`
  absent post-commit in the declared-overlay case. Any harness-observed activation is recorded as
  `scratchActivation` labeled `SCRATCH-VERIFIED`; the production claim set stays
  (`UPDATED`/`MATCHED`/`UNKNOWN_LIVE_UNVERIFIED`).

---

## 14. Open questions with required evidence (binding)

- **Q1. Live-activation observability (C3-resolved as UNCLAIMED).** No production observation mechanism
  exists in architecture C by design (no sensor, no reporter; HMR source text is not evidence). Required:
  T16/T20 record harness observations labeled `SCRATCH-VERIFIED` without generalizing; production outcomes
  carry `UNKNOWN_LIVE_UNVERIFIED`. A future Host-side reporter would need an architecture amendment and is
  explicitly out of scope. Blocks NOTHING in this spec (no claim depends on activation); blocks any future
  CLAIM of production `RECONCILE_OBSERVED`-style semantics until such a mechanism is specified and proven.
- **Q2. Loader-waterfall validation gap for C.** Which invalid candidates would the Loader reject that the
  file-side schema-dialect check accepts? Required: adversarial corpus in T14/T20 (malformed provider shapes,
  bad `api` literals, type violations) run through the scratch runtime; any class that activates wrongly becomes
  an additional pre-write exact-shape assertion. Blocks implementation sign-off, not this spec.
- **Q3. Install-anchor resolution + live-state knowledge (R5).** DSH-home derivation
  (`@deepseek-ai/dsh-home-paths` `resolveDshHome`, env overrides) for classification (§8.7), and the
  R5 result that CLI/UI-child processes have NO reliable sensor for a running owner's existence or launch
  overlays (port/lock inference forbidden). Resolution: absolute-anchor library loading (§11.6) + operator
  live-state attestation for production targets with `LIVE_OVERLAY_UNKNOWN` as the safe default (§8.5).
  Required: T11/T16 harnesses construct `ProfileContext`-equivalent facts explicitly (known launch overlays
  double as satisfied attestation; a withheld overlay proves the refusal path). A Host-side read-only
  live-state reporter would need an architecture amendment and is explicitly NOT introduced.
- **Q4. `dsh-llm-pi-ai` config schema strictness.** The exact accepted shape of `config.providers[*]` beyond what
  fixtures show (needed for Q2 assertions). Required: read the installed `dsh-llm-pi-ai` schema source at
  implementation time (read-only) — NOT done here to bound this gate's surface.
- **Q5. Performance sizing of `waitMs`.** Lock-hold duration for a 21-entry/5k-line patch render on Windows.
  Required: measured in T11/T13; default 2 s MUST be replaced by a measured explicit value.

---

## 15. Explicit implementation gate (no code until ALL hold)

1. This spec accepted by orchestration review (frozen thereafter; changes require a spec amendment, not edits).
2. Contract amendments A-1 AND A-2 explicitly approved (target relocation + temp-verification relocation,
   §3.3) as a versioned follow-up to contract v1.4.1.
3. Dependency strategy decided per §11.6 ((a) dynamic exact-version resolution or (b) pinned manifest addition
   with reproducibility proof) — `package.json`/`package-lock.json` untouched until then.
4. TDD plan filed mapping T01–T20 to RED→GREEN slices; deterministic tests first, **(R)** tests on scratch
   runtimes only; no live-profile contact in any test (CI assertion).
5. Recovery procedure of §12.4 (incl. `POST_WRITE_VERIFY_FAILED` and `UPDATED_WITH_RECONCILE_FAILURE` paths)
   documented operator-ready (restore-from-backup + re-Preview steps).
6. Live-state attestation UX (CLI flag + UI acknowledgment control, §8.5) specified behavior-ready with the
   refusal default (`LIVE_OVERLAY_UNKNOWN`) proven before any admitted production path.
7. Explicit authorization to proceed to the implementation gate (this phase authorizes specification ONLY).

---

## 16. Audit verdict and evidence references

### 16.1 Adversarial audit — first pass (spec author vs source)

| # | Challenge | Result |
| --- | --- | --- |
| A | Native editing truly callable from OCMS-S? | PASS with boundary: Host-process-only via new Remote (unbuilt); UI child never directly. Spec claims only this. |
| B | Editor available offline? | PASS: correctly answered NO (N13/N14), and the preferred architecture does not require it. |
| C | Lock coordinates with concurrent DSH edits? | PASS: identical path + identical package (§7.1); T11 proves it. Patch-file locking explicitly rejected. |
| D | No lock re-entrancy/deadlock? | PASS: single acquisition, nesting forbidden (§7.4), bounded wait, no network under lock. |
| E | Effective ownership proven? | PASS: bundle-dormant + user-layer-owned + override-refusal (B/C/D/E of §4), all source-cited. |
| F | Multiple overlays handled? | PASS: ordering confirmed (§4.1); declared layers composed file-side; undeclared live overlays → `LIVE_OVERLAY_UNKNOWN` via mandatory attestation (§8.5, R5); port/lock inference forbidden. |
| G | Custom tags/comments preserved? | PASS with R1/C2 splice boundary: owned value spans only (§9.14 F1/F1-add/F2, incl. empty-desired C1 cases); all non-owned bytes preserved by construction and proven by span-excision (§9.16); anchors/tags/boundary-comments/unpreservable structures refuse (§9.15); model-item comments warn (§9.7). |
| H | Preview's exact target digest still binding? | PASS: digest redefined over patch bytes and checked INSIDE the lock at §7.2 step 3, before derive (§8.6). |
| I | Apply still explicit and user-confirmed? | PASS: state machine unchanged, binding extended to target identity + attestation (§8.5–8.6/8.9). |
| J | All six arrays updated together? | PASS: one commit transaction replaces all six; partial application impossible (single render + single rename, §7.2 steps 8–11). |
| K | Unrelated providers/fields protected? | PASS: deep-path node edits only (§9.14) + byte-identity assertions + refusal code (§9.16, T05). |
| L | No-change preserves the file? | PASS: no-write NO CHANGE incl. mtime (T08), stronger than current backup-only rule. |
| M | Failure/rollback claims actually supported? | PASS: each claim traced to package source; R3-separated (backup-failure vs write-failure vs post-write states, §7.3/§12.4); temp-verification relocation honest via A-2 (never claimed from the internal temp); fsync/multi-file/auto-revert explicitly UNclaimed (§7.5, N11e/N12). |
| N | Original source/route-placement contract expanded? | PASS: amendment A-1 is target-only; planning/placement frozen (§3.1, T18). |
| O | Undocumented DSH internals depended on? | PASS: every DSH behavior cited to installed source lines; residual unknowns listed as Q1–Q5, never assumed. |
| P | Online claims based only on static inspection? | PASS: all live behaviors marked UNKNOWN with **(R)** tests required; safety never depends on them (§4 F, §7.2 step 13); liveness is attested, never inferred (R5). |

First-pass defects found and repaired in-draft: (1) initial draft echoed the gate's "`!!js` in archived YAML"
claim — corrected by byte scan (§2.4); (2) initial draft allowed patch-file locking as an option — removed,
manifest-lock-only (§7.1); (3) initial draft left backup placement ambiguous vs the native lock — resolved by
selecting C, where OCMS-S owns the whole boundary (old §7.2 backup step; see the R2-ordered §7.2).

### 16.2 Independent verification — second pass (re-read of final spec against source evidence)

Re-read the final document against: `config-editor/lib/index.js` (edit flow, lock line, override check,
restore path), `atomic-write/lib/index.js` (lock protocol, write path, fsync exclusion),
`app-boot/lib/index.js` (composition order, profile-context readers, reconcile), `hmr/lib/index.js`
(`runExclusive`, watch registration), `sync.mjs`/`ui.mjs`/`host.mjs`/`lifecycle.mjs` (frozen contracts).
Second-pass outcome: no additional defects; all N1–N17 verdicts, A–I answers, and the B/C/Hybrid record are
consistent with the cited lines. The two re-read corrections applied: (a) home-patch label clarified to
DSH-home level (§4.1); (b) `PLUGIN_ENTRY` creation explicitly forbidden (profile-management exclusion, §8.4).

### 16.3 P0-R1 repair record (this pass — architecture selection NOT reopened)

| ID | Conflict repaired | Resolution (section) |
| --- | --- | --- |
| R1 | §9 permitted whole-`config` replacement, normalizing unowned YAML | Replaced with six-node Document-editing contract: exhaustive footprint F1–F3 (§9.14), anchor/tag pre-write refusals (§9.15), byte-identity footprint enforcement (§9.16); whole-`config` `setIn` FORBIDDEN for the adapter; normalization allowance narrowed to owned model-item comments with mandatory warning (§9.7) |
| R2 | Override check referenced an underived candidate; order inconsistent | Single 13-step order: lock → re-read → stale → parse → derive → validate → effective/override → render → verify → backup → commit → post-write verify → reconcile observe (§7.2); candidate derived (5) and validated (6) before override check (7), mirroring native derive-before-check |
| R3 | Backup vs zero-side-effect refusals conflated; temp contract overstated | R3-separated failure semantics (§7.3): side-effect-free zone steps 1–9; `BACKUP_FAILED` (never attempts write); `WRITE_FAILED` (backup retained + reported); `POST_WRITE_VERIFY_FAILED` safe-error state; no auto-deletion (no cleanup-failure mode by construction); A-2 temp-relocation amendment proposed (§3.3, §15) — internal temp never claimed as verified |
| R4 | Scratch flag could downgrade production targets | Classification is real-path-vs-real-home ONLY; `--scratch` is a restriction mode (`SCRATCH_MODE_PRODUCTION_REFUSED`), never a reclassification (§8.7, §8.9, T17, §11.1) |
| R5 | "Online profile" detection undefined; Host-observed check assumed B-transport | Port/lock inference FORBIDDEN; no Host/Loader queries introduced; production commits default to `LIVE_OVERLAY_UNKNOWN` unless explicit operator live-state attestation bound into Preview (§8.5); offline admission restricted to harness-controlled scratch; telemetry excluded by construction (source-cited) |
| R6 | §6.3 ("no `@deepseek-ai/*` in UI child") contradicted §10–§11 dynamic imports | §6.3 rewritten as exhaustive symbol allowlist for CLI/UI-child file utilities + explicit forbiddens (`reconcileProfilePatches`, `ConfigEditor`, Cordis/Loader/HMR services); identical UI/CLI admission; absolute-anchor resolution (§6.3, §11.6, T15); no new service architecture |

Cross-reference sweep after repair: §7.2 step numbers updated in §§7.3, 7.4, 10, 11.4, 12, 12.4, 16.1;
§12.4 renumbered (7 states) with §13 T14 and §15 item 5 repointed; §9 item numbers updated in §§7.2,
10, 12, 16.1; §8.9/§11.1/§12 codes/T17 aligned on R4 wording; §8.5 attestation referenced from
§§7.2, 11.1, 12, 13 (T11/T16), 14 (Q3), 15. No stale cross-reference remains (verified by full re-read).

### 16.4 Independent verification — third pass (R1–R6 repair vs N1–N17, invariants, A-1/A-2, §8, §9, §12, T01–T20, Q1–Q5, §15)

Re-read the repaired document end to end against the same source evidence as §16.2 plus the R1–R6
mandates. Results: (a) N1–N17 verdicts untouched and still consistent (repairs concern architecture C
internals, not native findings; §5 table unchanged); (b) transaction invariants hold in the new order —
stale (step 3) precedes derive, validation (6) precedes override (7), backup (10) follows all pre-write
verification (9), commit (11) follows backup; (c) A-1 scope unchanged, A-2 scoped to mechanism relocation
with outcome-equivalence argument and explicit non-claim; (d) §8 target contract internally consistent
(classification derivation, admission refusals, attestation default-refuse); (e) §9 footprint is exhaustive
and enforced by assertion (no silent-expansion path: any extra delta fails closed); (f) §12 codes cover all
§7.3/§12.4 states with no orphan code and no code without a test (T03/T06/T10–T17 mapping checked);
(g) Q1–Q5 still accurate (Q3 rewritten for R5; Q5 `waitMs` now consumed at §7.2 step 1); (h) §15 complete
(A-1+A-2, attestation UX, recovery doc). One correction applied in-pass: §7.4's "Host-side native path
NEVER pre-locks" implied a pursued path — reworded to state the native path is not pursued for C.
No mandatory uncertainty beyond Q1–Q5 and the §15 approvals; architecture C satisfies all mandatory
requirements. No HOLD condition met.

### 16.5 P0-R2 corrigendum record (this pass — C1–C4 only, no architecture change)

| ID | Previous defect | Normative correction (sections) | Contradiction check | Verdict |
| --- | --- | --- | --- | --- |
| C1 | F1 allowed replacement only for non-empty desired; removal-to-empty unspecified | F1 splits into F1 (differing array incl. `[]`, cases A/B), F1-add (missing key, case C), F2 (absent+non-empty, case E), absent+empty creates nothing (D), all-identical is NO CHANGE (F0) — §§9.14, 9.2, 9.8; T04 extended | Membership/duplicates/NO CHANGE untouched; footprint still six arrays + ancestors; T08/T10 already coherent, no edit needed | PASS |
| C2 | §9.16 used parsed-object equality inside `llm-pi-ai`; whole-Document serialization assumed byte-preserving (probe-proven false: untouched `[1, 2]` → `[ 1, 2 ]`) | Byte-surgical splice construction + span-excision verification on real bytes (§§9.5–9.7, 9.14–9.16, §7.2 steps 8–9); `UNOWNED_COMMENT_AMBIGUOUS` + `UNPRESERVABLE_STRUCTURE` refusals (§9.15, §12, T06); CST-range feasibility SCRATCH-VERIFIED on synthetic fixtures (P0-R2 probe: ranges ordered, visit-restore preserves unowned, owned replacement exact) | No silent-expansion path (extra delta fails closed); owned-item warning allowance preserved; T05/T06 rewritten to excision proof | PASS |
| C3 | `RECONCILE_OBSERVED`/`RECONCILE_DEFERRED` returnable in production without any live sensor; attestation read as observation | Three-fact separation (§8.8); production outcomes always `UPDATED`+`MATCHED`+`UNKNOWN_LIVE_UNVERIFIED` (§§7.2 step 13, 7.5, 8.5, 10 C, 11.4, 12.4 items 5–6); retired tokens never returned; `UPDATED_WITH_RECONCILE_FAILURE` gated on authorized evidence only; T14/T16/T20 relabeled `SCRATCH-VERIFIED`; Q1 rewritten as UNCLAIMED; §4 F corrected (source text ≠ observation) | Safe error states + operator recovery preserved; no Host/Loader reporter introduced; attestation still mandatory for admission but never activation evidence | PASS |
| C4 | §3.3 "single amendment" vs A-1+A-2 content; §10 C "A-1 only" | §3.3 retitled to TWO proposed amendments; §10 C references both; sweep confirms all remaining A-1 mentions are scope-accurate (B-path, audit N) and §15 requires both; neither in force | No transaction guarantee altered by C4 | PASS |

### 16.6 Independent verification — fourth pass (C1–C4 vs §§3,6–16)

Re-read the corrigendum end to end against the P0-R1 baseline plus the four mandates. Results: (a) F1–F3
footprint consistent across §§9.2, 9.8, 9.10, 9.14–9.16, T04/T08 (empty-desired removal lands as `[]`,
absent+empty creates nothing, all-F0 is write-free); (b) 13-step transaction still valid — steps 8–9 now
splice+excise, backup (10) still follows all pre-write validation, no backup before validation passes;
(c) no unrelated-YAML-byte loss path: construction copies unowned bytes, verification excises on real
bytes, ambiguity refuses; (d) no unjustified runtime-reconciliation claim remains — grep confirms
`RECONCILE_OBSERVED`/`RECONCILE_DEFERRED` survive only inside explicit retirement/prohibition sentences;
(e) production classification still path-derived, attestation still mandatory but never liveness evidence;
(f) NO CHANGE preserves bytes and mtime (§§9.8, 9.14 F0, T08); (g) A-1 and A-2 both proposed, both pending,
neither active; (h) T01–T20 all coherent (deterministic vs (R) split intact; new codes mapped to T03/T06/
T10–T17); (i) Q1–Q5 accurately classified (Q1 rewritten, Q2/Q4/Q5 untouched and still true); (j) no
implementation authorization implied (§15 gate unchanged in force). No FEASIBILITY_HOLD condition met:
surgical editing is specified within proven `yaml`-v2 CST capabilities (ranges + visit + fragment render),
so C2 needs no HOLD.

### 16.7 Evidence references (exact)

- DSH install: `C:\Users\GNV\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh` (`dsh@0.2.1-alpha.2` manifest).
- Editor: `…\@deepseek-ai\dsh-config-editor\lib\index.js:17-18` (inject), `:24-26` (documentPath),
  `:30-35` (unique entries), `:69-135` (edit), `:72` (lock), `:91-98` (parse/locate), `:99-110` (prune/add/set),
  `:111-116` (!!js restore), `:117-123` (override check + write), `:124-130` (reconcile/restore),
  `:133-134` (HMR); `lib\types\index.d.ts:28-34` (signature); `README.md:28-34,41,63-69`.
- Atomic: `…\dsh-atomic-write\lib\index.js:31-44` (Windows retries), `:56` (fsync out of scope), `:61-77`
  (write path), `:163` (2 s default), `:188-215` (lock protocol).
- Boot: `…\dsh-app-boot\lib\index.js:478-484` (composition), `:496` (patch filename), `:533-536` (name grammar),
  `:1001-1037` (load dir), `:1070-1075` (compose), `:1104-1115` (layer order), `:3623-3651` (reconcile);
  `lib\types\profile-context.d.ts:10-25` (context).
- HMR: `…\dsh-hmr\lib\index.js:633-641` (exclusive/non-nesting), `:696-719` (profile file watching).
- OCMS-S: `sync.mjs:42-81` (routes), `:1005-1016` (settings path), `:1115-1196` (plan), `:1234-1300` (commit),
  `:895-919` (match/verify); `ui.mjs:237-239,349-360,369-427` (Preview/Apply); `dsh/host.mjs:92-176`;
  `dsh/lifecycle.mjs:96-101,183-207`; `package.json:3,43-50`; live profile scans §2.4; scratch probes §2.6.

### FINAL VERDICT

**SPEC_PASS (P0-R2 corrigendum applied).** Architecture **C (standalone profile-aware adapter)** satisfies all
mandatory requirements with the C1–C4 corrections: empty-desired removal semantics with F0 NO CHANGE (§9.14);
byte-surgical splice construction with span-excision proof on real bytes, ambiguity refusals, and no reliance
on serializer fidelity (§§9.5–9.7, 9.14–9.16, §7.2 steps 8–9); three-fact outcome separation with production
`UNKNOWN_LIVE_UNVERIFIED` and retired reconcile tokens (§§7.2 step 13, 7.5, 8.5, 8.8, 11.4, 12.4, T14/T16/T20, Q1);
exactly two proposed amendments A-1+A-2, both pending (§§3.3, 10, 15). Candidates B and Hybrid remain
rejected (selection NOT reopened). Open questions Q1–Q5 and the §15 gate are binding preconditions for code.
No live DSH integration is asserted; no implementation readiness beyond that is claimed; no
FEASIBILITY_HOLD condition met.

HARD STOP. No implementation. No repair loop. No commit/push. No production Apply.
Awaiting orchestration review and explicit authorization.
