// S4-B1 lock identity and staleness (T10/T12). Scratch fixtures only.
import { describe, it, beforeEach, afterEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ProfileAwareCommit, LOCK_RESOURCE_SUFFIX } from '../../profile/commit.mjs';
import { assert, makeTempHome, sandboxDshHome, buildReadyPlan, appendPatchNewline, holdPackageLock, releaseLock, readPatchText, backupNames, tempNames, patchLockPresent, packageLockPresent } from './helpers.mjs';
describe('S4-B1 lock identity', () => {
  let home; let restore; let cleanupHome;
  beforeEach(() => { restore = sandboxDshHome(); const h = makeTempHome(); home = h.home; cleanupHome = h.cleanup; });
  afterEach(() => { try { cleanupHome(); } catch {} try { restore(); } catch {} });
  it('whitespace-only edit refuses STALE_TARGET with zero side effects', async () => {
    const built = await buildReadyPlan({ home });
    const plan = built.plan; const profileDir = built.profileDir;
    const modText = appendPatchNewline(profileDir);
    const res = await ProfileAwareCommit({ plan, waitMs: 8000 });
    assert.equal(res.ok, false); assert.equal(res.code, 'STALE_TARGET'); assert.equal(res.stale, true);
    assert.deepEqual(backupNames(profileDir), []);
    assert.deepEqual(tempNames(profileDir), []);
    assert.equal(readPatchText(profileDir), modText);
    assert.ok(res.lockResource && res.lockResource.endsWith('package.json'));
  });
  it('contending commit serializes; loser does not resurrect', async () => {
    const built = await buildReadyPlan({ home });
    const plan = built.plan; const profileDir = built.profileDir;
    const first = await ProfileAwareCommit({ plan, waitMs: 8000 });
    assert.equal(first.ok, true); assert.equal(first.status, 'UPDATED');
    const afterFirst = readPatchText(profileDir);
    const loser = await ProfileAwareCommit({ plan, waitMs: 8000 });
    assert.equal(loser.ok, false); assert.equal(loser.code, 'STALE_TARGET');
    assert.equal(readPatchText(profileDir), afterFirst);
  });
  it('native timeout maps to LOCK_TIMEOUT', async () => {
    const built = await buildReadyPlan({ home });
    const plan = built.plan; const profileDir = built.profileDir;
    const lockPath = holdPackageLock(profileDir);
    try {
      const res = await ProfileAwareCommit({ plan, waitMs: 300 });
      assert.equal(res.ok, false); assert.equal(res.code, 'LOCK_TIMEOUT');
      assert.deepEqual(backupNames(profileDir), []);
    } finally { releaseLock(lockPath); }
  });
  it('lock sibling is package.json.lock; patch lock never appears', async () => {
    const built = await buildReadyPlan({ home });
    const plan = built.plan; const profileDir = built.profileDir;
    const res = await ProfileAwareCommit({ plan, waitMs: 8000 });
    assert.equal(res.ok, true);
    assert.ok(res.lockResource && res.lockResource.endsWith('package.json'));
    assert.equal(patchLockPresent(profileDir), false);
    assert.equal(packageLockPresent(profileDir), false);
    assert.equal(LOCK_RESOURCE_SUFFIX, '.lock');
  });
});
