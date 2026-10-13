# OpenCode Model Sync — Simple Script Contract v1.4.7-rc3

Additive contract over Contracts v1.2 through v1.4.7-rc2 including
Amendments A and B. Where v1.4.7-rc3 does not explicitly supersede
appearance, v1.4.7-rc2 remains binding. Contracts v1.0 through
v1.4.7-rc2 including Amendments A and B are unchanged and immutable.

Status: FROZEN. Freeze SHA-256 and line count recorded.
Gate: OCMS-S v1.4.7-rc3.
Repo: C:\Users\GNV\.dsh\tools\ocms-s, branch main.
Baseline: HEAD 3fd53614df3ef57c79fb640235e2eba5a99c3489 (v1.4.7-rc2,
CI run 38433479577 green). No commit, tag or push in this gate.
Release candidate only. Visual only; every behaviour, safety rule
and test stays unless this contract names the change.

Design reference (read-only capture from https://pixelcraftsco.com,
2026-10-13; inspiration only, no asset reuse):
Tokens: --base #0B0F17; --panel #141B27; --raised #1B2433;
--border #2A3850; --fg #E6ECF5; --muted #8A97AD; accents --lime #BAFF70,
--cyan #81D6F1, --violet #BDABFF, --orange #FFC190, --pink #F3AACC;
color-scheme: dark. Type: Plus Jakarta Sans, fallback "Segoe UI",
system-ui, sans-serif. Display heading mixes weight 200 and 800.
Section labels 13px 700 uppercase letter-spacing ~0.12em muted.
Body 16px; secondary text muted; a lime one-line lede. Marks: a 2x2 grid
of coloured squares as logo; a constellation motif of small pixel squares
joined by thin lines (inline SVG, static). Generous whitespace, hairline
dividers, flat panels, small radii, no heavy shadows.

## V1 (look)

ui/index.html adopts the tokens above as CSS custom properties on :root
and uses only them for colour (no other hex/rgb/hsl colour literals for
painted elements). Header: 2x2 pixel logo (four spans, accent fills) +
"OCMS-S" wordmark, a light/heavy split heading (e.g. "Model" weight 200,
"Sync" weight 800), a lime one-line lede, version and state badge.
A small static inline-SVG constellation is decoration only (aria-hidden,
no animation, no script hooks, honours prefers-reduced-motion). Panels
flat on --panel with --border hairlines; raised surfaces on --raised.
Layout and CSS may change; nothing else may change except V5.

## V2 (meaning by colour, never colour alone)

Fixed accent roles: lime = ready/ok, cyan = info/added, violet =
moved/metadata, orange = warnings/skipped/unsupported, pink =
removed/destructive/errors. Every state also carries text (counts, labels,
warning sentences); colour never acts alone. The Removed count and the
per-route loss warning are the most prominent elements when non-zero
(size/weight/placement, not colour alone). Apply Sync looks
destructive-primary (pink) only when enabled; disabled is unmistakably
inert (muted text, hairline border, reduced opacity, not-allowed cursor).

## V3 (offline and safe)

No network resources of any kind: no Google Fonts, no CDN, no remote
CSS/JS/images. The page uses the system fallback stack only
("Segoe UI", system-ui, sans-serif). Vendoring Plus Jakarta Sans (OFL)
as a local file is out of scope unless a named amendment allows it.
CSP, text-only rendering (textContent, no innerHTML for data), and the
embed/iframe behaviour (frame-ancestors, loopback origin) stay unchanged.

## V4 (behaviour frozen)

Every element id, every data/ARIA hook the tests use, the DETAIL_GROUPS
logic, the U2 completeness gate, the A2 pure functions
previewDetailsComplete and routeLossWarnings (bytes between their __PURE
banners unchanged), attestation controls and the Apply flow stay identical.
Script logic may not change except V5. The U2 gate, STATE_LABELS, SOURCE_SLOTS,
renderTarget/renderSources/renderPreview/clearPreview/setState/syncControls
and the confirm dialog flow keep rc2 semantics byte-for-byte apart from V5.

## V5 (two display fixes; only script exception)

Only these script edits are allowed, with no server change: (a) sources
reported as { ok: true } with no count show "OK" (lime) instead of
"1 field(s)"; { ok: false } shows "unavailable" (pink); implemented as
one small new pure function with __PURE banners plus its renderSources call
site and two CSS classes; (b) in profile mode the legacy "Settings target
UNKNOWN" panel is hidden or labelled "not used in profile mode" via the
existing profile render path only (fixed text or hidden attribute, no data
change). All other script bytes keep rc2 logic.

## V6 (accessibility)

Text contrast >= 4.5:1 for body text and >= 3:1 for large text and UI
borders, checked in a test computed from the token hex values (WCAG relative
luminance; pairs: --fg on --base, --fg on --panel, --muted on --base,
--muted on --panel, --lime on --base, plus --border against --panel). Visible
lime focus ring on every control (focus-visible). Layout works at 1280px and
inside the DSH embed width; no horizontal scroll at 1024px (verified by the
read-only screenshots in test 8, not by live calls in tests).

## V7 (version and pins)

Version 1.4.7-rc3: package.json version, description contract tag, test
script (gains the rc3 freeze suite by explicit paths); package-lock root
versions mirroring package.json; client PLUGIN_VERSION and the rebuilt
client.js (builder script only, never hand-edited). Only ui/index.html
changes in product. ui.mjs is untouched in this gate (no served-asset header
change is required; CSP/embed bytes stay identical). Re-pin ui/index.html at
every pin site with a named reason (PixelCrafts look + V5 display fixes):
t19 CURRENT map and the compat succession (skip the rc2 ui pin as superseded,
add the rc3 successor; established pattern). cordis.patch.yml stays
byte-identical (prefix 192070a4, verified identical before and after).
Forbidden: sync.mjs planning, profile files, SPEC files, frozen contracts,
lifecycle/host, bundle architecture, Preview/Apply semantics, settings
targets, route transport, roster/catalog/docs URLs, live probes, .gate/, real
profiles and production Apply, weakening/skipping/deleting any test.

## Files

Every file touched in this gate, including re-pin sites, CHANGELOG, README:

- This contract (frozen before any rc3 test was written).
- tests/v1.4.7-rc3/helpers.mjs: rc3 freeze anchor (additive).
- tests/v1.4.7-rc3/freeze.test.mjs: the frozen test 1 (explicit path below).
- tests/v1.4.7-rc3/visual.test.mjs: V1-V6 checks (explicit path below).
- package.json: version 1.4.7-rc3, description tag, test script gains the two
  rc3 files by explicit path (no globs).
- package-lock.json: root version mirror only.
- dsh/client.mjs, dsh/client.js: version only (builder script, never hand-edit).
- ui/index.html: V1 look, V2 accent roles, V5 display fixes, V6 focus/contrast
  hooks (only product file). ui.mjs untouched.
- tests/v1.4/compat.test.mjs: skip rc2 ui pin (superseded by rc3 look + V5),
  add rc3 successor pin; version pin rc2 -> rc3.
- tests/profile-reader/t19-footprint.test.mjs: CURRENT ui/index.html re-pin
  with named reason (PixelCrafts look + V5 display fixes).
- tests/dev-tools.test.mjs: version pin rc2 -> rc3 if present.
- CHANGELOG.md and README.md (release notes and counts).
- No other file changes. cordis.patch.yml, sync.mjs, ui.mjs, profile/* stay
  byte-identical (verified, not re-pinned).

## Test

Package.json test script lists every file by explicit path (no globs).
Identities frozen:
1. tests/v1.4.7-rc3/freeze.test.mjs: contract freeze anchor intact (SHA-256
   plus line count from tests/v1.4.7-rc3/helpers.mjs).
2. tests/v1.4.7-rc3/visual.test.mjs: (a) tokens present on :root and only
   tokens used for colour; (b) no http(s) URL in any src/href/@import/url();
   (c) contrast check over the token pairs in V6 from hex values;
   (d) every id from v1.4.7-rc2 ui/index.html (HEAD blob) still present;
   (e) the two __PURE function bodies byte-identical to rc2 (HEAD blob);
   (f) V5 source display via the new small pure function run in node:vm
   ({ ok:true } -> OK lime; { ok:false } -> unavailable pink; existing
   count/ids/field(s) shapes unchanged); (g) legacy Settings-target panel
   hidden or labelled not-used in profile mode (static marker).
3. Existing rc2 vm tests pass unchanged (assertions unmodified):
   tests/v1.4.7-rc2/profile-preview.test.mjs,
   tests/profile-cli-ui/r2-browser.test.mjs.
4. Full npm test green with only authorized version updates plus the rc3
   freeze and visual suites; vehicle green with 0 fail.
5. tests/support/clean-env-run.mjs green; fresh clone at a different path
   (npm test, vehicle, profile job with DSH 0.2.1-alpha.2); read-only web
   check (Refresh Preview only, never Apply, never acknowledge attestation)
   with 1280px and 1024px screenshots to scratch (not the repo) and counters
   reported; cordis.patch.yml SHA-256 identical before and after.
No live calls in tests. Never weaken, skip or delete a test outside a named
amendment. A pass counts only from the clean vehicle, the fresh clone, or CI.

## Challenge

Row one: redesign hides state. Answer: V2 keeps every text carrier; Removed
and loss warning gain prominence; U2 gate and Apply flow unchanged.
Row two: token-only colour breaks states. Answer: fixed accent roles plus text;
contrast test pins the pairs; disabled Apply is inert by more than colour.
Row three: offline claim drifts. Answer: no-URL test plus unchanged CSP and
textContent/embed markers; vendoring needs an amendment.
Row four: V5 reopens logic. Answer: two named display hunks only; A2 pure
bodies pinned byte-identical; rc2 vm suites unmodified.
Row five: version bump hides drift. Answer: only ui/index.html re-pinned with
named reason at both pin sites; cordis/sync/ui.mjs/profile verified identical.

## Freeze record

The SHA-256 over exact file bytes and the line count of this file, as frozen
before any v1.4.7-rc3 test was written, are recorded in
tests/v1.4.7-rc3/helpers.mjs and pinned by test 1. Any later edit requires
a new gate. Disposition rows stay sorted by gateway then id.

## Verify and stop (Steps 3-4)

Step 3 runs labelled by origin: npm test; tests/support/clean-env-run.mjs;
fresh clone at a different path (npm test, vehicle, profile job with DSH
0.2.1-alpha.2); one read-only visual check (profile UI for web, Refresh
Preview only, screenshots 1280px and 1024px to scratch). Step 4 stops: show
the diff, screenshots and results. No commit, tag or push. Hard rules: no
Apply against any real profile; do not touch C:\Users\GNV\.dsh\profiles\
or .gate/; no live calls in tests; never weaken/skip/delete a test outside a
named amendment; a pass counts only from the clean vehicle, fresh clone, or CI.
