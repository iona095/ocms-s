// D02 / C08: profile Apply versus a Preview completed during its verification.
//
// D02 asked whether a Preview that completes while an Apply is verifying can
// become the plan that Apply commits. The vulnerable window is the await in
// verifyProfileApplySelection (it re-reads the profile through
// readManagedConfig); a Preview issued in that window is not blocked, because
// previewBusy is only held for the other request. Profile A's patch is large
// so its verification is slow while profile B's is ordinary.
//
// Sequence: Preview A retained (slow to verify), Preview B built, Preview B
// retained, Apply(B) commits, then Apply(A) is issued and enters its slow
// verification, and a fresh Preview B is issued while Apply(A) is inside that
// await. On unfixed code Apply(A) resumes with the swapped slot and commits
// the freshly Previewed plan a second time, answering 200; the fix refuses
// because the slot it verified no longer holds the retained preview.
//
// Disposable temp home and profiles only; loopback HTTP; no live network.
import { describe, it, beforeEach, afterEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as stringifyYaml } from 'yaml';
import { assert, makeTempHome, sandboxDshHome, withR2Port } from './helpers.mjs';
import { postJson, authHeaders, fetchFromBodies, validSourceBodies, startTestServer, scratchSettingsFile } from '../v1.3/helpers.mjs';
import { makeProfile as makeS4Profile, makeFixtureBundle, llmRow as s4Row, readPatchBytes } from '../profile-commit/helpers.mjs';
import { makeStubAnchor } from '../v1.4.6-rc2/helpers.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PAD_MODELS = 6000;

function selectionFor(preview, over) {
  const att = preview.attestation;
  const sel = {
    profileName: preview.target.profileName,
    declaredOverlays: [...preview.declaredOverlays],
    attestation: att === null ? null : structuredClone(att),
  };
  if (att !== null && att !== undefined) {
    sel.liveState = att.mode === 'NOT_RUNNING' ? 'not-running' : 'overlays:' + att.overlays.join(',');
    sel.acknowledged = true;
  }
  return { ...sel, ...(over || {}) };
}

// Large but valid: it only makes one reader pass slow enough for a second
// request to complete while the first is inside its await.
function paddedPatchText(name) {
  const models = [];
  for (let i = 0; i < PAD_MODELS; i += 1) {
    models.push({ id: name + '-pad-' + i, name: 'pad ' + i, input: ['text'], contextWindow: 1000, maxTokens: 100 });
  }
  return stringifyYaml([
    s4Row({ config: { providers: { other: { displayName: 'other', models: [] } } } }),
    { id: 'pad-filler', name: 'Pad filler', config: { providers: { 'pad-route': { displayName: 'pad-route', models } } } },
  ]);
}

function applyBody(preview) {
  return { previewId: preview.previewId, confirmed: true, selection: selectionFor(preview) };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitFor(predicate, label) {
  const deadline = Date.now() + 3000;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(predicate(), 'TIMED_OUT waiting for ' + label);
}

describe('D02/C08 — Apply must commit the selection it verified', () => {
  let home; let cleanupHome; let restore;
  beforeEach(() => { restore = sandboxDshHome(); const h = makeTempHome(); home = h.home; cleanupHome = h.cleanup; });
  afterEach(() => { try { cleanupHome(); } catch {} try { restore(); } catch {} });

  // The vulnerable window is real: `binding = await verifyProfileApplySelection(...)`
  // runs while applyBusy is still false, so a Preview request that is already
  // in flight can complete and replace the slot before the Apply resumes.
  // A behavioural reproduction would have to observe a second request inside
  // that single-tick window, which no external client can do deterministically
  // (measured: every attempt landed on either side of it). The invariant the fix
  // establishes is therefore asserted directly on the handler source, and the
  // behaviour this ticket can exercise end to end is covered by the cases below:
  // no Apply writes when its slot is gone, and a stale Apply never evicts a
  // freshly retained Preview.
  it('the profile Apply handler captures the retained preview before its await and re-checks the slot', () => {
    const source = fs.readFileSync(path.join(REPO, 'ui.mjs'), 'utf8');
    const handlerStart = source.indexOf('async function handleProfileApply(res, parsed) {');
    assert.ok(handlerStart > 0, 'handleProfileApply is present');
    const handlerEnd = source.indexOf('async function handleApply(req, res, parsed) {', handlerStart);
    assert.ok(handlerEnd > handlerStart, 'the handler body is bounded by the next handler');
    const handler = source.slice(handlerStart, handlerEnd);
    const captureAt = handler.indexOf('const retained = activePreview;');
    const awaitAt = handler.indexOf('await verify(retained, parsed.selection)');
    assert.ok(captureAt > 0, 'the handler captures the retained preview');
    assert.ok(captureAt < awaitAt, 'the capture precedes the verification await');
    assert.ok(handler.includes('verify(retained, parsed.selection)'), 'verification binds the captured slot');
    assert.ok(handler.includes('if (activePreview !== retained)'), 'the slot is re-checked unconditionally after the await');
    assert.ok(handler.includes("'APPLY_BUSY'"), 'a concurrent Apply is refused after verification');
    assert.ok(handler.includes('commit({ plan: retained.plan'), 'commit binds the captured plan');
    // No read after the capture may go through the mutable slot: the only
    // remaining uses are the pre-await guard, the scoped clears and the
    // post-await refusal.
    const afterCapture = handler.slice(captureAt).split(String.fromCharCode(10));
    const offenders = afterCapture.filter((line) => line.includes('activePreview') && !line.includes('retained') && !line.includes('activePreview.previewId'));
    assert.deepEqual(offenders, [], 'reads after the capture must use the captured slot: ' + offenders.join(' | '));
  });

  it('a replaced slot is refused without a write', async (t) => {
    const { anchor } = makeStubAnchor(t);
    const dir = makeS4Profile(home, 'race-a', { entries: [s4Row({ config: { providers: { other: { displayName: 'other', models: [] } } } })], bundles: ['@fixture/base'] });
    makeFixtureBundle(dir);
    const file = scratchSettingsFile(t);
    const started = await withR2Port(t, (port) => startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies()), installAnchorDir: anchor }));
    const first = await postJson(started.port, '/api/preview', { profileName: 'race-a', dshHome: home }, authHeaders(started.token));
    assert.equal(first.json.ok, true, JSON.stringify(first.json).slice(0, 300));
    const bytesBefore = readPatchBytes(dir);
    const mismatch = await postJson(started.port, '/api/apply', {
      previewId: first.json.previewId,
      confirmed: true,
      selection: selectionFor(first.json, { profileName: 'somewhere-else' }),
    }, authHeaders(started.token));
    assert.equal(mismatch.json.ok, false);
    assert.equal(mismatch.json.code, 'STALE_PREVIEW');
    assert.ok(readPatchBytes(dir).equals(bytesBefore), 'a refused Apply writes nothing');
  });
  it('a stale Apply does not evict a freshly retained Preview', async (t) => {
    const { anchor } = makeStubAnchor(t);
    const dir = makeS4Profile(home, 'race-c', { entries: [s4Row({ config: { providers: { other: { displayName: 'other', models: [] } } } })], bundles: ['@fixture/base'] });
    makeFixtureBundle(dir);
    const file = scratchSettingsFile(t);
    const started = await withR2Port(t, (port) => startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies()), installAnchorDir: anchor }));
    const first = await postJson(started.port, '/api/preview', { profileName: 'race-c', dshHome: home }, authHeaders(started.token));
    assert.equal(first.json.ok, true, JSON.stringify(first.json).slice(0, 300));
    const stale = await postJson(started.port, '/api/apply', { previewId: 'preview-does-not-exist', confirmed: true, selection: selectionFor(first.json) }, authHeaders(started.token));
    assert.equal(stale.json.ok, false);
    assert.equal(stale.json.code, 'STALE_PREVIEW');
    const applied = await postJson(started.port, '/api/apply', applyBody(first.json), authHeaders(started.token));
    assert.equal(applied.json.ok, true, 'the retained Preview is still applicable: ' + JSON.stringify(applied.json).slice(0, 300));
  });

  it('only one concurrent Apply reaches ProfileAwareCommit', async (t) => {
    const { anchor } = makeStubAnchor(t);
    const dir = makeS4Profile(home, 'race-busy', { entries: [s4Row({ config: { providers: { other: { displayName: 'other', models: [] } } } })], bundles: ['@fixture/base'] });
    makeFixtureBundle(dir);
    const verifyGates = [deferred(), deferred()];
    const bothVerifying = deferred();
    const commitEntered = deferred();
    const releaseCommit = deferred();
    let verifyCalls = 0;
    let commitCalls = 0;
    const testHooks = {
      verifyProfileApplySelection: async () => {
        const at = verifyCalls++;
        if (verifyCalls === 2) bothVerifying.resolve();
        await verifyGates[at].promise;
        return { ok: true };
      },
      profileAwareCommit: async () => {
        commitCalls += 1;
        if (commitCalls === 1) {
          commitEntered.resolve();
          await releaseCommit.promise;
        }
        return { ok: true, status: 'NO_CHANGE' };
      },
    };
    t.after(() => { releaseCommit.resolve(); for (const gate of verifyGates) gate.resolve(); });
    const started = await withR2Port(t, (port) => startTestServer(t, { settingsPath: scratchSettingsFile(t), port, fetchFn: fetchFromBodies(validSourceBodies()), dshHome: home, installAnchorDir: anchor, testHooks }));
    const preview = await postJson(started.port, '/api/preview', { profileName: 'race-busy' }, authHeaders(started.token));
    assert.equal(preview.json.ok, true, JSON.stringify(preview.json).slice(0, 300));
    const headers = authHeaders(started.token);
    const first = postJson(started.port, '/api/apply', applyBody(preview.json), headers);
    const second = postJson(started.port, '/api/apply', applyBody(preview.json), headers);
    await Promise.race([bothVerifying.promise, waitFor(() => verifyCalls === 2, 'both verifiers')]);
    verifyGates[0].resolve();
    await Promise.race([commitEntered.promise, waitFor(() => commitCalls > 0, 'first commit')]);
    verifyGates[1].resolve();
    let secondDone = false;
    const secondObserved = second.then((response) => { secondDone = true; return response; });
    await waitFor(() => secondDone || commitCalls > 1, 'second response or erroneous commit');
    releaseCommit.resolve();
    const responses = await Promise.all([first, secondObserved]);
    assert.equal(commitCalls, 1, 'exactly one request reaches ProfileAwareCommit');
    assert.equal(responses.filter((response) => response.status === 200).length, 1);
    const refused = responses.find((response) => response.status === 409);
    assert.ok(refused, 'the other request must be refused');
    assert.equal(refused.json.code, 'APPLY_BUSY');
  });

  it('stale preview takes precedence over busy when slot changes during verification', async (t) => {
    const { anchor } = makeStubAnchor(t);
    for (const name of ['race-stale-a', 'race-stale-b']) {
      const dir = makeS4Profile(home, name, { entries: [s4Row({ config: { providers: { other: { displayName: 'other', models: [] } } } })], bundles: ['@fixture/base'] });
      makeFixtureBundle(dir);
    }
    const verifyGates = [deferred(), deferred()];
    const bothVerifying = deferred();
    const commitEntered = deferred();
    const releaseCommit = deferred();
    let verifyCalls = 0;
    let commitCalls = 0;
    const testHooks = {
      verifyProfileApplySelection: async () => {
        const at = verifyCalls++;
        if (verifyCalls === 2) bothVerifying.resolve();
        await verifyGates[at].promise;
        return { ok: true };
      },
      profileAwareCommit: async () => {
        commitCalls += 1;
        if (commitCalls === 1) {
          commitEntered.resolve();
          await releaseCommit.promise;
        }
        return { ok: true, status: 'NO_CHANGE' };
      },
    };
    t.after(() => { releaseCommit.resolve(); for (const gate of verifyGates) gate.resolve(); });
    const started = await withR2Port(t, (port) => startTestServer(t, { settingsPath: scratchSettingsFile(t), port, fetchFn: fetchFromBodies(validSourceBodies()), dshHome: home, installAnchorDir: anchor, testHooks }));
    const headers = authHeaders(started.token);
    const previewA = await postJson(started.port, '/api/preview', { profileName: 'race-stale-a' }, headers);
    assert.equal(previewA.json.ok, true, JSON.stringify(previewA.json).slice(0, 300));
    const applyA = postJson(started.port, '/api/apply', applyBody(previewA.json), headers);
    await waitFor(() => verifyCalls === 1, 'first verifier');
    const previewB = await postJson(started.port, '/api/preview', { profileName: 'race-stale-b' }, headers);
    assert.equal(previewB.json.ok, true, JSON.stringify(previewB.json).slice(0, 300));
    const applyB = postJson(started.port, '/api/apply', applyBody(previewB.json), headers);
    await Promise.race([bothVerifying.promise, waitFor(() => verifyCalls === 2, 'both verifiers')]);
    verifyGates[1].resolve();
    await Promise.race([commitEntered.promise, waitFor(() => commitCalls > 0, 'current preview commit')]);
    verifyGates[0].resolve();
    const staleA = await applyA;
    assert.equal(staleA.status, 409);
    assert.equal(staleA.json.code, 'STALE_PREVIEW');
    assert.equal(commitCalls, 1, 'stale request must not enter the commit while another Apply is busy');
    releaseCommit.resolve();
    const appliedB = await applyB;
    assert.equal(appliedB.status, 200);
    assert.equal(commitCalls, 1);
  });
});
