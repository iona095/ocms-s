// R2-B4 writer-failure truth. Scratch-only.
import { describe, it, beforeEach, afterEach } from 'node:test';
import path from 'node:path';
import { ProfileAwareCommit } from '../../profile/commit.mjs';
import { assert, makeTempHome, sandboxDshHome, buildReadyPlan, backupNames, readPatchBytes, readBackupBytes, resolveRealScopeOrSkip } from './helpers.mjs';
const WFA = 'write' + 'FileAtomic';
describe('R2-B4 writer truth', () => {
  let home; let restore; let cleanupHome;
  beforeEach(() => { restore = sandboxDshHome(); const h = makeTempHome(); home = h.home; cleanupHome = h.cleanup; });
  afterEach(() => { try { cleanupHome(); } catch {} try { restore(); } catch {} });
  it('replace-then-throw enters post-write safe-error with observed new digest', async (t) => {
    const built = await buildReadyPlan({ home });
    const before = readPatchBytes(built.profileDir);
    const realScope = resolveRealScopeOrSkip(t);
    if (realScope === null) return;
    const { pathToFileURL } = await import('node:url');
    const realMod = await import(pathToFileURL(realScope + '/dsh-atomic-write/lib/index.js').href);
    const realFn = realMod[WFA];
    const res = await ProfileAwareCommit({ plan: built.plan, waitMs: 8000, deps: { [WFA]: async (p, data, opts) => { await realFn(p, data, opts); throw Object.assign(new Error('ambiguous-post-rename'), { code: 'EPERM' }); } } });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'POST_WRITE_VERIFY_FAILED');
    assert.ok(res.backupPath);
    assert.ok(readBackupBytes(res.backupPath).equals(before));
    assert.equal(res.targetDigestObserved, built.plan.candidateDigest);
  });
  it('true pre-rename failure still reports WRITE_FAILED preserved', async () => {
    const built = await buildReadyPlan({ home });
    const before = readPatchBytes(built.profileDir);
    const res = await ProfileAwareCommit({ plan: built.plan, waitMs: 8000, deps: { [WFA]: async () => { throw Object.assign(new Error('pre-rename'), { code: 'EPERM' }); } } });
    assert.equal(res.ok, false); assert.equal(res.code, 'WRITE_FAILED');
    assert.ok(readPatchBytes(built.profileDir).equals(before));
  });
  it('missing target after writer error reports uncertainty, never success', async () => {
    const built = await buildReadyPlan({ home });
    const { readFileSync: rfs, rmSync: rms } = await import('node:fs');
    const res = await ProfileAwareCommit({ plan: built.plan, waitMs: 8000, deps: { [WFA]: async (p, data, opts) => { try { rms(p, { force: true }); } catch {} throw Object.assign(new Error('vanished'), { code: 'EPERM' }); } } });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'POST_WRITE_VERIFY_FAILED');
    assert.ok(res.backupPath);
  });
});
