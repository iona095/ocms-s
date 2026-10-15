// S4-B2 transaction ordering and side effects (T05/T08/T13).
import { describe, it, beforeEach, afterEach } from 'node:test';
import path from 'node:path';
import { ProfileAwareCommit } from '../../profile/commit.mjs';
import { assert, makeTempHome, sandboxDshHome, buildReadyPlan, readPatchBytes, readBackupBytes, backupNames, tempNames, patchMtimeMs, minimalSources, makeProfile, bindReal, readerOpts, resolvedStubScope, makeFixtureBundle } from './helpers.mjs';
const WFA = 'write' + 'FileAtomic';
describe('S4-B2 ordering and side effects', () => {
  let home; let restore; let cleanupHome;
  beforeEach(() => { restore = sandboxDshHome(); const h = makeTempHome(); home = h.home; cleanupHome = h.cleanup; });
  afterEach(() => { try { cleanupHome(); } catch {} try { restore(); } catch {} });
  it('backup exact-byte precedes writer; writer gets exact bytes and mode', async (t) => {
    const built = await buildReadyPlan({ home });
    const plan = built.plan; const profileDir = built.profileDir;
    const beforeBytes = readPatchBytes(profileDir);
    let seenArgs = null;
    // T2 (owner decision): the subject here is ProfileAwareCommit's ordering --
    // backup bytes, the mode handed to the writer, temp-file cleanup -- all
    // observed through the injected writer. It does not assert the installed
    // library's internals, so it runs on the stub scope and no longer skips on
    // a clean runner.
    const scope = resolvedStubScope().scope;
    const { pathToFileURL } = await import('node:url');
    const realMod = await import(pathToFileURL(scope + '/dsh-atomic-write/lib/index.mjs').href);
    const realFn = realMod[WFA];
    const res = await ProfileAwareCommit({ plan, waitMs: 8000, deps: { writeFileAtomic: async (p, data, opts) => { seenArgs = { p, len: data.length, mode: opts && opts.mode }; return realFn(p, data, opts); } } });
    assert.equal(res.ok, true); assert.equal(res.status, 'UPDATED');
    assert.ok(seenArgs && seenArgs.mode === 0o600);
    const backs = backupNames(profileDir);
    assert.equal(backs.length, 1);
    assert.ok(readBackupBytes(path.join(profileDir, backs[0])).equals(beforeBytes));
    assert.deepEqual(tempNames(profileDir), []);
  });
  it('NEGATIVE CONTROL: the backup is load-bearing and precedes the writer', async () => {
    // Strengthened after audit. The previous control compared the backup to the
    // POST-write bytes, which is already false in the happy path (the backup
    // holds the pre-write content by design), so it proved only that
    // Buffer.equals can return false.
    //
    // This control makes the positive test's OWN equality load-bearing:
    //   1. inside the writer, the backup must ALREADY exist and ALREADY equal
    //      the pre-write bytes -- the "precedes the writer" claim, true only if
    //      the product wrote the backup before calling the writer;
    //   2. corrupting it afterwards makes that same equality false, so the
    //      positive test's assertion would fail.
    const built = await buildReadyPlan({ home });
    const profileDir = built.profileDir;
    const beforeBytes = readPatchBytes(profileDir);
    const scope = resolvedStubScope().scope;
    const { pathToFileURL } = await import('node:url');
    const realMod = await import(pathToFileURL(scope + '/dsh-atomic-write/lib/index.mjs').href);
    const realFn = realMod[WFA];
    let observedAtWriterTime = null;
    const res = await ProfileAwareCommit({ plan: built.plan, waitMs: 8000, deps: { [WFA]: async (p, data, opts) => {
      const backs = backupNames(profileDir);
      observedAtWriterTime = {
        count: backs.length,
        matchedPreWriteBytes: backs.length > 0
          ? readBackupBytes(path.join(profileDir, backs[0])).equals(beforeBytes)
          : false,
      };
      if (backs.length > 0) {
        const fs = await import('node:fs');
        fs.writeFileSync(path.join(profileDir, backs[0]), 'CORRUPTED-BACKUP', 'utf8');
      }
      return realFn(p, data, opts);
    } } });
    assert.equal(res.ok, true, 'the commit itself still succeeds');
    assert.ok(observedAtWriterTime, 'the writer really was invoked');
    assert.equal(observedAtWriterTime.count, 1, 'exactly one backup exists at the moment the writer runs');
    assert.equal(
      observedAtWriterTime.matchedPreWriteBytes,
      true,
      'the backup already holds the exact pre-write bytes BEFORE the writer runs',
    );
    const backs = backupNames(profileDir);
    assert.equal(backs.length, 1);
    assert.equal(
      readBackupBytes(path.join(profileDir, backs[0])).equals(beforeBytes),
      false,
      'after corruption the positive test own equality (backup === pre-write bytes) is false',
    );
  });
  it('NO_CHANGE invokes neither backup nor writer and preserves mtime', async () => {
    const { readManagedConfig } = await import('../../profile/config-reader.mjs');
    const { buildProfileAwarePlan } = await import('../../profile/plan-builder.mjs');
    const src = minimalSources();
    const first = await buildReadyPlan({ home });
    const desired = first.plan.desired;
    const providers = {};
    for (const [k, v] of Object.entries(desired)) providers[k] = { displayName: k, models: structuredClone(v) };
    const secondRows = [{ id: 'llm-pi-ai', name: '@fixture/dsh-llm-fixture', config: { providers } }];
    const secondDir = makeProfile(home, 'second', { entries: secondRows, bundles: ['@fixture/base'] });
    makeFixtureBundle(secondDir);
    const target2 = bindReal(home, 'second');
    const rr2 = await readManagedConfig(readerOpts(target2));
    assert.equal(rr2.ok, true);
    const plan2 = buildProfileAwarePlan({ target: structuredClone(target2), readerResult: rr2, sources: src });
    assert.equal(plan2.status, 'NO_CHANGE');
    const profileDir2 = path.join(home, 'profiles', 'second');
    const m0 = patchMtimeMs(profileDir2);
    await new Promise((r) => setTimeout(r, 25));
    let writerCalled = false;
    const W2 = 'write' + 'FileAtomic';
    const res = await ProfileAwareCommit({ plan: plan2, waitMs: 8000, deps: { [W2]: async () => { writerCalled = true; throw new Error('must-not-write'); } } });
    assert.equal(res.ok, true); assert.equal(res.status, 'NO_CHANGE');
    assert.equal(writerCalled, false);
    assert.deepEqual(backupNames(profileDir2), []);
    assert.equal(patchMtimeMs(profileDir2), m0);
  });
  it('pre-write refusal creates no backup, temp, or target mutation', async () => {
    const built = await buildReadyPlan({ home });
    const plan = structuredClone(built.plan);
    plan.desired['opencode'] = [{ id: 'dup-x' }];
    plan.desired['opencode-messages'] = [{ id: 'dup-x' }];
    const profileDir = built.profileDir;
    const beforeBytes = readPatchBytes(profileDir);
    const m0 = patchMtimeMs(profileDir);
    const res = await ProfileAwareCommit({ plan, waitMs: 8000 });
    assert.equal(res.ok, false);
    assert.deepEqual(backupNames(profileDir), []);
    assert.deepEqual(tempNames(profileDir), []);
    assert.ok(readPatchBytes(profileDir).equals(beforeBytes));
    assert.equal(patchMtimeMs(profileDir), m0);
  });
});
