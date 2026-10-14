// OCMS-S v1.4.7-rc6 §5(b) RED test: recorded evidence reports the OBSERVED
// dependency version, never the expected constant (contract v1.4.7-rc6 §5(b),
// §7 item 2).
//
// The manifest-only anchors of skew-admission.test.mjs can never reach a
// successful composition: a manifest-only anchor has no library entry, so both
// resolveCompositionUtils and resolveCommitUtils stop at util-entry-unresolvable
// and no version record is ever produced. This file supplies the missing half —
// stub-library anchors — so the composition path runs to completion and the
// versions it RECORDS can be read back and compared with the manifest bytes.
//
// Hermetic by construction:
//   - every fixture lives under os.tmpdir (fresh mkdtemp per case) and is
//     removed afterwards; the real DSH home, the real ~/.dsh and any PATH dsh
//     are never consulted (every call passes an explicit installAnchorDir and
//     an explicit empty pathEnv, and DSH_HOME is sandboxed);
//   - the anchor carries MANIFESTS plus two stub ESM entries and one stub CJS
//     YAML dialect, written by this test. No @deepseek-ai package code is
//     copied, imported or executed, and no network call is made;
//   - each stub exports exactly the symbols resolveCompositionUtils checks
//     after import (profile/config-reader.mjs:497-521) and nothing else:
//       dsh-app-boot          -> loadProfileDirectory, readProfilePatches,
//                                composeEntries
//       cordis-plugin-include -> entryListSchema (a non-null object)
//       js-yaml (CJS, via     -> load(text, opts), resolved by the product
//       createRequire on the   createRequire(includeEntry)('js-yaml') call at
//       include entry)         profile/config-reader.mjs:515)
//   - the js-yaml stub is a text-keyed fixture dialect: it returns the rows
//     this test wrote for that exact patch text and throws for anything else,
//     so it can never quietly stand in for a real parser.
//
// Every assertion below compares against the OBSERVED manifest version (read
// back from the anchor bytes by this test) or a literal, never against the
// product's EXPECTED_VERSIONS constant.
//
// Why there is no commit-path case here: the commit path records NO versions.
// profile/commit.mjs:151 returns `anchor: { kind, scopeDir, installAnchor }`
// from resolveCommitUtils — no versions field — and the identifier `versions`
// does not occur anywhere in profile/commit.mjs (`grep -c versions
// profile/commit.mjs` is 0), so there is nothing for a §5(b) assertion to
// read back on that path. Only the composition path records
// versions['cordis-plugin-include'] (profile/config-reader.mjs:456-457, 479-482
// and the copy returned at profile/config-reader.mjs:957).
import { describe, it, beforeEach, afterEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { readManagedConfig } from '../../profile/config-reader.mjs';
import { resolveProfileTarget } from '../../profile/target-resolver.mjs';
import {
  assert,
  makeTempHome,
  sandboxDshHome,
  PINNED,
  INCLUDE_ALPHA_1,
  INCLUDE_ALPHA_2,
  refusalText,
} from './skew-fixtures.mjs';

// The two admitted include versions as OBSERVED values. These are the bytes in
// the anchor manifests; they are deliberately not read from the product.
const OBSERVED_ALPHA_1 = '1.0.10-alpha.1';
const OBSERVED_ALPHA_2 = '1.0.10-alpha.2';
assert.equal(INCLUDE_ALPHA_1, OBSERVED_ALPHA_1);
assert.equal(INCLUDE_ALPHA_2, OBSERVED_ALPHA_2);

const FIXTURE_LLM_NAME = '@fixture/dsh-llm-fixture';
const FIXTURE_BUNDLE_PKG = '@fixture/base';

// The single user-owned llm-pi-ai row every case composes.
const LLM_ROW = { id: 'llm-pi-ai', name: FIXTURE_LLM_NAME, config: { providers: {} } };
const PATCH_TEXT = stringifyYaml([LLM_ROW]);

// dsh-app-boot stub: the three readers resolveCompositionUtils checks for
// (profile/config-reader.mjs:497-503) and nothing else.
const APP_BOOT_STUB = `// rc6 stub library — fixture code, not DSH code.
export function loadProfileDirectory(appId, profileDir, installAnchor, options) {
  return {
    appId,
    profileDir,
    installAnchor,
    userLayer: options && options.userLayer === true,
    layers: [],
    skippedBundles: [],
  };
}

export function readProfilePatches(appId, context, initial) {
  const layers = initial && Array.isArray(initial.layers) ? initial.layers : [];
  const patches = initial && Array.isArray(initial.patches) ? initial.patches : [];
  return [...layers.flatMap((layer) => (Array.isArray(layer.patches) ? layer.patches : [])), ...patches];
}

// Merge by row id, later rows win, insertion order preserved: the minimum
// composition semantics the reader needs to project the llm-pi-ai row.
export function composeEntries(patchLists) {
  const merged = new Map();
  const order = [];
  for (const list of patchLists) {
    for (const row of Array.isArray(list) ? list : []) {
      if (!row || typeof row !== 'object' || typeof row.id !== 'string') continue;
      if (!merged.has(row.id)) order.push(row.id);
      merged.set(row.id, row);
    }
  }
  return order.map((id) => merged.get(id));
}
`;

// cordis-plugin-include stub: the entry-list schema object, nothing else.
const INCLUDE_STUB = `// rc6 stub library — fixture code, not DSH code.
export const entryListSchema = { type: 'rc6-fixture-entry-list-schema' };
`;

// js-yaml stub, resolved through the product's own createRequire call from the
// include entry. Text-keyed: the exact fixture texts and their parsed rows are
// baked in by this test; any other text throws (the reader then refuses
// PATCH_PARSE_ERROR — a loud failure, never a silent fallback).
const jsYamlStub = (texts) => `// rc6 stub library — fixture code, not DSH code.
'use strict';
const FIXTURE_ROWS = ${JSON.stringify(texts, null, 2)};

function load(text, options) {
  const key = String(text);
  if (!Object.prototype.hasOwnProperty.call(FIXTURE_ROWS, key)) {
    throw new Error('rc6 stub js-yaml: no fixture rows for this patch text');
  }
  void options;
  return structuredClone(FIXTURE_ROWS[key]);
}

module.exports = { load, loadAll: () => { throw new Error('rc6 stub js-yaml: loadAll is not part of this fixture'); } };
`;

const writeFile = (file, body) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, 'utf8');
};

// Stub-library anchor under os.tmpdir: manifests for the S1 admission set plus
// stub library entries for everything the composition path imports.
// Returns the scope dir (<root>/@deepseek-ai), the same shape
// admitDependencyPackages expects.
function makeStubAnchor(root, { include }) {
  const scope = path.join(root, '@deepseek-ai');
  const manifests = {
    'dsh-atomic-write': PINNED['dsh-atomic-write'],
    'dsh-app-boot': PINNED['dsh-app-boot'],
    'cordis-plugin-include': include,
    dsh: PINNED.dsh,
  };
  for (const [pkg, version] of Object.entries(manifests)) {
    writeFile(
      path.join(scope, pkg, 'package.json'),
      JSON.stringify({ name: '@deepseek-ai/' + pkg, version }, null, 2) + '\n',
    );
  }
  writeFile(path.join(scope, 'dsh-app-boot', 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-app-boot',
    version: PINNED['dsh-app-boot'],
    exports: './index.mjs',
  }, null, 2) + '\n');
  writeFile(path.join(scope, 'dsh-app-boot', 'index.mjs'), APP_BOOT_STUB);
  writeFile(path.join(scope, 'cordis-plugin-include', 'package.json'), JSON.stringify({
    name: '@deepseek-ai/cordis-plugin-include',
    version: include,
    exports: './index.mjs',
  }, null, 2) + '\n');
  writeFile(path.join(scope, 'cordis-plugin-include', 'index.mjs'), INCLUDE_STUB);
  writeFile(path.join(root, 'node_modules', 'js-yaml', 'package.json'), JSON.stringify({
    name: 'js-yaml',
    version: '0.0.0-rc6-stub',
    main: 'index.cjs',
  }, null, 2) + '\n');
  writeFile(path.join(root, 'node_modules', 'js-yaml', 'index.cjs'), jsYamlStub({ [PATCH_TEXT]: [LLM_ROW] }));
  return scope;
}

// The manifest version as the BYTES on disk report it — the observation this
// test compares the recorded evidence against.
const manifestVersionOf = (scope, pkg) => JSON.parse(
  fs.readFileSync(path.join(scope, pkg, 'package.json'), 'utf8'),
).version;

let home;
let cleanupHome;
let restoreDshHome;

// One hermetic case: temp home, stub anchor at the given include version, a
// synthetic profile, an S1 binding, and a full read-only composition over that
// anchor. No DSH code, no PATH dsh, no ~/.dsh.
//
// The S1 binding is always taken over a separate clean alpha.1 stub anchor, so
// the only thing the case anchor can decide is the COMPOSITION path
// (readManagedConfig -> resolveCompositionUtils, profile/config-reader.mjs:401)
// and the version record it produces — never the S1 admission gate.
async function composeOver(include) {
  const scope = makeStubAnchor(path.join(home, 'stub-anchor-' + include.replace(/[^0-9A-Za-z.-]/g, '_')), { include });
  const boundScope = makeStubAnchor(path.join(home, 'stub-anchor-bound'), { include: OBSERVED_ALPHA_1 });
  const profileDir = path.join(home, 'profiles', 'rc6evidence');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(
    path.join(profileDir, 'package.json'),
    JSON.stringify({ name: 'rc6evidence', private: true, dsh: { profile: { bundles: [FIXTURE_BUNDLE_PKG] } }, version: '0.0.0-fixture' }, null, 2) + '\n',
    'utf8',
  );
  fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), PATCH_TEXT, 'utf8');

  const bound = resolveProfileTarget({ profileName: 'rc6evidence', dshHome: home, installAnchorDir: boundScope, pathEnv: '' });
  assert.equal(bound.ok, true, 'S1 bind over the clean alpha.1 stub anchor must succeed (' + refusalText(bound) + ')');
  const read = await readManagedConfig({ target: bound.target, installAnchorDir: scope, pathEnv: '', telemetryDisabledEnv: '' });
  return { scope, read, observed: manifestVersionOf(scope, 'cordis-plugin-include') };
}

const recordedInclude = (read) => read.composition.versions['cordis-plugin-include'];

beforeEach(() => {
  restoreDshHome = sandboxDshHome();
  ({ home, cleanup: cleanupHome } = makeTempHome());
});

afterEach(() => {
  try { cleanupHome(); } catch { /* best effort */ }
  try { restoreDshHome(); } catch { /* best effort */ }
});

describe('v1.4.7-rc6 §5(b) recorded evidence reports the observed version', () => {
  it('RC6-EVIDENCE-COMPOSE-A1 composition over a stub alpha.1 anchor succeeds and records the observed alpha.1', async () => {
    const { scope, read, observed } = await composeOver(OBSERVED_ALPHA_1);
    assert.equal(read.ok, true, 'the alpha.1 control must compose (' + refusalText(read) + ')');
    assert.equal(observed, OBSERVED_ALPHA_1, 'the anchor manifest must carry the observed alpha.1');
    assert.equal(
      recordedInclude(read),
      observed,
      'the recorded include version must be the version read from the anchor manifest',
    );
    assert.equal(recordedInclude(read), OBSERVED_ALPHA_1);
  });

  it('RC6-EVIDENCE-COMPOSE-A2 composition over a stub alpha.2 anchor succeeds and records the observed alpha.2', async () => {
    const { scope, read, observed } = await composeOver(OBSERVED_ALPHA_2);
    assert.equal(
      read.ok,
      true,
      'composition over an alpha.2 include anchor must succeed; the boundary admits alpha.2 alongside '
      + 'alpha.1 (observed anchor version ' + observed + ', detail ' + refusalText(read) + ')',
    );
    assert.equal(observed, OBSERVED_ALPHA_2, 'the anchor manifest must carry the observed alpha.2');
    assert.equal(
      recordedInclude(read),
      observed,
      '§5(b): the recorded include version must be the OBSERVED manifest version, never the expected constant',
    );
    assert.equal(recordedInclude(read), OBSERVED_ALPHA_2);
    assert.notEqual(
      recordedInclude(read),
      OBSERVED_ALPHA_1,
      '§5(b): recording the alpha.1 constant for an alpha.2 anchor is exactly the defect this test pins',
    );
    assert.equal(read.composition.versions['dsh-app-boot'], PINNED['dsh-app-boot'], 'the app-boot record must report the observed manifest version');
    assert.equal(read.composition.versions.dsh, PINNED.dsh, 'the dsh record must report the observed manifest version');
    assert.equal(read.composition.scopeDir, scope, 'the composition anchor must be the stub scope');
  });
});