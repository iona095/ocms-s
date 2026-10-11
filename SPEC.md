# OCMS-S Developer-Ergonomics Spec (post-v1.4.5)

Status: SPECIFICATION ONLY - do not implement. No product/runtime source is changed by this phase.
Baseline: OCMS-S v1.4.5, CLOSED. Target DSH: `0.2.1-alpha.2` EXACTLY.
Output of this phase: this file (`SPEC.md` at repository root). Stop after acceptance and await Product Owner confirmation before `/build`.

Verified baseline (this checkout):

    HEAD peeled commit: 70182943744397ecb5c00089529bd42bf44e8ead  (main / origin/main / v1.4.5)
    HEAD tree:          b618154685b331ffd66cb6ff38a95ec4618d34ae
    dsh --version:      0.2.1-alpha.2

Authoritative closed scope (do NOT reopen): model synchronization semantics; Go/Zen placement;
transport ownership; Preview/Apply; lifecycle ownership; HMR retirement behavior; Typert codecs;
package reproducibility repair; production configuration. No production Apply.

---

## 1. Objective

Provide a small, cross-platform, Node-based developer-ergonomics layer for an OCMS-S
developer/maintainer working locally from PowerShell, cmd, Bash, or another normal npm shell.

Primary goal: replace manual/repetitive development steps (build the browser client, register the
local checkout into a DSH profile, rebuild on change, launch a local DSH Web profile) with
explicit, safe npm commands - without changing runtime/product behavior.

Non-goals:

- No change to `sync.mjs`, `ui.mjs`, `ui/`, `dsh/host.mjs`, `dsh/lifecycle.mjs`, `dsh/client.mjs`,
  `dsh/client.js` semantics, `cordis.patch.yml`, contracts, or Apply behavior.
- No new runtime/product feature. No daemon, scheduler, probe, or transport work.
- No publication decision. Version stays `1.4.5` through `/spec` (see section 6).
- No production `settings.yaml` access from any new command.
- No Preview/Apply invocation from any new command.

The Phase-0 capability map (DX-1..DX-5) is APPROVED and is not re-asked. Only genuinely
unresolvable requirements may be returned as questions; there are none (see section 14).

---

## 2. Commands

Exact public surface. `<name>` is always a user-typed profile name. `--` is npm forwarding separator.

DX-1: `npm run build` (depends: none) - expose the canonical browser-client build through npm.
DX-2: `npm run register -- --profile <name>` (depends: DX-1) - register checkout into one explicit DSH profile.
DX-3: `npm run watch` (depends: DX-1) - watch build inputs and rebuild `dsh/client.js`. No DSH interaction.
DX-4: `npm run dev:web -- --profile <name>` (depends: DX-1, DX-2) - bounded build/register/launch of selected DSH Web profile.
DX-5: integration / tests / docs / acceptance (depends: DX-1..DX-4) - prove the layer without changing runtime behavior.

### 2.1 npm run build

- Invokes exactly the canonical builder, no other compiler/bundler path:
  `node dsh/build-client.mjs` with no arguments.
- Side effects: regenerates `dsh/client.js` from `dsh/client.mjs` only. No profile access,
  no DSH process launch, no settings access, no network.
- Stdout: builder output (`dsh/client.js written`) passes through.
- Extra arguments: any argument to `npm run build` is rejected with concise usage on stderr
  and non-zero exit (prevents smuggling profile semantics into the build).
- Exit: 0 on success; builder exact non-zero code on failure.

### 2.2 npm run register -- --profile <name>

- Missing `--profile`: fail BEFORE any DSH invocation or mutation, print concise usage
  (stderr), exit non-zero. This includes bare `npm run register` with no forwarded args.
- Explicit form MUST, in order:
  1. validate the profile argument (section 11);
  2. print the selected profile to stdout BEFORE any mutation: `ocms-s register: target profile "[name]"`;
  3. verify an already-available `dsh` executable (PATH lookup, no bunx/npx/network fallback);
     fail clearly on stderr when unavailable (see section 9);
  4. perform a non-mutating existence pre-check of that exact profile (read-only check that
     the resolved profile directory contains an initialized `package.json`; section 11). When absent,
     fail clearly on stderr and DO NOT invoke `dsh` (wrapper-side guard preventing silent construction - see P4);
  5. run exactly ONE plugin operation against that exact profile and nothing else (P3/P5);
  6. return non-zero on any failure, propagating the underlying exit code where one exists.
- The single operation is FROZEN (see section 7): `dsh plugin --profile <name> add <absoluteRepoRoot>`
  where the last token is the absolute path of this checkout. No `remove`, `update`,
  `install`, `why`, version-exemption, or second pnpm verb. No tarball pack step.
- Affect only plugin `ocms-s` (the package name of the absolute path passed). Never alter
  another plugin; never pass another package name, range, URL, or git spec.
- Never fall back to bunx/npx/network installation of DSH. Never create/modify production
  `settings.yaml`. Never auto-start DSH. No `--profile web` defaulting: `web`
  is used only when the developer literally typed `--profile web`.
- Unknown/extra flags, duplicate `--profile`, empty values, or values beginning with
  `-` are rejected with usage before any mutation.

### 2.3 npm run watch

- Form: `npm run watch` with NO arguments and NO profile semantics. Any forwarded argument
  (including `--profile`) is rejected with usage and non-zero exit. This retires the earlier
  deferred wording that included a profile argument.
- Behavior:
  - Run one initial build on start (same canonical builder as DX-1). If the initial build
    fails, report and exit non-zero without entering watch mode.
  - Then watch BUILD INPUTS ONLY: `dsh/client.mjs` and `dsh/build-client.mjs`.
    `dsh/client.js` (the output) is NEVER watched. Nothing else is watched.
  - On a relevant change: debounce 150 ms (trailing edge), serialize through a single build
    mutex - at most one builder at a time; bursts collapse into at most one queued rebuild;
    overlapping builders are impossible.
  - Success: print one line `ocms-s watch: rebuilt dsh/client.js` (stdout). Failure: print
    builder stderr plus `ocms-s watch: build failed (watching continues)` and CONTINUE
    watching (exit remains 0 until Ctrl-C or a fatal watcher error).
  - Irrelevant paths (including output writes, editor temp files outside the two
    inputs, node_modules, profiles, settings) trigger no build.
  - No DSH registration, restart, profile mutation, process scanning, PID-file killing, or
    settings access. No DSH invocation of any kind.
  - Ctrl-C (SIGINT/SIGTERM): stop watching, settle/cancel only the in-flight or queued build
    owned by this watcher, remove only watchers/timers it created, then exit 0 (or the fatal
    error code if the watcher itself faulted). Never touch unrelated processes.
- Exit codes: 0 on clean Ctrl-C shutdown; non-zero on initial-build failure or fatal watcher
  setup failure (e.g. inputs unreadable).

### 2.4 npm run dev:web -- --profile <name>

- Missing `--profile`: fail BEFORE build/register/launch or any mutation, usage on stderr,
  non-zero exit.
- Explicit form MUST, in order:
  1. validate profile (section 11);
  2. print `ocms-s dev:web: target profile "[name]"` BEFORE any mutation/start;
  3. run the canonical build (DX-1 semantics; build failure stops the sequence, non-zero);
  4. run the exact DX-2 register sequence against that same profile (register failure stops
     the sequence, non-zero; target is NOT re-printed - the register step prints its own line);
  5. launch EXACTLY `dsh --profile <name> --no-open` as a single foreground child with
     inherited stdio, attached until that child exits (section 10);
  6. exit with that exact child exit code.
- Launch argv is FROZEN to the long explicit form `dsh --profile <name> --no-open`.
  The positional shorthand (`dsh <name>`) MUST NOT be used (launcher parsing ambiguity).
  No extra DSH flags are added by default (no port/host/patch/from-default-profile/dump flags).
  Extra forwarded flags beyond `--profile <name>` are rejected with usage.
- MUST NEVER scan for, match, or terminate any process it did not spawn: no pgrep/taskkill/
  Get-Process sweep, no PID-file kill, no make-room kill of an occupying listener. Port/host
  conflict is a fail/report path (section 9), never a kill path.
- No production settings mutation, no daemon/detached spawn, no auto-start outside this
  explicit invocation, no Preview/Apply call.
- Ctrl-C: relay termination to the owned child only, wait for its exit, clean up only
  owned resources, then exit with the child code. Never touch a foreign DSH process.

---

## 3. Project structure

Smallest architecture meeting this spec. FROZEN direction (alternatives rejected in parentheses):

    package.json              # thin scripts only (build / register / watch / dev:web, test, test:smoke)
    dsh/build-client.mjs      # CANONICAL build implementation - already exists, UNCHANGED
    scripts/dev-tools.mjs     # single shared cross-platform developer CLI (all four commands)
    tests/dev-tools.test.mjs  # developer-tool behavior tests (no real-profile mutation)
    SPEC.md                   # this specification (this phase only)

- `package.json` scripts delegate to `scripts/dev-tools.mjs` subcommands, e.g.
  `"build": "node scripts/dev-tools.mjs build"`. Scripts stay one-liners; all argv/process
  logic lives once in `dev-tools.mjs` (sharing genuinely reduces duplication).
- Rejected: one script file per command (duplicates profile/process/exit logic); a second
  bundler/compiler path (violates ONE-build-implementation); Bash-only or PowerShell-only
  scripts (violates cross-platform); any new runtime dependency (violates section 6).
- `dsh/build-client.mjs` MUST NOT be modified, wrapped, or reimplemented. `npm run build`
  execs it as a child (`node dsh/build-client.mjs`) so failure propagation and stdio are exact.
- New files MUST be LF line endings (package reproducibility rule, v1.4.5). No change to
  `files`, `exports`, `main`, dependencies, or peers is authorized by this spec.
- This structure is the recommendation; `/build` may only deviate if it proves a SMALLER
  change meeting every contract, and must record the deviation in its commit message.

---

## 4. Code style

- Node.js ESM (`import`, `.mjs`), built-in Node APIs ONLY:
  `node:fs`, `node:fs/promises`, `node:path`, `node:url`,
  `node:child_process`, `node:os`, `node:process`. No new dependencies or devDependencies.
  (`fs.watch` for DX-3; no chokidar unless `/build` conclusively proves built-ins cannot
  meet the contract - not expected - and then it MUST ask first per section 6.)
- Cross-platform by construction: no shell scripts, no ps1 scripts, no shell-only syntax, no
  pgrep/taskkill/Get-Process, no POSIX-only signal assumptions beyond SIGINT/SIGTERM handling Node provides.
- Process invocation: `child_process.spawn` / `execFile` with `shell: false` where
  practical, explicit argv arrays, `stdio: inherit` for interactive foreground
  children (register pnpm passthrough, dev:web launch), piped capture only for short
  non-interactive probes. Exact exit-code propagation. No shell command-string
  construction, no interpolation into a shell string.
- Style: small pure argv parsers (testable without spawning), explicit usage strings,
  errors to stderr, target lines to stdout BEFORE mutation, fail-closed on any doubt.
  No telemetry, no network, no settings parsing in the ergonomics layer
  (existence pre-check reads only whether the profile package.json exists, never its settings).
- Determinism: no timestamps/randomness in outputs; build output byte-identity is inherited
  from the canonical builder and must not be post-processed.

---

## 5. Testing strategy

`/build` and later `/test` MUST follow TDD (RED -> minimal GREEN -> full regression -> commit).
Every slice needs failing tests first; no implementation edit without a failing test.

- Isolation: tests MUST NOT mutate real user DSH profiles, production settings, or the
  real `dsh/client.js` beyond a temp copy. Use a fake `dsh` executable on a controlled
  PATH (or an injected command-runner seam) so argv can be asserted EXACTLY, plus temp
  fixture checkouts for build/watch. Real `dsh` is never on PATH during unit tests.
- Required classes (each is a blocking gate for its slice):

  DX-1 BUILD - build path execs canonical builder (`node dsh/build-client.mjs`, shell false);
  deterministic output (two builds byte-identical); non-zero propagation (builder failure ->
  tool failure); no profile access (no profile argv, no DSH spawn); no settings access.

  DX-2 REGISTER - missing `--profile` fails with usage BEFORE any DSH spawn; malformed
  profile (empty, leading dash, separators, dot segments, node_modules, desktop,
  duplicate flag) fails before spawn; explicit profile propagated EXACTLY as
  `[plugin, --profile, <name>, add, <absRepoRoot>]`; selected-profile line printed before
  spawn; DSH-missing fails safely with clear message and no fallback attempt; no implicit
  `web` (assert argv never contains it unless typed); only `ocms-s` targeted (assert
  single add of the absolute repo root, no remove/update/install/why, no second
  package); underlying DSH non-zero propagates.

  DX-3 WATCH - initial build runs; relevant source change triggers exactly one rebuild;
  irrelevant change (output file, unrelated file) triggers none; burst changes serialize
  (N rapid edits produce at most 2 builder runs, never overlapping); build failure does NOT
  spawn an overlapping builder and watching continues; cleanup leaves no watcher/timer/child
  artifact; zero DSH spawns across all watch tests.

  DX-4 DEV:WEB - missing profile fails before build/register/launch; target printed once
  before any step; exact sequence build -> register -> launch asserted via ordered fake-runner
  log; exact launch argv `[dsh, --profile, <name>, --no-open]`;
  no process-scan/kill primitives present (static assert: no pgrep/taskkill/Get-Process/
  process-list/kill-by-name in implementation); launch non-zero propagates; port-conflict
  stderr does NOT trigger any termination attempt; Ctrl-C/cleanup touches only the owned
  child handle; no settings/Apply code path reachable.

  INTEGRATION - existing `npm test` green; `npm run test:smoke -- --strict` green (where
  prerequisites exist; strict means missing prereq fails, never skips-green); release/runtime package
  behavior unchanged (no sync/lifecycle/client/contract file touched); no new package runtime
  dependency; `files` unchanged (no dev-only file leaks into the tarball unless already included).

- Regression rule: each `/build` slice runs the FULL suite (`npm test`) before commit.
  Watch/dev:web timing tests MUST use short bounded timeouts and always clean up.

---

## 6. Boundaries

### Always

- Explicit `--profile` for every profile-mutating or profile-launching command.
- Print the resolved target profile BEFORE any mutation/start.
- Fail closed (usage + non-zero; never guess, never default, never fallback).
- Preserve v1.4.5 runtime semantics and the exact DSH `0.2.1-alpha.2` compatibility bound.
- Cross-platform Node implementation; built-in APIs only.
- Developer-only, foreground, observable actions. No daemon/detached/background behavior.
- Preserve package reproducibility rules (LF, locked deps, deterministic build).

### Ask first

- Adding ANY dependency (including dev).
- Changing supported DSH version or version grammar.
- Creating profiles automatically (currently FORBIDDEN - see section 11).
- Altering package distribution contents (`files`/`exports`).
- Changing runtime/plugin source for tooling convenience.
- Adding background/daemon behavior.
- Implementing ANY process termination beyond signal-relay to the exact child spawned by
  the same command.
- Expanding dev:web beyond the bounded launcher (ports, hosts, patches, browser-open).

### Never

- Default register/dev:web to profile `web`; mutate a profile without explicit `--profile`.
- `npm publish`; `publish.sh`; bunx/npx fallback to fetch DSH.
- Kill arbitrary DSH processes; pgrep-and-kill; taskkill by name search; Get-Process sweep;
  silently repair conflicts by termination (dsh-context web.sh behavior).
- Kill prior watchers by PID lookup (dsh-context watch.sh behavior).
- Hard-code `dsh plugin --profile web ...` (dsh-context behavior).
- Production Apply; authenticated model probes; account/quota probes.
- Transport-ownership, model-sync feature, lifecycle-ownership, HMR-coordinator, compat-fallback work.
- Broaden DSH support beyond exactly `0.2.1-alpha.2`; add admission authority or runtime fail-open fallbacks.
- Publish/release shell tooling.

---

## 7. Approved capability map and dependency direction

ID: DX-1 - deterministic cross-platform build - public: `npm run build` - depends: none.
Safety: ONE implementation (`node dsh/build-client.mjs`); no profile/DSH/settings touch.
ID: DX-2 - explicit-profile local registration - public: `npm run register -- --profile <name>` - depends: DX-1.
Safety: mandatory profile; print-before-mutate; only ocms-s; no fallback; no auto-start.
ID: DX-3 - cross-platform watch/rebuild - public: `npm run watch` - depends: DX-1.
Safety: inputs-only; no DSH; no kills; serialized/debounced; owned-cleanup-only.
ID: DX-4 - safe explicit-profile dev web launcher - public: `npm run dev:web -- --profile <name>` - depends: DX-1, DX-2.
Safety: mandatory profile; owned-child-only; conflict-fails (never kills); foreground attached.
ID: DX-5 - integration / tests / docs / acceptance - depends: DX-1..DX-4.
Safety: runtime-unchanged proof; TDD; no new runtime dep; reproducibility preserved.

Dependency direction is FROZEN: DX-1 first; DX-2 and DX-3 independently after DX-1;
DX-4 after DX-1+DX-2; DX-5 last. (See section 13.)

### Proven DSH CLI behavior (authoritative) vs implementation choice

PROVEN (observed on installed DSH 0.2.1-alpha.2; do not re-derive from dsh-context):

- P1 - Version bound: `dsh --version` prints `0.2.1-alpha.2`. Spec pins exactly this.
- P2 - Launcher shape: `dsh --help` shows `Usage: dsh [--profile] <name> [options] [app-args...]`
  and `dsh plugin --profile <name> <pnpm-args...>`; examples prove `dsh web` equals `dsh --profile web`.
  Spec uses the explicit `--profile` form everywhere.
- P3 - Plugin forwarding: `dsh plugin --help` says remaining arguments are forwarded verbatim
  to pnpm in the profile directory; `--profile <name>` REQUIRED. Source lib/bin.js (parseDshArgs):
  missing profile errors; empty profile errors; desktop rejected; plugin with zero pnpm args errors.
  Source lib/plugin-BGnVfe_D.js (runPlugin): non-desktop path delegates to runPluginCommand.
- P4 - Silent construction is REAL and must be guarded: lib/types/operations.js runPluginCommand
  does mkdir recursive then, when package.json is absent, initProfile with template or DEFAULT bundles
  and prints initialized-profile text. THEREFORE there is NO non-mutating existence check on the
  dsh plugin path. The wrapper MUST pre-check existence (read-only profile package.json presence)
  and refuse BEFORE invoking dsh. This guard is an implementation choice REQUIRED by safety, not DSH behavior.
- P5 - Local-path grammar: parseInstallSpec requires a local path to be ABSOLUTE; anchorPathSpec
  resolves leading dot-dot forms against the CALLER cwd, never the profile dir. THEREFORE register
  MUST pass an absolute path; relative specs are forbidden.
- P6 - Profile-name grammar (bounded, adopted verbatim): resolveProfileDir (dsh-app-boot) throws for
  empty names, names containing path separators, dot, dot-dot, and node_modules. selectProfile rejects
  selecting twice; rejectElectronProfile rejects desktop. Spec adopts exactly this set PLUS conservative
  hardening: reject missing/empty values and any value beginning with dash (option-injection guard).
  No broader syntax is invented.
- P7 - Boot missing-profile behavior: loadProfile (app-boot) auto-initializes ONLY shipped templates
  (acp/web/headless/sdk/sdk-minimal); for any other missing name it throws a does-not-exist error telling
  the user to create it with dsh plugin add. THEREFORE dev:web launch of a missing custom profile fails
  without creation - and register pre-check makes the failure occur even earlier.
- P8 - Web launch syntax: `dsh web --help` proves the web app owns `--host` / `--no-open` /
  `--port` and related flags with examples `dsh --profile web --no-open` and port/host variants.
  THEREFORE the frozen launch argv `dsh --profile <name> --no-open` is proven syntax; the positional
  shorthand is deliberately NOT used (parsing ambiguity).
- P9 - Canonical build: `dsh/build-client.mjs` (37 lines) does a line-anchored export-strip (any surviving
  export form throws), an import-free guard (any import throws), then deterministic
  banner+stripped+footer concatenation into `dsh/client.js` (ModuleLoader form, React external).
  No bundler, no input beyond the two files. Repeated runs are byte-identical.

IMPLEMENTATION CHOICES (frozen by this spec; /build must follow, not re-decide):

- C1 - Register mechanism: single `dsh plugin --profile <name> add <absoluteRepoRoot>`
  (directory path, NOT tarball, NOT remove+add, NOT update). Narrowest verbatim-forwarded op achieving
  affect-only-ocms-s. Tarball would add a pack step and stale-copy semantics;
  directory install tracks the working checkout for subsequent DX-3 rebuilds.
- C2 - Existence pre-check: resolve the profile directory under DSH home and check for package.json
  presence read-only; absent means fail before dsh. DSH home unset means the default user profile home.
- C3 - Watch primitive: built-in fs.watch on the two input files (not polling, not chokidar).
  Debounce 150 ms trailing-edge plus single-mutex serialization.
- C4 - Launch form: `dsh --profile <name> --no-open` foreground, stdio inherit,
  shell false, exact exit-code propagation. No port/host override flags.

Reference project dsh-context: npm-command/watch ergonomics IDEAS may inform, but its web hard-code,
bunx fallback, watch PID-kill, web pgrep-kill, publish tooling, fail-open fallbacks, and admission
mechanism MUST NOT be copied.

---

## 8. Detailed acceptance criteria per DX module

### DX-1 build

- build execs `node dsh/build-client.mjs` (shell false, no extra argv).
- `dsh/client.js` regenerated from `dsh/client.mjs`; content starts with the ModuleLoader banner.
- Repeated builds byte-identical (SHA-256 equal across two consecutive runs).
- Builder failure leads to tool non-zero exit with builder stderr.
- No argv containing `--profile`, no dsh spawn, no settings-file read/write.
- Manual: `npm run build` stable on a clean tree; node --check passes on touched scripts.

### DX-2 register

- Bare `npm run register` prints usage to stderr and exits non-zero with ZERO spawns.
- Malformed profiles each fail pre-spawn with usage: empty, missing value, leading dash,
  separators, dot segments, node_modules, desktop (any case), duplicate flag. No fuzzy matching, no default.
- Explicit form prints the target-profile line BEFORE any spawn/mutation.
- DSH-unavailable: clear not-found message on stderr, non-zero, zero further spawns, no fallback.
- Profile-not-initialized: clear does-not-exist message on stderr, non-zero, ZERO dsh invocations.
- Happy-path argv EXACT: dsh plugin --profile [name] add [absoluteRepoRoot] - absolute, no extra flags.
  Only ocms-s affected (single add; no remove/update/install/why, no second package).
- `--profile web` works ONLY when literally typed (passthrough, not default).
- Underlying dsh non-zero exit propagates with pnpm stderr surfaced.
- No production settings read/write; no DSH auto-start; no other profile touched.

### DX-3 watch

- Start runs the initial build; initial failure exits non-zero with no watcher left behind.
- Editing the client source triggers exactly one rebuild within 2 s.
- Writing the OUTPUT file or an unrelated file triggers NO rebuild.
- 10 rapid edits within 100 ms produce at most 2 builder runs total and never overlap.
- Builder failure prints failure, performs no second concurrent build, and watching CONTINUES.
- stop/SIGINT removes all watchers/timers and settles only the owned build; no lingering handles.
- Zero dsh spawns across every watch test. Any profile or extra arg fails before watching.

### DX-4 dev:web (IMPLEMENTED, not deferred)

The section-10 ownership/safety contract IS satisfiable with proven DSH behavior (P7/P8): boot is a
foreground process that fails (not kills) on conflict, and the wrapper owns exactly the child
it spawns. No blocker was found; weakening the contract was not needed.

- Missing profile fails pre-build with usage, zero spawns.
- Malformed profile fails exactly as DX-2 (same validator shared).
- Target line printed BEFORE build.
- Ordered sequence asserted: build step, then register step (same argv as DX-2), then launch step
  `dsh --profile <name> --no-open`, all with the SAME name. No profile switch mid-sequence.
- Launch uses inherited stdio, stays attached; tool exit code equals child exit code (0 and non-zero).
- Static plus behavioral proof of no scan/kill: no pgrep/taskkill/Get-Process/process-enumeration
  logic; simulated port-conflict child failure propagates with zero termination attempts.
- DSH-missing, register-failure, and build-failure each abort BEFORE launch with the originating code.
- Ctrl-C test (where harness permits): only the owned child handle is signaled/waited;
  no other spawn is signaled. No detached handle remains.
- No settings mutation, no Preview/Apply import or call, no daemon flag.

### DX-5 integration

- `npm test` green (full release suite plus new dev-tools tests).
- `npm run test:smoke -- --strict` green where prerequisites exist (strict means missing prereq
  fails, never skips-green; same as CI).
- No file outside package.json (scripts only), scripts/dev-tools.mjs, tests/dev-tools.test.mjs, and SPEC.md
  is touched by the ergonomics work; in particular sync/lifecycle/client/contract files are byte-identical.
- package.json dependencies/peerDependencies/engines unchanged; no new runtime dep.
- files/exports/main unchanged (dev scripts do not leak into the packed tarball).
- README/CHANGELOG ergonomics notes (if Task 5 adds any) describe ONLY the four commands with safety notes.
- Determinism proof: two consecutive builds byte-identical; pack file list unchanged vs v1.4.5 baseline.

---

## 9. Failure semantics

All failures: concise one-line message plus (where applicable) underlying tool stderr, usage on
argv errors, non-zero exit. Propagates means the tool exits with the exact child code.

- No --profile (register, dev:web): usage on stderr, non-zero, ZERO spawns/mutations.
- Malformed profile (register, dev:web): usage on stderr, non-zero, ZERO spawns.
- Extra/unknown args (build, watch): usage, non-zero, no side effects. Extra flags beyond
  --profile plus name on register/dev:web: same.
- dsh not on PATH (register, dev:web): not-found message, non-zero, no fallback. Build/watch never check.
- Profile not initialized (register, dev:web): does-not-exist message, non-zero, ZERO dsh invocations.
- Canonical build fails (build, watch-initial, dev:web step 3): builder stderr plus tool non-zero;
  watch-initial exits without watching; dev:web stops before register/launch.
- Watch rebuild fails: report, CONTINUE watching (exit stays 0 until Ctrl-C/fatal). Never overlap builders.
- dsh plugin add fails (register, dev:web): pnpm stderr surfaces; exit equals underlying code;
  dev:web never proceeds to launch.
- dsh web launch exits non-zero incl. port/host conflict (dev:web): child output surfaces; tool exit
  equals child code; NO kill/scan/retry; conflict text is passed through, never acted on.
- Port already occupied (dev:web): same as above - fail/report, never terminate the occupant.
- Ctrl-C / SIGTERM (watch, dev:web): relay/settle ONLY owned build/child; remove ONLY owned
  watchers/timers; then exit (0 for clean watch shutdown; child code for dev:web).
- Production settings present/absent: irrelevant - new commands never open settings.yaml.

Informational dsh stderr such as initialized-profile text MUST NOT appear on the happy path,
because the pre-check guarantees the profile already existed; if such a line ever appears,
the implementation has violated section 11 and the run MUST be treated as a bug.

---

## 10. Process ownership model

OWNED means exactly the process object returned by the spawn/execFile call the same command
issued in this run. Nothing else is ever owned.

- Each command owns AT MOST: build - one short-lived builder child; register - one short-lived
  dsh plugin child; watch - its fs.watch handles plus timers plus at most one builder child at
  a time; dev:web - the three sequential step children, of which the final web child is long-lived.
- FORBIDDEN: enumerating processes; signaling any PID not equal to an owned child;
  cleanup of a previous watcher by killing it; freeing a port by killing its listener.
- Ctrl-C semantics: the handler signals ONLY owned children, awaits ONLY owned exits, closes
  ONLY owned watchers/timers. A foreign DSH Web on the same port is reported, never touched.
- No daemon/detached/unref spawn (detached false, no unref), no background flag, no double-fork.
  dev:web remains attached: when the child exits, the tool exits with its code;
  when interrupted, it relays to the child and then exits.
- Watch serialization: a boolean mutex plus one trailing slot. Concurrent triggers while busy set
  a queued flag (collapsed); completion runs at most one trailing build. Debounce timer (150 ms)
  precedes mutex acquisition. No queue deeper than one.
- All spawns: shell false, explicit argv arrays, no string interpolation. Interactive
  children use stdio inherit; the initial watch build may capture output for the
  one-line report but MUST surface builder failures verbatim.

---

## 11. Profile-safety model

- Explicitness: `--profile <name>` is MANDATORY for register and dev:web. There is no default,
  no web fallback, no env-derived profile, no positional profile, no fuzzy/prefix matching, no case folding
  (except DSH own desktop guard, which the wrapper mirrors by rejecting desktop in any casing before calling DSH).
- Print-before-mutate: the exact target-profile line precedes every spawn/mutation/start. The name is quoted.
- Validation (conservative; DSH grammar P6 plus injection guard; shared by register/dev:web):
  reject when: missing value; empty string; first character is dash; contains path separators;
  equals dot, dot-dot, node_modules (exact); case-insensitive equals desktop; duplicated flag; or
  length over 64 or characters outside [A-Za-z0-9._-] - the last clause is wrapper-stricter than DSH and is
  PERMITTED because it only narrows (fails closed and safe). Recorded here so /build does not widen it.
- Existence (no silent construction): before any dsh plugin invocation, the wrapper
  read-only checks the resolved profile directory for package.json presence (same home resolution as
  DSH; never creates directories). Absent means fail with no dsh spawn. This compensates P4 proven auto-init.
  The check MUST NOT read or parse production settings.yaml.
- Blast radius: exactly one profile (the named one), exactly one plugin (ocms-s, via the
  single absolute-path add). Implementation MUST assert the repo package.json name equals ocms-s
  before constructing the add spec (fail closed otherwise).
  No other profile directory is opened for writing; no other package name appears in argv.
- Settings/Apply isolation: the ergonomics layer imports no Preview/Apply code, opens no
  settings path, and passes no settings flag. DSH Web boot mounts the profile own
  configuration as usual - that is DSH behavior, not an OCMS-S settings mutation, and the
  spec requires no extra flags that would alter it.

---

## 12. Out-of-scope list

- Everything closed under v1.4.5: model-sync semantics, Go/Zen placement, transport ownership,
  Preview/Apply, lifecycle ownership, HMR retirement, Typert codecs, reproducibility repair,
  production configuration. No production Apply under any flag.
- npm publish, publish.sh, release tagging, version bumps (stays 1.4.5).
- bunx/npx/network fetch of DSH; any auto-install of toolchains.
- Any process-scan/kill feature (pgrep/taskkill/Get-Process/PID-file/port-to-PID).
- Daemon/service/scheduler/tray/protocol-handler/launcher persistence; auto-start on boot,
  on profile load, on tab open, or on HMR.
- Authenticated model probes; account/quota/network probes beyond pnpm own install fetch.
- Transport-ownership, model-sync feature, lifecycle-redesign, HMR-coordinator, compat-fallback work.
- DSH support beyond exactly 0.2.1-alpha.2.
- dsh-context behaviors: hard-coded web, bunx fallback, watch PID-kill, web pgrep-kill,
  publish shell tooling, fail-open fallbacks (all explicitly rejected in section 7).
- New runtime dependencies; new bundlers/compilers; second build implementation.
- Hidden profile semantics in watch; extra DSH flags in dev:web; positional shorthand in implementation.

---

## 13. Build order

FROZEN (no blocker found):

    DX-1 build
      |- DX-2 register   (independent of DX-3)
      |- DX-3 watch      (independent of DX-2)
             |
             v (needs DX-1 + DX-2)
           DX-4 dev:web
             |
             v
           DX-5 integration / docs / acceptance

Each arrow is a prerequisite gate: the later slice MUST re-run the earlier slice tests green
before starting (plus the full npm test).

---

## 14. /build task slicing recommendation

Each slice follows RED -> minimal GREEN -> full regression (npm test) -> build verification ->
ONE bounded commit -> STOP. Never combine slices. Never start the next slice in the same run.

- Task 1 - npm build entry point plus build tests (DX-1).
  Add scripts/dev-tools.mjs build subcommand plus package.json build script plus
  tests/dev-tools.test.mjs DX-1 class. Acceptance: section 8 DX-1 boxes; npm run build
  byte-identical reruns; npm test green. Commit: DX-1 message.

- Task 2 - explicit-profile register (DX-2).
  Add register subcommand plus register script plus DX-2 tests. Reuses the shared profile
  validator/DSH-availability/existence-guard helpers introduced here (later slices reuse them).
  Acceptance: section 8 DX-2 boxes incl. zero-spawn proofs. Commit: DX-2 message.

- Task 3 - watch/rebuild (DX-3).
  Add watch subcommand plus watch script plus DX-3 tests. No DSH code. Acceptance: section 8 DX-3
  boxes incl. serialization proof and owned-cleanup-only. Commit: DX-3 message.

- Task 4 - safe dev:web launcher (DX-4, IMPLEMENTED).
  Add dev:web subcommand plus dev:web script plus DX-4 tests. Reuses Task 2 validator/guard
  and Task 1 build step verbatim. Acceptance: section 8 DX-4 boxes. NO deferral rationale is
  needed (contract proven in P7/P8 plus section 10); if implementation discovered a previously
  unknown exact blocker, it MUST stop and return a DEFERRED note with the exact blocker instead
  of weakening section 10 - that path is not expected. Commit: DX-4 message.

- Task 5 - integration / docs / final acceptance (DX-5).
  Wire full regression, test:smoke --strict evidence, determinism/pack-list checks, and
  minimal README developer-commands documentation (four commands plus safety notes only).
  Acceptance: section 8 DX-5 boxes. Commit: DX-5 message.
  Version decision explicitly NOT in this task - it belongs to later /ship.

Unresolved questions: NONE. All profile/DSH semantics needed were proven in P1-P9 from the
installed 0.2.1-alpha.2 help and source. The two narrowest frozen choices (150 ms debounce;
fs.watch over polling) are decisions, not open questions.

---

## Appendix A. Command quick reference (normative)

    npm run build
    npm run register -- --profile [name]
    npm run watch
    npm run dev:web -- --profile [name]

Appendix B. Frozen argv (normative)

    build:    node dsh/build-client.mjs
    register: dsh plugin --profile [name] add [absoluteRepoRoot]
    watch:    (no DSH argv; builder only)
    dev:web:  dsh --profile [name] --no-open   (after build + register steps above)

Appendix C. Baseline pins (normative)

    OCMS-S v1.4.5 closed; HEAD 70182943744397ecb5c00089529bd42bf44e8ead;
    tree b618154685b331ffd66cb6ff38a95ec4618d34ae; DSH 0.2.1-alpha.2 exactly.
    No version bump, no publish, no runtime change in this layer.
