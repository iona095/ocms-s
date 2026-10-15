// S10 preview-display-swallow [Space Bunny #17]. runProfileSync/runSettingsSync
// wrap the Preview display in try{say}catch{} and continue to confirm + Apply:
// when the display fails the operator confirms blind and the commit still
// writes. Reproduced with a throwing print (stdout failure proxy) and an
// affirmative confirm. Scratch-only, stubbed fetch, zero real writes intended.
import { describe, it, beforeEach, afterEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { assert, makeTempHome, sandboxDshHome } from '../profile-cli-ui/helpers.mjs';
import { fetchFromBodies, validSourceBodies } from '../v1.3/helpers.mjs';
import { makeProfile, makeFixtureBundle, llmRow, bindReal, resolvedStubScope } from '../profile-commit/helpers.mjs';
import { runSettingsSync, runProfileSync } from '../../sync.mjs';

const throwingPrint = () => { throw new Error('EPIPE simulated stdout failure'); };
const yesConfirm = async () => true;

describe('S10 preview-display-swallow: a failed display never reaches Apply', () => {
  let home; let cleanupHome; let restore;
  beforeEach(() => { restore = sandboxDshHome(); const h = makeTempHome('ocms-s10-'); home = h.home; cleanupHome = h.cleanup; });
  afterEach(() => { try { cleanupHome(); } catch {} try { restore(); } catch {} });

  it('legacy path: throwing display refuses without writing', async () => {
    const dsh = path.join(home, '.dsh');
    fs.mkdirSync(dsh, { recursive: true });
    const scratch = path.join(home, 'scratch');
    fs.mkdirSync(scratch, { recursive: true });
    const file = path.join(scratch, 'settings.yaml');
    fs.writeFileSync(file, ['llm:', '  unrelated: true', 'llm-pi-ai:', '  providers: {}', ''].join(String.fromCharCode(10)), 'utf8');
    const before = fs.readFileSync(file);
    const res = await runSettingsSync({ settingsPath: file, dshHome: dsh, fetchFn: fetchFromBodies(validSourceBodies()), print: throwingPrint, confirmFn: yesConfirm });
    assert.equal(res.ok, false, 'a blind confirm must not succeed: ' + JSON.stringify(res).slice(0, 200));
    assert.equal(res.code, 'PREVIEW_DISPLAY_FAILED', 'typed refusal, got ' + JSON.stringify(res).slice(0, 200));
    assert.ok(fs.readFileSync(file).equals(before), 'zero writes when the Preview was never displayed');
  });

  it('profile path: throwing display refuses without writing', async () => {
    const scope = resolvedStubScope().scope;
    const dir = makeProfile(home, 's10', { entries: [llmRow({ config: { providers: { other: { displayName: 'other', models: [] } } } })], bundles: ['@fixture/base'] });
    makeFixtureBundle(dir);
    const target = bindReal(home, 's10');
    const before = fs.readFileSync(path.join(dir, 'cordis.patch.yml'));
    const res = await runProfileSync({ profile: 's10', dshHome: home, fetchFn: fetchFromBodies(validSourceBodies()), print: throwingPrint, confirmFn: yesConfirm, installAnchorDir: scope, pathEnv: '' });
    assert.equal(res.ok, false, 'a blind confirm must not succeed: ' + JSON.stringify(res).slice(0, 200));
    assert.equal(res.code, 'PREVIEW_DISPLAY_FAILED', 'typed refusal, got ' + JSON.stringify(res).slice(0, 200));
    assert.ok(fs.readFileSync(path.join(dir, 'cordis.patch.yml')).equals(before), 'zero writes when the Preview was never displayed');
  });
});
