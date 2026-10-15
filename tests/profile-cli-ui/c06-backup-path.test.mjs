// C06: the legacy Apply response must describe a backup that exists.
//
// commitPlan names each backup after the target it replaced, but the server
// scanned for a hard-coded settings.yaml.bak- prefix and, when the scan found
// nothing, returned the invented path <target>.bak. For a scratch target with
// any other basename the operator was pointed at a file that never existed.
//
// Disposable temp target with a custom basename; loopback HTTP; no live calls.
import { describe, it, beforeEach, afterEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { assert, makeTempHome, sandboxDshHome, withR2Port } from './helpers.mjs';
import { postJson, authHeaders, fetchFromBodies, validSourceBodies, startTestServer } from '../v1.3/helpers.mjs';

const CUSTOM_NAME = 'my-ocms-settings.yaml';

async function startedWithCustomTarget(t) {
  const home = makeTempHome('ocms-c06-');
  t.after(() => home.cleanup());
  const dsh = path.join(home.home, '.dsh');
  fs.mkdirSync(dsh, { recursive: true });
  // Scratch means outside the DSH home: a file inside ~/.dsh is production by
  // definition. The target lives beside the home, in its own scratch folder.
  const scratch = path.join(home.home, 'scratch');
  fs.mkdirSync(scratch, { recursive: true });
  const file = path.join(scratch, CUSTOM_NAME);
  fs.writeFileSync(file, ['llm:', '  unrelated: true', 'llm-pi-ai:', '  providers: {}', ''].join(String.fromCharCode(10)), 'utf8');
  const started = await withR2Port(t, (port) => startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies()), dshHome: dsh }));
  return { dir: scratch, file, started };
}

describe('C06 — legacy Apply backup path', () => {
  let restore;
  beforeEach(() => { restore = sandboxDshHome(); });
  afterEach(() => { try { restore(); } catch {} });

  it('reports the real backup created beside a custom-basename scratch target', async (t) => {
    const { dir, file, started } = await startedWithCustomTarget(t);
    const preview = await postJson(started.port, '/api/preview', {}, authHeaders(started.token));
    assert.equal(preview.json.ok, true, JSON.stringify(preview.json).slice(0, 300));
    const applied = await postJson(started.port, '/api/apply', { previewId: preview.json.previewId }, authHeaders(started.token));
    assert.equal(applied.json.ok, true, JSON.stringify(applied.json).slice(0, 300));
    assert.equal(applied.json.status, 'UPDATED');
    assert.equal(typeof applied.json.backupPath, 'string', 'an UPDATED write reports its recovery path');
    assert.ok(fs.existsSync(applied.json.backupPath), 'the reported backup must exist: ' + String(applied.json.backupPath));
    assert.equal(path.dirname(applied.json.backupPath), dir, 'the backup lives beside the target');
    assert.ok(path.basename(applied.json.backupPath).startsWith(CUSTOM_NAME + '.bak-'), 'the backup carries the target basename: ' + path.basename(applied.json.backupPath));
    assert.ok(!applied.json.backupPath.endsWith('.bak'), 'the invented <target>.bak path must never be reported');
    assert.equal(fs.readFileSync(applied.json.backupPath, 'utf8').includes('unrelated: true'), true, 'the backup holds the pre-apply bytes');
    assert.equal(fs.readFileSync(file, 'utf8').includes('model-a') || fs.readFileSync(file, 'utf8').includes('model-z'), true, 'the target was actually updated');
  });

  it('never reports a backup for a refusal', async (t) => {
    const { started } = await startedWithCustomTarget(t);
    const refused = await postJson(started.port, '/api/apply', { previewId: 'no-such-preview' }, authHeaders(started.token));
    assert.equal(refused.json.ok, false);
    assert.equal(refused.json.code, 'STALE_PREVIEW');
    assert.equal('backupPath' in refused.json, false, 'a refusal names no recovery path');
  });
});
