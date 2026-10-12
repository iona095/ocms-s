// R2-B1 authentic S1 identity inside the lock. Scratch-only.
import { describe, it, beforeEach, afterEach } from 'node:test';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { ProfileAwareCommit } from '../../profile/commit.mjs';
import { assert, makeTempHome, sandboxDshHome, buildReadyPlan, backupNames, readPatchBytes } from './helpers.mjs';
describe('R2-B1 authentic S1 identity', () => {
  let home; let restore; let cleanupHome;
  beforeEach(() => { restore = sandboxDshHome(); const h = makeTempHome(); home = h.home; cleanupHome = h.cleanup; });
  afterEach(() => { try { cleanupHome(); } catch {} try { restore(); } catch {} });
  it('valid scratch identity still commits', async () => {
    const built = await buildReadyPlan({ home });
    assert.equal(built.target.classification, 'SCRATCH');
    const res = await ProfileAwareCommit({ plan: built.plan, waitMs: 8000 });
    assert.equal(res.ok, true); assert.equal(res.status, 'UPDATED');
  });
  it('forged production-as-scratch refuses STALE_TARGET', async () => {
    const prodHome = process.env.DSH_HOME;
    const built = await buildReadyPlan({ home: prodHome, profileName: 'r2forge' });
    assert.equal(built.target.classification, 'PRODUCTION');
    const forged = structuredClone(built.plan);
    forged.target.classification = 'SCRATCH';
    const other = makeTempHome();
    forged.target.dshHomeReal = other.home;
    const res = await ProfileAwareCommit({ plan: forged, waitMs: 8000 });
    assert.equal(res.ok, false); assert.equal(res.code, 'STALE_TARGET');
    assert.deepEqual(backupNames(built.profileDir), []);
    other.cleanup();
  });
  it('changed designation refuses STALE_TARGET', async () => {
    const built = await buildReadyPlan({ home });
    const mut = structuredClone(built.plan);
    mut.target.profileName = 'renamed-profile';
    const res = await ProfileAwareCommit({ plan: mut, waitMs: 8000 });
    assert.equal(res.ok, false); assert.equal(res.code, 'STALE_TARGET');
    assert.deepEqual(backupNames(built.profileDir), []);
  });
  it('changed overlays to missing file refuse pre-write with no backup', async () => {
    const built = await buildReadyPlan({ home });
    const mut = structuredClone(built.plan);
    mut.target.declaredOverlays = [path.join(home, 'ghost.yml')];
    const res = await ProfileAwareCommit({ plan: mut, waitMs: 8000 });
    assert.equal(res.ok, false); assert.equal(res.code, 'PATCH_UNREADABLE');
    assert.deepEqual(backupNames(built.profileDir), []);
  });
  it('malformed identity refuses STALE_TARGET', async () => {
    const built = await buildReadyPlan({ home });
    const mut = structuredClone(built.plan);
    mut.target.profileName = '';
    const res = await ProfileAwareCommit({ plan: mut, waitMs: 8000 });
    assert.equal(res.ok, false); assert.equal(res.code, 'STALE_TARGET');
  });
});
