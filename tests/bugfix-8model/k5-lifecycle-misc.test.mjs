// K5 lifecycle-misc [Muse/Space Bunny/GLM]. Fault-injected fakes and a minimal host
// ctx only; every wait bounded; controllers disposed. probePortTcp is documented
// CODE-VERIFIED (timeout option + handler already present); the timers double is
// deleted as dead (see commit message).
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  assert, loadLifecycleModule, probeLifecycleCapability, makeDeps, readinessSequence,
  assertOcmsFailure, childDouble, HOST_PATH, loadClientSourceModule,
} from '../v1.4/helpers.mjs';

const hasLifecycle = await probeLifecycleCapability();
const skip = !hasLifecycle ? 'capability missing: createLifecycleController' : false;
const ORIGIN = 'http://127.0.0.1:3080';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let hostModule = null;
let hostLoadError = null;
try {
  hostModule = await import(pathToFileURL(HOST_PATH).href);
} catch (err) {
  hostLoadError = err;
}
const hostSkip = hostLoadError ? 'capability missing: dsh/host.mjs must load (' + (hostLoadError && hostLoadError.message) + ')' : false;

async function make(overrides = {}) {
  const { deps, record } = makeDeps({ deadlineMs: 2000, intervalMs: 10, ...overrides });
  const { createLifecycleController } = await loadLifecycleModule();
  return { controller: createLifecycleController(deps), deps, record };
}

function fakeHostCtx(slotCalls) {
  return {
    root: {},
    fiber: { assertActive() {} },
    reflect: { provide() { return () => {}; } },
    slots: {
      inject(slot, factory) {
        slotCalls.push(['inject', slot]);
        const r = factory();
        return () => { slotCalls.push(['dispose-inject']); };
      },
      register(opts) {
        slotCalls.push(['register', opts && opts.id]);
        return () => { slotCalls.push(['dispose-register']); };
      },
    },
    get: () => undefined,
  };
}

describe('K5 lifecycle-misc', () => {
  it('EXTERNAL carries its port-in-use message on emission, not after', { skip }, async () => {
    const seen = [];
    const { controller } = await make({
      probePort: async () => 'occupied',
      onState: (s) => seen.push(s),
    });
    try {
      await assert.rejects(controller.start({ embedOrigin: ORIGIN }), (err) => {
        assertOcmsFailure(err, 'ocms/port-in-use');
        return true;
      });
      const ext = seen.filter((s) => s.state === 'EXTERNAL');
      assert.ok(ext.length >= 1, 'EXTERNAL was emitted');
      assert.ok(typeof ext[0].message === 'string' && ext[0].message.includes('already in use'),
        'EXTERNAL payload carries the message, got ' + JSON.stringify(ext[0]));
    } finally {
      try { await controller.dispose(); } catch {}
    }
  });

  it('ERROR to OFFLINE drops the stale failure message', { skip }, async () => {
    let childRef = null;
    const { controller } = await make({
      probeHttp: async () => ({ ok: false, status: 0, json: null }),
      spawnFn(cmd, args, opts) { childRef = childDouble(); return childRef; },
    });
    try {
      const failing = controller.start({ embedOrigin: ORIGIN });
      await sleep(30);
      childRef.fireError(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
      await assert.rejects(failing, (err) => { assertOcmsFailure(err); return true; });
      assert.ok(typeof (await controller.status()).message === 'string', 'ERROR carries a message first');
      childRef.fire('close', -2, null);
      await sleep(20);
      const after = await controller.status();
      assert.equal(after.state, 'OFFLINE', 'close reconciles to OFFLINE');
      assert.ok(!('message' in after), 'OFFLINE carries no stale failure message, got ' + JSON.stringify(after));
    } finally {
      try { if (childRef && !childRef.exited) childRef.fireExit(0); } catch {}
      try { await controller.dispose(); } catch {}
    }
  });

  it('a disposed-during-probe Start emits OFFLINE at most once (no duplicate)', { skip }, async () => {
    let releaseProbe = null;
    const probeGate = new Promise((resolve) => { releaseProbe = resolve; });
    const seen = [];
    const { controller } = await make({
      probePort: () => probeGate.then(() => 'free'),
      probeHttp: readinessSequence([{ ok: true, status: 200, json: { ok: true } }]),
      onState: (s) => seen.push(s.state),
    });
    const started = controller.start({ embedOrigin: ORIGIN });
    await sleep(20);
    const disposing = controller.dispose();
    releaseProbe();
    await assert.rejects(started, (err) => { assertOcmsFailure(err, 'ocms/start-failed'); return true; });
    await disposing;
    const offlineCount = seen.filter((s) => s === 'OFFLINE').length;
    assert.ok(offlineCount <= 1, 'OFFLINE emitted at most once, got ' + offlineCount + ' in ' + JSON.stringify(seen));
  });

  // The slots leak is in the plugin-face apply (dsh/client.mjs): it drops the
  // inject/register handles and its disposer releases only the remote mount.
  it('plugin-face dispose releases the slots inject/register handles (no leak)', { skip }, async () => {
    const m = await loadClientSourceModule();
    const slotCalls = [];
    const seen = {};
    const fakeCtx = {
      remote: {
        $mount: async () => { slotCalls.push(['mount']); return async () => { slotCalls.push(['dispose-remote']); }; },
      },
      slots: {
        inject(slot, factory) {
          slotCalls.push(['inject', slot]);
          seen.factory = factory;
          return () => { slotCalls.push(['dispose-inject']); };
        },
        register(opts) {
          slotCalls.push(['register', opts && opts.id]);
          return () => { slotCalls.push(['dispose-register']); };
        },
      },
      get: () => undefined,
    };
    const face = m.createOcmsClient({
      createElement: (...args) => ({ element: args }),
      useState: (initial) => [initial, () => {}],
      useEffect: () => {},
    });
    const dispose = await face.apply(fakeCtx);
    seen.factory();
    assert.ok(slotCalls.some((c) => c[0] === 'register'), 'register handle acquired');
    await dispose();
    assert.ok(slotCalls.some((c) => c[0] === 'dispose-remote'), 'remote mount still released');
    assert.ok(slotCalls.some((c) => c[0] === 'dispose-register'), 'register handle released');
    assert.ok(slotCalls.some((c) => c[0] === 'dispose-inject'), 'inject handle released');
  });

  it('an invalid configured port falls back to the default with a diagnostic (not silently)', { skip: hostSkip }, async () => {
    for (const badPort of [0, 65536, 3.5]) {
      const slotCalls = [];
      const warnings = [];
      const origWarn = console.warn;
      console.warn = (...args) => { warnings.push(args.join(' ')); };
      let dispose = null;
      try {
        dispose = await hostModule.apply(fakeHostCtx(slotCalls), { port: badPort });
      } finally {
        console.warn = origWarn;
      }
      try {
        const controller = hostModule.currentController();
        assert.ok(controller, 'controller published');
        assert.equal((await controller.status()).port, 18751, 'port ' + badPort + ' falls back to 18751');
        assert.ok(warnings.some((w) => w.includes(String(badPort))), 'a diagnostic names the rejected port ' + badPort + ', got ' + JSON.stringify(warnings));
      } finally {
        try { await dispose(); } catch {}
      }
    }
  });
});
