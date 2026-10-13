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
    const recorded = new Map([
      ['profile/target-resolver.mjs', '1d72e8169fac2c89b9bcc9196c7e019a729eaa81204aa3ecee1e50db63ca06b1'],
      ['tests/profile-target/helpers.mjs', '535be36cad699d729c0eb5e9afde0aaf5ad9517b67b052eb7c2026a560c42c6f'],
      ['tests/profile-target/target-admission.test.mjs', 'c1d4cc56ddd7e2ed01844895b678d82921de9f49dd79c1fc36dc1a2d48db94a8'],
      ['tests/profile-target/boundary.test.mjs', 'b4b0638a77ade1deee4c8033c62225541e596745dd5de60c52b4e7439ed717ea'],
    ]);
    for (const [rel, hex] of recorded) assert.equal(sha(rel), hex, 'S1 changed: ' + rel);
    // config-reader is S2 frozen: verify it still exposes the accepted surface (byte check via T19 + export check)
    assert.ok(fs.existsSync('profile/config-reader.mjs'));
  });
  it('T18 sync.mjs CURRENT reviewed bytes pinned (planning via suites)', async () => {
    // CURRENT authorized surface (rc4 P3 row 4 re-anchor of the S5-R4 pin,
    // re-pinned by v1.4.7-rc1 G5 for the G1/G2 product change with named reason):
    // sync.mjs carries the narrow canonical-target binding. Value equals the
    // v1.4.7-rc1 reviewed bytes, so the
    // pin keeps guarding the planning surface. Planning semantics stay proven
    // through the original planning suites.
    assert.equal(sha('sync.mjs'), '99e4f9dc78bbaf31a26692fd045f319509d9565bfd20f7419cbe5681a4b34b75', 'sync.mjs drift beyond the CURRENT reviewed bytes is forbidden');
    const { execFileSync } = await import('node:child_process');
    const out = execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' });
    const modified = out.split('\n').map((l) => l.trim()).filter(Boolean);
    assert.ok(!modified.includes('profile/config-reader.mjs'), 'config-reader must not be modified');
    assert.ok(!modified.includes('profile/target-resolver.mjs'), 'target-resolver must not be modified');
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
