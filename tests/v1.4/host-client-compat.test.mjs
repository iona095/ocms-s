// v1.4.4 Host apply/dispose + Remote/Client/Slot guards (DSH 0.2.1-alpha.2).
//
// Desired simplified Host: apply(ctx) creates exactly one lifecycle
// controller, publishes exactly one OcmsLifecycleService, and returns an
// async disposer that awaits controller.dispose(). No generation coordinator,
// no lease queue, no supersede state. Remote/Client/Slot surfaces are
// unchanged behavior guards: they must stay green without production edits.
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol';

import { assert, HOST_PATH, loadClientSourceModule, nextTestPort } from './helpers.mjs';

const HOST_URL = pathToFileURL(HOST_PATH).href;

let hostModule = null;
let hostLoadError = null;
try {
  hostModule = await import(HOST_URL);
} catch (err) {
  hostLoadError = err;
}
const skip = hostLoadError
  ? 'capability missing: dsh/host.mjs must load in this runtime (' + (hostLoadError && hostLoadError.message) + ')'
  : false;

let clientModule = null;
let clientLoadError = null;
try {
  clientModule = await loadClientSourceModule();
} catch (err) {
  clientLoadError = err;
}
const clientSkip = clientLoadError
  ? 'capability missing: dsh/client.mjs must load in this runtime (' + (clientLoadError && clientLoadError.message) + ')'
  : false;

function occupy(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

// apply() creates exactly one controller and one service, and returns an
// async disposer function.
test('apply publishes exactly one controller and one service', { skip }, async () => {
  const root = new Context();
  const fiber = root.plugin(hostModule.apply, {});
  await fiber;
  try {
    const controller = hostModule.currentController();
    assert.ok(controller !== null, 'exactly one controller published');
    const service = root.get('ocmsLifecycleService');
    assert.ok(service, 'exactly one OcmsLifecycleService published');
    assert.equal(service.typertRemote.serviceKey, 'ocmsLifecycleService', 'service key');
    assert.equal(service.typertRemote.namespace, 'ocms', 'wire namespace');
    assert.equal(service.typertRemote.service?.controller, controller, 'binding points at the live service controller');
    assert.equal((await controller.status()).state, 'OFFLINE', 'controller starts idle');
  } finally {
    await fiber.dispose();
  }
  assert.equal(hostModule.currentController(), null, 'disposal retires the controller');
});

// The disposer awaits controller.dispose(): with disposal held pending, the
// fiber stays unsettled; after release it settles exactly once.
test('disposer awaits controller.dispose()', { skip, timeout: 30_000 }, async () => {
  const root = new Context();
  const fiber = root.plugin(hostModule.apply, {});
  await fiber;
  try {
    const controller = hostModule.currentController();
    assert.ok(controller !== null, 'controller published');
    let release = null;
    const gate = new Promise((resolve) => { release = resolve; });
    const original = controller.dispose.bind(controller);
    controller.dispose = () => gate.then(() => original());
    let settled = false;
    const disposing = fiber.dispose().then(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(settled, false, 'fiber remains unsettled while controller.dispose() is pending');
    release();
    await disposing;
    assert.equal(settled, true, 'fiber settles after controller.dispose() settles');
  } finally {
    try { await fiber.dispose(); } catch { /* already settled */ }
  }
  assert.equal(hostModule.currentController(), null, 'controller retired');
});

// A disposed Host accepts a fresh apply with no stale state.
test('re-apply after dispose publishes fresh with no stale state', { skip }, async () => {
  const root = new Context();
  const first = root.plugin(hostModule.apply, {});
  await first;
  const one = hostModule.currentController();
  assert.ok(one !== null, 'first generation published');
  await first.dispose();
  assert.equal(hostModule.currentController(), null, 'first generation retired');
  const second = root.plugin(hostModule.apply, {});
  await second;
  try {
    const two = hostModule.currentController();
    assert.ok(two !== null, 'second generation published');
    assert.ok(two !== one, 'fresh controller instance');
  } finally {
    await second.dispose();
  }
  assert.equal(hostModule.currentController(), null, 'second generation retired');
});

// Remote descriptor guard: version 1 with the three direct methods.
test('Remote prototype descriptor stays version 1 with status/start/stop', { skip }, async () => {
  const root = new Context();
  const fiber = root.plugin(hostModule.apply, {});
  await fiber;
  try {
    const service = root.get('ocmsLifecycleService');
    const proto = Object.getPrototypeOf(service);
    const descriptor = proto['@deepseek-ai/dsh-typert-protocol/remote-methods'];
    assert.equal(descriptor?.version, 1, 'descriptor version');
    assert.deepEqual(
      descriptor.methods.map((m) => [m.method, m.invocation?.kind]),
      [['status', 'direct'], ['start', 'direct'], ['stop', 'direct']],
      'direct method markers',
    );
  } finally {
    await fiber.dispose();
  }
});

// RemoteError guard: a business failure keeps its code across the mapping.
test('RemoteError business code preserved on occupied-port start', { skip, timeout: 30_000 }, async () => {
  const port = nextTestPort();
  const listener = await occupy(port);
  try {
    const root = new Context();
    const fiber = root.plugin(hostModule.apply, { port });
    await fiber;
    try {
      const service = root.get('ocmsLifecycleService');
      await assert.rejects(
        service.start('http://127.0.0.1:3080'),
        (err) => err instanceof RemoteError && err.code === 'ocms/port-in-use',
        'start on an occupied port must reject with the preserved business code',
      );
    } finally {
      await fiber.dispose();
    }
  } finally {
    await closeServer(listener);
  }
});

// Client contribution guard: manual descriptors satisfy strict input rules.
// v1.4.4 shape: strict codecs carry a create() schema factory (DSH
// 0.2.1-alpha.2 Typert registry admission), not a codec-level schema field.
test('manual Remote contribution carries strict codecs', { skip: clientSkip }, async () => {
  const { OCMS_REMOTE_CONTRIBUTION } = clientModule;
  assert.equal(OCMS_REMOTE_CONTRIBUTION.package, 'ocms-s', 'contribution package');
  assert.equal(OCMS_REMOTE_CONTRIBUTION.descriptors.length, 3, 'three method descriptors');
  for (const descriptor of OCMS_REMOTE_CONTRIBUTION.descriptors) {
    for (const parameter of descriptor.parameters) {
      assert.equal(parameter.codec?.mode, 'strict', descriptor.id + ' param ' + parameter.name + ' has a strict codec');
    }
  }
  const statusCodec = OCMS_REMOTE_CONTRIBUTION.descriptors[0].result;
  assert.deepEqual(
    statusCodec.create().parse({ state: 'OFFLINE', port: 18751 }),
    { state: 'OFFLINE', port: 18751 },
    'status codec accepts a valid payload',
  );
  assert.throws(() => statusCodec.create().parse({ state: 'BOGUS' }), 'status codec rejects an unknown state');
});

// Client face guard: $mount contribution shape, namespace access, slot entry.
test('client face mounts remote and registers the additive Models entry', { skip: clientSkip }, async () => {
  const { createOcmsClient, VIEW_META } = clientModule;
  assert.deepEqual(
    { slot: VIEW_META.slot, id: VIEW_META.id, label: VIEW_META.label, order: VIEW_META.order },
    { slot: 'conversation.view', id: 'models', label: 'Models', order: 30 },
    'Models entry identity',
  );
  const seen = {};
  const fakeNs = {
    async status() { return { ok: true, value: { state: 'OFFLINE', port: 18751 } }; },
  };
  const fakeCtx = {
    remote: {
      async $mount(contribution) {
        seen.contribution = contribution;
        return async () => { seen.unmounted = true; };
      },
    },
    slots: {
      inject(key, factory) { seen.injected = [key, factory]; },
      register(options) { seen.registered = options; return () => {}; },
    },
    get(key) { return key === 'remote.ocms' ? fakeNs : undefined; },
  };
  const face = createOcmsClient({
    createElement: (...args) => ({ element: args }),
    useState: (initial) => [initial, () => {}],
    useEffect: () => {},
  });
  assert.deepEqual(face.inject, ['slots', 'remote'], 'client inject declaration');
  const dispose = await face.apply(fakeCtx);
  assert.equal(seen.contribution?.package, 'ocms-s', '$mount contribution package');
  assert.equal(seen.injected?.[0], 'conversation.view', 'injects into conversation.view');
  seen.injected[1]();
  assert.deepEqual(
    { name: seen.registered?.name, id: seen.registered?.id, order: seen.registered?.order, label: seen.registered?.label },
    { name: 'conversation.view', id: 'models', order: 30, label: 'Models' },
    'additive slot registration',
  );
  await dispose();
  assert.equal(seen.unmounted, true, 'client disposer releases the remote mount');
});

// ---------------------------------------------------------------------------
// v1.4.4 strict-codec create() factory regression (DSH 0.2.1-alpha.2).
// The target Typert registry validates every non-src-json codec at mount
// admission: mode 'strict' + non-empty typeSymbol + create() function. The
// tests below feed the REAL OCMS_REMOTE_CONTRIBUTION into the REAL installed
// 0.2.1-alpha.2 registry admission path.
// ---------------------------------------------------------------------------

const TARGET_REGISTRY_VERSION = '0.2.1-alpha.2';

function targetRegistryScope() {
  const candidates = [];
  if (typeof process.env.APPDATA === 'string' && process.env.APPDATA.length > 0) {
    candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'));
  }
  for (const scope of candidates) {
    if (fs.existsSync(path.join(scope, 'dsh-typert-registry', 'lib', 'index.js'))) return scope;
  }
  return null;
}

async function loadTargetRegistry() {
  const scope = targetRegistryScope();
  if (scope === null) {
    return { skip: 'capability missing: installed DSH 0.2.1-alpha.2 target runtime with @deepseek-ai/dsh-typert-registry was not found' };
  }
  const meta = JSON.parse(fs.readFileSync(path.join(scope, 'dsh-typert-registry', 'package.json'), 'utf8'));
  assert.equal(meta.version, TARGET_REGISTRY_VERSION, 'target registry must be exactly ' + TARGET_REGISTRY_VERSION + ' (got ' + meta.version + ')');
  const cordisMod = await import(pathToFileURL(path.join(scope, 'cordis', 'lib', 'index.js')).href);
  const DshContext = cordisMod.Context ?? cordisMod.default?.Context;
  assert.equal(typeof DshContext, 'function', 'target cordis must export Context');
  const regMod = await import(pathToFileURL(path.join(scope, 'dsh-typert-registry', 'lib', 'index.js')).href);
  const TypertRegistry = regMod.TypertRegistry ?? regMod.default;
  assert.equal(typeof TypertRegistry, 'function', 'target registry must export TypertRegistry');
  const root = new DshContext();
  void new TypertRegistry(root);
  const registry = root.typert ?? root.get('typert');
  assert.ok(registry, 'typert service must be reachable on the target context');
  return { root, registry };
}

function contributionById(contribution, id) {
  const found = contribution.descriptors.find((d) => d.id === id);
  assert.ok(found, 'descriptor ' + id + ' must exist');
  return found;
}

test('framework admission: target Typert registry accepts the OCMS contribution', { skip: clientSkip }, async (t) => {
  const loaded = await loadTargetRegistry();
  if (loaded.skip) { t.skip(loaded.skip); return; }
  const { OCMS_REMOTE_CONTRIBUTION } = clientModule;
  const handle = loaded.registry.remotes.register(OCMS_REMOTE_CONTRIBUTION);
  t.after(() => { try { if (typeof handle === 'function') handle(); } catch { /* best effort */ } });
  assert.ok(handle !== undefined, 'admission returns an effect handle');
  assert.throws(
    () => loaded.registry.remotes.register(OCMS_REMOTE_CONTRIBUTION),
    /already registered/,
    'repeat registration rejected: admission is stateful',
  );
});

test('factory semantics: origin codec create() validates loopback origins', { skip: clientSkip }, async () => {
  const { OCMS_REMOTE_CONTRIBUTION } = clientModule;
  const start = contributionById(OCMS_REMOTE_CONTRIBUTION, 'ocms-s#ocms/start');
  assert.equal(start.parameters.length, 1, 'start takes exactly embedOrigin');
  const codec = start.parameters[0].codec;
  assert.equal(codec.mode, 'strict', 'strict mode');
  assert.equal(codec.typeSymbol, 'ocms-s#embedOrigin', 'type symbol');
  const schema = codec.create();
  assert.equal(typeof schema?.parse, 'function', 'create() returns a schema with parse()');
  assert.equal(schema.parse('http://127.0.0.1:30861'), 'http://127.0.0.1:30861', 'loopback IPv4 accepted');
  assert.equal(schema.parse('http://localhost:18751'), 'http://localhost:18751', 'localhost accepted');
  for (const bad of ['', 'https://example.com/', 'http://127.0.0.1/', 'http://127.0.0.1:abc', 'http://192.168.1.2:3080', 42, null]) {
    assert.throws(() => schema.parse(bad), 'origin rejected: ' + String(bad));
  }
});

test('factory semantics: status codec create() validates lifecycle payloads', { skip: clientSkip }, async () => {
  const { OCMS_REMOTE_CONTRIBUTION } = clientModule;
  const status = contributionById(OCMS_REMOTE_CONTRIBUTION, 'ocms-s#ocms/status');
  const codec = status.result;
  assert.equal(codec.mode, 'strict', 'strict mode');
  assert.equal(codec.typeSymbol, 'ocms-s#LifecycleStatus', 'type symbol');
  const schema = codec.create();
  assert.equal(typeof schema?.parse, 'function', 'create() returns a schema with parse()');
  assert.deepEqual(schema.parse({ state: 'OFFLINE', port: 18751 }), { state: 'OFFLINE', port: 18751 }, 'offline payload accepted');
  assert.deepEqual(
    schema.parse({ state: 'ONLINE', port: 1, url: 'http://127.0.0.1:1/', message: 'hi', embedOrigin: 'http://127.0.0.1:9' }),
    { state: 'ONLINE', port: 1, url: 'http://127.0.0.1:1/', message: 'hi', embedOrigin: 'http://127.0.0.1:9' },
    'full online payload accepted',
  );
  for (const bad of [null, {}, { state: 'BOGUS' }, { state: 'ONLINE', port: 'x' }]) {
    assert.throws(() => schema.parse(bad), 'payload rejected: ' + JSON.stringify(bad));
  }
  assert.deepEqual(schema.parse({ state: 'ONLINE', port: 1, evil: 1 }), { state: 'ONLINE', port: 1 }, 'unknown fields stay dropped');
});
