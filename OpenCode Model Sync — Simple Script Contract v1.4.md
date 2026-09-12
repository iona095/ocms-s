# OpenCode Model Sync — Simple Script Contract v1.4

Additive contract over Contract v1.3. Where v1.4 does not explicitly supersede behavior, v1.3 remains binding. Contracts v1.0–v1.3 are unchanged.

Status: DRAFT (Phase D). Freeze SHA-256 recorded at Phase E start. Once tests begin, this contract is immutable.

## 1. Purpose

Add an optional DSH integration exposing OCMS-S as one DSH conversation view (tab label `Models`, slot id `models`) whose DSH-owned scope is exclusively: OCMS server lifecycle (status, Start, Stop), child-process ownership, and iframe hosting. All synchronization authority (source acquisition, planning, placement, compat, Preview, Apply, retained-plan, stale protection, backup transaction, result display) remains in the released OCMS-S server and Web UX.

## 2. Authority / version lineage

- OCMS-S baseline: released v1.3.0 (commit 50968d968ede3c0c847c6d127e1ff8059f790185, tree ab795dd, tag c5c4716; contract SHA-256 be98df46c6a9a7626018da44a9ff2817081ab75607092cda9131c1101436e2d3; sync.mjs 9211544a…; ui.mjs c41bfc99…; ui/index.html 6610e735…).
- v1.4 development begins from released v1.3 semantics on current main; no history rewrite; v1.3 immutability holds.
- Root package version stays 1.3.0 during this gate; no released-v1.4.0 claim.

## 3. DSH compatibility

```
Supported DSH: 0.1.5-rc.2
Authoritative DSH tag: dsh-v0.1.5-rc.2
Authoritative DSH commit: fb2c4b9e698e30edb738bca4cf0618587db7d203
Local installation state: CLI banner 0.1.5-rc.1 with ALL plugin-facing internal runtime packages at exactly 0.1.5-rc.2 (caret-resolved; documented, user-authorized deviation; compatibility is evaluated against the installed runtime, not the banner)
External distribution: profile bundle (dsh.bundle.patch + cordis.patch.yml), installed via "dsh plugin --profile <name> add <tarball>"
Legacy .dsh-plugin: unsupported
dsh-plugin-prepare: unsupported
Old repository Plugin: unsupported
dsh.compatibility.dshReleases: stale, unused
Earlier/future DSH plugin ABI: not assumed compatible
```

## 4. Goals

One boring lifecycle adapter: DSH Models tab → typed Remote lifecycle (status/start/stop) → exactly one owned `ui.mjs` child serving the existing OCMS Web UX in an iframe.

## 5. Non-goals

OCMS daemon; Windows service; startup entry; scheduled task; tray application; custom URI protocol; background launcher; automatic OCMS start; automatic Preview; automatic Apply; scheduler; quota; account switching; provider key management; model editor; route editor; second planner; rewritten DSH-native OCMS UI; LAN/remote OCMS server; DSH core patch; kill-by-process-name; kill-by-port; legacy .dsh-plugin support; repository Plugin compatibility layer; support claims for untested DSH versions.

## 6. Package / distribution model

Candidate A: the root ocms-s package doubles as the DSH profile bundle. Bundle payload: `cordis.patch.yml`, `dsh/host.mjs`, built `dsh/client.js`, `sync.mjs`, `ui.mjs`, `ui/`. Manifest additions: `dsh.bundle.patch`, `dsh.client { platform: "web", inject: [] }`, main pointing at the host entry, files list covering the payload. Install: built tarball via `dsh plugin --profile <profile> add <tarball>` (pnpm forwarder; no lifecycle scripts ⇒ no allowBuilds). Uninstall: supported plugin removal; no OS-level residue of any kind.

## 7. Install / uninstall

Scratch-profile only during this gate (`ocms-v14-test` or another unique name). Init from the web template without modifying any normal profile. Removal leaves no Windows service, registry, scheduled task, startup shortcut, tray, protocol handler, or daemon because none may exist.

## 8. Host architecture

One Host plugin (`dsh/host.mjs`, named exports name/inject/Config/apply). Exactly **one process-global lifecycle controller** per DSH Host plugin instance — not per session, tab, workspace, or browser connection. States: OFFLINE, STARTING, ONLINE, STOPPING, EXTERNAL, ERROR.

## 9. Client architecture

Built client bundle `dsh/client.js` in rc.2 `window.__ModuleLoader__` format, inject ["slots","remote"], plain `react.createElement` rendering; mounts its typed Remote contribution via `ctx.remote.$mount`; registers the Models tab via `ctx.slots.inject("conversation.view", ...)`.

## 10. conversation.view registration

`name: "conversation.view"`, `id: "models"`, `order: 30`, `label: "Models"`. Chosen from measured rc.2 registrations: Chat order 0 (ui-chat), Trajectory 10 (ui-trajectory), Context 20 (dsh-context), Subtitles 20 (dsh-srt-ensemble). Must not replace, shadow, or alter any existing view.

## 11. Lifecycle states

- OFFLINE: no owned child; configured port appears free. Allowed: Start, Status. Forbidden: Stop, iframe.
- STARTING: one explicit Start spawning/waiting for readiness. No second Start, no second child, no iframe.
- ONLINE: plugin owns a live child with confirmed readiness; trusted URL returned; iframe and Stop allowed.
- STOPPING: owned child shutdown in progress; no Start, no duplicate Stop, no iframe authority.
- EXTERNAL: plugin owns no child; configured port occupied by another process. MUST NOT kill, replace, claim, signal, or scan the other process. Start refused, Stop refused, iframe not shown.
- ERROR: known lifecycle failure; safe user-facing message; no stack to browser. After failure cleanup the controller returns to OFFLINE and a new explicit Start is allowed when safe.

## 12. Process ownership

Ownership = the Host controller spawned this exact child (`ownedChild` handle). MUST NOT use process name, node.exe enumeration, command-line scanning, port ownership, or netstat PID search to infer ownership.

## 13. Node / runtime resolution

Start MUST validate the node executable before spawning: accepted = validated `process.execPath` when a successful `--version` probe (shell:false) returns a version string and the basename is a Node binary, or a validated configured `nodeBin`. Spawn MUST use `spawn(nodeExecutable, [absoluteUiPath, ...args], { shell: false })`. No cmd.exe /c, no shell:true, no PowerShell interpolation.

## 14. OCMS runtime resolution

Package-relative: the absolute path of `ui.mjs` derived from the host plugin module URL. No disk search, no CWD dependency, no browser-supplied path, no sibling-repo scan.

## 15. Start

Only an explicit DSH client Start invokes Host Start. Host Start MUST, in order: (1) verify local environment and lifecycle startability; (2) determine port state (bounded local probe; occupied-by-other ⇒ EXTERNAL refusal); (3) validate Node executable; (4) validate absolute ui.mjs; (5) validate the embed origin as an exact loopback origin (http/https scheme, 127.0.0.1 or localhost host, port 1–65535, empty path/query/fragment, no userinfo, exactly one origin, no duplicates, no wildcards); (6) set STARTING before spawn; (7) spawn exactly one child with `--no-open`, `--port=<port>`, `--embed-origin=<normalized origin>`, and a settings path only from Host-owned configuration; (8) attach exit/error handlers immediately; (9) perform bounded readiness against `GET /api/state` (expected HTTP status, expected OCMS response structure, correct port); (10) transition to ONLINE only after readiness; (11) return trusted lifecycle state. Start MUST NOT run Preview, fetch sources, Apply, read production settings for synchronization, write settings, or create a backup.

## 16. Readiness

Bounded retry loop during STARTING only (deadline, small interval, abort on child exit). Not background polling. Exact values (15 s deadline, 250 ms interval) are tested. WRONG shape/port ⇒ ERROR. If a port-occupying process binds between probe and spawn (TOCTOU race) and the owned child exits with a bind failure, the controller resolves to ERROR (`ocms/start-failed`) — it MUST NOT claim EXTERNAL authority over the competing listener, MUST NOT kill it, and a later explicit Start re-runs the full probe.

## 17. ONLINE

Trusted URL `http://127.0.0.1:<port>/`. Client MAY render the iframe with this URL only.

## 18. Stop

Operates only on ownedChild. No owned child ⇒ fail safely with RemoteError `ocms/not-owned`; while EXTERNAL, Stop MUST be refused with `ocms/not-owned` (the listener is not owned — its identity is never established beyond "not ours"). Bounded termination await; if graceful termination fails, force kill MAY target the exact owned child only. No taskkill /IM, no kill-by-port, no global process search.

## 19. Disposal

On normal Host plugin disposal (shutdown, profile/plugin disposal, reload, teardown): if ownedChild exists, stop it; the child MUST NOT outlive its creating Host instance. Mechanism: the Cordis plugin apply disposer. Not dependent on process.on('exit') alone. Client-view unmount, session close, and tab switch MUST NOT stop the child (§46 separation: server belongs to the Host integration, not one tab component).

## 20. External-port behavior

EXTERNAL = informational refusal. No kill, no ownership claim, no PID scan. Embedding an externally running OCMS instance is NOT part of v1.4 (refused).

## 21. Concurrency

Start+Start, Start+Stop, Stop+Stop, Stop+Start serialized by a transition lock/state fence. No operation may observe OFFLINE and independently spawn while another Start is active. Exactly one child maximum. `start()` while ONLINE is idempotent: it returns the current ONLINE state and MUST NOT spawn. `start()` while STARTING or STOPPING is refused with RemoteError `ocms/busy` (no queueing; the caller re-requests explicitly). `stop()` while STARTING or STOPPING is refused with `ocms/busy`; it never races a transition in progress.

## 22. Multi-session behavior

Two sessions' Models views control the SAME Host lifecycle. A Start → one child; B status → same ONLINE server; B Stop → same owned child stops. Never one OCMS per conversation. Two simultaneously running DSH processes each own their own controller; the second process's Start observes the configured port occupied and reports EXTERNAL — no cross-process coordination exists or is attempted.

## 23. Host↔Client API

Typed Remote, namespace `ocms`, service key `ocmsLifecycleService`, methods:
- `status(): LifecycleStatus`
- `start(embedOrigin: string): LifecycleStatus`
- `stop(): LifecycleStatus`
`LifecycleStatus = { state, port, url?, message?, embedOrigin? }`. Only lifecycle/presentation data crosses Remote. Client half mounts its contribution with `ctx.remote.$mount` and strict codecs.

## 24. Failure vocabulary

RemoteError domain codes: `ocms/incompatible-dsh`, `ocms/port-in-use`, `ocms/start-failed`, `ocms/readiness-timeout`, `ocms/not-owned`, `ocms/stop-failed`, `ocms/not-local`, `ocms/busy` (a lifecycle transition is already in progress; retry explicitly after it settles). No Error subclass per failure; no stack traces over Remote.

## 25. Local / remote topology

"Local DSH integration" = the browser page origin is an exact loopback origin AND the OCMS child binds 127.0.0.1. The client supplies `window.location.origin` exactly once, as the `start(embedOrigin)` argument (assisted by `ctx.remote.$host.isLoopback` when available); no other Remote method accepts an origin. The Host validates it as exact loopback; ui.mjs re-validates independently. A non-loopback browser origin MUST NOT authorize embed mode. No physical-locality guarantee beyond this is claimed; remote/SSH topologies fail safe via origin validation.

## 26. iframe authority

The iframe `src` MUST come only from trusted Host lifecycle output. Forbidden sources: query parameter, localStorage, settings field from browser, arbitrary user URL, message/event-provided URL. The client MUST NOT concatenate attacker-controlled hostnames. Required attributes: `title="OCMS-S Models"`, `referrerPolicy="no-referrer"`, `sandbox="allow-scripts allow-same-origin"` (the narrow set under which the existing OCMS UX's same-origin /api fetches and in-page token bootstrap work; verified in scratch acceptance); no camera, microphone, geolocation, clipboard, downloads, popups, or top-navigation permissions.

## 27. Embed-origin validation

Validated twice (Host at Start; ui.mjs at launch). Accepted forms: `http://127.0.0.1:<port>`, `http://localhost:<port>`, and https equivalents only if rc.2 deployment evidence requires. Rejected: foreign hosts, suffix-confusion hosts (`127.0.0.1.evil.example`), userinfo, missing port, port 0/99999, any path/query/fragment, `*`, `'none'`, multiple origins in one argument, duplicate `--embed-origin` arguments.

## 28. CSP standalone

Without embed mode, `node ui.mjs` MUST keep CSP `frame-ancestors 'none'` and remain unframeable. No broadening to 'self', *, http:, or loopback wildcards.

## 29. CSP embed mode

With one validated origin, the frame-ancestors directive becomes exactly that normalized origin. No wildcard, no permanent allowlist, no global DSH exception in standalone mode. Only the frame policy changes.

## 30. Preserved Host/Origin/token protection

Embedding MUST NOT relax: literal 127.0.0.1 binding, Host validation, Origin validation, missing-Origin semantics, X-OCMS-Token, per-process 256-bit token, constant-time comparison, no wildcard CORS, CSP/nosniff/no-referrer/no-store, no remote assets, no telemetry. The embedded iframe executes under the OCMS origin; its /api requests remain OCMS-origin requests. Framing authority is changed; API mutation authority is not.

## 31. Settings target

The Models tab MUST NOT expose settings path input, file picker, production/scratch selector, or drag/drop YAML. Production launch uses the standard OCMS default target. Manual/development acceptance uses a scratch settings path from Host-owned test configuration only.

## 32. Testing

All existing 154 released tests stay GREEN and unmodified. New v1.4 tests (tests/v1.4/, node --test, run separately until the release gate) cover: embed-origin parser matrix; CSP standalone/embed; lifecycle state machine with injected doubles; readiness; spawn failures; external port; stop/disposal; unexpected exit; concurrency; no-auto-start; capability anchors; compatibility static assertions (no .dsh-plugin / prepare / repository Plugin artifacts; rc.2 manifest form; pinned constraints).

## 33. Scratch manual acceptance

Full browser acceptance on a scratch DSH profile with scratch settings only: tab visibility/order; OFFLINE; no auto-start on load/mount/session operations; Start→STARTING→ONLINE; iframe renders OCMS (IDLE, scratch target); embedded Preview (and scratch Apply where exercised); Stop→OFFLINE; restart; unexpected child exit; external-port behavior; two sessions/one child; tab unmount does not stop; Host disposal stops child; standalone framing blocked; embedded framing allowed.

## 34. Compatibility failures

Unknown/missing rc.2 APIs at load MUST fail loud in the loader (never silently degrade). Unsupported runtime conditions (spawn failure, invalid node, missing ui.mjs, readiness timeout, stop failure) map to the §24 vocabulary with safe user messages.

## 35. Release compatibility

This gate produces a locally verified implementation candidate only. No commit, push, tag, GitHub Release, README/CHANGELOG release claims, or normal-profile installation. Release-preparation work belongs to a later gate.

## 36. Explicit exclusions

Any DSH ABI beyond 0.1.5-rc.2; any auto-start trigger (DSH boot, plugin load, client load, session create/switch, tab selection, component mount, iframe creation, reconnect, HMR); any browser-supplied executable/ui.mjs/settings path; any background lifecycle polling; any second child; any external-process control; any OCMS security relaxation.
