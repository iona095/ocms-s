// OCMS-S v1.3 contract tests — E (Apply semantics) and supporting side-effect
// negatives. Every test depends on the ui.mjs server capability and is fully
// written now, conditionally skipping until it exists (contract v1.3
// sections 11, 17). Scratch targets only; source acquisition stubbed.
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parse as parseYaml } from 'yaml';
import {
  sync,
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
  getJson,
  postJson,
  authHeaders,
  validSourceBodies,
} from './helpers.mjs';

const PREVIEW_SKIP = !hasUiServer;

test('E1: Apply requires a previewId (absent identity is refused, nothing is written)',
  { skip: PREVIEW_SKIP },
  async (t) => {
    const file = scratchSettingsFile(t, currentWithExtras());
    const beforeBytes = fs.readFileSync(file);
    const started = await startTestServer(t, { settingsPath: file, port: nextTestPort(), fetchFn: fetchFromBodies(validSourceBodies()) });
    const refusal = await postJson(started.port, '/api/apply', {}, authHeaders(started.token));
    assert.ok(refusal.status === 400 || refusal.status === 409, 'missing identity refused');
    assert.equal(refusal.json.ok, false);
    assert.equal(backupCount(path.dirname(file)), 0, 'no backup');
    assert.equal(tempResidue(path.dirname(file)).length, 0, 'no temp');
    assert.deepEqual(fs.readFileSync(file), beforeBytes, 'no write');
  });

test('E2: a READY retained plan applies through the v1.2 transaction and reports UPDATED',
  { skip: PREVIEW_SKIP },
  async (t) => {
    const file = scratchSettingsFile(t, currentWithExtras());
    const originalBytes = fs.readFileSync(file);
    const started = await startTestServer(t, { settingsPath: file, port: nextTestPort(), fetchFn: fetchFromBodies(validSourceBodies()) });
    const preview = await postJson(started.port, '/api/preview', {}, authHeaders(started.token));
    assert.equal(preview.json.state, 'READY');
    const applied = await postJson(started.port, '/api/apply', { previewId: preview.json.previewId }, authHeaders(started.token));
    assert.equal(applied.status, 200);
    assert.equal(applied.json.status, 'UPDATED');
    assert.equal(applied.json.ok, true);
    assert.equal(typeof applied.json.backupPath, 'string', 'backup path reported');
    const dir = path.dirname(file);
    const backups = fs.readdirSync(dir).filter((n) => n.startsWith('settings.yaml.bak-'));
    assert.equal(backups.length, 1);
    assert.deepEqual(fs.readFileSync(path.join(dir, backups[0])), originalBytes, 'backup bytes are the exact pre-Apply original');
    assert.equal(tempResidue(dir).length, 0, 'temp removed after replacement');
    const written = parseYaml(fs.readFileSync(file, 'utf8'))['llm-pi-ai'].providers;
    assert.deepEqual(written['opencode-go'].models.map((m) => m.id), ['model-a']);
    assert.deepEqual(written.opencode.models.map((m) => m.id), ['model-z']);
  });

test('E3: NO_CHANGE cannot Apply; nothing is manufactured (no backup, no write)',
  { skip: PREVIEW_SKIP },
  async (t) => {
    const file = scratchSettingsFile(t, currentWithExtras());
    assert.equal(sync.syncFromSources({ settingsPath: file, sources: validSources() }).result, 'UPDATED');
    const beforeBytes = fs.readFileSync(file);
    const backups = backupCount(path.dirname(file));
    const started = await startTestServer(t, { settingsPath: file, port: nextTestPort(), fetchFn: fetchFromBodies(validSourceBodies()) });
    const preview = await postJson(started.port, '/api/preview', {}, authHeaders(started.token));
    assert.equal(preview.json.state, 'NO_CHANGE');
    const refusal = await postJson(started.port, '/api/apply', { previewId: preview.json.previewId }, authHeaders(started.token));
    assert.equal(refusal.status, 409);
    assert.equal(refusal.json.code, 'PREVIEW_NOT_READY');
    assert.equal(backupCount(path.dirname(file)), backups, 'NO_CHANGE Apply creates no backup');
    assert.equal(tempResidue(path.dirname(file)).length, 0);
    assert.deepEqual(fs.readFileSync(file), beforeBytes, 'no write manufactured');
  });

test('E4: BLOCKED cannot Apply; no bypass, no backup, no mutation',
  { skip: PREVIEW_SKIP },
  async (t) => {
    const file = scratchSettingsFile(t, currentWithExtras());
    const beforeBytes = fs.readFileSync(file);
    const bodies = validSourceBodies(validSources({ catalog: { go: {} } }));
    const started = await startTestServer(t, { settingsPath: file, port: nextTestPort(), fetchFn: fetchFromBodies(bodies) });
    const preview = await postJson(started.port, '/api/preview', {}, authHeaders(started.token));
    assert.equal(preview.json.state, 'BLOCKED');
    const refusal = await postJson(started.port, '/api/apply', { previewId: preview.json.previewId }, authHeaders(started.token));
    assert.equal(refusal.status, 409);
    assert.equal(refusal.json.code, 'PREVIEW_NOT_READY', 'no bypass for a blocked plan');
    assert.equal(backupCount(path.dirname(file)), 0);
    assert.deepEqual(fs.readFileSync(file), beforeBytes, 'no mutation');
  });

test('E5: Apply performs zero source fetches and zero replanning (retained-plan model)',
  { skip: PREVIEW_SKIP },
  async (t) => {
    const file = scratchSettingsFile(t, currentWithExtras());
    const bodies = validSourceBodies(validSources());
    const seen = [];
    const started = await startTestServer(t, { settingsPath: file, port: nextTestPort(), fetchFn: fetchFromBodies(bodies, seen) });
    const preview = await postJson(started.port, '/api/preview', {}, authHeaders(started.token));
    assert.equal(preview.status, 200);
    assert.equal(seen.length, 5, 'preview fetched the five sources');
    // Poison the acquisition layer: any refetch or replan would now fail.
    for (const key of Object.keys(bodies)) bodies[key] = 'not-parseable-source';
    const applied = await postJson(started.port, '/api/apply', { previewId: preview.json.previewId }, authHeaders(started.token));
    assert.equal(applied.status, 200, 'Apply commits without refetching');
    assert.equal(applied.json.status, 'UPDATED');
    assert.equal(seen.length, 5, 'Apply performed zero source fetches');
    const written = parseYaml(fs.readFileSync(file, 'utf8'))['llm-pi-ai'].providers;
    assert.deepEqual(written['opencode-go'].models.map((m) => m.id), ['model-a'], 'committed arrays are the previewed ones');
  });

test('E6: the committed document equals the CLI-planner document for identical preview inputs',
  { skip: PREVIEW_SKIP },
  async (t) => {
    const sources = validSources();
    const fileA = scratchSettingsFile(t, currentWithExtras());
    assert.equal(sync.syncFromSources({ settingsPath: fileA, sources }).result, 'UPDATED');
    const cliBytes = fs.readFileSync(fileA);

    const fileB = scratchSettingsFile(t, currentWithExtras());
    const started = await startTestServer(t, { settingsPath: fileB, port: nextTestPort(), fetchFn: fetchFromBodies(validSourceBodies()) });
    const preview = await postJson(started.port, '/api/preview', {}, authHeaders(started.token));
    assert.equal(preview.json.state, 'READY');
    const applied = await postJson(started.port, '/api/apply', { previewId: preview.json.previewId }, authHeaders(started.token));
    assert.equal(applied.json.status, 'UPDATED');
    assert.deepEqual(fs.readFileSync(fileB), cliBytes, 'Apply commits exactly the previewed (CLI-equal) document');
  });

test('E7: transaction failure preserves the original target and does not fabricate UPDATED',
  { skip: PREVIEW_SKIP },
  async (t) => {
    const file = scratchSettingsFile(t, currentWithExtras());
    const originalBytes = fs.readFileSync(file);
    const dir = path.dirname(file);
    const started = await startTestServer(t, { settingsPath: file, port: nextTestPort(), fetchFn: fetchFromBodies(validSourceBodies()) });
    const preview = await postJson(started.port, '/api/preview', {}, authHeaders(started.token));
    // Deterministic failure: occupy the temp path with a directory so the
    // v1.2 temp-write step fails after backup (contract v1.2 section 15).
    fs.mkdirSync(file + '.tmp');
    const failure = await postJson(started.port, '/api/apply', { previewId: preview.json.previewId }, authHeaders(started.token));
    assert.equal(failure.status, 500, 'unexpected internal failure surfaces as ERROR');
    assert.equal(failure.json.code, 'ERROR');
    assert.notEqual(failure.json.status, 'UPDATED', 'failure never fabricates UPDATED');
    assert.deepEqual(fs.readFileSync(file), originalBytes, 'original preserved');
    assert.equal(backupCount(dir), 1, 'backup was created before the failed replacement');
    fs.rmdirSync(file + '.tmp');
    const retry = await postJson(started.port, '/api/apply', { previewId: preview.json.previewId }, authHeaders(started.token));
    assert.equal(retry.status, 200, 'failed Apply does not consume the preview');
    assert.equal(retry.json.status, 'UPDATED');
  });
