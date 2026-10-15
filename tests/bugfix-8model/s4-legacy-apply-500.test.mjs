// S4 legacy-apply-500 [GLM L12]. A refused legacy commit (commitPlan returns
// result NOT WRITTEN with unresolved reasons) must reach the operator as a typed
// refusal that forwards those reasons; HTTP 500 is for unexpected throws only.
// Scratch target under os.tmpdir(); loopback HTTP; no live calls.
import { it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { assert, makeTempHome, sandboxDshHome, withR2Port } from '../profile-cli-ui/helpers.mjs';
import { postJson, authHeaders, fetchFromBodies, validSourceBodies, startTestServer } from '../v1.3/helpers.mjs';

it('legacy Apply on an unwritable target (directory in place of the file) is a typed NOT_WRITTEN refusal, not HTTP 500', async (t) => {
  const restore = sandboxDshHome();
  const home = makeTempHome('ocms-s4-'); t.after(() => home.cleanup()); t.after(() => { try { restore(); } catch {} });
  const dsh = path.join(home.home, '.dsh'); fs.mkdirSync(dsh, { recursive: true });
  const scratch = path.join(home.home, 'scratch'); fs.mkdirSync(scratch, { recursive: true });
  const file = path.join(scratch, 'my.yaml');
  fs.writeFileSync(file, ['llm:', '  unrelated: true', 'llm-pi-ai:', '  providers: {}', ''].join(String.fromCharCode(10)), 'utf8');
  const started = await withR2Port(t, (port) => startTestServer(t, { settingsPath: file, port, fetchFn: fetchFromBodies(validSourceBodies()), dshHome: dsh }));
  const pv = await postJson(started.port, '/api/preview', {}, authHeaders(started.token));
  assert.equal(pv.json.ok, true, JSON.stringify(pv.json).slice(0, 200));
  fs.rmSync(file, { force: true });
  fs.mkdirSync(file);
  const ap = await postJson(started.port, '/api/apply', { previewId: pv.json.previewId }, authHeaders(started.token));
  assert.notEqual(ap.status, 500, 'a refused commit must not surface as an internal error: ' + JSON.stringify(ap.json).slice(0, 200));
  assert.equal(ap.status, 409, JSON.stringify(ap.json).slice(0, 200));
  assert.equal(ap.json.ok, false);
  assert.equal(ap.json.code, 'NOT_WRITTEN');
  assert.ok(Array.isArray(ap.json.reasons) && ap.json.reasons.length > 0 && ap.json.reasons.every((r) => typeof r === 'string' && r.length > 0), 'unresolved reasons are forwarded');
  assert.equal(fs.statSync(file).isDirectory(), true, 'nothing was written: the directory is untouched');
  assert.equal('backupPath' in ap.json, false, 'a refusal names no recovery path');
});
