// S2 T05/T06-support β€” read preservation (P0-R2 Β§Β§9.5β€“9.7 posture for reads).
//
// The reader preserves exact source bytes and never normalizes unrelated
// YAML content: comments, scalar styles, flow spans, anchors, and custom
// tags outside the managed entry survive as data. Byte identity is proven by
// patchBytes equality; no file is rewritten (mtime/size snapshots).
import { describe, it, beforeEach, afterEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { readManagedConfig } from '../../profile/config-reader.mjs';
import {
  assert,
  makeTempHome,
  sandboxDshHome,
  decoyRow,
  llmRow,
  modelsConfig,
  makeProfile,
  makeFixtureBundle,
  bindReal,
  readerOpts,
  requireRealCompositionOrSkip,
  snapshotTree,
  assertNoMutation,
  SECRET_MARKERS,
  assertNoSecrets,
  FIXTURE_BUNDLE_PKG,
} from './helpers.mjs';

let home;
let cleanupHome;
let restoreDshHome;

function bind(name) {
  return bindReal(home, name);
}

beforeEach(() => {
  restoreDshHome = sandboxDshHome();
  ({ home, cleanup: cleanupHome } = makeTempHome());
});

afterEach(() => {
  cleanupHome();
  restoreDshHome();
});

describe('S2 read preservation (T05/T06 support)', () => {
  it('T05 comments, styles, and flow spans do not disturb the read', async () => {
    const profileDir = makeProfile(home, 'styled', { bundles: [FIXTURE_BUNDLE_PKG], entries: null });
    makeFixtureBundle(profileDir);
    const raw = [
      '# leading comment',
      '- id: llm-pi-ai # trailing row comment',
      "  name: '@fixture/dsh-llm-fixture'",
      '  config: # config comment',
      '    providers:',
      "      opencode: {models: [{id: 'm1', name: \"M 1\"}], displayName: 'Op'}",
      '      # route comment',
      "      opencode-go: {models: []}",
      '- id: other # other comment',
      '  name: Other',
      '  config: {marker: true} # marker comment',
      '# trailer comment',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), raw, 'utf8');
    const snap = snapshotTree(profileDir);
    const r = await readManagedConfig(readerOpts(bind('styled')));
    assert.equal(r.ok, true, `expected success: ${JSON.stringify(r)}`);
    assert.equal(r.status, 'MATCHED');
    assert.deepEqual(r.patchBytes.toString('utf8'), raw);
    assert.deepEqual(r.storedConfig.providers.opencode.models, [{ id: 'm1', name: 'M 1' }]);
    assertNoMutation(snap, profileDir, 'T05 styled: read mutated disk');
  });

  it('T06 unrelated !!js tags are preserved as data, never executed', async (t) => {
    if (!requireRealCompositionOrSkip(t, 'real DSH YAML-dialect semantics for custom !!js tags')) return;
    const profileDir = makeProfile(home, 'jstag', { bundles: [FIXTURE_BUNDLE_PKG], entries: null });
    makeFixtureBundle(profileDir);
    const raw = [
      '- id: other',
      '  name: Other',
      '  config:',
      '    flag: !!js "process.exit(99) ? 1 : 2"',
      '    list: [!!js "a", !!js "b"]',
      '- id: llm-pi-ai',
      "  name: '@fixture/dsh-llm-fixture'",
      '  config:',
      '    providers: {}',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), raw, 'utf8');
    const snap = snapshotTree(profileDir);
    const r = await readManagedConfig(readerOpts(bind('jstag')));
    assert.equal(r.ok, true, `expected success: ${JSON.stringify(r)}`);
    assert.equal(r.status, 'MATCHED');
    // Tags boxed as data; the process survives (nothing evaluated).
    const other = r.documentModel.rows.find((row) => row.id === 'other');
    assert.deepEqual(other.config.flag, { __jsExpr: 'process.exit(99) ? 1 : 2' });
    assert.deepEqual(other.config.list, [{ __jsExpr: 'a' }, { __jsExpr: 'b' }]);
    assert.deepEqual(r.patchBytes.toString('utf8'), raw);
    assertNoMutation(snap, profileDir, 'T06 jstag: read mutated disk');
  });

  it('T05 anchors, aliases, and unknown fields round-trip in reads', async () => {
    const profileDir = makeProfile(home, 'anchors', { bundles: [FIXTURE_BUNDLE_PKG], entries: null });
    makeFixtureBundle(profileDir);
    const raw = [
      '- id: shared-def',
      '  name: Shared',
      '  config: &shared',
      '    level: 3',
      '    extraInvention: yes',
      '- id: llm-pi-ai',
      "  name: '@fixture/dsh-llm-fixture'",
      '  config:',
      '    providers:',
      '      opencode:',
      '        models: [{id: m1}]',
      '- id: consumer',
      '  name: Consumer',
      '  config:',
      '    ref:',
      '      <<: *shared',
      '      own: 1',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), raw, 'utf8');
    const snap = snapshotTree(profileDir);
    const r = await readManagedConfig(readerOpts(bind('anchors')));
    assert.equal(r.ok, true, `expected success: ${JSON.stringify(r)}`);
    assert.equal(r.status, 'MATCHED');
    const consumer = r.documentModel.rows.find((row) => row.id === 'consumer');
    assert.equal(consumer.config.ref.own, 1);
    assert.deepEqual(r.patchBytes.toString('utf8'), raw);
    assertNoMutation(snap, profileDir, 'T05 anchors: read mutated disk');
  });

  it('T05 credential-shaped synthetic data is read but never leaks into refusals', async () => {
    const config = {
      providers: {
        opencode: { models: [{ id: 'm1' }], apiKeyEnv: SECRET_MARKERS[0] },
        'unrelated-svc': { token: SECRET_MARKERS[1], nested: { secret: SECRET_MARKERS[2] } },
      },
    };
    const profileDir = makeProfile(home, 'secrets', { bundles: [FIXTURE_BUNDLE_PKG], entries: [llmRow({ config }), decoyRow('x')] });
    makeFixtureBundle(profileDir);
    const snap = snapshotTree(profileDir);
    const r = await readManagedConfig(readerOpts(bind('secrets')));
    assert.equal(r.ok, true, `expected success: ${JSON.stringify(r)}`);
    // Success legitimately carries configuration for S3/S4 consumers; the
    // leak prohibition covers errors, warnings, and reports.
    assert.deepEqual(r.warnings, []);
    assertNoSecrets({ warnings: r.warnings, status: r.status, overriddenBy: r.overriddenBy }, 'T05 secrets warnings');
    assertNoMutation(snap, profileDir, 'T05 secrets: read mutated disk');
  });

  it('T05 documentModel mirrors the patch as parsed (pre composition anchoring)', async () => {
    // An insert row with a relative name is anchored to file:// for
    // composition; documentModel must still show the patch as parsed.
    const profileDir = makeProfile(home, 'docmodel', { entries: null, bundles: [FIXTURE_BUNDLE_PKG] });
    makeFixtureBundle(profileDir);
    const raw = [
      '- insert:',
      '    - id: child-a',
      '      name: ./rel-child',
      '- id: llm-pi-ai',
      "  name: '@fixture/dsh-llm-fixture'",
      '  config:',
      '    providers: {}',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), raw, 'utf8');
    const snap = snapshotTree(profileDir);
    const r = await readManagedConfig(readerOpts(bind('docmodel')));
    assert.equal(r.ok, true, `expected success: ${JSON.stringify(r)}`);
    assert.equal(r.status, 'MATCHED');
    const insertRow = r.documentModel.rows.find((row) => Object.hasOwn(row, 'insert'));
    assert.equal(insertRow.insert[0].name, './rel-child');
    assert.deepEqual(r.patchBytes.toString('utf8'), raw);
    assertNoMutation(snap, profileDir, 'T05 docmodel: read mutated disk');
  });

  it('T05 non-ASCII model identifiers round-trip', async () => {    const ids = ['ζ¨΅ε‹-alpha', 'modell-Ξ²-π―-synthetic', 'mΓ¶tley'];
    const config = modelsConfig({ opencode: ids.map((id) => ({ id })) });
    const profileDir = makeProfile(home, 'unicode', { bundles: [FIXTURE_BUNDLE_PKG], entries: [llmRow({ config })] });
    makeFixtureBundle(profileDir);
    const snap = snapshotTree(profileDir);
    const r = await readManagedConfig(readerOpts(bind('unicode')));
    assert.equal(r.ok, true, `expected success: ${JSON.stringify(r)}`);
    assert.equal(r.status, 'MATCHED');
    assert.deepEqual(r.storedConfig.providers.opencode.models.map((m) => m.id), ids);
    assertNoMutation(snap, profileDir, 'T05 unicode: read mutated disk');
  });
});
