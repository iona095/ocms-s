# OpenCode Model Sync — Simple Script Contract v1.4.7-rc4 Amendment B

Frozen amendment to Contract v1.4.7-rc4 (SHA-256
988466ebe3e80588bf2075e6874f4fcb2c6f2f9abf3037c49b48a2fafc0c8a43, 181 lines),
as fixed by Amendment A (token confinement, H2 skip). It supersedes only the
listed L1/L2 parts below. Everything in P1, Amendment A, Frozen and V stays
binding, including every element id, ARIA hook, text, __PURE block, CSP and
the tokens/contrast rules. The base contract is otherwise unchanged and immutable.

Status: FROZEN. Freeze SHA-256 and line count recorded below.
Gate: OCMS-S v1.4.7-rc4, amendment B (density for the DSH Models tab).
Baseline: HEAD d4bf74c plus the frozen rc4 work (L1/L2/P1 implemented,
Amendment A consolidated, H2 skipped).
No release/tag authorized in this gate. No tag, no push.

## B1 (header fits in 64px)

One flex row holds the pixel logo, the ModelSync heading, the constellation
and the lede inline (muted, ellipsizing); version plus state badge sit at the
far right. "Local Web UX" folds into the version tooltip (no sub line).
Heading <= 24px (was 30px); header padding-block <= 12px (was 16px). Header
content aligns with the main left edge (both padding-left 16px). Measured proxies:
brand-row contains logo, h1, svg and lede; no .sub element; title tooltip set.

## B2 (full width, tighter type and spacing)

The 1200px cap is removed (no max-width). Page padding <= 16px, grid gap
<= 12px, panel padding <= 14px, body text 14px. Counter values keep their
relative prominence (Removed number larger than the rest) and Removed stays
the most prominent element when non-zero.

## B3 (three columns at 1400px and up, two below)

At >= 1400px: Profile (picker, overlays, attestation, classification) |
Synchronization Preview (8 counters in 2x4 while in the middle column) with
Per-route scale under it |
Actions over Upstream Sources; Details full width below; the collapsed
Settings line full width above Details. Columns size to content with
align-items start, so no stretched empty rows. Between 1024 and 1399px: two
columns (Profile spanning rows 1-2 | Actions over Sources), the rest full
width, no dead row space. DOM and tab order are the workflow order: profile,
actions, sources, preview, routes, settings, details. At two columns this
matches the visual exactly; at three columns tab follows the workflow
(picker, Refresh, Apply, sources, results) instead of row-major.

## B4 (status bar never covers content)

The bar stays in-flow (sticky, never fixed or absolute) and main reserves
its height with bottom padding >= 48px. Proxies: sticky-or-static position,
main padding-bottom value >= 48.

## B5 (measurable fold)

At 1650x730 viewport: Refresh Preview, Apply, all 8 counters, every source
row and the first loss warning visible without scrolling. At 1280x800:
Refresh, Apply and the counters visible. Visibility is measured, screenshots
are additional evidence: Step 3 reports getBoundingClientRect().bottom for
Refresh, Apply, each of the 8 counters, every source row and the first loss
warning, each against innerHeight minus the status bar height, at 1650x730
and (for Refresh, Apply and the counters) at 1280x800, plus scrollWidth and
clientWidth at 1024px, all from the final bytes after a server restart.

## Layout.test changes (named old to new; nothing else in that file)

1. L1 one-row test -> B1 test: brand-row gains the inline lede; lede-below
   and .sub assertions removed; display bound 32 -> 24; header padding bound
   20 -> block 12; new asserts for the version tooltip and the 16px left-edge
   alignment.
2. L2 section-order list (profile, actions, sources, target, preview, routes,
   details) -> B3 workflow order (profile, actions, sources, preview, routes,
   settings, details).
3. L2 counters assertions (one container of 8 kept; removed-hero kept plus a
   numeric check that the Removed value is larger than the rest; responsive
   shape: 2x4 via repeat(4) only while Preview sits in the 1400px middle
   column, 8 across at full width for 1100-1399px, 4x2 below 1100px; the 1100px
   rule stays, extended to both breakpoints).
4. L2 warnings-as-items and carried-markers assertions unchanged.
5. NAME_TABLE keeps the 129-char (reject) and 128-char (accept) boundary pair.

## Files

This amendment covers exactly:

- OpenCode Model Sync — Simple Script Contract v1.4.7-rc4 Amendment B.md
  (this file; frozen before any amendment test was written).
- tests/v1.4.7-rc4/helpers.mjs: amendment freeze anchor (additive).
- tests/v1.4.7-rc4/amendment-b.test.mjs: freeze pin now; B1-B5 checks land
  here post-review as the Step-2 RED work (package.json explicit path now).
- tests/v1.4.7-rc4/layout.test.mjs: only the L1/L2 assertions named above
  (post-review).
- package.json: test script gains the amendment-b path (this step).
- ui/index.html: CSS plus DOM moves only, no script logic change (post-review).
- tests/v1.4/compat.test.mjs and tests/profile-reader/t19-footprint.test.mjs:
  ui/index.html re-pin with named reason "density Amendment B" (post-review).
- Post-review evidence: 1650x730 viewport (not full page), 1280x800 and 1024
  full-page shots from final bytes after a restart; scrollWidth equals
  clientWidth at 1024; both cordis hashes before and after; every started
  listener killed (port 18751 belongs to the maintainer DSH: hands off);
  post-gate DSH-restart persistence check from Amendment A still open.

Forbidden: touching P1, Amendment A, Frozen or V semantics; editing any
frozen contract or test outside the named changes; any product change, any
B-check test, or any pin edit in this step.

## Freeze record

The SHA-256 (over exact file bytes) and line count of this file, as
frozen before any amendment test was written, are recorded in
tests/v1.4.7-rc4/helpers.mjs and pinned by
tests/v1.4.7-rc4/amendment-b.test.mjs. Any later edit requires a new
amendment.
