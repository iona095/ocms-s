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

test('bundle manifest is rc.2 form: dsh.bundle.patch + dsh.client (§110)', () => {
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

test('DSH dependency constraints pinned exactly to 0.1.5-rc.2 (§16/§120)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const blocks = [pkg.devDependencies ?? {}, pkg.peerDependencies ?? {}];
  const pins = [];
  for (const block of blocks) for (const [k, v] of Object.entries(block)) if (k.startsWith('@deepseek-ai/')) pins.push([k, v]);
  assert.ok(pins.length > 0, 'at least one exact DSH pin must exist for the bundle');
  // Contract §120 scopes the rc.2 pin to DSH packages; cordis/schemastery
  // carry their own independent versioning lines and must simply be exact.
  for (const [k, v] of pins) {
    if (k.startsWith('@deepseek-ai/dsh-')) assert.equal(v, '0.1.5-rc.2', k + ' pinned exactly to rc.2 (got ' + v + ')');
    else assert.doesNotMatch(String(v), /[\^~*]|>=|<=|x/, k + ' must be pinned exactly (got ' + v + ')');
  }
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

test('v1.3 identity: sync.mjs byte-identical to released v1.3 (§115/§181)', () => {
  const sha = sha256Hex(fs.readFileSync(path.join(REPO_ROOT, 'sync.mjs')));
  assert.equal(sha, V13_SYNC_SHA, 'sync.mjs must remain byte-identical to the released v1.3 hash');
});

test('v1.3 identity: ui/index.html byte-identical to released v1.3 (§116/§181)', () => {
  const sha = sha256Hex(fs.readFileSync(path.join(REPO_ROOT, 'ui', 'index.html'), 'utf8'));
  assert.equal(sha, V13_UI_HTML_SHA, 'ui/index.html must remain byte-identical to the released v1.3 hash');
});

test('built client bundle carries the rc.2 __ModuleLoader__ convention and no second React (§119/§121)', { skip: !fs.existsSync(CLIENT_BUNDLE_PATH) ? 'capability missing: dsh/client.js not built yet' : false }, () => {
  const text = fs.readFileSync(CLIENT_BUNDLE_PATH, 'utf8');
  assert.match(text.slice(0, 400), /window\.__ModuleLoader__\.load/, 'bundle opens with the rc.2 ModuleLoader banner');
  assert.doesNotMatch(text, /https?:\/\/[^'"]*(?:cdn|unpkg|jsdelivr)/i, 'no CDN runtime references');
  // Shared react is resolved through the loader require, not inlined.
  assert.ok(!/react-development|react-dom[^/]*\.min\.js/.test(text), 'no vendored react runtime copy');
});

test('root package version is 1.4.0 at release', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '1.4.0');
});
