// P3-3 RED: browsers omit the default port from Host/Origin, so a UI bound
// to port 80 refuses every ordinary browser request. The validators must
// accept bare loopback Host/Origin exactly when bound to port 80, and keep
// refusing them on every other port. Loopback HTTP only; no live network.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hostAllowed, originAllowed } from '../../ui.mjs';
import { httpRequest, startTestServer, scratchSettingsFile, fetchFromBodies, validSourceBodies, withR2Port } from '../v1.3/helpers.mjs';

const hostReq = (host) => ({ rawHeaders: ['Host', host], headers: { host } });
const originReq = (origin) => ({ headers: { origin } });

describe('P3-3 default-port Host/Origin', () => {
  it('unit: bare loopback Host/Origin accepted only when bound to port 80', () => {
    assert.equal(hostAllowed(hostReq('localhost'), 80), true);
    assert.equal(hostAllowed(hostReq('127.0.0.1'), 80), true);
    assert.equal(hostAllowed(hostReq('localhost:80'), 80), true);
    assert.equal(hostAllowed(hostReq('localhost'), 18751), false);
    assert.equal(hostAllowed(hostReq('localhost:18751'), 18751), true);
    assert.equal(hostAllowed(hostReq('foreign.example'), 80), false);
    assert.equal(originAllowed(originReq('http://localhost'), 80), true);
    assert.equal(originAllowed(originReq('http://127.0.0.1'), 80), true);
    assert.equal(originAllowed(originReq('http://localhost'), 18751), false);
    assert.equal(originAllowed(originReq('http://localhost:18751'), 18751), true);
    assert.equal(originAllowed(originReq('http://evil.example'), 80), false);
  });

  it('http: bare Host still refused on a non-default port', async (t) => {
    const started = await withR2Port(t, (port) => startTestServer(t, { settingsPath: scratchSettingsFile(t), port, fetchFn: fetchFromBodies(validSourceBodies()) }));
    const res = await httpRequest({ port: started.port, method: 'GET', urlPath: '/api/state', hostValue: 'localhost' });
    assert.equal(res.status, 403);
    assert.equal(JSON.parse(res.body).code, 'BAD_HOST');
  });

  it('http: bare Host works when bound to port 80', async (t) => {
    let started;
    try {
      started = await startTestServer(t, { settingsPath: scratchSettingsFile(t), port: 80, fetchFn: fetchFromBodies(validSourceBodies()) });
    } catch (err) {
      const msg = String((err && err.message) || err);
      if ((err && (err.code === 'EACCES' || err.code === 'EADDRINUSE')) || msg.includes('EACCES') || msg.includes('EADDRINUSE')) {
        t.skip('port 80 is not bindable in this environment (' + ((err && err.code) || msg.slice(0, 80)) + ')');
        return;
      }
      throw err;
    }
    assert.equal(started.port, 80);
    const res = await httpRequest({ port: 80, method: 'GET', urlPath: '/api/state', hostValue: 'localhost' });
    assert.equal(res.status, 200, 'bare loopback Host must work on port 80: ' + res.body.slice(0, 200));
  });
});
