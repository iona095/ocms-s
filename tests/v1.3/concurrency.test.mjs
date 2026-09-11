// OCMS-S v1.3 contract tests — G (concurrency races with deterministic
// barriers, no timing sleeps; contract v1.3 section 16). All tests depend on
// the ui.mjs server capability and conditionally skip until it exists.
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  hasUiServer,
  nextTestPort,
  scratchSettingsFile,
  assertNoBackupOrTemp,
  backupCount,
  tempResidue,
  validSources,
  currentWithExtras,
  fetchFromBodies,
  startTestServer,
  postJson,
  authHeaders,
  validSourceBodies,
  deferred,
} from './helpers.mjs';

const SKIP = !hasUiServer;

test('G1: second concurrent Preview is refused 409 PREVIEW_BUSY while the first build is in progress',
  { skip: SKIP },
  async (t) => {
    const file = scratchSettingsFile(t, currentWithExtras());
    const bodies = validSourceBodies(validSources());
    const buildStarted = deferred();
    const releaseBuild = deferred();
    const fetchFn = async (url) => {
      buildStarted.resolve();
      await releaseBuild.promise;
      const body = bodies[url];
      if (body === undefined) throw new Error('UNEXPECTED_LIVE_NETWORK');
      return { ok: true, status: 200, text: async () => body };
    };
    const started = await startTestServer(t, { settingsPath: file, port: nextTestPort(), fetchFn });
    const first = postJson(started.port, '/api/preview', {}, authHeaders(started.token));
    await buildStarted.promise; // first preview is provably inside acquisition
    try {
      const second = await postJson(started.port, '/api/preview', {}, authHeaders(started.token));
      assert.equal(second.status, 409, 'second concurrent preview refused');
      assert.equal(second.json.code, 'PREVIEW_BUSY');
    } finally {
      releaseBuild.resolve();
      const firstResult = await first;
      assert.equal(firstResult.status, 200, 'first preview completes after release');
      assert.equal(firstResult.json.state, 'READY');
      assertNoBackupOrTemp(path.dirname(file));
    }
  });

test('G2: Apply while a Preview build is in progress is refused, writes nothing, and the preview completes',
  { skip: SKIP },
  async (t) => {
    const file = scratchSettingsFile(t, currentWithExtras());
    const beforeBytes = fs.readFileSync(file);
    const bodies = validSourceBodies(validSources());
    const buildStarted = deferred();
    const releaseBuild = deferred();
    const fetchFn = async (url) => {
      buildStarted.resolve();
      await releaseBuild.promise;
      const body = bodies[url];
      if (body === undefined) throw new Error('UNEXPECTED_LIVE_NETWORK');
      return { ok: true, status: 200, text: async () => body };
    };
    const started = await startTestServer(t, { settingsPath: file, port: nextTestPort(), fetchFn });
    const preview = postJson(started.port, '/api/preview', {}, authHeaders(started.token));
    await buildStarted.promise; // preview build is provably in progress
    try {
      const apply = await postJson(started.port, '/api/apply', { previewId: 'a'.repeat(64) }, authHeaders(started.token));
      assert.equal(apply.status, 409, 'Apply during an in-flight preview build is refused');
      assert.ok(['APPLY_BUSY', 'PREVIEW_BUSY'].includes(apply.json.code), 'contract refusal code, got ' + apply.json.code);
      assert.equal(backupCount(path.dirname(file)), 0, 'no write against a half-built preview');
      assert.deepEqual(fs.readFileSync(file), beforeBytes, 'target untouched');
    } finally {
      releaseBuild.resolve();
      const previewResult = await preview;
      assert.equal(previewResult.status, 200, 'held preview completes cleanly');
      assert.equal(previewResult.json.state, 'READY');
      assert.equal(backupCount(path.dirname(file)), 0, 'still no write');
    }
  });

test('G3: sequential duplicate Apply after success is exactly STALE_PREVIEW with exactly one write',
  { skip: SKIP },
  async (t) => {
    const file = scratchSettingsFile(t, currentWithExtras());
    const started = await startTestServer(t, { settingsPath: file, port: nextTestPort(), fetchFn: fetchFromBodies(validSourceBodies()) });
    const preview = await postJson(started.port, '/api/preview', {}, authHeaders(started.token));
    const first = await postJson(started.port, '/api/apply', { previewId: preview.json.previewId }, authHeaders(started.token));
    assert.equal(first.status, 200);
    assert.equal(first.json.status, 'UPDATED');
    const replay = await postJson(started.port, '/api/apply', { previewId: preview.json.previewId }, authHeaders(started.token));
    assert.equal(replay.status, 409);
    assert.equal(replay.json.code, 'STALE_PREVIEW', 'sequential replay of the consumed preview is stale, never a second write');
    assert.equal(backupCount(path.dirname(file)), 1, 'exactly one backup across both requests');
    assert.equal(tempResidue(path.dirname(file)).length, 0);
  });

test('G4: concurrent duplicate Apply never writes twice and the loser is a contract refusal',
  { skip: SKIP },
  async (t) => {
    const file = scratchSettingsFile(t, currentWithExtras());
    const port = nextTestPort();
    const started = await startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies()) });
    const preview = await postJson(port, '/api/preview', {}, authHeaders(started.token));
    const body = { previewId: preview.json.previewId };
    const headers = authHeaders(started.token);
    // Both requests are fired without awaiting either response first.
    const race = await Promise.all([
      postJson(port, '/api/apply', body, headers),
      postJson(port, '/api/apply', body, headers),
    ]);
    const updated = race.filter((r) => r.status === 200 && r.json && r.json.status === 'UPDATED');
    assert.equal(updated.length, 1, 'exactly one request reports UPDATED');
    for (const res of race) {
      if (res.status !== 200) {
        assert.equal(res.status, 409, 'the loser is a 409 contract refusal');
        assert.ok(['APPLY_BUSY', 'STALE_PREVIEW'].includes(res.json.code), 'loser code is a contract Apply refusal');
      }
    }
    assert.equal(backupCount(path.dirname(file)), 1, 'exactly one backup total');
    assert.equal(tempResidue(path.dirname(file)).length, 0);
  });
