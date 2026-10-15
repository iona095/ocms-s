// C09 / C10 / C07 / C25: typed refusals and the operator-facing confirmation.
//
// C09  JSON null on /api/apply must be a typed 400, not a 500.
// C10  A malformed attestation must be a typed refusal, not a TypeError 500.
// C07  The confirmation dialog must read a profile target's classification and
//      real path, and must show the PRODUCTION warning for a production one.
// C25  A 409 busy Apply must restore the page to a coherent READY state.
//
// Disposable temp homes, loopback HTTP, no live calls.
import { describe, it, beforeEach, afterEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { assert, makeTempHome, sandboxDshHome, withR2Port } from './helpers.mjs';
import { httpRequest, postJson, authHeaders, fetchFromBodies, validSourceBodies, startTestServer, scratchSettingsFile, REPO_ROOT } from '../v1.3/helpers.mjs';
import { makeProfile as makeS4Profile, makeFixtureBundle, llmRow as s4Row, readPatchBytes } from '../profile-commit/helpers.mjs';
import { makeStubAnchor } from '../v1.4.6-rc2/helpers.mjs';
import { makeProductionHome } from './helpers.mjs';

function seedEntries() {
  return [s4Row({ config: { providers: { other: { displayName: 'other', models: [] } } } })];
}

async function previewProfile(t, home, name, anchor) {
  const dir = makeS4Profile(home, name, { entries: seedEntries(), bundles: ['@fixture/base'] });
  makeFixtureBundle(dir);
  const file = scratchSettingsFile(t);
  const started = await withR2Port(t, (port) => startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies()), installAnchorDir: anchor }));
  const preview = await postJson(started.port, '/api/preview', { profileName: name, dshHome: home }, authHeaders(started.token));
  assert.equal(preview.json.ok, true, JSON.stringify(preview.json).slice(0, 400));
  return { started, dir, preview: preview.json };
}

describe('C09/C10 — malformed input is a typed refusal', () => {
  let home; let cleanupHome; let restore;
  beforeEach(() => { restore = sandboxDshHome(); const h = makeTempHome(); home = h.home; cleanupHome = h.cleanup; });
  afterEach(() => { try { cleanupHome(); } catch {} try { restore(); } catch {} });

  it('a literal JSON null body is refused with 400, never 500', async (t) => {
    const { anchor } = makeStubAnchor(t);
    const { started, dir } = await previewProfile(t, home, 'c09', anchor);
    const bytesBefore = readPatchBytes(dir);
    const res = await httpRequest({
      port: started.port, method: 'POST', urlPath: '/api/apply',
      headers: { 'content-type': 'application/json', ...authHeaders(started.token) },
      body: 'null',
    });
    assert.equal(res.status, 400, 'null body must be a client error: ' + res.body.slice(0, 200));
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.ok, false);
    assert.equal(typeof parsed.code, 'string');
    assert.ok(readPatchBytes(dir).equals(bytesBefore), 'a malformed body writes nothing');
  });

  it('a malformed EXACT_OVERLAYS attestation is refused with a typed code, not 500', async (t) => {
    const { anchor } = makeStubAnchor(t);
    const { started, dir } = await previewProfile(t, home, 'c10', anchor);
    const bytesBefore = readPatchBytes(dir);
    for (const overlays of ['not-an-array', 42, null]) {
      const res = await postJson(started.port, '/api/preview', {
        profileName: 'c10',
        dshHome: home,
        liveState: 'overlays:x',
        acknowledged: true,
        attestation: { mode: 'EXACT_OVERLAYS', overlays },
      }, authHeaders(started.token));
      assert.notEqual(res.status, 500, 'overlays=' + JSON.stringify(overlays) + ' must not be a 500: ' + res.body.slice(0, 200));
      assert.equal(res.json.ok, false, 'overlays=' + JSON.stringify(overlays));
      assert.equal(res.json.code, 'INVALID_ATTESTATION', 'overlays=' + JSON.stringify(overlays) + ' code: ' + JSON.stringify(res.json).slice(0, 200));
    }
    assert.ok(readPatchBytes(dir).equals(bytesBefore), 'a malformed attestation writes nothing');
  });
});

describe('C07/C25 — the page reflects the target it will change', () => {
  const html = fs.readFileSync(path.join(REPO_ROOT, 'ui', 'index.html'), 'utf8');

  it('the confirmation dialog reads a profile target classification and path', () => {
    assert.ok(html.includes("confirmTarget.classification === 'PRODUCTION'"), 'the badge derives PRODUCTION from classification');
    assert.ok(html.includes("'patchPathReal'"), 'the dialog reads the real patch path');
    assert.ok(!html.includes("classificationBadge(confirmClassEl, lastPreview.target ? lastPreview.target.production : undefined)"), 'the legacy-only badge read is gone');
  });

  it('a profile PRODUCTION confirmation can show the production warning', () => {
    const i = html.indexOf('const production = productionFlag === true;');
    assert.ok(i > 0, 'the confirmation note derives from the same classification');
    const note = html.slice(i, i + 400);
    assert.ok(note.includes('PRODUCTION target'), 'the production warning text is reached from that flag');
  });

  it('a busy Apply restores READY instead of staying APPLYING', () => {
    const i = html.indexOf("code === 'PREVIEW_BUSY' || code === 'APPLY_BUSY'");
    assert.ok(i > 0, 'the busy branch exists');
    const branch = html.slice(i, i + 500);
    assert.ok(branch.includes("setState('READY')"), 'the busy branch restores READY');
    const applyStart = html.indexOf('async function doApply()');
    const applyingState = html.indexOf("setState('APPLYING')", applyStart);
    assert.ok(applyStart > 0 && applyingState > applyStart, 'the APPLYING state is still set on submit');
  });
});

describe('C07 — a production profile target still carries its classification', () => {
  it('the payload the dialog reads names PRODUCTION for a production profile', async (t) => {
    const prod = makeProductionHome();
    try {
      const dir = makeS4Profile(prod.home, 'c07', { entries: seedEntries(), bundles: ['@fixture/base'] });
      makeFixtureBundle(dir);
      const file = scratchSettingsFile(t);
      const { anchor } = makeStubAnchor(t);
      const started = await withR2Port(t, (port) => startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies()), installAnchorDir: anchor }));
      const preview = await postJson(started.port, '/api/preview', { profileName: 'c07', dshHome: prod.home, liveState: 'not-running', acknowledged: true }, authHeaders(started.token));
      assert.equal(preview.json.ok, true, JSON.stringify(preview.json).slice(0, 400));
      assert.equal(preview.json.target.classification, 'PRODUCTION', 'the dialog has a classification to read');
      assert.equal(typeof preview.json.target.patchPathReal, 'string', 'the dialog has a real path to read');
    } finally { try { prod.cleanup(); } catch {} try { prod.restore(); } catch {} }
  });
});
