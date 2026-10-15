// 0d: server startup must support OS-assigned ephemeral ports.
// Each test owns a scratch settings file; bounded by the shared test timeout.
import { describe, it } from 'node:test';
import net from 'node:net';
import { assert, fetchNever, httpRequest, nextTestPort, scratchSettingsFile, spawnServerOnFreePort, startEphemeralTestServer } from './helpers.mjs';

describe('ephemeral test server ports', () => {
  it('two concurrent servers receive distinct OS-assigned ports', async (t) => {
    const file = scratchSettingsFile(t, {});
    const [first, second] = await Promise.all([
      startEphemeralTestServer(t, { settingsPath: file, fetchFn: fetchNever }),
      startEphemeralTestServer(t, { settingsPath: file, fetchFn: fetchNever })
    ]);
    assert.notEqual(first.port, 0);
    assert.notEqual(second.port, 0);
    assert.notEqual(first.port, second.port);
    const [firstPage, secondPage] = await Promise.all([
      httpRequest({ port: first.port, method: 'GET', urlPath: '/' }),
      httpRequest({ port: second.port, method: 'GET', urlPath: '/' })
    ]);
    assert.equal(firstPage.status, 200);
    assert.equal(secondPage.status, 200);
  });

  it('a spawned server retries an occupied candidate instead of failing', async (t) => {
    const file = scratchSettingsFile(t, {});
    const blocker = net.createServer();
    await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => blocker.close(() => resolve())));
    const blocked = blocker.address().port;
    let calls = 0;
    const spawned = await spawnServerOnFreePort(
      t,
      (port) => ({ args: ['--port=' + port], ports: [port] }),
      ['--settings=' + file, '--no-open'],
      '127.0.0.1:',
      { allocatePort: () => {
        calls += 1;
        return calls === 1 ? blocked : nextTestPort();
      } }
    );
    try {
      assert.equal(spawned.matched, true);
      assert.equal(calls >= 2, true, 'the occupied candidate must be retried');
      assert.notEqual(spawned.ports[0], blocked);
      const page = await httpRequest({ port: spawned.ports[0], method: 'GET', urlPath: '/' });
      assert.equal(page.status, 200);
    } finally {
      spawned.child.kill();
    }
  });
});
