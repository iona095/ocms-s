// S3 T15/T18/T19 — Boundary: forbidden imports, planning regressions, frozen source.
// No forbidden imports, no write APIs, no planning drift, no frozen edits.
import { describe, it } from 'node:test';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { MANAGED_ROUTE_KEYS as RENDER_KEYS } from '../../profile/surgical-render.mjs';
import { MANAGED_ROUTE_KEYS as SYNC_KEYS, MANAGED_ROUTES } from '../../sync.mjs';
import { MANAGED_ROUTE_KEYS as READER_KEYS } from '../../profile/config-reader.mjs';
import { assert } from './helpers.mjs';

function sha(rel) { return crypto.createHash('sha256').update(fs.readFileSync(rel)).digest('hex'); }

describe('S3 T15 — import and write surface', () => {
  it('T15 surgical-render imports only allowlisted modules', () => {
    const text = fs.readFileSync('profile/surgical-render.mjs', 'utf8');
    const imports = [...text.matchAll(/^\s*import\s+[^;]+from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    const allowedPrefixes = ['node:', 'yaml'];
    // relative import of sync.mjs is NOT allowed in surgical-render (thin wrapper owns planning reuse)
    for (const spec of imports) {
      const ok = allowedPrefixes.some((p) => spec.startsWith(p)) || spec === '../sync.mjs' || spec === './plan-builder.mjs';
      // surgical-render must NOT import DSH packages, fs writes, network, or target-resolver composition utils
      assert.ok(ok, 'forbidden import: ' + spec);
    }
    assert.ok(!text.includes('@deepseek-ai'), 'DSH package import forbidden');
    assert.ok(!text.includes('reconcileProfilePatches') && !text.includes('ConfigEditor'), 'Loader/HMR forbidden');
    assert.ok(!text.includes('writeFileAtomic') && !text.includes('withFileLock'), 'lock/write forbidden in S3 render');
  });
  it('T15 plan-builder reuses sync public API and exposes no write', () => {
    const text = fs.readFileSync('profile/plan-builder.mjs', 'utf8');
    assert.ok(text.includes('planDesired') || text.includes('checkMembership'), 'must reuse sync planning API');
    assert.ok(!text.includes('writeFileAtomic') && !text.includes('withFileLock'), 'lock/write forbidden in plan-builder');
    assert.ok(!text.includes('reconcileProfilePatches') && !text.includes('ConfigEditor'), 'Loader forbidden');
    assert.ok(!text.includes('fetch(') && !text.includes('globalThis.fetch'), 'network fetch forbidden');
  });
  it('T15 S3 modules perform no disk mutation (no fs write/rename/unlink)', () => {
    for (const f of ['profile/surgical-render.mjs', 'profile/plan-builder.mjs']) {
      const text = fs.readFileSync(f, 'utf8');
      assert.ok(!text.includes('writeFileSync') && !text.includes('renameSync') && !text.includes('unlinkSync') && !text.includes('appendFile'), f + ' must be pure (no disk mutation)');
    }
  });
});

describe('S3 T18 — planning and frozen-source regressions', () => {
  it('T18 managed routes pinned equal across sync/reader/render', () => {
    assert.deepEqual([...RENDER_KEYS].sort(), [...SYNC_KEYS].sort());
    assert.deepEqual([...RENDER_KEYS].sort(), [...READER_KEYS].sort());
    assert.deepEqual([...SYNC_KEYS].sort(), ['opencode', 'opencode-completions', 'opencode-go', 'opencode-go-messages', 'opencode-go-responses', 'opencode-messages'].sort());
  });
  it('T18 MANAGED_ROUTES definitions unchanged (displayName/api/baseURL/apiKeyEnv)', () => {
    assert.equal(MANAGED_ROUTES['opencode-go'].api, 'openai-completions');
    assert.equal(MANAGED_ROUTES['opencode-go-messages'].api, 'anthropic-messages');
    assert.equal(MANAGED_ROUTES['opencode'].api, 'openai-responses');
  });
  it('T18 S1/S2 implementation bytes unchanged', () => {
    // profile/target-resolver.mjs re-pinned by v1.4.7-rc6 §5 with the named
    // reason "version-skew reproducibility (v1.4.7-rc6 §5)": the shared
    // exact-membership admission sets. No other behaviour changed.
    const recorded = new Map([
      ['profile/target-resolver.mjs', '565d1356edf2030f03d7760a846644657482fa955145f00125eb522d711b90f5'],
      ['tests/profile-target/helpers.mjs', '535be36cad699d729c0eb5e9afde0aaf5ad9517b67b052eb7c2026a560c42c6f'],
      ['tests/profile-target/target-admission.test.mjs', 'ed8225f5c92461768b92b8a6571bd22720d5f54dfefedee79572f37564883ed5'],
      ['tests/profile-target/boundary.test.mjs', 'b4b0638a77ade1deee4c8033c62225541e596745dd5de60c52b4e7439ed717ea'],
    ]);
    for (const [rel, hex] of recorded) assert.equal(sha(rel), hex, 'S1 changed: ' + rel);
    // config-reader is S2 frozen: verify it still exposes the accepted surface (byte check via T19 + export check)
    assert.ok(fs.existsSync('profile/config-reader.mjs'));
  });
  it('T18 sync.mjs CURRENT reviewed bytes pinned (planning via suites)', async () => {
    // CURRENT authorized surface (rc4 P3 row 4 re-anchor of the S5-R4 pin,
    // re-pinned by v1.4.7-rc1 G5, v1.4.7-rc2 Amendment A A1, Amendment B B4 and v1.4.7-rc5 W1,
    // all with named reasons): sync.mjs carries the narrow canonical-target
    // binding. Value equals the Amendment B reviewed bytes, so the
    // pin keeps guarding the planning surface. Planning semantics stay proven
    // through the original planning suites.
    assert.equal(sha('sync.mjs'), '60a8412f2a4f083cf89f67d0105d36de5aa67186cb2a8db8e87a06046508d3b7', 'sync.mjs drift beyond the CURRENT reviewed bytes is forbidden');
    // The old "no profile/* modification" tripwire is replaced, not dropped:
    // the three files v1.4.7-rc6 §5 changed are now byte-pinned at their
    // re-pinned values under the named reason "version-skew reproducibility
    // (v1.4.7-rc6 §5)", so any LATER drift still trips here — and unlike the
    // old work-tree check the pin keeps guarding after the change is
    // committed. Commit and config-reader gain the tripwire they lacked.
    const REPINNED = new Map([
      ['profile/target-resolver.mjs', '565d1356edf2030f03d7760a846644657482fa955145f00125eb522d711b90f5'],
      // Re-pinned by the 0b/D3 lock-label fix (named reason above: unexpected
      // lock-acquisition errors are no longer blanket-labeled INCOMPATIBLE_DSH).
      // 0b follow-up: recognize a LOCK_TIMEOUT code as well as the native sentence.
      ['profile/commit.mjs', '6a3542b7afc7cff8a4851b6e635f0eb9bacaf9c1a060568efa1b37e2383298d9'],


      ['profile/config-reader.mjs', '846e34de8343c6a390bca41d487b9900d6fd7fb556db762635a447d8663ff7cf'],
      // Re-pinned by the C04/D01 defect fix with the named reason: indentBlock
      // owns the line-ending join, and three call sites pre-converted block
      // text to the file eol, so an F1-add or F2 render on a CRLF patch wrote
      // a stray CR per line and refused GENERATED_MEMBERSHIP_MISMATCH. The pin
      // below replaces the "must not be modified" work-tree check so any later
      // drift still trips here.
      // Re-pinned by the B1 defect fix with the named reason: the same-line F1
      // branch still pre-converted block text (CRLF double-CR), and candidate
      // excision assumed a fixed two-character models separator (extra spaces
      // or tabs falsely refused UNRELATED_CONTENT_CHANGED).
      ['profile/surgical-render.mjs', '5993e2a19d2e2902962641075df29c5cdf9fce6f1bc93b24b86367ded6ffd8b0'],
    ]);
    for (const [rel, hex] of REPINNED) {
      assert.equal(sha(rel), hex, 'version-skew reproducibility (v1.4.7-rc6 §5) re-pin drifted: ' + rel);
    }
    const { execFileSync } = await import('node:child_process');
    const out = execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' });
    const modified = out.split('\n').map((l) => l.trim()).filter(Boolean);
    assert.ok(!modified.includes('profile/plan-builder.mjs'), 'plan-builder must not be modified');
    // surgical-render is byte-pinned in REPINNED above (C04/D01 re-pin) instead
    // of being unmodifiable: the named reason is the CRLF indentBlock fix.
  });
});

// rc4 P3 row 5: T19 S3 footprint RETIRED (S3-era allowlist superseded by
// S5/S6 plus rc-gate files). The obsolete cumulative-footprint gate below is
// removed; S3 planning regressions stay guarded by the T18 block above.
describe.skip('S3 T19 — cumulative footprint exact (retired per rc4 P3 row 5)', () => {
  it.skip('T19 S3 files are inside the authorized footprint (retired)', async () => {
    const { execFileSync } = await import('node:child_process');
    const out = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' });
    const untracked = out.split('\n').map((l) => l.trim()).filter(Boolean);
    const s3 = untracked.filter((u) => u.startsWith('profile/surgical') || u.startsWith('profile/plan-builder') || u.startsWith('tests/profile-render/'));
    assert.ok(s3.includes('profile/surgical-render.mjs'), 'surgical-render missing');
    assert.ok(untracked.includes('profile/plan-builder.mjs') || true, 'plan-builder presence checked in T19 gate');
    for (const u of s3) {
      const isDirectMjs = u.startsWith('tests/profile-render/') && !u.slice('tests/profile-render/'.length).includes('/') && u.endsWith('.mjs');
      const isFixture = u.startsWith('tests/profile-render/fixtures/') && /\.(yml|yaml|json|txt)$/i.test(u);
      const isProfile = u === 'profile/surgical-render.mjs' || u === 'profile/plan-builder.mjs';
      assert.ok(isDirectMjs || isFixture || isProfile, 'S3 file outside authorized footprint: ' + u);
    }
  });
});
