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
  assert.equal(pkg.version, '1.4.6-rc5', 'release metadata per contract v1.4.6-rc5 \u00a78');
  assert.equal(pkg.engines?.dsh, '0.2.1-alpha.2', 'engines.dsh declares the exact supported DSH target');
});

test('lockfile root peers mirror package.json and root version is 1.4.6-rc5', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package-lock.json'), 'utf8'));
  assert.equal(lock.name, 'ocms-s', 'lock root name');
  assert.equal(lock.version, '1.4.6-rc5', 'lock root version must equal package version 1.4.6-rc5');
  const rootPkg = lock.packages?.[''];
  assert.ok(rootPkg, 'lockfileVersion 3 root package entry must exist');
  assert.equal(rootPkg.version, '1.4.6-rc5', 'lock root package version must equal package version 1.4.6-rc5');
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

test('v1.4.6-rc2 identity: sync.mjs pinned to the rc2 bytes', () => {
  const sha = sha256Hex(fs.readFileSync(path.join(REPO_ROOT, 'sync.mjs')));
  assert.equal(sha, RC2_SYNC_SHA, 'sync.mjs drift beyond the v1.4.6-rc2 implementation is forbidden');
});

test('v1.4.6-rc2 identity: ui/index.html pinned to the rc2 bytes', () => {
  const sha = sha256Hex(fs.readFileSync(path.join(REPO_ROOT, 'ui', 'index.html'), 'utf8'));
  assert.equal(sha, RC2_UI_HTML_SHA, 'ui/index.html drift beyond the v1.4.6-rc2 implementation is forbidden');
});

test('built client bundle carries the __ModuleLoader__ convention and no second React (§119/§121)', { skip: !fs.existsSync(CLIENT_BUNDLE_PATH) ? 'capability missing: dsh/client.js not built yet' : false }, () => {
  const text = fs.readFileSync(CLIENT_BUNDLE_PATH, 'utf8');
  assert.match(text.slice(0, 400), /window\.__ModuleLoader__\.load/, 'bundle opens with the ModuleLoader banner');
  assert.doesNotMatch(text, /https?:\/\/[^'"]*(?:cdn|unpkg|jsdelivr)/i, 'no CDN runtime references');
  // Shared react is resolved through the loader require, not inlined.
  assert.ok(!/react-development|react-dom[^/]*\.min\.js/.test(text), 'no vendored react runtime copy');
});

test('root package version is 1.4.6-rc5 at release candidate', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '1.4.6-rc5');
});
