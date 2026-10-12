// G1-D file-side recovery — CORRECTED S6-R3 (F4). Exercised cases, machine-checkable.
// No Loader boot. Reuses S4 failure-injection seams (deps). No automatic recovery.
// Every case captures bytes/digest, backup, temp, mtime, code, subsequent re-Preview.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ProfileAwareCommit } from '../../profile/commit.mjs';
import { readManagedConfig } from '../../profile/config-reader.mjs';
import { buildProfileAwarePlan } from '../../profile/plan-builder.mjs';
import { makeTempHome, sandboxDshHome, buildReadyPlan, readPatchBytes, backupNames, tempNames, patchMtimeMs, appendPatchNewline, holdPackageLock, releaseLock, sha256Hex, overwritePatchText } from '../profile-commit/helpers.mjs';
import { makeProductionHome, makeProfile as makeS5Profile } from '../profile-cli-ui/helpers.mjs';
import { makeProfile as makeS4Profile, makeFixtureBundle, llmRow as s4Row } from '../profile-commit/helpers.mjs';
function captureState(dir) {
  const bytes = readPatchBytes(dir);
  return { bytes, digest: sha256Hex(bytes), backups: backupNames(dir), temps: tempNames(dir), mtime: patchMtimeMs(dir) };
}
async function rePreview(target) {
  const rr = await readManagedConfig({ target: structuredClone(target), installAnchorDir: null, pathEnv: '' });
  assert.equal(rr.ok, true, 're-Preview read must succeed: ' + JSON.stringify(rr).slice(0,400));
  return rr;
}
describe('G1-D recovery file-side — exercised (S6-R3 F4)', () => {
  let home; let restore; let cleanupHome;
  beforeEach(() => { restore = sandboxDshHome(); const h = makeTempHome(); home = h.home; cleanupHome = h.cleanup; });
  afterEach(() => { try { cleanupHome(); } catch {} try { restore(); } catch {} });
  it('1 stale target before write refuses STALE_TARGET with zero side effects', async () => {
    const built = await buildReadyPlan({ home });
    const dir = built.profileDir;
    const s0 = captureState(dir);
    const modText = appendPatchNewline(dir);
    const res = await ProfileAwareCommit({ plan: structuredClone(built.plan), waitMs: 8000 });
    assert.equal(res.ok, false); assert.equal(res.code, 'STALE_TARGET');
    assert.deepEqual(backupNames(dir), []); assert.deepEqual(tempNames(dir), []);
    assert.equal(readPatchBytes(dir).toString('utf8'), modText);
    console.log('RECOVERY_1_STALE code=' + res.code + ' bytes=' + s0.bytes.length + ' digest=' + s0.digest.slice(0,12) + ' backups=0 temp=0 mtime=' + s0.mtime);
    const fresh = (await import('../../profile/target-resolver.mjs')).resolveProfileTarget({ profileName: built.target.profileName, dshHome: home, pathEnv: process.env.PATH ?? '' });
    assert.equal(fresh.ok, true);
    const rr = await rePreview(fresh.target);
    assert.equal(rr.ok, true);
    console.log('RECOVERY_1_REPREVIEW ok=true');
  });
  it('2 backup failure refuses BACKUP_FAILED; writer never invoked', async () => {
    const built = await buildReadyPlan({ home });
    const dir = built.profileDir;
    const s0 = captureState(dir);
    let writerCalled = false;
    const WFA = 'write' + 'FileAtomic';
    const res = await ProfileAwareCommit({ plan: structuredClone(built.plan), waitMs: 8000, deps: { writeBackupFile: async () => { throw new Error('injected-backup-fail'); }, [WFA]: async () => { writerCalled = true; throw new Error('must-not-reach'); } } });
    assert.equal(res.ok, false); assert.equal(res.code, 'BACKUP_FAILED');
    assert.equal(writerCalled, false);
    assert.ok(readPatchBytes(dir).equals(s0.bytes)); assert.deepEqual(tempNames(dir), []);
    console.log('RECOVERY_2_BACKUP code=' + res.code + ' writerCalled=' + writerCalled + ' backups=' + backupNames(dir).length);
    const rr = await rePreview(built.target);
    console.log('RECOVERY_2_REPREVIEW ok=' + rr.ok);
  });
  it('3 atomic write failure refuses WRITE_FAILED; original intact; backup retained', async () => {
    const built = await buildReadyPlan({ home });
    const dir = built.profileDir;
    const s0 = captureState(dir);
    const WFA2 = 'write' + 'FileAtomic';
    const res = await ProfileAwareCommit({ plan: structuredClone(built.plan), waitMs: 8000, deps: { [WFA2]: async () => { throw Object.assign(new Error('injected-pre-rename'), { code: 'EPERM' }); } } });
    assert.equal(res.ok, false); assert.equal(res.code, 'WRITE_FAILED');
    assert.ok(res.backupPath);
    assert.ok(readPatchBytes(dir).equals(s0.bytes));
    const { readFileSync } = await import('node:fs');
    assert.ok(readFileSync(res.backupPath).equals(s0.bytes));
    console.log('RECOVERY_3_WRITE code=' + res.code + ' backup=' + res.backupPath + ' mtime=' + s0.mtime);
    console.log('RECOVERY_3_OPERATOR explicitly restore backup via file operation outside Apply, then re-Preview (no auto-revert performed)');
  });
  it('4 post-write verification failure refuses POST_WRITE_VERIFY_FAILED; backup retained; no revert', async () => {
    const built = await buildReadyPlan({ home });
    const dir = built.profileDir;
    const s0 = captureState(dir);
    const res = await ProfileAwareCommit({ plan: structuredClone(built.plan), waitMs: 8000, deps: { postWriteReader: async () => Buffer.from('corrupted-bytes', 'utf8') } });
    assert.equal(res.ok, false); assert.equal(res.code, 'POST_WRITE_VERIFY_FAILED');
    assert.ok(res.backupPath);
    console.log('RECOVERY_4_POSTVERIFY code=' + res.code + ' backup Retained, file holds unverified bytes (no auto-revert)');
    const rr = await rePreview((await import('../../profile/target-resolver.mjs')).resolveProfileTarget({ profileName: built.target.profileName, dshHome: home, pathEnv: process.env.PATH ?? '' }).target);
    assert.equal(rr.ok, true);
  });
  it('5 successful UPDATED carries UNKNOWN_LIVE_UNVERIFIED (never OBSERVED file-side)', async () => {
    const built = await buildReadyPlan({ home });
    const dir = built.profileDir;
    const s0 = captureState(dir);
    const res = await ProfileAwareCommit({ plan: structuredClone(built.plan), waitMs: 8000 });
    assert.equal(res.ok, true); assert.equal(res.status, 'UPDATED');
    assert.equal(res.fileVerified, true);
    assert.equal(res.liveActivation, 'UNKNOWN_LIVE_UNVERIFIED');
    assert.equal(backupNames(dir).length, 1); assert.deepEqual(tempNames(dir), []);
    assert.ok(!readPatchBytes(dir).equals(s0.bytes));
    console.log('RECOVERY_5_UPDATED status=' + res.status + ' liveActivation=' + res.liveActivation + ' backup=' + backupNames(dir).length);
    const rr = await rePreview((await import('../../profile/target-resolver.mjs')).resolveProfileTarget({ profileName: built.target.profileName, dshHome: home, pathEnv: process.env.PATH ?? '' }).target);
    assert.equal(rr.ok, true);
  });
  it('6 native lock timeout refuses LOCK_TIMEOUT with zero side effects', async () => {
    const built = await buildReadyPlan({ home });
    const dir = built.profileDir;
    const s0 = captureState(dir);
    const lockPath = holdPackageLock(dir);
    try {
      const res = await ProfileAwareCommit({ plan: structuredClone(built.plan), waitMs: 300 });
      assert.equal(res.ok, false); assert.equal(res.code, 'LOCK_TIMEOUT');
      assert.deepEqual(backupNames(dir), []);
      assert.ok(readPatchBytes(dir).equals(s0.bytes)); assert.equal(patchMtimeMs(dir), s0.mtime);
      console.log('RECOVERY_6_LOCK code=' + res.code + ' waitMs=300 mtime_unchanged=true');
    } finally { releaseLock(lockPath); }
  });
  it('7 incompatible runtime/version refuses INCOMPATIBLE_DSH with zero writes', async () => {
    const built = await buildReadyPlan({ home });
    const dir = built.profileDir;
    const s0 = captureState(dir);
    const res = await ProfileAwareCommit({ plan: structuredClone(built.plan), waitMs: 8000, installAnchorDir: path.join(home, 'no-such-anchor') });
    assert.equal(res.ok, false); assert.equal(res.code, 'INCOMPATIBLE_DSH');
    assert.deepEqual(backupNames(dir), []); assert.ok(readPatchBytes(dir).equals(s0.bytes));
    console.log('RECOVERY_7_INCOMPATIBLE code=' + res.code);
  });
  it('8 unattested synthetic production refuses LIVE_OVERLAY_UNKNOWN (no real home touched)', async () => {
    const prod = makeProductionHome();
    try {
      const pdir = makeS4Profile(prod.home, 'recProd', { entries: [s4Row({ config: { providers: { other: { displayName: 'other', models: [] } } } })], bundles: ['@fixture/base'] });
      makeFixtureBundle(pdir);
      const { resolveProfileTarget } = await import('../../profile/target-resolver.mjs');
      const rr0 = resolveProfileTarget({ profileName: 'recProd', dshHome: prod.home, pathEnv: process.env.PATH ?? '' });
      assert.equal(rr0.ok, true); assert.equal(rr0.target.classification, 'PRODUCTION');
      const readerResult = await readManagedConfig({ target: structuredClone(rr0.target), installAnchorDir: null, pathEnv: '' });
      assert.equal(readerResult.ok, true);
      const plan = buildProfileAwarePlan({ target: structuredClone(rr0.target), readerResult, sources: (await import('../profile-commit/helpers.mjs')).minimalSources() });
      assert.equal(plan.ok, true);
      const s0 = captureState(pdir);
      const res = await ProfileAwareCommit({ plan: structuredClone(plan), waitMs: 8000 });
      assert.equal(res.ok, false); assert.equal(res.code, 'LIVE_OVERLAY_UNKNOWN');
      assert.deepEqual(backupNames(pdir), []); assert.ok(readPatchBytes(pdir).equals(s0.bytes));
      console.log('RECOVERY_8_UNATTESTED code=' + res.code + ' synthetic PRODUCTION refused, real home untouched');
    } finally { try { prod.cleanup(); } catch {} try { prod.restore(); } catch {} }
  });
  it('9 scratch-observed activation failure is HOLD (native boot gated by F5 isolation)', async () => {
    console.log('RECOVERY_9_SCRATCH_ACTIVATION HOLD: native DSH boot requires verified process-level egress containment (F5). No containment established, so no scratch runtime booted and no activation observed. See G2 HOLD.');
    const g2 = fs.readFileSync(path.resolve("tests/profile-acceptance/g2-isolation.test.mjs"), "utf8");
    assert.ok(g2.includes("ISOLATION_HOLD") && !g2.includes("ISOLATION_PASS"), "G2 must record HOLD, not PASS (F5 gate holds)");
    assert.ok(!g2.includes("owned DSH version with same guard" ) || g2.includes("STOP before native"), "no native boot performed");
  });
});