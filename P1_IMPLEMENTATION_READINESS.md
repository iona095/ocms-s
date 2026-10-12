# P1 — OCMS-S Implementation Readiness (Architecture C, A-1/A-2, Strategy A)

Status: PLANNING ONLY. No runtime, UI, test, profile, or dependency file is changed by this document.
Baseline: OCMS-S `v1.4.5`, HEAD `85027c35605e966cbacfe02a9a2f3c762403659c`, DSH `0.2.1-alpha.2` EXACTLY.
Authority: `SPEC_DSH_PROFILE_AWARE_SYNC.md` (P0-R2, frozen). This document does NOT amend, edit, or reinterpret it.
HARD STOP after acceptance: no S1 code, no live Preview, no production Apply, no DSH restart, no commit/push/tag.

---

## 1. Entry verification

Verified by direct inspection in this ticket (read-only; no reset, no overwrite, no execution of DSH):

| Item | Expected | Observed | Verdict |
| --- | --- | --- | --- |
| Repository | `C:\Users\GNV\.dsh\tools\ocms-s` | same directory inspected | match |
| Branch | `main` | `git branch --show-current` → `main` | match |
| HEAD commit | `85027c35605e966cbacfe02a9a2f3c762403659c` | `git rev-parse HEAD` → identical; `git log --format=%H -n 1 HEAD` → identical | match |
| HEAD tree | `1d535dd50260ccda0fce67bb7a09f41eddd09b4b` | `git log --format=%T -n 1 HEAD` → identical (used because PowerShell mangles the `HEAD^{tree}` argument; `%T` reports the same tree object) | match |
| Tracked changes | none | `git diff --name-only` → empty; `git diff --cached --name-only` → empty | clean |
| Untracked | the specification only | `git status --porcelain=v1` → exactly `?? SPEC_DSH_PROFILE_AWARE_SYNC.md`; `git ls-files --others --exclude-standard` → exactly that file | match |
| `P1_IMPLEMENTATION_READINESS.md` pre-existence | absent | `existsSync` → false before this write | confirmed new |

P0-R2 specification identity (actual file, not a Drive snapshot):

- Path: `SPEC_DSH_PROFILE_AWARE_SYNC.md` at repository root.
- Size: 114,276 bytes; 1,286 lines (measured by byte read in this ticket).
- Contains, by substring/structure check: `P0-R1`, `P0-R2`, `A-1`, `A-2`, `13-step`, `surgical`, `attestation`, `T01`, `T20`, `Q1`, `Q5`, `R1`–`R6` rows (§16.3), `C1`–`C4` rows (§16.5), a 13-step transaction (§7.2), the surgical YAML preservation contract (§§9.14–9.16), the operator-attestation admission contract (§8.5), the T01–T20 matrix (§13), Q1–Q5 evidence requirements (§14), the §15 implementation gate, and the `SPEC_PASS (P0-R2 corrigendum applied)` verdict (§16, FINAL VERDICT).
- Label note (editorial, non-normative): the ticket writes "Architecture C"; the frozen spec writes "Candidate C — STANDALONE PROFILE-AWARE ADAPTER (PREFERRED)" (§10) and "Preferred: C" (decision summary). Same referent. Recorded here as an editorial variance, not a defect; the frozen wording governs.
- No entry assumption is false. No HOLD triggered by §1. Nothing was reset or overwritten.

Source inventory confirmed read-only (no test executed, no DSH started):

- `sync.mjs`: 62,297 bytes, 1,488 lines; exports `buildPlan` and `commitPlan`; `MANAGED_ROUTES` six routes; planning/placement/compat logic frozen per spec §3.1.
- `ui.mjs`: 24,034 bytes, 670 lines; single retained Preview slot (`activePreview`, `previewId`), `previewBusy`/`applyBusy` guards, `/api/preview` + `/api/apply`, `STALE_PREVIEW` / `PREVIEW_NOT_READY` semantics; target classification currently path-equals-default (`ui.mjs:213-218`) — superseded by profile-identity classification in implementation (A-1 scope).
- `dsh/host.mjs`: 7,210 bytes, 185 lines; no `inject`, no `loader`/`profileContext`/`configEditor` reference (native-transport absence verified).
- `dsh/lifecycle.mjs`: 21,780 bytes, 517 lines; exact-exit child ownership (frozen).
- `package.json`: `version 1.4.5`; peers pin `@deepseek-ai/dsh-typert-protocol 0.2.1-alpha.2`, `@deepseek-ai/cordis 4.0.5-alpha.1`, `@deepseek-ai/schemastery 3.18.5-alpha.1`; `engines.dsh 0.2.1-alpha.2`.
- Tests present (listed, never executed): `tests/sync.test.mjs`, `tests/dev-tools.test.mjs`, `tests/v1.3/*` (6 test files + `helpers.mjs`), `tests/v1.4/*` (8 test files + `helpers.mjs`), `tests/v1.4.1/unsupported-protocol.test.mjs` (+ helpers), `tests/acceptance/smoke.mjs`. Count matches the frozen §2.2 inventory.
- Installed DSH (read-only version reads, no process start): `dsh@0.2.1-alpha.2`; nested `@deepseek-ai/dsh-atomic-write@0.2.1-alpha.2`, `@deepseek-ai/dsh-app-boot@0.2.1-alpha.2`, `@deepseek-ai/cordis-plugin-include@1.0.10-alpha.1`; installed `dsh-llm-pi-ai@0.2.1-alpha.2` present (`lib/index.js`, `lib/types/`) for read-only schema inspection at implementation time (Q4).

---

## 2. Accepted decisions A-1/A-2

Settled for planning by Product Owner. They authorize planning only — not implementation, not installed-DSH modification, not profile editing, not production Preview/Apply, not automatic reconciliation, not commit/push/release. The P0-R2 spec stays frozen.

- **A-1 APPROVED (target relocation):** synchronization moves from the legacy mapping-root `settings.yaml` to the `config` of the ID-selected `llm-pi-ai` entry in the explicitly selected DSH profile's writable patch file, subject to override refusal (§8.5). All other guarantees (exact-byte stale digest, exact-byte backup, pre-write verification, NO CHANGE idempotence, explicit Apply, six-route planning/placement/compat semantics frozen) are preserved with profile-bound identity. Spec shape: §3.3 A-1, §§7–9, §11.1–11.4, §15 item 2.
- **A-2 APPROVED (verification relocation):** the named pre-rename temp-file re-parse (`sync.mjs:1272-1278`) is NOT replicated file-for-file because `writeFileAtomic` owns its internal temp sibling and exposes no handle. Relocated without weakening the outcome: (i) pre-write verification applies to the EXACT commit string passed to `writeFileAtomic` (schema-dialect parse + six-array asserts + footprint excision asserts, §7.2 steps 8–9); (ii) the rename is atomic (old-complete or new-complete, never partial); (iii) post-write re-read verification asserts the file bytes (§7.2 step 12); any post-write failure enters the §12.4 safe-error state (backup retained, operator-confirmed recovery, no auto-revert). "Temp verification satisfied" MUST never be claimed from the internal temp. Spec shape: §3.3 A-2, §7.2 steps 8–9/11–12, §7.3, §12.4, §15 item 2.
- **Operator attestation APPROVED (admission, not proof):** required before production-target commits when the running DSH profile/overlay state cannot be independently established. Two modes only (§8.5): (A) operator declares the profile is not running; (B) operator declares the exact known launch overlay files for the running owner. Attestation permits the admission path; it proves no activation. Production outcomes always carry `liveActivation: UNKNOWN_LIVE_UNVERIFIED`. Spec shape: §8.5, §8.8, §7.2 steps 7/13, §12.4 item 6, §15 item 6.
- **Architecture C RETAINED:** standalone profile-aware adapter. Native ConfigEditor (B) and Hybrid remain rejected for the recorded reasons (B: online-only N6/N13/N14, no stale-digest/backup composition N17, lock re-entrancy §7.4; Hybrid: split-brain consistency contract). Selection NOT reopened. Spec shape: §10 decision record.
- **Dependency strategy A SELECTED:** dynamic resolution of installed DSH utilities with exact-version admission (§3 of this document; spec §11.6 as amended by the §15 decision point).

What A-1/A-2 do NOT authorize is restated in §13 STOP conditions and enforced per-slice.

---

## 3. Dependency strategy A

**Decision: strategy A — dynamic resolution of installed DSH utilities, with exact-version admission. No dependency installation. No persistent package additions. No manifest change in any S-slice without a separately approved §15-style amendment (which this ticket does not grant).**

### 3.1 Admitted packages and exact versions (verified installed in this ticket)

| Package | Required version | Observed (read-only `package.json` read) | Anchor |
| --- | --- | --- | --- |
| `@deepseek-ai/dsh-atomic-write` | `0.2.1-alpha.2` | same, at `<dsh-install>/node_modules/@deepseek-ai/dsh-atomic-write` | DSH install anchor |
| `@deepseek-ai/dsh-app-boot` | `0.2.1-alpha.2` | same, at `<dsh-install>/node_modules/@deepseek-ai/dsh-app-boot` | DSH install anchor |
| `@deepseek-ai/cordis-plugin-include` | `1.0.10-alpha.1` | same, at `<dsh-install>/node_modules/@deepseek-ai/cordis-plugin-include` | DSH install anchor |
| `@deepseek-ai/dsh` (anchor derivation + compat baseline) | `0.2.1-alpha.2` | same | resolved `dsh` executable |
| `@deepseek-ai/dsh-llm-pi-ai` (Q4 schema source, read-only) | `0.2.1-alpha.2` | same, present | DSH install anchor |
| `engines.dsh` compat bound | `0.2.1-alpha.2` | `package.json:48-50` | manifest (read-only) |

Top-level `<npm-root>/node_modules/@deepseek-ai/dsh-atomic-write` and `dsh-app-boot` are ABSENT (verified `ENOENT`) — resolution MUST NOT assume top-level hoisting. The nested `dsh/node_modules/@deepseek-ai/*` graph is the operative anchor. The entire installed combination matches the accepted compatibility baseline today; any mismatch at implementation time produces `INCOMPATIBLE_DSH` (never fetch/install/vendor/patch/reimplement).

### 3.2 Exact symbol allowlist (ONLY these; spec §6.3 — exhaustive)

- `@deepseek-ai/dsh-atomic-write`: `withFileLock`, `writeFileAtomic` ONLY.
- `@deepseek-ai/dsh-app-boot`: `loadProfileDirectory`, `readProfilePatches`, `composeEntries` ONLY (pure profile-path/composition readers; any further symbol needs a spec amendment).
- `@deepseek-ai/cordis-plugin-include`: `entryListSchema` ONLY (patch-list schema dialect).
- `yaml` / `js-yaml`: Document handling and schema-dialect parsing (existing OCMS-S dependencies; `yaml` already pinned `^2.7.0`).

FORBIDDEN in CLI/UI-child processes: `reconcileProfilePatches` (requires the root Include entry; throws outside a booted Host), `ConfigEditor`, any `cordis` Service/Context import, any `dsh-hmr` import, any Loader import, and any other symbol of the three admitted packages. The UI child and CLI use the IDENTICAL commit function, resolution order, exact-version admission, and refusals (T15).

### 3.3 Absolute resolution anchors (spec §11.6; order normative)

1. Target profile `node_modules` (fixture/scratch profiles may carry no DSH packages — then miss, continue).
2. DSH install anchor directory: sibling of the resolved `dsh` executable location; the executable is located via `PATH` lookup exactly as `SPEC.md` §DX-2 (no bunx/npx fallback).
3. Otherwise refuse `INCOMPATIBLE_DSH`.

Never bare-specifier hope. Never `cwd`-dependent lookup. Never silent fallback to a different version. Runtime version assertion on every load (package `version` field must equal the §3.1 pinned string exactly; prerelease tags compare exactly).

### 3.4 Loader-resolution contract (to be proven in S-slices, stated here)

- The loader resolves each admitted package ONLY through the §3.3 anchor order, records the resolved absolute path + asserted version in the Preview binding evidence (not in the user-visible success payload), and re-resolves identically at commit time (commit re-asserts; anchor drift → `INCOMPATIBLE_DSH` refusal, zero side effects).
- `withFileLock` MUST coordinate on the identical path the native writer locks: `<profileDir>/package.json` (lock sibling `package.json.lock`, mode `0o600`, PID record). A lock on `cordis.patch.yml` alone is FORBIDDEN (does not coordinate with native writers).
- Negative tests (all RED-first in S4/S5, deterministic, offline unless marked): unsupported DSH version; unresolvable package anchor (both anchors miss); version-skewed anchor (wrong prerelease present); symbol beyond allowlist (static import-allowlist assert, T15); `reconcileProfilePatches`/`ConfigEditor`/Loader/HMR import attempt (static assert); lock-path divergence (assert the contended path string equals `<profileDir>/package.json`).
- If dynamic resolution cannot be made reproducible from supported absolute anchors (e.g. anchor derivation ambiguous on a supported platform), the responsible slice records HOLD per §13 — it MUST NOT quietly switch to manifest dependencies, vendoring, or reimplementation.

---

## 4. Architecture C boundaries

Architecture C: OCMS-S-owned file transaction (`ProfileAwareCommit`) running in the CLI process or the UI child process against an explicit profile target, using ONLY the §3.2 file utilities. No Loader handle anywhere in OCMS-S code. No new Host Remote surface (the N8 native-transport design is NOT pursued). DSH owns runtime reconciliation (HMR auto-observe when online, boot application when offline); OCMS-S specifies observation + reporting, never triggering (`ProfileChangeReconciler` explicitly declined, §11.5).

### 4.1 Implementation invariants (normative restatement; conflicts → HOLD per §13)

1. Exactly six managed routes (`opencode-go`, `opencode-go-messages`, `opencode-go-responses`, `opencode-completions`, `opencode-messages`, `opencode`); `MANAGED_ROUTE_KEYS` is the closed set; managed container is `llm-pi-ai.providers`.
2. Go/Zen discovery authority unchanged (rosters/catalog/docs; placement rules; `-free` counterpart fallback; compat rules). No OMP routing import. No model/account probes. No scheduler or background sync.
3. No implicit profile selection: every profile-targeting operation takes explicit `--profile <name>` (CLI) or explicit picker value (UI); no default, no `web` fallback, no env-derived profile, no positional guessing; DSH name grammar enforced; manifest-existence pre-check with no auto-init.
4. Existing Preview/Apply state machine retained (single retained slot, `previewId` binding, `STALE_PREVIEW`/`PREVIEW_NOT_READY`, busy guards, success clears the slot). Extended only with target identity + digests + overlays + attestation binding (§8.6).
5. No write before explicit Apply. No write on NO CHANGE (no backup, mtime preserved).
6. Stale digest checked INSIDE the shared lock (§7.2 step 3), binding (profile, patchPath, exact bytes).
7. All pre-write validation before backup (steps 1–9 side-effect-free: no backup, no temp, no mtime change); exact-byte backup before replacement (step 10); atomic replacement via `writeFileAtomic` (step 11), not crash durability (fsync out of scope, multi-file atomicity unclaimed).
8. Only owned YAML spans may change (exhaustive footprint F1 / F1-add / F2 / F0 per route, §9.14); any ambiguous splice refuses (`ANCHOR_IN_MANAGED_SCOPE`, `TAG_IN_MANAGED_ARRAY`, `UNOWNED_COMMENT_AMBIGUOUS`, `UNPRESERVABLE_STRUCTURE`); whole-`config` replacement FORBIDDEN for the adapter; whole-Document serialization MUST NOT produce the commit string.
9. Production activation remains unverified: every production/offline outcome carries `liveActivation: UNKNOWN_LIVE_UNVERIFIED`; `RECONCILE_OBSERVED`/`RECONCILE_DEFERRED` are retired and MUST NOT be returned; `UPDATED_WITH_RECONCILE_FAILURE` requires independently evidenced authorized observation (scratch harness or an explicitly amended reporter — the latter does not exist).
10. Host lifecycle and DSH plugin files unchanged (`dsh/host.mjs`, `dsh/lifecycle.mjs`, `dsh/client.*`, `cordis.patch.yml` byte-identical; T19). No Host/Loader integration. No new routing or model-placement behavior.

### 4.2 Pre-existing editorial inconsistencies (recorded separately; frozen spec NOT rewritten)

1. "Architecture C" (this ticket) vs "Candidate C" (frozen spec §10): same referent; frozen wording governs.
2. Ticket §6 lists "F0 / F1 / F1-add / F2" while the frozen §9.14 footprint is F1 / F1-add / F2 / F0 plus "F3: NOTHING else" (F3 = the closed-world clause, not a write shape). Same semantics; frozen codes govern.
3. Ticket §9 recovery lists "Incompatible DSH version" alongside recovery states; the frozen taxonomy treats `INCOMPATIBLE_DSH` as a pre-write admission refusal (no artifact, fix-cause + re-Preview), not a post-write safe-error state. Same handling; frozen classification governs.
4. No normative conflict with a mandatory safety property was found; therefore no HOLD under the conflict rule. If implementation discovers a genuine conflict, §13 requires HOLD rather than guessing.

---

## 5. S1–S6 implementation sequence

Minimal RED→GREEN order. One ticket at a time. No autonomous next-slice execution. Each slice is independently reviewable. Slices build only on ACCEPTED prior slices; a failed mandatory acceptance test HOLDS its slice (no speculative redesign, no skipping ahead).

Conventions used below: "Allowed" = files the slice ticket may change (additive only unless stated). "Forbidden" = files the slice ticket MUST NOT touch (violation fails review). "RED" = failing tests written first. "GREEN" = acceptance for merge of that slice. "Review evidence" = artifacts the reviewer must see. "STOP" = conditions that halt the slice into HOLD.

### S1 — Profile target admission

- **Objective:** explicit profile selection, profile home/path resolution, production-vs-scratch classification, target identity binding, missing/duplicate entry refusal, read-only target resolution. No planning, no writing. Implements §8.1–8.4, §8.7 (R4), §11.1 (resolver half), with §6.3.2/§11.6 loader anchors for `loadProfileDirectory`-based read-only resolution.
- **Allowed:** new `profile/target-resolver.mjs` (or same-responsibility name); new `tests/profile-target/*.test.mjs` (additive); README/CHANGELOG notes for the slice if the repo convention requires (docs only).
- **Forbidden:** `sync.mjs` planning/placement/validation semantics; `ui.mjs` Apply path; `dsh/*`; `cordis.patch.yml`; `SPEC.md`; contract docs; `package.json`/`package-lock.json` pins; any live profile file; any production Preview/Apply enablement.
- **RED tests:** invalid profile names (empty, separators, `.`, `..`, `node_modules`, wrapper-narrowed additions); uninitialized profile (no `package.json`) refusal with no directory creation; symlink/reparse escape refusal (patch path outside real profile dir; patch path itself an external symlink; temp/backup sibling would leave the directory); production classification under real home EVEN WITH `--scratch` (+ `SCRATCH_MODE_PRODUCTION_REFUSED` at admission); scratch classification outside real home; missing `llm-pi-ai` → `PLUGIN_ENTRY_MISSING`; duplicate rows (same file, user+home layers) → `PLUGIN_ENTRY_DUPLICATE`; `insert`-row same-id ignored-but-flagged; bundle/home-only `config:` → `NOT_PROFILE_OWNED`; profile-switch invalidates Preview binding (T09-part); unresolvable anchor / version skew → `INCOMPATIBLE_DSH`.
- **GREEN acceptance:** all RED tests pass deterministically offline against synthetic fixture profiles under `%TEMP%` (never the real web profile); classification derived SOLELY from real-path-vs-real-home; resolver output binds `{ profileName, profileDirReal, patchPathReal, pluginEntryName, classification, declaredOverlays, liveAttestation }` or a stable typed refusal; no disk mutation beyond fixture setup; existing suites unmodified and passing.
- **Review evidence:** fixture tree listing; refusal-code table vs spec §12; real-path resolution log (paths redacted to classification facts); static diff proving no forbidden file changed.
- **STOP:** any implicit profile default/fallback; any auto-init of profile directories; any `--scratch` downgrade of production; any first/last-pick on duplicates; any live-profile contact; any anchor fallback to manifest/vendor/reimplementation → HOLD.

### S2 — Managed configuration reader

- **Objective:** sequence-root YAML reading, ID-based `llm-pi-ai` discovery, stored config + effective composition, provider-shape validation, custom-tag handling, digest computation. Read-only (no commit path). Implements §8.2, §8.5 file-side composition, §8.8 stored/effective reporting, §11.2, §9.1–9.4 admission.
- **Allowed:** new `profile/config-reader.mjs`; new `tests/profile-reader/*.test.mjs`; docs notes.
- **Forbidden:** same as S1 plus: no commit/transaction code; no `reconcileProfilePatches`/`ConfigEditor`/Loader/HMR imports (T15-part static assert begins here); no planning-semantics change; no `dsh/*`; no pins.
- **RED tests:** mapping-root/scalar-root → `PATCH_ROOT_NOT_SEQUENCE` (T01); entry at index 0/middle/last found by id, with static assert that no numeric literal locates the entry (T02); missing/duplicate/overridden/home-override attribution incl. `EFFECTIVE_DIFFERS_FROM_STORED` surfacing with both digests (T03-part, §8.5); malformed shapes (non-mapping `config`/`providers`/provider, non-array `models`) → `SETTINGS_INVALID` family (§9.4); unparsable YAML / unresolvable tags (incl. outside the entry) → refusal without writing (T07-part, read-path); `!!js`-aware parse (same tag line as the editor); stored/effective digest pair reported distinctly; non-ASCII ids round-trip in reads; `ADDRESSABILITY_UNVERIFIED` warning recorded file-side without blocking.
- **GREEN acceptance:** reader returns `{ patchBytes, patchDigest, documentModel, llmEntryIndex, storedConfig, effectiveConfig, effectiveDigest, overriddenBy }` or typed refusal; exact-byte digest over patch bytes; effective composition from file layers + explicitly declared overlays only; all RED deterministic offline; existing suites unmodified and passing.
- **Review evidence:** digest recomputation log (exact bytes → sha-256); composition layer list per fixture (bundle order, user patch, home patch if present, declared overlays); refusal matrix.
- **STOP:** any Loader/HMR/service import; any effective-config guess beyond declared layers; any silent tag/anchor normalization at read time; any live-profile contact → HOLD.

### S3 — Surgical desired-state rendering

- **Objective:** six-managed-array-paths-only rendering with byte-surgical splicing: empty desired-array removal (`[]` semantics incl. cases A–F), missing key/route behavior (F1-add/F2/F0), CST source-span extraction, byte-surgical splicing, unowned-byte excision verification, ambiguous comment/anchor/tag refusals, NO CHANGE preservation. Pure render/verify (no lock, no write). Implements §9 (R1-precise, C1–C2), §7.2 steps 5–6/8–9 (render half), §11.3 wrapper.
- **Allowed:** new `profile/surgical-render.mjs` (+ wrapper `profile/plan-builder.mjs` reusing `validateSourceBundle`, `planDesired`, `checkMembership`, `diffDesired`, digests, `buildNewConfig`-object-logic verbatim); new `tests/profile-render/*.test.mjs` (+ golden fixtures); docs notes.
- **Forbidden:** lock/acquire code; `writeFileAtomic`/backup code; planning/placement/compat semantic changes; whole-`config` replacement; whole-Document serialization as commit-string producer; `dsh/*`; pins; live profiles.
- **RED tests:** T04 golden desired arrays (order/fields/`compat` carried; F2 creates minimal 5-key route only when non-empty; case D creates nothing; case B lands `models: []` with route intact; case C adds exactly the `models` key; non-ASCII round-trip); T05 excision proof (original-minus-owned-spans BYTE-EQUAL candidate-minus-owned-spans; decoys: unrelated providers, credential-shaped synthetic references, other root entries, header/trailer, route-level fields); T06 (outside-span `!!js`/comments/unknown-fields/anchors/aliases/styles byte-identical; interior-line comments → `REPLACED_SUBTREE_NORMALIZATION` warning; boundary ambiguity → `UNOWNED_COMMENT_AMBIGUOUS`; tag inside replaced span → `TAG_IN_MANAGED_ARRAY`; anchor defined in / alias referencing replaced span → `ANCHOR_IN_MANAGED_SCOPE`; flow-style managed parent / missing indent reference → `UNPRESERVABLE_STRUCTURE`; unresolvable tag anywhere → refusal); duplicate managed IDs → `MEMBERSHIP` refusal; stale-shape/membership refusals; NO CHANGE (all-F0) produces no bytes and no mtime delta (T08-part at render level: render returns no-op with proof); lossy-serialization regression (untouched `[1, 2]` flow span must survive byte-identically — whole-serializer output MUST NOT be the commit string); desired `models: []` removal cases; malformed patch YAML (T07-part).
- **GREEN acceptance:** exhaustive footprint F1/F1-add/F2/F0 per route with F3 closed-world clause; construction copies unowned bytes (never re-serializes them); verification re-parses the candidate, asserts six arrays deep-equal desired, then excises owned spans on real bytes and asserts remainder BYTE-EQUAL (failure → `UNRELATED_CONTENT_CHANGED`/`VERIFY_FAILED` with nothing written); all RED deterministic offline; existing suites unmodified and passing.
- **Review evidence:** per-fixture owned-span tables (CST ranges) + excision diff (byte-equal remainder hashes); warning vs refusal partition log; static assert of no whole-`config` `setIn` and no whole-Document commit-string production.
- **STOP:** any whole-`config` replacement; any silent unowned-byte normalization; any guessing at ambiguous boundaries; any live-profile contact → HOLD.

### S4 — Atomic transaction

- **Objective:** the §7.2 13-step standalone commit with native-compatible locking: `package.json` lock with explicit measured `waitMs`, digest check inside lock, pre-write verification of the exact commit string, exact-byte backup, atomic replacement, post-write verification, safe-error outcomes, concurrency + failure injection. Implements §7 (R2-ordered, R3-separated, A-2), §12/§12.4 states, §6.3.4 re-entrancy prohibitions; consumes S1–S3 outputs; no UI wiring yet (headless commit function + harness).
- **Allowed:** new `profile/commit.mjs` (the `ProfileAwareCommit` function); failure-injection seams as PARAMETERS (lock-acquire override, backup-writer override, atomic-writer override, rename-fault override — no production-code branches on env flags); new `tests/profile-commit/*.test.mjs`; docs notes.
- **Forbidden:** Loader/HMR/`edit()` calls; `hmr.runExclusive` wrapping; nested `withFileLock`; lock on `cordis.patch.yml`; whole-Document commit-string production; planning-semantics changes; `dsh/*`; pins; UI/Host surface changes; auto-revert/auto-retry/auto-prune logic; live profiles (all fixtures synthetic under `%TEMP%`).
- **RED tests:** T10 stale digest (incl. parse-equivalent whitespace edit) → `STALE_TARGET`, no backup, no temp, slot-clearing semantics at API level stubbed; T12 lock timeout (pre-held `package.json.lock` + short `waitMs`) → `LOCK_TIMEOUT` zero-side-effect + single-flight busy; T13 atomic/backup failures (injected `writeFileAtomic` failure → `WRITE_FAILED` with original intact + step-10 backup retained/reported; injected backup failure → `BACKUP_FAILED` with atomic writer never invoked / no temp sibling; mocked rename EPERM×N exhaustion → `WRITE_FAILED`; forced orphan `<rand>.tmp` inertness: never read, never pruned); T03/T06/T07 refusal battery at commit boundary (all zero-side-effect incl. byte+mtime asserts); T08 NO CHANGE (no backup file, mtime unchanged); T05/T06 excision re-asserted at commit; missing backup / backup-write failure / rename failure / post-write verification failure paths; `INCOMPATIBLE_DSH` (version skew, unresolvable anchor) with zero side effects; injection-seam contract tests (seams are parameters, default to real implementations; no test mutates production code paths).
- **GREEN acceptance:** steps 1–13 execute in order inside ONE `withFileLock(<profileDir>/package.json)` hold with explicit `waitMs` (Q5 placeholder value flagged TBD-measured; default 2 s MUST NOT ship silently); steps 1–9 create no backup/temp/mtime change on any refusal; step 10 exact-byte backup precedes step 11; step 11 uses `writeFileAtomic(patchPath, commitString, { mode: 0o600 })`; step 12 re-read verification (+ footprint + duplicate-ID scan) with `POST_WRITE_VERIFY_FAILED` safe-error on failure (no auto-revert); step 13 records `UPDATED` + `fileVerified: true` + `effectiveComposition: MATCHED` + `liveActivation: UNKNOWN_LIVE_UNVERIFIED` (never reconcile tokens); concurrency self-test (two adapter commits serialize; loser refuses, no resurrection); all RED deterministic offline; existing suites unmodified and passing.
- **Review evidence:** step-order trace per test (1–13 with side-effect ledger: backup/temp/mtime at each refusal); lock-path assertion (`<profileDir>/package.json`); backup-retention listing; post-write re-read hashes.
- **STOP:** any pre-lock digest bypass; any backup-after-write ordering; any auto-revert/retry/prune; any lock-path divergence; any `UNKNOWN_LIVE_UNVERIFIED` deviation; any live-profile contact; any irreproducible anchor → HOLD.

### S5 — CLI and UI integration

- **Objective:** explicit profile targeting in CLI + UI, retained Preview identity, operator attestation (two modes, default-refuse), production admission refusal, existing Apply confirmation retained, clear `liveActivation: UNKNOWN` reporting, no Host/Loader integration. Implements §8.3, §8.5–8.9, §8 attestation UX (§15 item 6), §11.7 UI deltas; wires S1–S4 behind the existing state machine.
- **Allowed:** `ui.mjs` (ADD target identity + stored/effective reporting + attestation binding; state machine reused); `sync.mjs` CLI arg surface (ADD `--profile` + `--live-state` + `--scratch` alongside; `defaultSettingsPath` retained as scratch fallback only); new `profile/*` glue only as needed; new `tests/profile-cli-ui/*.test.mjs`; `ui/index.html` + client glue ONLY for identity/attestation display + Apply-confirmation re-display (no logic changes beyond binding); docs notes.
- **Forbidden:** `dsh/host.mjs`, `dsh/lifecycle.mjs`, `dsh/client.*`, `cordis.patch.yml` (byte-identical, T19); planning/placement/validation semantics; any new Host Remote method; any Loader/HMR/service call; any implicit profile default; any pre-checked attestation; any `RECONCILE_*` production token; credential exposure in recordings/logs; live profiles in tests.
- **RED tests:** T09 profile-switch invalidation (`STALE_PREVIEW`/`TARGET_MISMATCH`, zero writes); T15 privilege boundary (static allowlist assert on CLI/UI-child imports + behavioral commit-works-at-anchors / refuses-`INCOMPATIBLE_DSH` + identical-function assert); T17 classification (production-under-home EVEN WITH `--scratch` → `SCRATCH_MODE_PRODUCTION_REFUSED`; temp fixture → `SCRATCH`; cross-classification Apply refuses; classification bound + displayed); attestation grammar battery (absent `--live-state`/unacknowledged control on production → `LIVE_OVERLAY_UNKNOWN`; mode A vs B acceptance; attestation bound to `previewId`, re-displayed at Apply confirmation, invalidated on profile/overlay change; attestation separate from write permission; recorded without credentials); stale-Preview on target-byte change (T10 at API level); NO CHANGE API response (no backup, mtime preserved); `liveActivation: UNKNOWN_LIVE_UNVERIFIED` asserted on every production/offline Apply response; misleading-attestation negative (false attestation is operator error — post-write effective checks surface it, never silently absorb); no-runtime-observation-channel negative (muted harness → `UPDATED` + UNKNOWN, never failure code).
- **GREEN acceptance:** CLI grammar `--profile <name>` (required for profile ops) + `--live-state=<mode-A|mode-B payload>` (absent → production refusal) + `--scratch` (restriction only) + retained `--settings=` (scratch only) with duplicate/invalid/unknown-flag refusals; UI picker + UNATTESTED-default acknowledgment control (never pre-checked) + Apply-confirmation re-display; retained Preview binds full identity + digests + overlays + attestation; existing Apply confirmation + busy guards retained; all RED offline (loopback harness, synthetic fixtures); existing suites unmodified and passing.
- **Review evidence:** CLI `--help` text + grammar decision table; UI screenshots/domsnap of UNATTESTED default + confirmation re-display (synthetic data only); refusal-code matrix; import-allowlist static report.
- **STOP:** any implicit profile selection; any pre-checked attestation; any third attestation mode; any scratch-flag production downgrade; any Host/Loader wiring; any credential in logs/recordings; any live-profile test → HOLD.

### S6 — Controlled scratch acceptance

- **Objective:** controlled scratch-only acceptance: native-writer contention, DSH schema admission, HMR activation observation in scratch ONLY, effective-composition parity, Windows timing / measured lock `waitMs`, recovery exercise, regression suite. Implements the **(R)** tests (T11/T14/T16/T20), Q1–Q5 closure measurements, §12.4 recovery drill file-side, T18/T19 regression proof. NO production runtime, NO production profile, NO real web profile boot.
- **Allowed:** new `tests/profile-acceptance/*.test.mjs` + harness helpers (disposable scratch DSH runtime fixture only); `waitMs` calibration constant update in `profile/commit.mjs` ONLY (value from measurement; no logic change); docs notes (recovery drill log, Q-evidence appendix).
- **Forbidden:** production targets; real-profile boot; any production activation claim; any planning/commit/UI logic change beyond the `waitMs` value; `dsh/*`; pins (without amendment); any auto-recovery code.
- **RED tests (all (R), disposable scratch runtime, known overlay lists):** T11 contention (native `edit()` mid-window vs adapter commit on SAME `package.json.lock` path; loser refuses; no resurrection; withheld-launch-overlay companion → `LIVE_OVERLAY_UNKNOWN`); T14 authorized-observation reconcile failure (harness Loader rejects new config → `UPDATED_WITH_RECONCILE_FAILURE` with backup path, bytes stay verified-new, no auto-revert; muted-channel companion → `UPDATED` + UNKNOWN); T16 live-vs-offline parity (booted-scratch with known overlays vs offline fixture → both `UPDATED` + `MATCHED` + UNKNOWN; plus harness `scratchActivation: OBSERVED` with effective-config agreement, labeled `SCRATCH-VERIFIED`; withheld-overlay companion documents the attestation need); T20 effective parity (file-side six arrays + scratch-composed effective config both equal desired; `EFFECTIVE_DIFFERS_FROM_STORED` absent post-commit); Q5 measurement (21-entry/5k-line-class fixture render+commit lock-hold timing on Windows → explicit `waitMs` with headroom; lock `waitMs` surfaced on timeout); recovery drill (each §12.4 state exercised file-side: re-Preview → operator-authorized restore-or-accept → re-Preview; backups never auto-deleted); T18 (existing suites pass unmodified) + T19 (Host/lifecycle/client/patch/docs/pins byte-identical, packs list unchanged).
- **GREEN acceptance:** all (R) tests pass on disposable scratch runtimes with zero live-profile contact (CI assertion); `waitMs` set from measurement (not the silent default); Q1–Q5 evidence thresholds met (§7 of this document); recovery drill log complete; T18/T19 regression green.
- **Review evidence:** harness construction log (known overlay lists doubling as attestation); timing histograms + chosen `waitMs` rationale; effective-parity diffs (never credential-bearing); recovery drill checklist with backup paths + re-Preview hashes.
- **STOP:** any production-runtime boot; any real-profile fixture; any generalized production activation claim; any unmeasured `waitMs`; any auto-revert/retry; any failed mandatory test triggering redesign instead of HOLD → HOLD.

Slice independence rule: S2 needs S1 accepted; S3 needs S2; S4 needs S1–S3; S5 needs S1–S4; S6 needs S1–S5. No slice may be split across tickets to evade review; no slice may be combined into an unbounded implementation ticket.

---

## 6. T01–T20 traceability

Authority: frozen §13. Every case uses synthetic profiles or a controlled disposable scratch DSH runtime. Never the user's real web profile. "Det" = deterministic offline; "(R)" = controlled scratch runtime.

| ID | Requirement (frozen) | Primary slice | Supporting | Mode |
| --- | --- | --- | --- | --- |
| T01 | Sequence root admission; mapping/scalar refuse | S2 | S4 (commit-boundary re-assert) | Det |
| T02 | ID-locate (0/middle/last); anti-fixed-index static assert | S2 | S3 (render uses located index) | Det |
| T03 | Missing/duplicate/overridden entry; insert-row flag; zero-modification refusals | S1+S2 | S4, S5 | Det |
| T04 | Six arrays land exactly (C1 cases A–F: removal→`[]`, missing-key add, absent+non-empty create, absent+empty create-nothing, all-identical NO CHANGE); route fields preserved; non-ASCII | S3 | S4, S6 | Det |
| T05 | Unrelated content untouched; span-excision proof; decoys incl. synthetic credential-shaped references | S3 | S4 | Det |
| T06 | Comments/`!!js`/anchors/unknown-fields/styles; warning vs four refusals; unresolvable-tag refusal | S3 | S4 | Det |
| T07 | Invalid YAML refuses without writing | S2 | S3, S4 | Det |
| T08 | NO CHANGE: no backup, mtime preserved, dispositions reported | S3+S4 | S5 | Det |
| T09 | Profile switch invalidates Preview | S1 | S5 | Det |
| T10 | Stale digest (incl. whitespace-only edit) → zero-side-effect refusal + slot clear | S4 | S5 | Det |
| T11 | Concurrent native writer; same lock path; known-overlay attestation; withheld-overlay refusal | S6 | S4 (mechanism), S5 (attestation) | (R) |
| T12 | Lock timeout + single-flight busy; zero side effects | S4 | S5 | Det |
| T13 | Atomic/rename/backup failures; orphan-temp inertness | S4 | S6 (timing) | Det |
| T14 | Authorized-observation reconcile failure (+ muted-channel negative) | S6 | S4 (state), S5 (reporting) | (R) |
| T15 | UI-child/Host privilege boundary: static allowlist + behavioral anchor tests + identical function | S5 | S1–S4 (imports constrained throughout) | Det |
| T16 | Live-vs-offline parity in scratch; `scratchActivation` labeled; withheld-overlay companion | S6 | S5 | (R) |
| T17 | Production/scratch classification; `--scratch` restriction; cross-classification refusal | S1 | S5 | Det |
| T18 | Existing suites pass unmodified (reuse proof; additive tests only) | Every slice (gate) | S6 (final proof) | Det |
| T19 | Runtime/package boundary byte-identical; pins unchanged; packs list unchanged | Every slice (gate) | S6 (final proof) | Det |
| T20 | Same effective configuration after update (file-side + composed); no conflated YAML-text criterion | S6 | S3, S4 | (R) |

Negative/adversarial coverage (ticket §6) mapped: profile switching → S1/S5 (T09/T17); stale Preview → S5 (T09/T10); concurrent native writer → S4/S6 (T11/T12); malformed patch YAML → S2/S3/S4 (T07); lossy YAML formatting → S3 (serializer-regression + T05/T06); F0/F1/F1-add/F2 → S3/S4 (T04/T08); `desired models: []` → S3 (cases A–C); duplicate model membership → S3/S4 (`MEMBERSHIP`); comment-boundary ambiguity → S3 (T06); anchors/aliases → S3 (T06); unknown YAML tags → S2/S3 (T06/T07); non-ASCII → S2/S3 (T04); unsupported DSH version → S1/S4/S5 (`INCOMPATIBLE_DSH`); unresolvable anchor → S1/S4/S5; missing backup → S4 (T13 `BACKUP_FAILED` path); backup-write failure → S4 (T13); rename failure → S4 (T13); post-write verification failure → S4 (`POST_WRITE_VERIFY_FAILED`); misleading attestation → S5 (negative); no observation channel → S5/S6 (T14/T16 negatives); NO CHANGE byte/mtime preservation → S3/S4/S5 (T08); exact unowned-byte preservation → S3/S4 (T05/T06 excision).

Every test asserts the §7.3 side-effect ledger (which refusals create no backup/temp/mtime change vs which retain the step-10 backup as a reported recovery artifact).

---

## 7. Q1–Q5 evidence plan

No unsupported production activation claim in any slice. A failed mandatory acceptance test HOLDS its slice; it never triggers speculative redesign.

- **Q1 (scratch-only live activation observation).** Evidence: T16/T20 harness `scratchActivation: OBSERVED | FAILED` records, labeled `SCRATCH-VERIFIED`, never generalized; production outcomes carry `UNKNOWN_LIVE_UNVERIFIED` (§8.8). Responsible: S6 (collect), S5 (report correctly). Method: disposable scratch runtime with known overlays; dump-composed effective config compared file-side (never credential-bearing). Threshold: both live-vs-offline cases verify six arrays file-side + effective agreement in the declared-overlay case; muted-channel negative stays `UPDATED`+UNKNOWN. Failure: any production activation claim or any generalization of scratch observation → HOLD S5/S6.
- **Q2 (Loader-waterfall validation gap).** Evidence: adversarial corpus (malformed provider shapes, bad `api` literals, type violations) run through the scratch runtime in T14/T20; any class the file-side schema-dialect check accepts but the Loader rejects becomes an additional pre-write exact-shape assertion (S3/S4 scope only, no planning-semantics change). Responsible: S6 (corpus + runs), S3/S4 (assertions if needed). Threshold: corpus dispositioned; gap classes either proven absent or covered by new assertions with RED tests. Failure: uncharacterized gap at S6 sign-off → HOLD S6 (blocks implementation sign-off, not this readiness).
- **Q3 (install-anchor resolution + live-state attestation boundary).** Evidence: T11/T16 harnesses construct `ProfileContext`-equivalent facts explicitly (known launch overlays double as satisfied attestation; withheld-overlay case proves `LIVE_OVERLAY_UNKNOWN`); anchor-resolution battery (both anchors miss / version skew / symbol drift → `INCOMPATIBLE_DSH`) in S1/S4/S5; DSH-home derivation (`resolveDshHome`, env overrides) proven by T17 classification tests. Responsible: S1 (anchors+classification), S4 (commit admission), S5 (attestation UX), S6 (harness facts). Threshold: port/lock/process inference absent (static + behavioral); attestation default-refuse proven; telemetry exclusion by construction cited. Failure: any live-state inference or irreproducible anchor → HOLD the responsible slice.
- **Q4 (installed `dsh-llm-pi-ai` schema compatibility).** Evidence: read-only inspection of the installed `dsh-llm-pi-ai@0.2.1-alpha.2` schema source at implementation time (NOT done in P0 per scope bound; allowed in S2/S3/S6 planning slices as read-only). Responsible: S2 (shape admission), S3 (render assertions), S6 (Q2 corpus grounding). Method: source read + fixture cross-check; no DSH runtime start required for the read. Threshold: exact accepted shape of `config.providers[*]` documented as test fixtures; Q2 assertions traceable to schema lines. Failure: schema contradicts the §9 footprint (e.g. requires unowned-span mutation) → HOLD S3 (genuine normative conflict rule, §13).
- **Q5 (measured Windows lock `waitMs` budget).** Evidence: T11/T13 timing on Windows for 21-entry/5k-line-class fixtures (render+commit lock-hold duration); explicit `waitMs` with headroom replaces the 2 s default; timeout surfaces `LOCK_TIMEOUT` (T12). Responsible: S4 (mechanism + placeholder flagged TBD), S6 (measurement + calibration — the ONLY logic-adjacent value change permitted in S6). Threshold: histograms recorded; chosen value justified; contention behavior re-proven at the new value. Failure: unmeasured default ships or contention unsafe → HOLD S4/S6.

---

## 8. CLI/UI attestation contract

Future behavior specification only. No implementation in this ticket.

Production targeting requires explicit user selection, never implicit web-profile selection. Every profile-targeting operation takes explicit `--profile <name>` (CLI) or explicit picker value (UI). No default. No `web` fallback.

The attestation distinguishes exactly two modes. No third mode exists. No additional mode may be invented:

- **A. Operator declares the profile is not running.** Operator-verified by their own means (e.g. stopped DSH). Folded into the Preview binding as mode-A text.
- **B. Operator declares the exact known launch overlay files for the running owner.** The declared `<list>` (exactly these files and no others) is folded into composition for BOTH Preview and commit. Withheld overlays are a design-visible mismatch (T11/T16 companions), never silently absorbed.

Contract properties (all normative for the future slices):

1. Default state: `UNATTESTED` — REFUSE production Apply with `LIVE_OVERLAY_UNKNOWN` (zero-side-effect, §7.2 step 7). Scratch-classified targets do not take attestation (not applicable; fixture control is the harness contract).
2. Explicit, never pre-checked: CLI requires an explicit `--live-state=` argument (absent → refusal for production targets); UI requires an explicit acknowledgment control (never pre-checked) bound to `previewId`.
3. Bound to the Preview identity: attestation text + declared overlays + full target identity + digests are frozen into the retained Preview; Apply re-validates the binding (`STALE_PREVIEW`/`TARGET_MISMATCH` on drift).
4. Visible again at Apply confirmation: the existing Apply confirmation re-displays the attestation text/mode before the user confirms.
5. Invalidated when the profile or declared overlay selection changes: any change clears/requires fresh attestation (old `previewId` refuses).
6. Kept separate from permission to write: attestation admits the overlay-knowledge path; the write still requires the existing explicit Apply confirmation. Neither implies the other.
7. Recorded without credential exposure: attestation records mode + overlay paths + timestamps; never credentials, tokens, or model-gateway secrets.
8. Declaration, not proof: a false attestation is operator error — surfaced where possible by post-write effective checks, never silently absorbed. Post-write production reporting ALWAYS states `liveActivation: UNKNOWN_LIVE_UNVERIFIED`. No `RECONCILE_OBSERVED`/`RECONCILE_DEFERRED` production claim.

CLI argument grammar (specified, not implemented):

- `--profile <name>` (required for profile ops; DSH grammar; duplicate/invalid → refusal).
- `--live-state=not-running` (mode A) | `--live-state=overlays:<comma-separated-explicit-path-list>` (mode B; exact grammar finalized in S5 within these bounds).
- `--scratch` (restriction mode; production target → `SCRATCH_MODE_PRODUCTION_REFUSED` at admission, attestation or not).
- Retained `--settings=<path>` (scratch-only escape hatch; production-classified path via this flag is still PRODUCTION).
- Refusal conditions: absent `--live-state` on production target; malformed mode/payload; unknown/duplicate flags; profile/overlay change after Preview; classification mismatch at Apply; any implicit-selection attempt.

---

## 9. Operator recovery procedure

Operator-ready section for the future implementation. No recovery operation is executed in this gate. No command below automatically overwrites production configuration. Restoring a backup never guarantees successful Loader reconciliation (activation is DSH-owned).

How to recognize each state (all states report stable codes; pre-write refusals in steps 1–9 have no backup/temp/mtime change):

- `BACKUP_FAILED`: Apply refused before any write; no temp exists; target file unmodified. Cause: filesystem permission/space/path fault at backup step. Action: fix the filesystem cause, re-Preview, retry Apply.
- `WRITE_FAILED`: backup EXISTS and is reported with its path; original file intact (package removed its temp); no partial file. Orphan `<file>.<rand>.tmp` sibling possible only if the package's own cleanup threw — inert, unique-named; report, do not prune cross-run, do not hand-delete the lock. Action: inspect, re-Preview if bytes changed, retry Apply.
- `POST_WRITE_VERIFY_FAILED`: file holds UNVERIFIED bytes; backup retained; NO auto-revert. Action: follow the 10-step restoring-write procedure below (explicit authorization required) OR accept bytes after cause analysis + re-Preview.
- `UPDATED_WITH_RECONCILE_FAILURE` (only when independently evidenced): file bytes are the verified new bytes; an AUTHORIZED observation channel (scratch-harness Loader diagnostic, or a future explicitly amended reporter — neither suspicion, HMR source text, nor attestation qualifies) supplied failure evidence. Without such evidence the outcome stays `UPDATED` + `UNKNOWN_LIVE_UNVERIFIED` with guidance to re-Preview. Action: same 10-step procedure (restore + allow DSH to re-reconcile to prior state, OR fix the activating cause and allow re-reconcile). Never auto-revert, never auto-retry reconciliation from outside the Host process.
- `STALE_TARGET`: someone changed the target bytes after Preview (even whitespace). Slot cleared; no backup/temp. Action: re-Preview against current file-truth, review the diff, Apply fresh if still intended.
- `LIVE_OVERLAY_UNKNOWN`: production target without valid attestation (or attestation contradicted at commit). Zero side effects. Action: supply mode-A/B attestation correctly (or stop the owner first), re-Preview, Apply.
- `INCOMPATIBLE_DSH`: version/anchor admission failure. Zero side effects. Action: align the installed DSH combination to the §3.1 baseline (no fetching/installing by OCMS-S itself); re-Preview after the environment matches. Never vendor/patch/reimplement.

Restoring-write procedure after a completed replacement (all restores are operator-authorized, compatible-transaction restores — never uncontrolled overwrite):

1. Identify the exact profile and target (profile name, real profile dir, real patch path from the Apply report binding).
2. Confirm the original target identity (re-resolve; refuse on `SYMLINK_ESCAPE`/classification drift).
3. Identify the matching exact-byte backup (`<patchPath>.bak-<UTC-stamp>` from the report; verify it is the sibling of the resolved target).
4. Compare relevant digests (backup bytes vs reported pre-commit digest; current file bytes vs reported post-commit digest) to confirm which state is on disk.
5. Establish safe exclusive ownership (no concurrent writer; acquire the SAME `<profileDir>/package.json` lock path via a defined compatible transaction; production targets re-require attestation).
6. Require explicit operator authorization for any restoring write (separate confirmation from the original Apply; record it).
7. Restore only through a defined compatible transaction (same 13-step ordering, backup-before-replacement, verification) — never raw copy/uncontrolled overwrite.
8. Re-read and verify resulting target bytes (six arrays + footprint excision on the re-read bytes).
9. Re-Preview against the recovered configuration (fresh `previewId`; stale slot never reused).
10. Keep runtime activation separate from file recovery (file recovery verifies bytes; activation stays `UNKNOWN_LIVE_UNVERIFIED` in production; observe only through authorized mechanisms).

Controlled scratch-recovery test plan (S6): each §12.4 state is forced against disposable scratch fixtures (injected backup failure, injected atomic-write failure, corrupted post-write bytes, harness-evidenced reconcile failure, stale-target edit, unattested production attempt, version-skewed anchor); for each, the drill asserts the recognized code, the artifact ledger (backup present/absent as specified), the 10-step file-side recovery, and the re-Preview hash chain. Backups are NEVER auto-deleted; there is no retention-pruning step to test.

---

## 10. Failure/refusal taxonomy

All refusals are `NOT WRITTEN`-family with stable codes (frozen §12). Pre-write (§7.2 steps 1–9): zero side effects. Backup artifacts exist ONLY after step 10 passes or after a post-backup infrastructure failure (§12.4 ledger).

- Admission: `INVALID_PROFILE_NAME` / `PROFILE_NOT_INITIALIZED` / `SYMLINK_ESCAPE`; `SCRATCH_MODE_PRODUCTION_REFUSED`; `PATCH_UNREADABLE` / `PATCH_PARSE_ERROR` / `PATCH_ROOT_NOT_SEQUENCE`; `PLUGIN_ENTRY_MISSING` / `PLUGIN_ENTRY_DUPLICATE`; `NOT_PROFILE_OWNED`; `INCOMPATIBLE_DSH`.
- Structure/safety (step 6): `SETTINGS_INVALID` family; `ANCHOR_IN_MANAGED_SCOPE` / `TAG_IN_MANAGED_ARRAY` / `UNOWNED_COMMENT_AMBIGUOUS` / `UNPRESERVABLE_STRUCTURE`; `MEMBERSHIP_MISMATCH` / `GENERATED_MEMBERSHIP_MISMATCH`; `UNRELATED_CONTENT_CHANGED`; warning (not refusal) `REPLACED_SUBTREE_NORMALIZATION`.
- Composition/liveness (step 7): `OVERRIDDEN` (with layer attribution); `LIVE_OVERLAY_UNKNOWN`.
- Staleness/binding: `STALE_TARGET` (`stale: true`, slot cleared); `STALE_PREVIEW` / `PREVIEW_NOT_READY` / `TARGET_MISMATCH`.
- Lock: `LOCK_TIMEOUT` (+ `APPLY_BUSY`/`PREVIEW_BUSY` single-flight).
- Backup/write/verify: `BACKUP_FAILED` (commit never attempted, no temp); `WRITE_FAILED` (original intact, backup retained+reported); `VERIFY_FAILED` (pre-write commit-string failure, nothing written, no backup); `POST_WRITE_VERIFY_FAILED` (safe-error, backup retained, no auto-revert).
- Post-write authorized-observation only: `UPDATED_WITH_RECONCILE_FAILURE` (requires authorized evidence; never from suspicion/text/attestation).
- Success (not refusal): `NO_CHANGE` (idempotent, no backup, mtime preserved); `UPDATED` (+ `fileVerified: true`, `effectiveComposition: MATCHED`, `liveActivation: UNKNOWN_LIVE_UNVERIFIED`, `backupPath`, `newDigest`).

---

## 11. Source-file change footprint

Per-slice allowed/forbidden sets are in §5; this section states the global footprint rule the reviewers enforce on every slice diff.

May change (additive; planning/placement/validation semantics reused verbatim):

- New `profile/*.mjs` modules (resolver, reader, plan-builder wrapper, surgical render, commit; illustrative names — responsibility boundaries normative, filenames not).
- New tests ONLY as additive files under `tests/profile-*/` (+ harness helpers); existing test assertions NEVER edited.
- `sync.mjs`: ADD profile-target CLI surface alongside (`--profile`, `--live-state`, `--scratch`); `defaultSettingsPath` retained as scratch fallback only. Lines 166–920 logic (planning/placement/validation) MUST NOT change semantics.
- `ui.mjs` + `ui/index.html` client glue: ADD target-identity display, stored/effective reporting, attestation control + Apply-confirmation re-display. State machine (`activePreview`, `previewId`, busy guards, `STALE_PREVIEW` semantics) reused.
- README/CHANGELOG notes per slice (docs only).

MUST NOT change (any slice touching these fails review):

- `dsh/host.mjs`, `dsh/lifecycle.mjs`, `dsh/client.js`, `dsh/client.mjs`, `dsh/build-client.mjs`, `cordis.patch.yml` (T19 byte-identity gate).
- `SPEC_DSH_PROFILE_AWARE_SYNC.md` (frozen), `SPEC.md` (frozen), authoritative contract docs.
- `package.json` / `package-lock.json` pins and dependency lists (no install, no addition, no version drift without a separately approved amendment).
- Existing tests' assertions (T18 gate); no test edits to make RED pass.
- Installed DSH files (read/execute as libraries within §3.2 only; never edited).
- Live profiles, credentials, account/model-gateway surfaces (never touched/probed).

---

## 12. Implementation acceptance gates

No slice merges unless ALL hold for that slice (plus the slice's §5 GREEN clause):

1. RED-first proof: failing tests committed/added before the GREEN change; reviewer sees the RED log (or RED-by-construction for static asserts with the pre-change failure demonstrated on a scratch branch/harness).
2. T-traceability: every new test cites its T-ID(s) + spec section; T18/T19 regression green with byte-identity evidence for the frozen files.
3. Side-effect ledger: every refusal test asserts backup/temp/mtime behavior per §7.3; NO CHANGE asserts no-write + mtime preservation.
4. Allowlist gate (T15-part from S1 on): static import scan of CLI/UI-child paths passes (exact packages + exact symbols; forbiddens absent).
5. Attestation gate (S5/S6): UNATTESTED-default refusal proven; two modes only; binding/invalidation/re-display proven; no credential in recordings.
6. Activation-honesty gate: no `RECONCILE_*` production token anywhere in code/tests/responses (grep gate); every success path asserts `UNKNOWN_LIVE_UNVERIFIED`.
7. Fixture-hygiene gate: no test references the real home profile, the real web patch, accounts, or network model-gateways; scratch fixtures under `%TEMP%`-style disposable dirs; (R) tests fenced to the scratch harness.
8. Q-evidence gate (S6 final): Q1–Q5 thresholds of §7 met and logged; `waitMs` measured (Q5); schema read logged (Q4); corpus dispositioned (Q2).
9. Recovery gate (S4/S6): §12.4 drill paths covered file-side with backup-path + re-Preview-hash evidence; no auto-revert/retry/prune code present (static + behavioral).
10. Review-independence gate: a reviewer other than the slice author replays the slice's evidence (fixtures, digests, refusal codes, diff footprint) and signs the slice; any §14 A–O failure returns the slice to RED.

---

## 13. Explicit STOP conditions

Any of the following HOLDS the responsible slice (work stops; report filed; no workaround, no guessing, no speculative redesign, no skipping to the next slice):

1. Entry drift: branch/HEAD/tree/spec-identity mismatch; tracked changes present; live profile touched.
2. Normative conflict: the frozen spec genuinely conflicts with a mandatory safety property (§4.1) — HOLD and report; do not resolve by guessing.
3. Implicit production touch: any ticket/slice touches a production profile, boots DSH against one, or enables live Apply implicitly.
4. Silent routing change: any model-routing/placement/compat semantic drift (T18 failure) or any OMP/probe/scheduler/background-sync introduction.
5. Premature A-1/A-2 activation: any code path exercising the new target/verification before S-slice acceptance (this document implements nothing).
6. Unmapped T-case: any T01–T20 without a responsible slice + RED test (traceability break).
7. Unconfirmed write: any write path not behind explicit Apply confirmation + Preview binding (incl. any auto-revert/retry/restore write).
8. Scratch downgrade: any flag/mode reclassifying a production target to scratch (R4 violation).
9. YAML rewrite escape: any unowned-byte mutation passing verification (excision failure) or any ambiguous-splice guess.
10. Lock bypass: stale-check outside the native lock, wrong lock path, nested/re-entrant acquisition, or network I/O under the lock.
11. Loader/HMR boundary breach: any Loader/HMR/Cordis-service/`edit()`/`reconcileProfilePatches` import or call in CLI/UI-child paths; any new Host Remote surface.
12. Irreproducible resolution: dynamic resolution not reproducible from §3.3 absolute anchors (version skew, anchor ambiguity) — HOLD; do not switch to manifest/vendor/reimplementation.
13. Assumed activation: any `RECONCILE_OBSERVED`/`RECONCILE_DEFERRED` production claim, any attestation-as-proof, any HMR-text-as-observation.
14. Operator-control loss: backup auto-deletion/pruning, uncontrolled overwrite restore, credential exposure, or any auto-overwrite recovery command.
15. Test-triggered loop: a failed mandatory test triggering redesign/retry-loop instead of HOLD.
16. Scope escape: any S1-code execution, live Preview, production Apply, DSH restart, commit/push/tag, dependency install, or next-gate auto-start arising from this planning ticket.

---

## 14. Adversarial audit

First pass (readiness author vs frozen spec + ticket). Each item challenged against the plan above:

| # | Challenge | Verdict |
| --- | --- | --- |
| A | Does any ticket touch production? | PASS: S1–S5 deterministic offline on synthetic fixtures; S6 boots disposable scratch runtimes only; live/real profiles forbidden per-slice + §12 gate 7 + §13(3). |
| B | Is live Apply implicitly authorized? | PASS: no Apply in S1–S4 (headless commit function tested against fixtures, no UI wiring until S5); S5 requires explicit Apply confirmation + attestation; S6 scratch-only. |
| C | Does any ticket silently change model routing? | PASS: planning/placement/compat frozen (§4.1(2), T18 gate every slice); footprint confined to six arrays + authorized ancestors. |
| D | Are A-1/A-2 implemented prematurely? | PASS: A-1/A-2 are planned shapes only; §§5/13 forbid exercising them before slice acceptance; this ticket writes no code. |
| E | Are all T01–T20 mapped? | PASS: §6 table maps all 20 with primary/supporting slices and modes; §5 RED lists cover each; negatives mapped explicitly. |
| F | Is every write behind explicit confirmation? | PASS: §4.1(5), S4 (function-level) + S5 (confirmation + attestation separation); restores require separate explicit authorization (§9). |
| G | Can any scratch flag downgrade production? | PASS: R4 rule restated (§4.1, S1/S5, T17); `--scratch` is restriction-only with `SCRATCH_MODE_PRODUCTION_REFUSED`; classification path-derived only. |
| H | Can any unsupported YAML rewrite pass? | PASS: S3 excision construction + verification (§9.16) with four refusals + closed-world F3; S4 re-asserts; §13(9) holds on escape. |
| I | Is stale-check protected by the native lock? | PASS: §7.2 step 3 inside ONE `withFileLock(<profileDir>/package.json)` hold (§4.1(6), S4); T10 proves incl. whitespace-only edits. |
| J | Are Loader/HMR boundaries preserved? | PASS: §3.2 allowlist + forbiddens, T15 static+behavioral from S1 on, no Host Remote growth, no `edit()`/`runExclusive` nesting (§4.1(10)-(11), §13(11)). |
| K | Is native dependency resolution reproducible? | PASS: §3 pins + absolute anchors + version assertion + refusal contract; irreproducibility → HOLD, never silent manifest switch (§3.4, §13(12)). |
| L | Is runtime activation ever assumed? | PASS: UNKNOWN-always production reporting (§4.1(9), §8-attestation, §12 gate 6); scratch observations fenced + labeled (Q1/S6). |
| M | Is backup recovery genuinely operator-controlled? | PASS: §9 10-step procedure; no auto-revert/retry/prune; backups never auto-deleted; restores via compatible transaction with separate authorization. |
| N | Can a failed test trigger an uncontrolled loop? | PASS: Q-plan + §5 slice rules + §13(15): mandatory-test failure HOLDS its slice; speculative redesign forbidden. |
| O | Does the plan accidentally authorize S1 code? | PASS: §§5/13 + final verdict explicitly authorize NO code; S1–S6 are specified tickets for future authorization, not granted here. |

First-audit defects found and corrected in-draft: (1) initial draft under-specified the injection seams as env-flag branches — corrected to parameter seams with no production-code env branching (S4); (2) initial draft let S6 change commit logic for `waitMs` — narrowed to value-calibration only (S6); (3) initial draft omitted the muted-observation negatives from the S5 list — added (S5/S6, T14/T16). All 15 items PASS after correction.

---

## 15. Independent verification

Second pass (independent re-read of this completed document against the frozen spec and the ticket, performed once, read-only):

- Re-read §§1–13 against frozen §§2–16: entry values reproduce (§2.1 HEAD/tree/status method noted with the `%T` equivalence); A-1/A-2/attestation/C/strategy-A statements match §§3.3/8.5/10/11.6 as approved; S1–S6 responsibilities partition §§7–9/11 without overlap or gap (resolver→reader→render→commit→integration→acceptance); T01–T20 mapping covers all §13 rows with Det/(R) modes intact; Q1–Q5 plan collects exactly the §14 evidence with the stated thresholds; attestation contract keeps the two modes with UNATTESTED-default and the seven properties; recovery covers all seven recognition states plus the 10-step procedure with no auto-overwrite command; taxonomy codes match §12/§12.4 with the `INCOMPATIBLE_DSH`-classification variance recorded in §4.2(3); footprint respects §11.7 (additive vs frozen); gates + STOP conditions enforce §§7/12/15 without adding implementation authorization.
- Re-checked prohibitions: one new file only (this document); no spec edit; no code/test/profile/dependency mutation (write ledger: single `write` of this path); no test execution; no DSH start; no Preview/Apply; no commit/push.
- Re-ran the §14 A–O battery on the final text: all PASS (see §14 table; corrections already folded in).
- Outcome: no additional defects; no HOLD condition met; readiness verdict `READINESS_PASS` is supported. Verification performed as document review only — not as runtime implementation.

---

## 16. Final verdict

**READINESS_PASS.**

The P0-R2 specification is verified present and complete; decisions A-1/A-2 + attestation + Architecture C + dependency strategy A are recorded as planning-settled with implementation explicitly NOT authorized; the S1–S6 RED→GREEN sequence partitions all T01–T20 work with per-slice allowed/forbidden sets, GREEN acceptance, review evidence, and STOP conditions; Q1–Q5 evidence, the two-mode attestation UX contract, the operator recovery procedure, the refusal taxonomy, the change footprint, the acceptance gates, and the A–O audit + independent verification are all specified above. Exactly one repository write was made (this document). All other files unchanged. No code, test, profile, dependency, commit, or runtime action taken.

HARD STOP. No S1 implementation. No live Preview. No production Apply. No DSH restart. No commit or push. No automatic next gate. Returned to the orchestrator for acceptance.
