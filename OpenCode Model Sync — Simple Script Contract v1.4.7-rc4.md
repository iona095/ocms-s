# OpenCode Model Sync — Simple Script Contract v1.4.7-rc4

Additive contract over v1.4.7-rc3 including Amendment A. Where v1.4.7-rc4
does not explicitly supersede appearance or the remembered profile,
v1.4.7-rc3 remains binding. All earlier contracts are unchanged and immutable.

Status: FROZEN. Freeze SHA-256 and line count recorded.
Gate: OCMS-S v1.4.7-rc4.
Repo: C:\Users\GNV\.dsh\tools\ocms-s, branch main.
Baseline: origin/main d4bf74c (tag v1.4.7-rc3 = 78c14cb, green).
No commit, tag or push in this gate. Release candidate only.

Scope: ui/index.html is the only product file. Layout and the remembered
profile change; behaviour, safety rules and frozen logic stay.

## L1 (one-row header, shorter)

Pixel logo, Model/Sync split heading and constellation SVG sit on ONE row
(constellation right of the heading); lede and Local Web UX below; version
and state badge stay top-right. Header height shrinks vs rc3, measured as:
display heading <= 32px (was 44px) and header padding-block <= 20px
(was 36px/28px). Logo, heading, lede, constellation and badge markers stay.

## L2 (work-first grid; DOM follows the visual order)

CSS grid over reordered DOM (every element id and ARIA hook unchanged,
reading/tab order follows the visual order): row 1 DSH Profile Target wide
(~2/3: picker, overlays, attestation, classification/identity) with Actions
(Refresh Preview, Apply Sync) then Upstream Sources stacked in the right
column; row 2 Settings target collapsed to a single line (profile mode:
"Settings target: not used in profile mode"; legacy content unchanged in
legacy mode); row 3 Synchronization Preview counters as one full-width row
of 8 (wraps to 4x2 below ~1100px), Removed still most prominent when
non-zero; row 4 Per-route scale full width with each loss warning as its
own line item via textContent (routeLossWarnings __PURE body byte-identical,
only the rendering changes); row 5 Details full width. No horizontal scroll
at 1024px; Refresh Preview and Apply visible without scrolling at 1280x800.

## P1 (remembered profile; amends SPEC_DSH_PROFILE_AWARE_SYNC 8.1 by name)

SPEC_DSH_PROFILE_AWARE_SYNC.md stays byte-identical; this section amends its
8.1 for UI remembering only (server grammar and --profile behaviour unchanged).
Old sentence (quoted): "Every profile-targeting operation takes an EXPLICIT
`--profile <name>` (CLI) or explicit profile picker value (UI/Host config).
No default, no `web` fallback, no env-derived profile, no positional guessing."
New rule: the picker may be PREFILLED from this browser's localStorage under
the documented key ocms-s.lastProfile, written only after a profile Preview
reaches READY (the trimmed name actually sent as profileName in that Preview
request) and applied on load only when the picker is empty and the stored
name passes the prefill grammar. The prefill grammar EQUALS
profile/target-resolver.mjs validateProfileName exactly (length <= 128,
charset ^[A-Za-z0-9][A-Za-z0-9._-]*$, no / backslash NUL, not . .. node_modules,
no leading '-', no trailing '.' or space, no reserved device names).
The server's --profile is never written into the picker (ui.mjs S5-R2 B4: the
server default is never silently substituted) and that stays true; only the
remembered name may prefill it, and only when the picker is empty at load.
Invalid, absent, or throwing storage -> empty picker, no error. Prefill NEVER
triggers Preview, never selects attestation, never pre-checks acknowledgment;
first visit stays empty; no hard-coded "web" anywhere. The picker label
changes from "(explicit; no default, no fallback)" to text saying the name
is remembered from the last successful Preview and must be confirmed by
Refresh Preview. One new __PURE function resolveRememberedProfile(stored,
current) decides (name or ''); storage access is try/catch-guarded so the
frozen stub-DOM suites pass unmodified. Known limitation: the page runs in a
cross-site iframe inside DSH, so storage may be partitioned or ephemeral
(e.g. Brave); remembering is best-effort and its absence leaves the page
exactly as rc3 (empty picker). Scratch-Chrome checks cannot prove DSH
persistence; "remembered name survives a DSH restart in the Models tab" is
a post-gate manual check for the maintainer.

## Frozen

previewDetailsComplete, routeLossWarnings and sourceStatusText stay
byte-identical between their __PURE banners. syncControls, the U2 completeness
gate, DETAIL_GROUPS, the confirm/Apply flow and attestation logic unchanged.
CSP, text-only rendering (textContent, no innerHTML for data) and embed
behaviour unchanged. No network URLs of any kind. Tokens and contrast rules
from rc3 plus Amendment A unchanged (rc3 visual suite stays green unmodified;
no supersession). ui.mjs, sync.mjs, profile/*, dsh/host.mjs,
dsh/lifecycle.mjs and the repo cordis.patch.yml stay byte-identical. Frozen
suites (profile-preview, r2-browser, ui-binding, rc3 visual) pass unmodified.

## V (version and pins)

Version 1.4.7-rc4: package.json version, description tag, test script (gains
the rc4 suites by explicit paths); package-lock mirrors; client
PLUGIN_VERSION plus rebuilt client.js (builder only). Re-pin ui/index.html
with named reason (work-first layout plus remembered profile) at both pin
sites: t19 CURRENT map and the compat successor (rc3 ui pin skipped as
superseded; established pattern). Forbidden: editing any frozen contract or
test except by named reason above; .gate/, real profiles, production Apply,
live calls in tests, weakening/skipping/deleting any test.

## Files

Exhaustive list of every file touched in this gate:

- This contract (frozen before any rc4 test was written).
- tests/v1.4.7-rc4/helpers.mjs: freeze anchor (additive).
- tests/v1.4.7-rc4/freeze.test.mjs: frozen test 1 (explicit path below).
- tests/v1.4.7-rc4/layout.test.mjs: L1/L2 checks (explicit path below).
- tests/v1.4.7-rc4/remembered-profile.test.mjs: P1 checks (explicit path).
- package.json: version 1.4.7-rc4, description tag, test script gains the
  three rc4 files by explicit path (no globs).
- package-lock.json: root version mirror only.
- dsh/client.mjs, dsh/client.js: version only (builder, never hand-edit).
- ui/index.html: L1/L2 layout plus P1 remembering (only product file).
- tests/v1.4/compat.test.mjs: skip rc3 ui pin (superseded by rc4 layout plus
  remembered profile), add rc4 successor; version pins rc3 -> rc4.
- tests/profile-reader/t19-footprint.test.mjs: CURRENT ui/index.html re-pin
  with named reason (work-first layout plus remembered profile).
- tests/dev-tools.test.mjs: version pin rc3 -> rc4 if present.
- CHANGELOG.md and README.md (release notes and counts).
- SPEC_DSH_PROFILE_AWARE_SYNC.md, ui.mjs, sync.mjs, profile/*, dsh/host.mjs,
  dsh/lifecycle.mjs, cordis.patch.yml: verified byte-identical, not re-pinned.

## Test

Package.json test script lists every file by explicit path (no globs).
1. tests/v1.4.7-rc4/freeze.test.mjs: contract freeze anchor intact.
2. tests/v1.4.7-rc4/layout.test.mjs: (a) one-row header (logo, heading and
   constellation share one row container; lede/sub below; display <= 32px,
   header padding-block <= 20px); (b) DOM order of section headings is
   profile, actions, sources, target, preview, routes, details; (c) 8 counters
   in one full-width container with 4x2 wrap below ~1100px and Removed most
   prominent; (d) loss warnings render as separate items via textContent while
   the page still calls routeLossWarnings and its __PURE body is byte-identical
   to rc3; (e) no-network, token and id-superset markers carried from rc3.
3. tests/v1.4.7-rc4/remembered-profile.test.mjs (node:vm plus stub DOM): valid
   stored name -> prefilled; invalid/absent/throwing storage -> empty picker
   with no error; a status-payload profile name is never written into the
   picker; nothing stored before READY; the trimmed request profileName is
   stored after READY; prefill never calls the preview function, never touches
   attestation or acknowledgment; no literal "web" default in page source
   outside placeholders; a shared name table run through both the page pure
   function and the imported profile/target-resolver.mjs validateProfileName
   asserts identical accept/reject (ui.mjs and profile/* stay untouched).
4. Frozen suites pass unmodified: tests/v1.4.7-rc2/profile-preview.test.mjs,
   tests/profile-cli-ui/r2-browser.test.mjs,
   tests/profile-cli-ui/ui-binding.test.mjs, tests/v1.4.7-rc3/visual.test.mjs.
5. Full npm test green; vehicle green with 0 fail.
6. tests/support/clean-env-run.mjs green; fresh clone at a path containing
   ocms-s (npm test, vehicle, profile job with DSH 0.2.1-alpha.2); read-only
   visual check of profile web (Refresh Preview only) with full-page 1280px
   and 1024px screenshots plus one reload shot showing the prefilled picker
   with NO preview run; scrollWidth vs clientWidth at 1024px reported;
   cordis.patch.yml SHA-256 identical before and after.
No live calls in tests. A pass counts only from the clean vehicle, the fresh
clone, or CI.

## Challenge

Row one: reorder breaks tab order. Answer: DOM follows the visual order, so
reading/tab order matches; ids and ARIA hooks unchanged.
Row two: remembered name becomes a default. Answer: prefill never previews,
attests or acknowledges; server grammar and --profile behaviour unchanged;
first visit stays empty.
Row three: per-item warnings change meaning. Answer: pure body pinned
byte-identical; only textContent rendering splits lines.
Row four: collapsed settings hides state. Answer: one-line note in profile
mode; legacy content byte-unchanged in legacy mode.
Row five: version bump hides drift. Answer: only ui/index.html re-pinned with
named reason at both pin sites; the frozen byte list verified identical.

## Freeze record

The SHA-256 over exact file bytes and the line count of this file, as frozen
before any v1.4.7-rc4 test was written, are recorded in
tests/v1.4.7-rc4/helpers.mjs and pinned by test 1. Any later edit requires
a new gate.

## Verify and stop (Steps 3-4)

Step 3 runs labelled by origin: npm test; tests/support/clean-env-run.mjs;
fresh clone at a path containing ocms-s (npm test, vehicle, profile job with
DSH 0.2.1-alpha.2); read-only visual check of profile web with full-page
screenshots plus the reload-prefill shot. Step 4 stops: diff, screenshots,
results. No commit, tag or push. Hard rules: no Apply and no acknowledgment
on any real profile; do not touch C:\Users\GNV\.dsh\profiles\ or .gate/;
no live calls in tests; never weaken/skip/delete a test outside a named
amendment; a pass counts only from the clean vehicle, fresh clone, or CI.
