// S4-B5 effective composition and live-state (T03/T11).
import { describe, it, beforeEach, afterEach } from 'node:test';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { ProfileAwareCommit } from '../../profile/commit.mjs';
import { assert, makeTempHome, sandboxDshHome, buildReadyPlan, readPatchBytes, backupNames, writeHomePatchText, writeOverlayText } from './helpers.mjs';
describe('S4-B5 composition and live-state', () => {
  let home; let restore; let cleanupHome;
  beforeEach(() => { restore = sandboxDshHome(); const h = makeTempHome(); home = h.home; cleanupHome = h.cleanup; });
  afterEach(() => { try { cleanupHome(); } catch {} try { restore(); } catch {} });
  it('declared overlay overriding managed candidate refuses OVERRIDDEN', async () => {
    const { makeProfile, bindReal } = await import('./helpers.mjs');
    const { readManagedConfig } = await import('../../profile/config-reader.mjs');
    const { buildProfileAwarePlan } = await import('../../profile/plan-builder.mjs');
    const { minimalSources, readerOpts, llmRow } = await import('./helpers.mjs');
    const src = minimalSources();
    const ovDir = makeProfile(home, 'ovfix', { entries: [llmRow({ config: { providers: { other: { displayName: 'other', models: [] } } } })], bundles: ['@fixture/base'] });
    const { makeFixtureBundle: mfb } = await import('./helpers.mjs');
    mfb(ovDir);
    const target = bindReal(home, 'ovfix');
    const rr = await readManagedConfig(readerOpts(target));
    const plan = buildProfileAwarePlan({ target: structuredClone(target), readerResult: rr, sources: src });
    const profileDir = home + '/profiles/ovfix';
    const overText = stringifyYaml([{ id: 'llm-pi-ai', name: '@fixture/dsh-llm-fixture', config: { providers: { opencode: { displayName: 'opencode', models: [{ id: 'evil-override' }] } } } }]);
    const overPath = writeOverlayText(home, 'over.yml', overText);
    const mut = structuredClone(plan);
    mut.target.declaredOverlays = [overPath];
    const res = await ProfileAwareCommit({ plan: mut, waitMs: 8000 });
    assert.equal(res.ok, false);
  });
  it('production without attestation refuses LIVE_OVERLAY_UNKNOWN', async () => {
    const prodHome = process.env.DSH_HOME;
    const built = await buildReadyPlan({ home: prodHome, profileName: 'prodfix' });
    assert.equal(built.target.classification, 'PRODUCTION');
    const res = await ProfileAwareCommit({ plan: built.plan, waitMs: 8000 });
    assert.equal(res.ok, false); assert.equal(res.code, 'LIVE_OVERLAY_UNKNOWN');
    assert.deepEqual(backupNames(built.profileDir), []);
  });
  it('scratch offline with no running DSH uses file composition', async () => {
    const built = await buildReadyPlan({ home });
    const res = await ProfileAwareCommit({ plan: built.plan, waitMs: 8000 });
    assert.equal(res.ok, true); assert.equal(res.status, 'UPDATED');
    assert.equal(res.effectiveComposition, 'MATCHED');
  });
});
