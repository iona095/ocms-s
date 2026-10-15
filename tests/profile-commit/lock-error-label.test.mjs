// 0b/D3: an unexpected lock-acquisition failure must not be labeled DSH skew.
// The suite injects a non-lock error into the file-lock seam, owns a temp
// profile, bounds the wait, and asserts the target is byte-identical.
import { describe, it, beforeEach, afterEach } from 'node:test';
import { ProfileAwareCommit } from '../../profile/commit.mjs';
import { assert, makeTempHome, sandboxDshHome, buildReadyPlan, readPatchBytes, backupNames, tempNames } from './helpers.mjs';

describe('commit lock acquisition error label', () => {
  let home;
  let restore;
  let cleanupHome;
  beforeEach(() => { restore = sandboxDshHome(); const created = makeTempHome(); home = created.home; cleanupHome = created.cleanup; });
  afterEach(() => { try { cleanupHome(); } catch {} try { restore(); } catch {} });

  it('a non-lock acquisition error is not reported as INCOMPATIBLE_DSH', async () => {
    const built = await buildReadyPlan({ home });
    const beforeBytes = readPatchBytes(built.profileDir);
    const res = await ProfileAwareCommit({
      plan: built.plan,
      waitMs: 8000,
      deps: { withFileLock: async () => { throw new Error('synthetic-acquire-failure'); } }
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'VERIFY_FAILED');
    assert.equal(res.status, 'BLOCKED');
    assert.notEqual(res.code, 'INCOMPATIBLE_DSH');
    assert.deepEqual(backupNames(built.profileDir), []);
    assert.deepEqual(tempNames(built.profileDir), []);
    assert.ok(readPatchBytes(built.profileDir).equals(beforeBytes));
  });
});
