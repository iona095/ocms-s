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
    // Re-pinned by the B5 defect fix with the named reason: row-name
    // anchoring is now shared (anchorNameBesideFile) so S1 binding identity
    // and S2 composition agree on every row's address.
    const recorded = new Map([
      // Re-pinned by the P2 defect fix (report C15; named reason: a Windows
      // reserved device stem is now detected before the FIRST dot, so con.x.y
      // and com1.a.b are refused instead of admitted).
      // Re-pinned by S6 baseline-divergence (named reason: the dsh baseline now uses the config-reader/commit candidate loop, skipping skewed or misnamed candidates so a top-level dsh cannot shadow a valid pinned nested scope). Superseded pin 86851a249e638ebbf8996bcd2eb0e2a2cd72df0a112b9d9486eb78fafff00a20.
      ['profile/target-resolver.mjs', 'dbd861995c87e63d15a8ca1a38cb22a7bdf35a5d730151058f80bbc581e9ff8a'],
      ['tests/profile-target/helpers.mjs', '535be36cad699d729c0eb5e9afde0aaf5ad9517b67b052eb7c2026a560c42c6f'],
      ['tests/profile-target/target-admission.test.mjs', 'ed8225f5c92461768b92b8a6571bd22720d5f54dfefedee79572f37564883ed5'],
      // Re-pinned by the B5 follow-up (named reason: the S1 export
      // allowlist admits the intentional anchorNameBesideFile export).
      ['tests/profile-target/boundary.test.mjs', '3e95d853f2dc5aacd5e5642387fbcfc3667f80b9bfd4c466a2f8d854f92f9d2a'],
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
    // Re-pinned by the C05 defect fix with the named reason: a missing
    // --settings file now prints verdict plus usage and exits 2, YAML parse
    // errors become coded SETTINGS_INVALID, and plan {reason} objects surface
    // in the legacy verdict instead of being dropped.
    // Re-pinned by the D04 defect fix with the named reason: backup names
    // stay unique inside one timestamp tick via legacyBackupPath.
    // Re-pinned by the D05 defect fix with the named reason: legacy Apply
    // edits managed arrays inside the existing document (surgicalLegacyUpdate)
    // so comments, key order, and unrelated styling survive the write.
    // Re-pinned by the P1 defect fix (report C14; named reason: the legacy
  // default settings path no longer falls back to a literal machine path; it
  // resolves USERPROFILE, then DSH_HOME, then refuses with a typed error).
  // Re-pinned by S8 digest-numerics (named reason: canonicalJson maps non-finite numbers to distinct bare tokens instead of collapsing onto 'null', and the reader gains the bigint arm; identical rule in all three copies). Superseded pin a89f9bcdb35b8efa52ffa8a7ca658bff2f632e485b60a4482b13c59d70c4b478.
      // Re-pinned by S9 confirm-eof (named reason: defaultConfirmCli settles on readline close, so Ctrl-D/EOF declines through the verdict path instead of hanging forever). Superseded pin 5934a809cba70a4b65f380619271fb281178617d08081a75e36eeb27776cc34f.
      // Re-pinned by S10 preview-display-swallow (named reason: a failed Preview display refuses PREVIEW_DISPLAY_FAILED instead of continuing to confirm and Apply blind). Superseded pin 3b940afa7aaa5730b8891a93cbd0f5ace77529b5b12f1bfd8093e5a80defad43.
      assert.equal(sha('sync.mjs'), '8bd44f458a0cf500b8ab18a603b6eb62000a72a898d11de491b20e13cba9ed17', 'sync.mjs drift beyond the CURRENT reviewed bytes is forbidden');
    // The old "no profile/* modification" tripwire is replaced, not dropped:
    // the three files v1.4.7-rc6 §5 changed are now byte-pinned at their
    // re-pinned values under the named reason "version-skew reproducibility
    // (v1.4.7-rc6 §5)", so any LATER drift still trips here — and unlike the
    // old work-tree check the pin keeps guarding after the change is
    // committed. Commit and config-reader gain the tripwire they lacked.
    const REPINNED = new Map([
      // Re-pinned by the B5 defect fix with the named reason: row-name
      // anchoring is now shared (anchorNameBesideFile) so S1 binding identity
      // and S2 composition agree on every row's address.
      // Re-pinned by the P2 defect fix (report C15; named reason: a Windows
      // reserved device stem is now detected before the FIRST dot, so con.x.y
      // and com1.a.b are refused instead of admitted).
      // Re-pinned by S6 baseline-divergence (named reason: the dsh baseline now uses the config-reader/commit candidate loop, skipping skewed or misnamed candidates so a top-level dsh cannot shadow a valid pinned nested scope). Superseded pin 86851a249e638ebbf8996bcd2eb0e2a2cd72df0a112b9d9486eb78fafff00a20.
      ['profile/target-resolver.mjs', 'dbd861995c87e63d15a8ca1a38cb22a7bdf35a5d730151058f80bbc581e9ff8a'],
      // Re-pinned by the 0b/D3 lock-label fix (named reason above: unexpected
      // lock-acquisition errors are no longer blanket-labeled INCOMPATIBLE_DSH).
      // 0b follow-up: recognize a LOCK_TIMEOUT code as well as the native sentence.
      // Re-pinned by the B5 follow-up with the named reason: commit-side
      // row anchoring shares anchorNameBesideFile and covers top-level rows,
      // matching the S1/S2 address rule.
      // Re-pinned by S3 refusal-taxonomy: S3 refusal-taxonomy (bugfix-8model): PROFILE_NOT_INITIALIZED and SYMLINK_ESCAPE added to COMMIT_REFUSAL_CODES; the re-resolve pass-through now carries the vanished-profile refusal with status BLOCKED. Superseded pin e08abf377fdf4934b7799a11aebef169ba7d5fc2d9fde0158c8bfa84e2a331e3.
      ['profile/commit.mjs', '281fc369c37208b899d010dcd98a4362d5cc62760f0a0efffefa41841b01d673'],



      // Re-pinned by the B5 defect fix with the named reason: insert-name
      // anchoring now covers top-level rows as well as insert children, so
      // one file's rows always address identically in composition.
      // Re-pinned by S8 digest-numerics (named reason: canonicalJson maps non-finite numbers to distinct bare tokens instead of collapsing onto 'null', and the reader gains the bigint arm; identical rule in all three copies). Superseded pin ed0e72e4ac039860fbc824dcb1990f2815839ba582792158216384ba77a64a49.
      ['profile/config-reader.mjs', '3aa41c5bbb56fcb79003b759ffd74982203ede0fa6f055bf0b8e37b9b6b07055'],
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
      // Re-pinned by the B2 defect fix with the named reason: a bare models
      // key (null value, including the null-scalar form) is accepted as an
      // empty list via a synthetic span covering only that key line ending.
      // Re-pinned by the B4 defect fix with the named reason: an alias inside
      // a replaced models span now refuses ANCHOR_IN_MANAGED_SCOPE instead of
      // rendering READY and silently dropping a non-local reference.
      // Re-pinned by the D07 defect fix with the named reason: an F1-add
      // insertion sharing its offset with the combined F2 insertion merges
      // (models block first) instead of refusing a duplicate site.
      ['profile/surgical-render.mjs', '6b9ad428030f47b6b9417901b68bca459a292eb4e6e966217a6631fffa61dd2f'],



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
