# OpenCode Model Sync — Simple Script Contract v1.4.7-rc3 Amendment A

Frozen amendment to Contract v1.4.7-rc3 (SHA-256
c007671724cb82a984f313fd2b199aa43917c84cfd70ab7ec4f17a421cb89d2d, 189 lines),
which is unchanged and immutable. Where this amendment is silent,
v1.4.7-rc3 remains binding.

Status: FROZEN. Freeze SHA-256 and line count recorded below.
Gate: OCMS-S v1.4.7-rc3, amendment A.
Baseline: HEAD 3fd53614df3ef57c79fb640235e2eba5a99c3489 plus the frozen
rc3 contract and its freeze anchor (no product change yet).
No release/tag authorized in this gate. No tag, no push.

## A1 (contrast reachability: controls, not hairlines)

V6 border/panel >= 3:1 is unreachable with the reference tokens (--border
#2A3850 on --panel #141B27 = 1.46:1; on --base #0B0F17 = 1.63:1). Per WCAG
1.4.11 Non-text Contrast, decorative hairlines (panel edges, dividers) keep
--border and are exempt as decoration. Every interactive control boundary
(text inputs, radios, checkbox, buttons, dialog buttons) and the visible
focus ring use a token with >= 3:1 against the background they sit on:
add --control-border (value #8A97AD, same as --muted; 5.85:1 on --panel)
for control boundaries, and use --lime for the focus ring. The contrast
test checks control-border/panel, control-border/base, lime/panel and
lime/base >= 3:1, and keeps every text pair >= 4.5:1 (fg, muted and all
five accents on base, panel and raised). No reference token value changes;
--control-border is an additional custom property only.

## A2 (pink Apply label contrast)

If the enabled Apply Sync uses a pink fill for its destructive-primary look,
its label uses --base (#0B0F17 on --pink #F3AACC = 10.4:1). The visual test
asserts that pair whenever the fill pattern is used; any enabled-Apply
text/background pair used must still meet >= 4.5:1. Disabled Apply stays
unmistakably inert per rc3 V2 (no contrast requirement beyond inert).

## Files

This amendment covers exactly:

- OpenCode Model Sync — Simple Script Contract v1.4.7-rc3 Amendment A.md
  (this file; frozen before any amendment test was written).
- tests/v1.4.7-rc3/helpers.mjs: amendment freeze anchor (additive).
- tests/v1.4.7-rc3/amendment-a.test.mjs: the amendment freeze test (also
  listed in the package.json test script by explicit path).
- package.json: test script gains tests/v1.4.7-rc3/freeze.test.mjs and
  tests/v1.4.7-rc3/amendment-a.test.mjs by explicit path (no globs).
- The rc3 visual suite (after go) asserts A1/A2 per above; no other file
  changes in this amendment step.

Forbidden: editing Contract v1.4.7-rc3 or any earlier frozen contract, and
everything forbidden by rc3 V7 except the files named above. No product
change in this step; RED-first implementation follows only after go.

## Freeze record

The SHA-256 (over exact file bytes) and line count of this file, as
frozen before any amendment test was written, are recorded in
tests/v1.4.7-rc3/helpers.mjs and pinned by
tests/v1.4.7-rc3/amendment-a.test.mjs. Any later edit requires a new
amendment.
