// v1.4 compatibility / scope static tests (contract v1.4 sections 3, 6, 32,
// 110, 128) plus v1.3 identity preservation (§9, §181): sync.mjs and
// ui/index.html MUST stay byte-identical to the released v1.3 hashes.
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  assert,
  REPO_ROOT,
  PATCH_PATH,
  CLIENT_BUNDLE_PATH,
  sha256Hex,
  V13_SYNC_SHA,
  V13_UI_HTML_SHA,
} from './helpers.mjs';

const trackedFiles = () => {
  const out = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
};

// Marker literals are assembled from fragments so this scanner file does not
// itself contain the strings it forbids.
const STALE_MARKERS = [
  '.dsh' + '-plugin',
  'dsh' + '-plugin-prepare',
  '@deepseek-ai/dsh-repository' + '-plugin',
  '@cordisjs/plugin-loader' + '/repository',
];

function repoTexts() {
  const skip = new Set(['package-lock.json', 'pnpm-lock.yaml']);
  const files = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        if (name === 'node_modules' || name === '.git' || name === '.gate') continue;
        walk(full);
      } else {
        if (skip.has(name) || !/\.(mjs|js|json|yml|yaml|md|html)$/.test(name)) continue;
        files.push(full);
      }
    }
  };
  walk(REPO_ROOT);
  return files.map((f) => ({ f, text: fs.readFileSync(f, 'utf8') }));
}

test('no stale-plugin markers anywhere in tracked-repo text (§110)', () => {
  // Contract documents legitimately NAME the unsupported mechanisms in their
  // compatibility sections (gate §78); the scan forbids mechanism *usage*, so
  // contract md files are excluded from the scan by explicit name.
  const contractDocs = /Simple Script Contract v1\.[0-4]\.md$/;
  for (const { f, text } of repoTexts()) {
    if (contractDocs.test(f)) continue;
    for (const marker of STALE_MARKERS) {
      assert.ok(!text.includes(marker), 'stale marker "' + marker + '" must not appear in ' + path.relative(REPO_ROOT, f));
    }
  }
});

test('bundle manifest is ModuleLoader form: dsh.bundle.patch + dsh.client (§110)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.dsh, 'package.json must declare a dsh block');
  assert.equal(pkg.dsh.bundle?.patch, './cordis.patch.yml');
  assert.equal(pkg.dsh.client?.platform, 'web');
  assert.ok(Array.isArray(pkg.dsh.client?.inject), 'dsh.client.inject declared');
});

test('cordis.patch.yml contributes one ordinary Plugin row for ocms-s (§110)', () => {
  assert.ok(fs.existsSync(PATCH_PATH), 'cordis.patch.yml must exist at repo root');
  const text = fs.readFileSync(PATCH_PATH, 'utf8');
  assert.match(text, /-\s*insert:/, 'insert row present');
  assert.match(text, /id:\s*ocms-s/, 'patch row targets ocms-s');
  assert.match(text, /name:\s*['"]?ocms-s/, 'patch row names ocms-s');
});

// v1.4.4 DSH 0.2.1-alpha.2 target graph (implementation gate §5/§6).
// Exact only: no wildcard, caret, tilde, or range. Old 0.1.5-rc.x support is
// intentionally dropped, so the previous rc.2 pin is retired, not widened.
const DSH_TARGET_PEERS = Object.freeze({
  '@deepseek-ai/dsh-typert-protocol': '0.2.1-alpha.2',
  '@deepseek-ai/cordis': '4.0.5-alpha.1',
  '@deepseek-ai/schemastery': '3.18.5-alpha.1',
});
const RETIRED_PEER_VALUES = Object.freeze(['0.1.5-rc.2', '4.0.2', '3.18.2']);

test('package peers target DSH 0.2.1-alpha.2 exactly (old runtime dropped)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.peerDependencies, { ...DSH_TARGET_PEERS }, 'peerDependencies must equal the exact 0.2.1-alpha.2 triple');
  for (const [k, v] of Object.entries(pkg.peerDependencies)) {
    assert.doesNotMatch(String(v), /[\^~*]|>=|<=|x/, 'peer ' + k + ' must be exact (got ' + v + ')');
  }
  assert.equal(pkg.version, '1.4.7-rc7', 'release metadata per contract v1.4.7-rc6 section 6');
  assert.equal(pkg.engines?.dsh, '0.2.1-alpha.2', 'engines.dsh declares the exact supported DSH target');
});

test('lockfile root peers mirror package.json and root version is 1.4.7-rc7', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package-lock.json'), 'utf8'));
  assert.equal(lock.name, 'ocms-s', 'lock root name');
  assert.equal(lock.version, '1.4.7-rc7', 'lock root version must equal package version 1.4.7-rc7');
  const rootPkg = lock.packages?.[''];
  assert.ok(rootPkg, 'lockfileVersion 3 root package entry must exist');
  assert.equal(rootPkg.version, '1.4.7-rc7', 'lock root package version must equal package version 1.4.7-rc7');
  assert.deepEqual(rootPkg.peerDependencies, { ...DSH_TARGET_PEERS }, 'lock root peers must mirror package.json peers');
});

test('lockfile resolves the exact target peer versions', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package-lock.json'), 'utf8'));
  const entries = lock.packages ?? {};
  assert.equal(entries['node_modules/@deepseek-ai/cordis']?.version, '4.0.5-alpha.1', 'resolved cordis');
  assert.equal(entries['node_modules/@deepseek-ai/dsh-typert-protocol']?.version, '0.2.1-alpha.2', 'resolved typer protocol');
  assert.equal(entries['node_modules/@deepseek-ai/schemastery']?.version, '3.18.5-alpha.1', 'resolved schemastery');
});

test('no retired 0.1.5-era peer authority remains in peer declarations', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package-lock.json'), 'utf8'));
  for (const block of [pkg.peerDependencies ?? {}, lock.packages?.['']?.peerDependencies ?? {}]) {
    for (const [k, v] of Object.entries(block)) {
      for (const retired of RETIRED_PEER_VALUES) {
        assert.notEqual(String(v), retired, 'retired peer value ' + retired + ' must not remain for ' + k);
      }
    }
  }
});

test('compatibility metadata declares engines.dsh == "0.2.1-alpha.2" (release metadata, not peer admission)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.engines?.dsh, '0.2.1-alpha.2', 'engines.dsh must equal the exact supported DSH target');
  assert.ok(pkg.peerDependencies?.['@deepseek-ai/dsh-typert-protocol'], 'exact peers remain the admission authority');
});

test('no broad DSH version ranges (§16)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  for (const block of [pkg.dependencies ?? {}, pkg.devDependencies ?? {}, pkg.peerDependencies ?? {}]) {
    for (const [k, v] of Object.entries(block)) {
      if (k.startsWith('@deepseek-ai/dsh')) {
        assert.doesNotMatch(String(v), /[\^~*]|>=|<=|x/, 'constraint for ' + k + ' must be exact: ' + v);
      }
    }
  }
});

// v1.4.1 supersession (contract v1.4.1 §14: sync.mjs planner/report scope +
// required unsupported-protocol report rendering are the authorized v1.4.1
// change surface). The v1.3 byte-identity pins above are therefore superseded
// for exactly these two files; the pins below guard against any further
// unreviewed drift under v1.4.1.
const V141_SYNC_SHA = 'cdd56032042775b39e3c09628e8988ef0ce7d6aa45fd9614196189157ef12b7d';
const V141_UI_HTML_SHA = 'd2383cd3fb545da64dd51a21ad570f1944fee95e8caf8c98286d9d8d85919658';
// S5-R4 final-reviewed pins (P1-S5-R4 G2-A/B). Computed from final post-repair source.
const S5R4_SYNC_SHA = '1e14051f400a1eeb7e4c368de5bca5c2c536727a2026a626925dc065591d7935';
// v1.4.6-rc1 pin (contract v1.4.6-rc1 §7): supersedes the S5-R4 sync.mjs pin,
// which the uncommitted R1 docs-URL repair had already invalidated.
const RC1_SYNC_SHA = 'e348ad7456e6ea2ddb83515c34a9a444e9d602051721325cf81283f039b70bad';
// v1.4.6-rc2 pins (contract v1.4.6-rc2 §9): supersede the RC1 sync.mjs pin and
// the S5-R4 ui/index.html pin, which R2 requires changing. The superseded
// tests below become skips citing rc2, as rc1 did.
const RC2_SYNC_SHA = '765a56ee26c165be05ab50b2d25ef7cd38b1e53355d328a0228ad6daf5e512f4';
// v1.4.7-rc1 pin (contract v1.4.7-rc1 G5): supersedes the RC2 sync.mjs pin,
// which G1 (inference/go base) and G2 (unknown-base distinction) require
// changing. Named reason: docs-move plus fail-closed block.
const RC1GATE_SYNC_SHA = '99e4f9dc78bbaf31a26692fd045f319509d9565bfd20f7419cbe5681a4b34b75';
// v1.4.7-rc1 Amendment A A4 pin: surgical-render.mjs had no byte pin. Named
// reason: G3 empty-list line ending.
const RC1GATE_RENDER_SHA = 'bd2884fd33abf0e6495bd356463da932728ae11983fb67c98afb0f7d9e4eea86';
const RC2_UI_HTML_SHA = '5979979d8d13d556a5dada32814fe6fb22e39810a27b39fdadb2ff0235ca3321';
const S5R4_UI_HTML_SHA = '5a8c4a233860fae364f115e46c1dfba1c4cb17e1ca87ec1b6a64abeefbe97bac';

test('v1.3 identity: sync.mjs byte-identical to released v1.3 (§115/§181)', { skip: 'superseded by contract v1.4.1 §14 scope (see v1.4.1 pins below)' }, () => {
  const sha = sha256Hex(fs.readFileSync(path.join(REPO_ROOT, 'sync.mjs')));
  assert.equal(sha, V13_SYNC_SHA, 'sync.mjs must remain byte-identical to the released v1.3 hash');
});

test('v1.3 identity: ui/index.html byte-identical to released v1.3 (§116/§181)', { skip: 'superseded by contract v1.4.1 §14 scope (see v1.4.1 pins below)' }, () => {
  const sha = sha256Hex(fs.readFileSync(path.join(REPO_ROOT, 'ui', 'index.html'), 'utf8'));
  assert.equal(sha, V13_UI_HTML_SHA, 'ui/index.html must remain byte-identical to the released v1.3 hash');
});

test('s5-r4 identity: sync.mjs pinned to the final-reviewed S5-R4 bytes', { skip: 'superseded by contract v1.4.6-rc1 §7 (see rc1 pin below)' }, () => {
  const sha = sha256Hex(fs.readFileSync(path.join(REPO_ROOT, 'sync.mjs')));
  assert.equal(sha, S5R4_SYNC_SHA, 'sync.mjs drift beyond the final-reviewed S5-R4 implementation is forbidden');
});

test('v1.4.6-rc1 identity: sync.mjs pinned to the rc1 bytes', { skip: 'superseded by contract v1.4.6-rc2 §9 (see rc2 pin below)' }, () => {
  const sha = sha256Hex(fs.readFileSync(path.join(REPO_ROOT, 'sync.mjs')));
  assert.equal(sha, RC1_SYNC_SHA, 'sync.mjs drift beyond the v1.4.6-rc1 implementation is forbidden');
});

test('s5-r4 identity: ui/index.html pinned to the final-reviewed S5-R4 bytes', { skip: 'superseded by contract v1.4.6-rc2 §9 (see rc2 pin below)' }, () => {
  const sha = sha256Hex(fs.readFileSync(path.join(REPO_ROOT, 'ui', 'index.html'), 'utf8'));
  assert.equal(sha, S5R4_UI_HTML_SHA, 'ui/index.html drift beyond the final-reviewed S5-R4 implementation is forbidden');
});

test('v1.4.6-rc2 identity: sync.mjs pinned to the rc2 bytes', { skip: 'superseded by contract v1.4.7-rc1 G5 (see rc1 pin below)' }, () => {
  const sha = sha256Hex(fs.readFileSync(path.join(REPO_ROOT, 'sync.mjs')));
  assert.equal(sha, RC2_SYNC_SHA, 'sync.mjs drift beyond the v1.4.6-rc2 implementation is forbidden');
});

test('v1.4.7-rc1 identity: sync.mjs pinned to the rc1 bytes', { skip: 'superseded by contract v1.4.7-rc2 Amendment A A1 (see rc2 pin below)' }, () => {
  const sha = sha256Hex(fs.readFileSync(path.join(REPO_ROOT, 'sync.mjs')));
  assert.equal(sha, RC1GATE_SYNC_SHA, 'sync.mjs drift beyond the v1.4.7-rc1 implementation is forbidden');
});

test('v1.4.7-rc2 identity: sync.mjs pinned to the rc2 bytes', { skip: 'superseded by contract v1.4.7-rc2 Amendment B B4 (see B pin below)' }, () => {
  const sha = sha256Hex(fs.readFileSync(path.join(REPO_ROOT, 'sync.mjs')));
  assert.equal(sha, '200b2b6d6952d96d2d2b19c474fa9ab57f74c100afd41e85f19c2ee0aa932284', 'sync.mjs drift beyond the v1.4.7-rc2 implementation is forbidden');
});

test('v1.4.7-rc2 Amendment B identity: sync.mjs pinned to the B bytes', { skip: 'superseded by contract v1.4.7-rc5 section 5 (see rc5 pin below)' }, () => {
  const sha = sha256Hex(fs.readFileSync(path.join(REPO_ROOT, 'sync.mjs')));
  assert.equal(sha, 'b686f64b47007d3f0046f70520e594afc08d217bc87d36dfd9bf6bc357fb4026', 'sync.mjs drift beyond the v1.4.7-rc2 Amendment B implementation is forbidden');
});

// Re-pinned by the C02/C03 defect fix (named reason: the legacy --settings CLI
// exited 0 on every refusal and never printed the final UPDATED / NO CHANGE
// verdict; main() now reports the verdict and exits 1 on refusal). The pin
// keeps guarding the CURRENT reviewed bytes after that change.
// Re-pinned by the C05 defect fix (missing --settings exits 2 with verdict
// plus usage; YAML parse errors are coded SETTINGS_INVALID), the D04 defect
// fix (unique backup names per tick), and the D05 defect fix (legacy Apply
// preserves comments via document edit).
test('v1.4.7-rc5 identity: sync.mjs pinned to the rc5 bytes plus the C02/C03 verdict fix', () => {
  const sha = sha256Hex(fs.readFileSync(path.join(REPO_ROOT, 'sync.mjs')));
  // Re-pinned by the P1 defect fix (report C14; named reason: the legacy
  // default settings path no longer falls back to a literal machine path).
  // Re-pinned by S8 digest-numerics (named reason: canonicalJson maps non-finite numbers to distinct bare tokens instead of collapsing onto 'null', and the reader gains the bigint arm; identical rule in all three copies). Superseded pin a89f9bcdb35b8efa52ffa8a7ca658bff2f632e485b60a4482b13c59d70c4b478.
  // Re-pinned by S9 confirm-eof (named reason: defaultConfirmCli settles on readline close, so Ctrl-D/EOF declines through the verdict path instead of hanging forever). Superseded pin 5934a809cba70a4b65f380619271fb281178617d08081a75e36eeb27776cc34f.
  // Re-pinned by S10 preview-display-swallow (named reason: a failed Preview display refuses PREVIEW_DISPLAY_FAILED instead of continuing to confirm and Apply blind). Superseded pin 3b940afa7aaa5730b8891a93cbd0f5ace77529b5b12f1bfd8093e5a80defad43.
  // Re-pinned by C1 legacy-tmp-race (named reason: unique per-commit temp plus finally cleanup instead of the fixed shared <settings>.tmp). Superseded pin 8bd44f458a0cf500b8ab18a603b6eb62000a72a898d11de491b20e13cba9ed17.
  // Re-pinned by NB1 inference bases (named reason: the live Go/Zen docs moved every
  // endpoint-table row onto per-provider /inference/... bases, so DOC_ENDPOINT_BASES gains
  // /inference/go/openai/v1/, /inference/go/anthropic/v1/, /inference/go/google/v1beta/ for go
  // and /inference/openai/v1/, /inference/anthropic/v1/, /inference/google/v1beta/,
  // /inference/systemone/v1/ for zen; old bases retained, fail-closed matching unchanged).
  // Superseded pin 6c3a335a9129e31490f671595bc7f2c2b5eebf3a51c95ee454f6682745ddd95e.
  assert.equal(sha, '1fb8014cdb4f164860cae6573ef38bfc1ab671ad16061e72ea26610db2fe40a3', 'sync.mjs drift beyond the C02/C03 verdict fix is forbidden');
});

test('v1.4.7-rc2 Amendment B identity: plan-builder pinned to the B bytes', () => {
  const sha = sha256Hex(fs.readFileSync(path.join(REPO_ROOT, 'profile', 'plan-builder.mjs')));
  // Re-pinned by S8 digest-numerics (named reason: canonicalJson maps non-finite numbers to distinct bare tokens instead of collapsing onto 'null', and the reader gains the bigint arm; identical rule in all three copies). Superseded pin 0bd80eca74a5e967cfd6e8fd1430ff9eef6c723b7ed380834f88685b83c53198.
  assert.equal(sha, 'ee428f453e5ff91c9281e708e66a0fc580bdb61417f1c75e8f6b3a3607c85548', 'plan-builder drift beyond the v1.4.7-rc2 Amendment B implementation is forbidden');
});

test('v1.4.7-rc1 Amendment A identity: surgical-render pinned to the rc1 bytes', { skip: 'superseded by the C04/D01 CRLF indentBlock fix (see the C04 pin below)' }, () => {
  const sha = sha256Hex(fs.readFileSync(path.join(REPO_ROOT, 'profile', 'surgical-render.mjs')));
  assert.equal(sha, RC1GATE_RENDER_SHA, 'surgical-render drift beyond the v1.4.7-rc1 implementation is forbidden');
});

// Re-pinned by the C04/D01 defect fix (named reason: indentBlock owns the
// line-ending join, and three call sites pre-converted block text to the file
// eol, so an F1-add or F2 render on a CRLF patch emitted a stray CR per line
// and refused GENERATED_MEMBERSHIP_MISMATCH).
// Re-pinned by the B1 defect fix (same-line separator span), the B2 defect
// fix (bare models key), the B4 defect fix (alias-inside refusal), and the
// D07 defect fix (same-offset F1-add/F2 merge).
test('C04 identity: surgical-render pinned after the CRLF indentBlock fix', () => {
  const sha = sha256Hex(fs.readFileSync(path.join(REPO_ROOT, 'profile', 'surgical-render.mjs')));
  assert.equal(sha, '6b9ad428030f47b6b9417901b68bca459a292eb4e6e966217a6631fffa61dd2f', 'surgical-render drift beyond the C04/D01 CRLF fix is forbidden');
});

test('v1.4.6-rc2 identity: ui/index.html pinned to the rc2 bytes', { skip: 'superseded by contract v1.4.7-rc2 U5 (see rc2 pin below)' }, () => {
  const sha = sha256Hex(fs.readFileSync(path.join(REPO_ROOT, 'ui', 'index.html'), 'utf8'));
  assert.equal(sha, RC2_UI_HTML_SHA, 'ui/index.html drift beyond the v1.4.6-rc2 implementation is forbidden');
});

test('v1.4.7-rc2 identity: ui/index.html pinned to the rc2 bytes', { skip: 'superseded by contract v1.4.7-rc3 V7 (see rc3 pin below)' }, () => {
  const sha = sha256Hex(fs.readFileSync(path.join(REPO_ROOT, 'ui', 'index.html'), 'utf8'));
  assert.equal(sha, '1836648bcf546fc09393481649899262a22bc0d13da4ddcd8b15541e81d46807', 'ui/index.html drift beyond the v1.4.7-rc2 implementation is forbidden');
});

test('v1.4.7-rc3 identity: ui/index.html pinned to the rc3 bytes', { skip: 'superseded by contract v1.4.7-rc4 V (see rc4 pin below)' }, () => {
  const sha = sha256Hex(fs.readFileSync(path.join(REPO_ROOT, 'ui', 'index.html'), 'utf8'));
  assert.equal(sha, '39f0a36151c1ce37a2551b2fd18d1cc293c9a529b2ab407fbf3a461ed569a5cc', 'ui/index.html drift beyond the v1.4.7-rc3 PixelCrafts look plus V5 display fixes is forbidden');
});

test('v1.4.7-rc4 identity: ui/index.html pinned to the rc4 bytes', { skip: 'superseded by contract v1.4.7-rc5 section 5 (see rc5 pin below)' }, () => {
  const sha = sha256Hex(fs.readFileSync(path.join(REPO_ROOT, 'ui', 'index.html'), 'utf8'));
  assert.equal(sha, 'ae3c0aff69f5a90367bdc23f44ca93bf8fcbf0be6fe24d24f441f745a43ffab9', 'ui/index.html drift beyond v1.4.7-rc4 plus density Amendment B plus Amendment C counters and lede is forbidden');
});

// Re-pinned by the C07/C25 fix (named reason: profile confirmation badge/path
// and the APPLYING restore on a busy refusal). The rc5 pin below is superseded.
test('C07/C25 identity: ui/index.html pinned after the confirmation fix', () => {
  const sha = sha256Hex(fs.readFileSync(path.join(REPO_ROOT, 'ui', 'index.html'), 'utf8'));
  assert.equal(sha, 'f4db7da417ce1d69a65ed50bdc68e3666c8c96fbc4f6781b6dc82a976a32ada8', 'ui/index.html drift beyond the C07/C25 fix is forbidden');
});

test('v1.4.7-rc5 identity: ui/index.html pinned to the rc5 bytes', { skip: 'superseded by the C07/C25 confirmation fix (see the C07/C25 pin above)' }, () => {
  const sha = sha256Hex(fs.readFileSync(path.join(REPO_ROOT, 'ui', 'index.html'), 'utf8'));
  assert.equal(sha, '4e8491022f5c0f1b4cc5493434a32d56a7f46abd1f752c6905114e129b8fc2c0', 'ui/index.html drift beyond the v1.4.7-rc5 withdrawn-docs reason rows is forbidden');
});

test('built client bundle carries the __ModuleLoader__ convention and no second React (§119/§121)', { skip: !fs.existsSync(CLIENT_BUNDLE_PATH) ? 'capability missing: dsh/client.js not built yet' : false }, () => {
  const text = fs.readFileSync(CLIENT_BUNDLE_PATH, 'utf8');
  assert.match(text.slice(0, 400), /window\.__ModuleLoader__\.load/, 'bundle opens with the ModuleLoader banner');
  assert.doesNotMatch(text, /https?:\/\/[^'"]*(?:cdn|unpkg|jsdelivr)/i, 'no CDN runtime references');
  // Shared react is resolved through the loader require, not inlined.
  assert.ok(!/react-development|react-dom[^/]*\.min\.js/.test(text), 'no vendored react runtime copy');
});

test('root package version is 1.4.7-rc7 at release candidate', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '1.4.7-rc7');
});
