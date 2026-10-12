// S4-B6 retained-plan integrity. Scratch fixtures only.
import { describe, it, beforeEach, afterEach } from 'node:test';
import { ProfileAwareCommit } from '../../profile/commit.mjs';
import { assert, makeTempHome, sandboxDshHome, buildReadyPlan, readPatchBytes, backupNames } from './helpers.mjs';
describe('S4-B6 retained-plan integrity', () => {
  let home; let restore; let cleanupHome;
  beforeEach(() => { restore = sandboxDshHome(); const h = makeTempHome(); home = h.home; cleanupHome = h.cleanup; });
  afterEach(() => { try { cleanupHome(); } catch {} try { restore(); } catch {} });
  it('non-READY plan never reaches writer', async () => {
    const built = await buildReadyPlan({ home });
    const bad = { ok: true, status: 'BLOCKED', target: built.plan.target };
    const res = await ProfileAwareCommit({ plan: bad, waitMs: 8000 });
    assert.equal(res.ok, false);
    assert.deepEqual(backupNames(built.profileDir), []);
  });
  it('identity mismatch refuses', async () => {
    const built = await buildReadyPlan({ home });
    const plan = structuredClone(built.plan);
    plan.target.profileName = 'other-name';
    const res = await ProfileAwareCommit({ plan, waitMs: 8000 });
    assert.equal(res.ok, false);
    assert.deepEqual(backupNames(built.profileDir), []);
  });
  it('altered desired without digest update refuses', async () => {
    const built = await buildReadyPlan({ home });
    const plan = structuredClone(built.plan);
    plan.desired['opencode'] = [{ id: 'tampered-id' }];
    const res = await ProfileAwareCommit({ plan, waitMs: 8000 });
    assert.equal(res.ok, false);
    assert.deepEqual(backupNames(built.profileDir), []);
  });
  it('caller mutation after call does not affect snapshot', async () => {
    const built = await buildReadyPlan({ home });
    const plan = structuredClone(built.plan);
    const p = ProfileAwareCommit({ plan, waitMs: 8000 });
    plan.desired['opencode'] = [{ id: 'race-mut' }];
    const res = await p;
    assert.equal(res.ok, true);
  });
});
