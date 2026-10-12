// R2-B3 readback evidence. Scratch-only.
import { describe, it, beforeEach, afterEach } from 'node:test';
import { ProfileAwareCommit } from '../../profile/commit.mjs';
import { assert, makeTempHome, sandboxDshHome, buildReadyPlan, backupNames, readPatchBytes, readBackupBytes } from './helpers.mjs';
describe('R2-B3 readback evidence', () => {
  let home; let restore; let cleanupHome;
  beforeEach(() => { restore = sandboxDshHome(); const h = makeTempHome(); home = h.home; cleanupHome = h.cleanup; });
  afterEach(() => { try { cleanupHome(); } catch {} try { restore(); } catch {} });
  it('object readback returns POST_WRITE_VERIFY_FAILED with backup', async () => {
    const built = await buildReadyPlan({ home });
    const before = readPatchBytes(built.profileDir);
    const res = await ProfileAwareCommit({ plan: built.plan, waitMs: 8000, deps: { postWriteReader: async () => ({}) } });
    assert.equal(res.ok, false); assert.equal(res.code, 'POST_WRITE_VERIFY_FAILED');
    assert.ok(res.backupPath);
    assert.ok(readBackupBytes(res.backupPath).equals(before));
  });
  it('null readback returns POST_WRITE_VERIFY_FAILED with backup', async () => {
    const built = await buildReadyPlan({ home });
    const res = await ProfileAwareCommit({ plan: built.plan, waitMs: 8000, deps: { postWriteReader: async () => null } });
    assert.equal(res.ok, false); assert.equal(res.code, 'POST_WRITE_VERIFY_FAILED');
    assert.ok(res.backupPath);
  });
  it('numeric readback returns POST_WRITE_VERIFY_FAILED with backup', async () => {
    const built = await buildReadyPlan({ home });
    const res = await ProfileAwareCommit({ plan: built.plan, waitMs: 8000, deps: { postWriteReader: async () => 42 } });
    assert.equal(res.ok, false); assert.equal(res.code, 'POST_WRITE_VERIFY_FAILED');
    assert.ok(res.backupPath);
  });
});
