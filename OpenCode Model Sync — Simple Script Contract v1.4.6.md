# OpenCode Model Sync — Simple Script Contract v1.4.6

Final release over Contracts v1.2–v1.4.6-rc5 (including Amendments A).
v1.4.6 is v1.4.6-rc5 unchanged in behaviour; it adopts the RC contracts
below as binding. Earlier contracts remain binding where silent here.

Status: FROZEN. Freeze SHA-256 and line count recorded in §9.
Gate: OCMS-S v1.4.6 — FINAL RELEASE (metadata and documentation only).
Baseline: tag v1.4.6-rc5, commit 42b9dd89b7ea189fb9a9f4c7ebd50b79a698d251.
Release proof: GitHub CI run 38368970261 on the baseline is green on all
four jobs (npm test 377 / 0 fail on Node 20 and 22; profile suites real DSH
0.2.1-alpha.2 449 / 0 fail; acceptance smoke pass).
No tag or push is authorized in this gate.

## 1. F1 — what v1.4.6 adopts

v1.4.6 adopts rc1–rc5 and their amendments as binding, listed here with
SHA-256 over exact file bytes:

- OpenCode Model Sync — Simple Script Contract v1.4.6-rc1.md:
  f041e7540875e53419243316289cd9b98ef52606cdff4c8ec665c3c9df41fa38.
- OpenCode Model Sync — Simple Script Contract v1.4.6-rc2.md:
  00204930eb1a12a4250a9eaeecd2828ac1fb83b17ffba8b2772c6d81dd56484a.
- OpenCode Model Sync — Simple Script Contract v1.4.6-rc3.md:
  d31553f23681bb8372ff01a7fefc999d9ea4f4e74a2ac327551a98d4c42399cb.
- OpenCode Model Sync — Simple Script Contract v1.4.6-rc4.md:
  bdf79b620f5b69fe575c6abb2206a13191488cb1112a7ffd7609f42613ad2c63.
- OpenCode Model Sync — Simple Script Contract v1.4.6-rc4 Amendment A.md:
  38706d72f5a8b2e2e73cd2908a5fcad7bf300346a546a65b379dfe734b77c2b7.
- OpenCode Model Sync — Simple Script Contract v1.4.6-rc5.md:
  ea05bda17a85bf1ade98d8655b59ba733f03d0d235352d19da8e91c20556de69.
- OpenCode Model Sync — Simple Script Contract v1.4.6-rc5 Amendment A.md:
  acc840231bda004bf3abd2e61a3da8c859f447f75a0431aa1660f501e26ec5cf.

No product file changes (sync.mjs, ui.mjs, ui/index.html, profile/*);
every existing pin stays green; no test weakened, skipped, or deleted.

## 2. F2 — version 1.4.6

Version 1.4.6 in package.json (version + description), package-lock.json
(root mirror), dsh/client.mjs PLUGIN_VERSION and the rebuilt dsh/client.js
(via dsh/build-client.mjs only, never hand-edited), and the existing version
assertions (metadata only). The release tarball name becomes
ocms-s-1.4.6.tgz (package.json files whitelist unchanged).

## 3. F3 — CHANGELOG v1.4.6 entry

CHANGELOG gets a v1.4.6 entry for a reader who skipped the RCs:

- Users: documented /inference/v1 bases with drift notices; blocked-Preview
  reasons shown verbatim in order in web (BLOCKED notice) and CLI (exit 1).
- Verification: hermetic tests (explicit temp homes, stubbed dsh/anchors,
  bounded waits), CI timeouts and a clean-machine guard, S5 profile suites
  in CI against pinned real DSH 0.2.1-alpha.2, portable run-time paths and
  LF-exact checkouts, a machine-path guard in npm test.
- Honest record: rc4's profile CI job was red (13 fail: dev-machine DSH
  paths, hard-coded repo root, CRLF checkout); rc5 fixed the setup, no
  product change, and CI is green on the baseline.
- Known risks: inference/Zen endpoint evolution is unprobed live; one
  header test is second-boundary sensitive; dev-tools assumes the folder
  name contains ocms-s; nested DSH packages float on tilde ranges (see the
  v1.4.7 backlog).

## 4. F4 — README for v1.4.6

README shows v1.4.6 as current, this contract as authoritative, current test
counts, the install command for ocms-s-1.4.6.tgz, and a status paragraph
(release: what shipped, CI proof commit, no open gates).

## 5. F5 — v1.4.7 backlog

CHANGELOG and README carry a v1.4.7 backlog section with exactly these
items, one line each:

1. routeBaseURL unknown-gateway guard.
2. longest-prefix base match.
3. one shared URL-validation helper for endpointApi and endpointBaseDrift.
4. copy the drift array into outcomes.
5. endpointBaseDrift null-arg tolerance.
6. formatReport comparator style.
7. one shared non-empty string reasons helper for sync.mjs and ui.mjs (rc2).
8. S2 visibility or per-ID protocol pins.
9. profile CI job also checks nested DSH package versions (tilde-range drift).
10. rename RC4_ALLOWED in t19-footprint.
11. embed-origin Date-header second-boundary flake.
12. dev-tools assumption that the repo folder name contains ocms-s.
13. optionally switch the Zen model list to /inference/v1/models.
14. authenticated check that /zen/v1 still serves chat (close it if the
    maintainer confirms daily Zen use works).

Recorded closed with evidence: the model-list endpoints (/inference/v1/models,
/zen/v1/models, /zen/go/v1/models) answered 200 without a key or session
header on 2026-10-13, and /zen/v1/models and /inference/v1/models served
identical model lists (84 IDs).

## 6. F6 — §Files

Every file touched in this gate:

- OpenCode Model Sync — Simple Script Contract v1.4.6.md (this file;
  frozen before any v1.4.6 test was written).
- tests/v1.4.6/helpers.mjs: freeze anchor.
- tests/v1.4.6/freeze.test.mjs: the frozen test (also listed in the
  package.json test script).
- package.json: version 1.4.6, description contract tag, test script gains
  the v1.4.6 freeze suite.
- package-lock.json: root versions mirroring package.json.
- dsh/client.mjs: PLUGIN_VERSION 1.4.6.
- dsh/client.js: rebuilt via dsh/build-client.mjs only.
- tests/v1.4/compat.test.mjs: version pins rc5→1.4.6 (metadata only).
- tests/dev-tools.test.mjs: whitelist version pin rc5→1.4.6 (metadata only).
- CHANGELOG.md: v1.4.6 entry (F3) plus v1.4.7 backlog (F5).
- README.md: v1.4.6 current (F4) plus v1.4.7 backlog (F5).

Forbidden: sync.mjs, ui.mjs, ui/index.html, profile/*, SPEC*.md, frozen
contracts v1.0–v1.4.6-rc5 and Amendments A, DSH lifecycle/host, bundle
architecture, Preview/Apply semantics, settings targets, route transport,
roster/catalog/docs URLs, live probes, .gate/, real profiles/production
Apply, weakening/skipping/deleting any test, touching
C:\Users\GNV\.dsh\profiles.

## 7. §Tests

tests/v1.4.6/ (node --test). Identities frozen:

1. contract freeze anchor intact (SHA-256 + line count per §9).
2. version assertions read 1.4.6 everywhere (package, lock, client, gates).
3. full npm test green with only the authorized rc5→1.4.6 version-pin updates
   plus the v1.4.6 freeze suite (378 tests / 0 fail expected: 377 + 1).
4. clean-env vehicle green with 0 fail (378 / 6 skipped expected).
5. fresh-clone and reproduced profile-job evidence unchanged in kind (profile
   suites green, machine-path guard green, smoke green on Node 22).
6. npm pack --dry-run shows ocms-s-1.4.6.tgz and only the files-whitelist
   files.
7. all RC2/RC3/RC4/RC5 pins green; devDependencies stays empty; no product diff.

## 8. Contract challenge

| # | Attack | Answer | Result |
|---|--------|--------|--------|
| 1 | Release renames behaviour | F1 freezes behaviour to rc5; product diff empty | PASS |
| 2 | SHA list drifts from files | SHAs measured from the tree in Step 1 | PASS |
| 3 | Tarball packs extra files | --dry-run checked against the whitelist | PASS |
| 4 | Backlog smuggles scope | Backlog is docs-only; no code authorized | PASS |
| 5 | Version bump hides drift | No product bytes change; all pins stay green | PASS |

## 9. Freeze record

The SHA-256 (over exact file bytes) and line count of this file, as frozen
before any v1.4.6 test was written, are recorded in
tests/v1.4.6/helpers.mjs and pinned by test 1. Any later edit requires
a new gate.

