// S2 T19-support — change footprint gate (P1-A §§11, 12 gate 2; ticket S2.9).
//
// Frozen source and contract files stay byte-identical (tracked files via
// git work-tree status against HEAD; accepted S1 untracked files via pinned
// hashes recorded at S2 ticket time). Only profile/config-reader.mjs and
// tests/profile-reader/* may be new. No install/commit/push/tag happens here.
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assert } from './helpers.mjs';

// Q2: run-time checkout root (was a hard-coded developer path), so git status
// and hash reads run against the actual checkout, including a fresh clone.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Tracked files frozen for S2 (P1-A §11 + ticket frozen list).
const FROZEN_TRACKED = [
  'sync.mjs',
  'ui.mjs',
  'cordis.patch.yml',
  'package.json',
  'package-lock.json',
  'SPEC.md',
  'SPEC_DSH_PROFILE_AWARE_SYNC.md',
  'P1_IMPLEMENTATION_READINESS.md',
];

// Accepted S1 untracked files are tripwired by hash in the third case below.
function shaFile(rel) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO, rel))).digest('hex');
}

function gitLines(args) {
  const out = execFileSync('git', args, { cwd: REPO, encoding: 'utf8' });
  return out.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
}

describe('S2 T19 — frozen files unchanged; S2 footprint exact', () => {
  it('T19 tracked frozen files have no work-tree modifications except authorized CURRENT pins', () => {
    // Tracked modifications only (diff, not untracked): the S1/S2 additions
    // are untracked by design and must not trip this gate.
    const modified = new Set([...gitLines(['diff', '--name-only']), ...gitLines(['diff', '--cached', '--name-only'])]);
    // CURRENT authorized surfaces (rc4 P3 row 2 re-anchor of the S5-R4 pins,
    // re-pinned by v1.4.7-rc1 G5 for the G1/G2 product change with named reason):
    // exact pins to the current reviewed bytes (sync value equals the Amendment B
    // reviewed bytes with named reason: per-copy removed rows; ui values equal the
    // v1.4.7-rc2 reviewed bytes with named reason: reviewable content plus
    // Amendment B stored-list counts without derivation). All other
    // forbidden files stay binding; no wildcards, no directory exemptions
    // beyond the §10-authorized version-bump files below.
    const CURRENT_PINS = new Map([
      ['sync.mjs', 'b686f64b47007d3f0046f70520e594afc08d217bc87d36dfd9bf6bc357fb4026'],
      ['ui.mjs', '3d0c656e48f628d0fc1624d7309f5369850693575f5c0fded949fe95d970d93e'],
      ['ui/index.html', '1836648bcf546fc09393481649899262a22bc0d13da4ddcd8b15541e81d46807'],
    ]);
    for (const [rel, hex] of CURRENT_PINS) {
      assert.equal(shaFile(rel), hex, `CURRENT surface drift: ${rel}`);
    }
    // §10-authorized version-bump files of this gate (metadata only, P6).
    const RC4_ALLOWED = new Set([
      'package.json',
      'package-lock.json',
      'dsh/client.js',
      'dsh/client.mjs',
    ]);
    const dirty = [...modified].filter(
      (rel) => !CURRENT_PINS.has(rel) && !RC4_ALLOWED.has(rel) && (FROZEN_TRACKED.includes(rel) || rel.startsWith('dsh/') || rel.startsWith('ui/') || rel === 'ui.mjs'),
    );
    assert.deepEqual(dirty, [], `modified frozen files: ${[...modified].join(', ')}`);
  });

  // rc4 P3 row 3: RETIRED (untracked allowlist enumerates S1–S5 history;
  // superseded by the committed tree and §10). Kept as an explicit skip so
  // per-file totals show the retire disposition.
  it.skip('T19 untracked set is exactly the accepted S1 files plus S2 files (retired per rc4 P3 row 3)', () => {
    const untracked = gitLines(['ls-files', '--others', '--exclude-standard']).sort();
    const allowed = new Set([
      'profile/target-resolver.mjs',
      'tests/profile-target/helpers.mjs',
      'tests/profile-target/target-admission.test.mjs',
      'tests/profile-target/boundary.test.mjs',
      'profile/config-reader.mjs',
      // S3 cumulative footprint (orchestrator-authorized T19 correction):
      // surgical renderer + thin planning wrapper. No other profile/* file
      // is admitted here; the rule stays an explicit allowlist, never a
      // profile/* or tests/* wildcard.
      'profile/surgical-render.mjs',
      'profile/plan-builder.mjs',
      // S4 cumulative footprint (orchestrator-authorized T19 correction):
      // headless atomic commit module only. No other profile/* file admitted.
      'profile/commit.mjs',
      // S5 cumulative footprint (P1-S5-R1 ticket-authorized T19 maintenance):
      // strict shared live-state attestation validator + minimal shared
      // Preview/binding glue only. No other profile/* file is admitted here;
      // the rule stays an explicit allowlist, never a profile/* wildcard.
      'profile/live-attestation.mjs',
      'profile/preview-session.mjs',
      // Frozen contract documents: untracked by design since P0 (entry gate).
      'SPEC_DSH_PROFILE_AWARE_SYNC.md',
      'P1_IMPLEMENTATION_READINESS.md',
    ]);
    // S3 fixture extension allowlist: synthetic golden fixtures only. No
    // executable scripts, no nested code, no other repository directories.
    const S3_FIXTURE_EXTS = new Set(['.yml', '.yaml', '.json', '.txt']);
    function isAllowedS3Render(p) {
      const prefix = 'tests/profile-render/';
      if (!p.startsWith(prefix)) return false;
      const rest = p.slice(prefix.length);
      // Direct S3 files: exactly one path segment ending in .mjs
      // (covers *.test.mjs plus .mjs helpers). Nested code is rejected.
      if (!rest.includes('/')) return rest.endsWith('.mjs');
      // Golden fixtures: only under fixtures/ with a narrow extension set.
      if (rest.startsWith('fixtures/')) {
        const tail = rest.slice('fixtures/'.length);
        if (tail.length === 0 || tail.endsWith('/')) return false;
        if (tail.includes('/')) return false;
        const dot = tail.lastIndexOf('.');
        if (dot < 0) return false;
        return S3_FIXTURE_EXTS.has(tail.slice(dot).toLowerCase());
      }
      return false;
    }
    function isAllowedS4Commit(p) {
      const prefix = 'tests/profile-commit/';
      if (!p.startsWith(prefix)) return false;
      const rest = p.slice(prefix.length);
      if (rest.length === 0 || rest.includes('/')) return false;
      return rest.endsWith('.mjs');
    }
    // S5 CLI/UI integration tests (P1-S5-R1 ticket-authorized T19
    // maintenance): direct .mjs files only — helpers plus one test module
    // per S5 concern. No nested code, no fixtures, no other directories.
    // S6 acceptance (P1-S6-R2 authorized): direct .mjs only under tests/profile-acceptance/ (helpers + deterministic/runtime tests). No nested, no other dirs.
    function isAllowedS6Acceptance(p) {
      const prefix = 'tests/profile-acceptance/';
      if (!p.startsWith(prefix)) return false;
      const rest = p.slice(prefix.length);
      if (rest.length === 0 || rest.includes('/')) return false;
      return rest.endsWith('.mjs');
    }
    function isAllowedS5CliUi(p) {
      const prefix = 'tests/profile-cli-ui/';
      if (!p.startsWith(prefix)) return false;
      const rest = p.slice(prefix.length);
      if (rest.length === 0 || rest.includes('/')) return false;
      return rest.endsWith('.mjs');
    }
    const foreign = untracked.filter(
      (u) => !allowed.has(u) && !(u.startsWith('tests/profile-reader/') && u.endsWith('.mjs')) && !isAllowedS3Render(u) && !isAllowedS4Commit(u) && !isAllowedS5CliUi(u) && !isAllowedS6Acceptance(u),
    );
    assert.deepEqual(foreign, [], `foreign untracked files:\n${untracked.join('\n')}`);
    assert.ok(untracked.includes('profile/config-reader.mjs'), 'S2 reader module missing');
    assert.ok(untracked.some((u) => u.startsWith('tests/profile-reader/')), 'S2 tests missing');
  });

  it('T19 accepted S1 files match their recorded bytes', () => {
    // Hashes recorded at S2 implementation start (S2 entry gate); any
    // S2-span edit of an S1 file breaks this tripwire.
    const recorded = new Map([
      ['profile/target-resolver.mjs', '1d72e8169fac2c89b9bcc9196c7e019a729eaa81204aa3ecee1e50db63ca06b1'],
      ['tests/profile-target/helpers.mjs', '535be36cad699d729c0eb5e9afde0aaf5ad9517b67b052eb7c2026a560c42c6f'],
      ['tests/profile-target/target-admission.test.mjs', 'c1d4cc56ddd7e2ed01844895b678d82921de9f49dd79c1fc36dc1a2d48db94a8'],
      ['tests/profile-target/boundary.test.mjs', 'b4b0638a77ade1deee4c8033c62225541e596745dd5de60c52b4e7439ed717ea'],
    ]);
    for (const [rel, hex] of recorded) {
      assert.ok(fs.existsSync(path.join(REPO, rel)), `S1 file vanished: ${rel}`);
      assert.equal(shaFile(rel), hex, `S1 file changed during S2: ${rel}`);
    }
  });
});
