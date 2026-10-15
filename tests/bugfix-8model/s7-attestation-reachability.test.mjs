// S7 preview-error-visibility [GLM L11, L9]. Verdict NOT REPRODUCIBLE: a retained
// profile Preview can only carry an admitted attestation, so the formatAttestationText
// throw (EXACT_OVERLAYS without overlays) is unreachable over HTTP. This guard pins
// the reachability: the omitted-overlays form is a typed INVALID_ATTESTATION refusal.
// Disposable temp homes, loopback HTTP, no live calls.
import { describe, it, beforeEach, afterEach } from 'node:test';
import { assert, makeTempHome, sandboxDshHome, withR2Port } from '../profile-cli-ui/helpers.mjs';
import { httpRequest, postJson, authHeaders, fetchFromBodies, validSourceBodies, startTestServer, scratchSettingsFile } from '../v1.3/helpers.mjs';
import { makeProfile as makeS4Profile, makeFixtureBundle, llmRow as s4Row, readPatchBytes } from '../profile-commit/helpers.mjs';
import { makeStubAnchor } from '../v1.4.6-rc2/helpers.mjs';

const seed = () => [s4Row({ config: { providers: { other: { displayName: 'other', models: [] } } } })];

describe('S7 attestation reachability (guard)', () => {
  let home; let cleanupHome; let restore;
  beforeEach(() => { restore = sandboxDshHome(); const h = makeTempHome('ocms-s7-'); home = h.home; cleanupHome = h.cleanup; });
  afterEach(() => { try { cleanupHome(); } catch {} try { restore(); } catch {} });

  it('an EXACT_OVERLAYS attestation without an overlays array is refused INVALID_ATTESTATION, never admitted or 500', async (t) => {
    const { anchor } = makeStubAnchor(t);
    const dir = makeS4Profile(home, 's7', { entries: seed(), bundles: ['@fixture/base'] });
    makeFixtureBundle(dir);
    const file = scratchSettingsFile(t);
    const started = await withR2Port(t, (port) => startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies()), installAnchorDir: anchor }));
    const before = readPatchBytes(dir);
    const res = await postJson(started.port, '/api/preview', {
      profileName: 's7', dshHome: home, liveState: 'overlays:x', acknowledged: true,
      attestation: { mode: 'EXACT_OVERLAYS' },
    }, authHeaders(started.token));
    assert.notEqual(res.status, 500, 'must not be a 500: ' + res.body.slice(0, 200));
    assert.equal(res.json.ok, false, JSON.stringify(res.json).slice(0, 200));
    assert.equal(res.json.code, 'INVALID_ATTESTATION', JSON.stringify(res.json).slice(0, 200));
    assert.ok(readPatchBytes(dir).equals(before), 'writes nothing');
  });
});
