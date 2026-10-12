// S2 T04-shapes — provider shape validation (P0-R2 §9.4; P1-A §5 S2).
//
// Stored llm-pi-ai configuration is validated: config/providers/route
// containers must be mappings when present; models must be arrays when
// present. Absent containers/keys are admitted as missing (never conflated
// with malformed values). Unrelated providers are preserved, never
// normalized. Exactly the six frozen routes are managed.
import { describe, it, beforeEach, afterEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { MANAGED_ROUTE_KEYS as SYNC_ROUTES } from '../../sync.mjs';
import { readManagedConfig, MANAGED_ROUTE_KEYS } from '../../profile/config-reader.mjs';
import {
  assert,
  makeTempHome,
  sandboxDshHome,
  sha256Hex,
  decoyRow,
  llmRow,
  modelsConfig,
  makeProfile,
  makeFixtureBundle,
  bindReal,
  readerOpts,
  snapshotTree,
  assertNoMutation,
  FIXTURE_BUNDLE_PKG,
} from './helpers.mjs';

let home;
let cleanupHome;
let restoreDshHome;

function bind(name) {
  return bindReal(home, name);
}

let seq = 0;
async function readWithConfig(config) {
  const name = `shape-${seq++}`;
  const profileDir = makeProfile(home, name, { entries: [llmRow({ config }), decoyRow('x')], bundles: [FIXTURE_BUNDLE_PKG] });
  makeFixtureBundle(profileDir);
  const snap = snapshotTree(profileDir);
  const r = await readManagedConfig(readerOpts(bind(name)));
  assertNoMutation(snap, profileDir, `shape ${JSON.stringify(config)}: read mutated disk`);
  return r;
}

// S1 admission refuses present-but-malformed config containers, so these two
// shapes reach S2 via transplanted bindings (valid bind, hostile current
// bytes, re-issued digest): S2 discovers current bytes, never trusts shape.
async function readWithHostileConfig(name, rawEntries) {
  const profileDir = makeProfile(home, name, { entries: [llmRow(), decoyRow('x')], bundles: [FIXTURE_BUNDLE_PKG] });
  makeFixtureBundle(profileDir);
  const target = bind(name);
  const patchPath = path.join(profileDir, 'cordis.patch.yml');
  fs.writeFileSync(patchPath, rawEntries, 'utf8');
  const forged = { ...target, patchDigest: sha256Hex(fs.readFileSync(patchPath)) };
  const snap = snapshotTree(profileDir);
  const r = await readManagedConfig(readerOpts(forged));
  assertNoMutation(snap, profileDir, `hostile shape ${name}: read mutated disk`);
  return r;
}

beforeEach(() => {
  restoreDshHome = sandboxDshHome();
  ({ home, cleanup: cleanupHome } = makeTempHome());
});

afterEach(() => {
  cleanupHome();
  restoreDshHome();
});

describe('S2 provider shape validation (P0-R2 §9.4)', () => {
  it('T04 exactly six managed routes, identical to sync.mjs', () => {
    assert.deepEqual([...MANAGED_ROUTE_KEYS].sort(), [
      'opencode',
      'opencode-completions',
      'opencode-go',
      'opencode-go-messages',
      'opencode-go-responses',
      'opencode-messages',
    ]);
    assert.deepEqual([...MANAGED_ROUTE_KEYS].sort(), [...SYNC_ROUTES].sort());
  });

  it('T04 scalar config refuses SETTINGS_INVALID', async () => {
    const r = await readWithHostileConfig(
      'shape-scalar',
      '- id: llm-pi-ai\n  name: X\n  config: not-a-mapping\n- id: other\n  config: {}\n',
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SETTINGS_INVALID');
  });

  it('T04 scalar providers refuses SETTINGS_INVALID', async () => {
    const r = await readWithConfig({ providers: 'nope' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SETTINGS_INVALID');
  });

  it('T04 scalar managed route refuses SETTINGS_INVALID', async () => {
    const r = await readWithConfig({ providers: { opencode: 'nope' } });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SETTINGS_INVALID');
  });

  it('T04 non-array models refuses SETTINGS_INVALID', async () => {
    for (const bad of ['nope', 42, { id: 'x' }]) {
      const r = await readWithConfig({ providers: { opencode: { models: bad } } });
      assert.equal(r.ok, false, `models=${JSON.stringify(bad)}`);
      assert.equal(r.code, 'SETTINGS_INVALID', `models=${JSON.stringify(bad)}`);
    }
  });

  it('T04 null config container refuses SETTINGS_INVALID', async () => {
    const r = await readWithHostileConfig(
      'shape-nullconfig',
      '- id: llm-pi-ai\n  name: X\n  config:\n- id: other\n  config: {}\n',
    );
    // config: null is a present-but-malformed config container.
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SETTINGS_INVALID');
  });

  it('T04 null models value refuses SETTINGS_INVALID (Q4 note: installed zod tolerates null; frozen shape governs)', async () => {
    const r = await readWithConfig({ providers: { opencode: { models: null } } });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SETTINGS_INVALID');
  });

  it('T04 missing providers key is admitted as missing (MATCHED, dormant managed)', async () => {
    const r = await readWithConfig({ other: 1 });
    assert.equal(r.ok, true, `expected success: ${JSON.stringify(r)}`);
    assert.equal(r.status, 'MATCHED');
  });

  it('T04 missing models key is admitted as missing (not malformed)', async () => {
    const r = await readWithConfig({ providers: { opencode: { displayName: 'x' } } });
    assert.equal(r.ok, true, `expected success: ${JSON.stringify(r)}`);
    assert.equal(r.status, 'MATCHED');
  });

  it('T04 empty models array is valid (present-empty)', async () => {
    const r = await readWithConfig(modelsConfig({ opencode: [] }));
    assert.equal(r.ok, true, `expected success: ${JSON.stringify(r)}`);
    assert.equal(r.status, 'MATCHED');
  });

  it('T04 unknown provider fields are preserved, not normalized', async () => {
    const config = { providers: { opencode: { models: [{ id: 'm1' }], futureField: { nested: [1, 2] } } } };
    const r = await readWithConfig(config);
    assert.equal(r.ok, true, `expected success: ${JSON.stringify(r)}`);
    assert.deepEqual(r.storedConfig.providers.opencode.futureField, { nested: [1, 2] });
    assert.deepEqual(r.effectiveConfig.providers.opencode.futureField, { nested: [1, 2] });
  });

  it('T04 unrelated providers are preserved and never treated as managed', async () => {
    const config = {
      providers: {
        opencode: { models: [{ id: 'm1' }] },
        'other-provider': { models: 'malformed-but-unrelated', extra: true },
      },
    };
    const r = await readWithConfig(config);
    assert.equal(r.ok, true, `expected success: ${JSON.stringify(r)}`);
    assert.equal(r.status, 'MATCHED');
    assert.equal(r.effectiveConfig.providers['other-provider'].models, 'malformed-but-unrelated');
  });

  it('T04 all six managed routes validate independently', async () => {
    const providers = {};
    for (const route of MANAGED_ROUTE_KEYS) providers[route] = { models: [{ id: `${route}-m` }] };
    const r = await readWithConfig({ providers });
    assert.equal(r.ok, true, `expected success: ${JSON.stringify(r)}`);
    assert.equal(r.status, 'MATCHED');
    for (const route of MANAGED_ROUTE_KEYS) {
      assert.deepEqual(r.storedConfig.providers[route].models, [{ id: `${route}-m` }]);
    }
  });
});
