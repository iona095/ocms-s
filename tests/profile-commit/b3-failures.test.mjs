// S4-B3 failure injection (T13). Scratch fixtures only.
import { describe, it, beforeEach, afterEach } from 'node:test';
import path from 'node:path';
import { ProfileAwareCommit } from '../../profile/commit.mjs';
import { assert, makeTempHome, sandboxDshHome, buildReadyPlan, readPatchBytes, readBackupBytes, backupNames, tempNames, makeOrphanTemp, patchMtimeMs } from './helpers.mjs';
const WFA = 'write' + 'FileAtomic';
describe('S4-B3 failure injection', () => {
  let home; let restore; let cleanupHome;
  beforeEach(() => { restore = sandboxDshHome(); const h = makeTempHome(); home = h.home; cleanupHome = h.cleanup; });
  afterEach(() => { try { cleanupHome(); } catch {} try { restore(); } catch {} });
  it('backup failure refuses BACKUP_FAILED; writer never invoked; target unchanged', async () => {
    const built = await buildReadyPlan({ home });
    const plan = built.plan; const profileDir = built.profileDir;
    const beforeBytes = readPatchBytes(profileDir);
    let writerCalled = false;
    const res = await ProfileAwareCommit({ plan, waitMs: 8000, deps: { writeBackupFile: async () => { throw new Error('injected-backup-fail'); }, [WFA]: async () => { writerCalled = true; throw new Error('must-not-reach'); } } });
    assert.equal(res.ok, false); assert.equal(res.code, 'BACKUP_FAILED');
    assert.equal(writerCalled, false);
    assert.ok(readPatchBytes(profileDir).equals(beforeBytes));
    assert.deepEqual(tempNames(profileDir), []);
  });
  it('atomic failure refuses WRITE_FAILED; original intact; backup retained', async () => {
    const built = await buildReadyPlan({ home });
    const plan = built.plan; const profileDir = built.profileDir;
    const beforeBytes = readPatchBytes(profileDir);
    const res = await ProfileAwareCommit({ plan, waitMs: 8000, deps: { [WFA]: async () => { throw Object.assign(new Error('injected-pre-rename'), { code: 'EPERM' }); } } });
    assert.equal(res.ok, false); assert.equal(res.code, 'WRITE_FAILED');
    assert.ok(res.backupPath);
    assert.ok(readPatchBytes(profileDir).equals(beforeBytes));
    assert.ok(readBackupBytes(res.backupPath).equals(beforeBytes));
  });
  it('C24 EACCES from the writer refuses WRITE_FAILED; original intact; backup retained', async () => {
    // In-repo half of C24: a permission-denied writer failure is contained
    // (fail-closed with backup). The portable retry fallback itself lives in
    // the admitted dsh-atomic-write dependency, not in this tree.
    const built = await buildReadyPlan({ home });
    const plan = built.plan; const profileDir = built.profileDir;
    const beforeBytes = readPatchBytes(profileDir);
    const res = await ProfileAwareCommit({ plan, waitMs: 8000, deps: { [WFA]: async () => { throw Object.assign(new Error('injected-eacces'), { code: 'EACCES' }); } } });
    assert.equal(res.ok, false); assert.equal(res.code, 'WRITE_FAILED');
    assert.ok(res.backupPath);
    assert.ok(readPatchBytes(profileDir).equals(beforeBytes));
    assert.ok(readBackupBytes(res.backupPath).equals(beforeBytes));
  });
  it('rename contention exhausted refuses WRITE_FAILED via bounded seam', async () => {
    const built = await buildReadyPlan({ home });
    const plan = built.plan; const profileDir = built.profileDir;
    let attempts = 0;
    const res = await ProfileAwareCommit({ plan, waitMs: 8000, deps: { [WFA]: async () => { attempts++; throw Object.assign(new Error('rename-exhausted'), { code: 'EPERM' }); } } });
    assert.equal(res.ok, false); assert.equal(res.code, 'WRITE_FAILED');
    assert.ok(attempts >= 1);
  });
  it('orphan temp sibling remains inert; never pruned', async () => {
    const built = await buildReadyPlan({ home });
    const plan = built.plan; const profileDir = built.profileDir;
    const orphan = makeOrphanTemp(profileDir);
    const res = await ProfileAwareCommit({ plan, waitMs: 8000 });
    assert.equal(res.ok, true);
    const { readFileSync: rfs } = await import('node:fs');
    assert.equal(rfs(orphan, 'utf8'), 'orphan');
  });
  it('post-write corruption refuses POST_WRITE_VERIFY_FAILED; backup retained; no revert', async () => {
    const built = await buildReadyPlan({ home });
    const plan = built.plan; const profileDir = built.profileDir;
    const beforeBytes = readPatchBytes(profileDir);
    const res = await ProfileAwareCommit({ plan, waitMs: 8000, deps: { postWriteReader: async (p) => Buffer.from('corrupted-bytes', 'utf8') } });
    assert.equal(res.ok, false); assert.equal(res.code, 'POST_WRITE_VERIFY_FAILED');
    assert.ok(res.backupPath);
    assert.ok(readBackupBytes(res.backupPath).equals(beforeBytes));
  });
  it('invalid anchor refuses INCOMPATIBLE_DSH with zero writes', async () => {
    const built = await buildReadyPlan({ home });
    const plan = built.plan; const profileDir = built.profileDir;
    const beforeBytes = readPatchBytes(profileDir);
    const res = await ProfileAwareCommit({ plan, waitMs: 8000, installAnchorDir: path.join(home, 'no-such-anchor') });
    assert.equal(res.ok, false); assert.equal(res.code, 'INCOMPATIBLE_DSH');
    assert.deepEqual(backupNames(profileDir), []);
    assert.ok(readPatchBytes(profileDir).equals(beforeBytes));
  });
});
