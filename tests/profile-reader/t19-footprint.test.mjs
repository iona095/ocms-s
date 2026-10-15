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
    // v1.4.7-rc5 reviewed bytes with named reason: withdrawn-docs removals (W1 rescue plus DOCS_WITHDRAWN plumbing). Prior rc4 reasons (work-first layout plus
    // remembered profile (P1 grammar equals the server validator) plus density
    // Amendment B (one-row header, full-width grid) plus Amendment C counters
    // and lede (base 4-across, lime lede)).
    // SPEC text unchanged. All other
    // forbidden files stay binding; no wildcards, no directory exemptions
    // beyond the §10-authorized version-bump files below.
    const CURRENT_PINS = new Map([
      // Re-pinned by the C05 defect fix (named reason: missing --settings
      // exits 2 with verdict plus usage; YAML parse errors are coded
      // SETTINGS_INVALID and surface in the legacy verdict).
      // Re-pinned by the D04 defect fix (named reason: backup names stay
      // unique inside one timestamp tick via legacyBackupPath).
      // Re-pinned by the D05 defect fix (named reason: legacy Apply edits
      // managed arrays inside the existing document via surgicalLegacyUpdate
      // so comments, key order, and unrelated styling survive the write).
      // Re-pinned by the P1 defect fix (report C14; named reason: the legacy default
// settings path resolves USERPROFILE, then DSH_HOME, then refuses with a typed
// error instead of falling back to a literal machine path).
 // Re-pinned by S8 digest-numerics (named reason: canonicalJson maps non-finite numbers to distinct bare tokens instead of collapsing onto 'null', and the reader gains the bigint arm; identical rule in all three copies). Superseded pin a89f9bcdb35b8efa52ffa8a7ca658bff2f632e485b60a4482b13c59d70c4b478.
      // Re-pinned by S9 confirm-eof (named reason: defaultConfirmCli settles on readline close, so Ctrl-D/EOF declines through the verdict path instead of hanging forever). Superseded pin 5934a809cba70a4b65f380619271fb281178617d08081a75e36eeb27776cc34f.
      ['sync.mjs', '3b940afa7aaa5730b8891a93cbd0f5ace77529b5b12f1bfd8093e5a80defad43'],


      // Re-pinned by the 0b/D3 lock-label fix (named reason: an unexpected
      // lock-acquisition failure was blanket-labeled INCOMPATIBLE_DSH; it is
      // now VERIFY_FAILED while native LOCK_TIMEOUT detection is unchanged).
      // Re-pinned by S3 refusal-taxonomy: S3 refusal-taxonomy (bugfix-8model): PROFILE_NOT_INITIALIZED and SYMLINK_ESCAPE added to COMMIT_REFUSAL_CODES; the re-resolve pass-through now carries the vanished-profile refusal with status BLOCKED. Superseded pin e08abf377fdf4934b7799a11aebef169ba7d5fc2d9fde0158c8bfa84e2a331e3.
      ['profile/commit.mjs', '281fc369c37208b899d010dcd98a4362d5cc62760f0a0efffefa41841b01d673'], // 0b follow-up: LOCK_TIMEOUT code is recognized alongside the native sentence. B5 follow-up: anchorRows shares anchorNameBesideFile and covers top-level rows.

      // Re-pinned by the C08/D02 defect fix (named reason: the profile Apply
      // handler awaited verifyProfileApplySelection against the mutable
      // activePreview slot and then committed activePreview.plan; it now captures
      // the retained preview before the await, commits the captured plan and
      // re-checks the slot). The pin keeps guarding the CURRENT reviewed bytes.
      // Re-pinned by the 0d ephemeral-port seam (named reason: programmatic
      // startServer accepts loopback port 0 for OS-assigned test ports; CLI
      // --port=0 remains a usage error).
      // Re-pinned by S4 legacy-apply-500 (named reason: a NOT WRITTEN legacy commit is now the typed 409 NOT_WRITTEN refusal with its reasons; 500 remains for unexpected throws). Superseded pin ab89c3fac719f116200c06caeea892ff8f8a915bfbc2c08416cb7be0edcbe2ac.
      // Re-pinned by S5 open-browser-error (named reason: the browser opener child always carries an 'error' listener, so a missing opener cannot crash the server). Superseded pin 99cbd2fb30578fb50a9dc0e2a83f4908e9cbcc144dda1c562517fd6adf4719a4.
      ['ui.mjs', '9eda134dc30936cea1dab05ec4f895facc3bf15de76c5b7b0ed325ce79874577'],

      // Re-pinned by the C09/C10 refusal hardening (named reason: a JSON null body
      // reached Object.keys as a 500, and an EXACT_OVERLAYS attestation without an
      // overlays array either spread a string per character or threw a TypeError
      // that surfaced as a 500; both are now typed 400 refusals).
      ['profile/preview-session.mjs', '7863d287a36f863ecd96842b710089c4cc1477ea29b0dd7399bd13a5dd4a27f1'],
      // Re-pinned by the C07/C25 confirmation and busy-state fix (named reason:
      // the confirmation dialog showed UNKNOWN for profile targets, suppressed the
      // PRODUCTION warning, and a 409 busy Apply left the page in APPLYING).
      ['ui/index.html', 'f4db7da417ce1d69a65ed50bdc68e3666c8c96fbc4f6781b6dc82a976a32ada8'],
      // Re-pinned by K5 lifecycle-misc (named reason: EXTERNAL is emitted with
      // its message assigned, ERROR to OFFLINE drops the stale message, the
      // disposed-during-probe OFFLINE re-assertion is guarded, the dead
      // STARTING/STOPPING busy guard is removed, spawn returns are validated,
      // close reconciles error retention, and F7 liveness checks precede the
      // readiness break).
      ['dsh/lifecycle.mjs', 'cee594647186d708e2186cae76ebe2c089dd19a8d58d6fd0b4cdf6b4dd6c37de'],
      // Re-pinned by K5 lifecycle-misc (named reason: an invalid configured
      // port still falls back to the default but now names the rejected value
      // in a warn diagnostic instead of substituting silently).
      // Re-pinned by K7 client-seq-persistence (named reason: the bundle footer
      // now passes useRef through so the status sequence guard survives
      // re-renders; transform and banner untouched).
      ['dsh/build-client.mjs', '29a3cea74ed2c9170c4b7be0f4472b3ff407ce42badd61dd3478c648c1ba6234'],
      ['dsh/host.mjs', '537b90b5c462143bf5e68b91ef5b89d000f7124816641f6a84bd3e0ffc0d7900'],
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
    //
    // profile/target-resolver.mjs re-pinned by v1.4.7-rc6 §5 with the named
    // reason "version-skew reproducibility (v1.4.7-rc6 §5)": EXPECTED_VERSIONS
    // became exact-membership sets so cordis-plugin-include admits exactly
    // {1.0.10-alpha.1, 1.0.10-alpha.2}. No other behaviour changed.
    // Re-pinned by the B5 defect fix with the named reason: row-name
    // anchoring is now shared (anchorNameBesideFile) so S1 binding identity
    // and S2 composition agree on every row's address.
    const recorded = new Map([
      // Re-pinned by S6 baseline-divergence (named reason: the dsh baseline now uses the config-reader/commit candidate loop, skipping skewed or misnamed candidates so a top-level dsh cannot shadow a valid pinned nested scope). Superseded pin 86851a249e638ebbf8996bcd2eb0e2a2cd72df0a112b9d9486eb78fafff00a20.
      ['profile/target-resolver.mjs', 'dbd861995c87e63d15a8ca1a38cb22a7bdf35a5d730151058f80bbc581e9ff8a'],
      ['tests/profile-target/helpers.mjs', '535be36cad699d729c0eb5e9afde0aaf5ad9517b67b052eb7c2026a560c42c6f'],
      ['tests/profile-target/target-admission.test.mjs', 'ed8225f5c92461768b92b8a6571bd22720d5f54dfefedee79572f37564883ed5'],
      // Re-pinned by the B5 follow-up (named reason: the S1 export
      // allowlist admits the intentional anchorNameBesideFile export).
      ['tests/profile-target/boundary.test.mjs', '3e95d853f2dc5aacd5e5642387fbcfc3667f80b9bfd4c466a2f8d854f92f9d2a'],
    ]);
    for (const [rel, hex] of recorded) {
      assert.ok(fs.existsSync(path.join(REPO, rel)), `S1 file vanished: ${rel}`);
      assert.equal(shaFile(rel), hex, `S1 file changed during S2: ${rel}`);
    }
  });
});
