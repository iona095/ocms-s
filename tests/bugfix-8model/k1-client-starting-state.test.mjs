// K1 client-starting-state [report C24; Muse/Sonnet/Space Bunny]. Scratch-only:
// no browser, no React, no live DSH. The stub element factory + stub hooks are
// the only DOM. K0 negative control FIRST: proves the stub harness can fail.
import { describe, it } from 'node:test';
import { assert } from '../v1.4/helpers.mjs';
import { loadClientSourceModule } from '../v1.4/helpers.mjs';

function h(type, props, ...children) {
  return { type, props: props ?? {}, children: children.flat().filter((c) => c !== null && c !== undefined && c !== false) };
}
function findInTree(node, predicate, acc = []) {
  if (!node || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { for (const c of node) findInTree(c, predicate, acc); return acc; }
  if (predicate(node)) acc.push(node);
  for (const child of node.children ?? []) findInTree(child, predicate, acc);
  return acc;
}
const buttons = (tree) => findInTree(tree, (n) => n.type === 'button');
const frames = (tree) => findInTree(tree, (n) => n.type === 'iframe');
const label = (b) => JSON.stringify(b.children ?? []);

// Mount the real OcmsModels component with stub hooks; return captures + tree.
// The face under test is reached through real button onClick wiring only.
async function mountFace(status, lifecycle) {
  const m = await loadClientSourceModule();
  const captures = [];
  const box = { value: null };
  const setStatus = (v) => { box.value = v; captures.push(v); };
  const calls = [];
  const recH = (type, props, ...children) => {
    calls.push([type, props]);
    return h(type, props, ...children);
  };
  const client = m.createOcmsClient({
    createElement: recH,
    useState: (initial) => [box.value, setStatus],
    useEffect: (fn) => { try { const r = fn(); if (r && typeof r.then === 'function') r.catch(() => {}); } catch {} },
  });
  // Reach OcmsModels: apply() with a fake ctx, capture the registered render,
  // then invoke the recorded OcmsModels element type with its props.
  let renderFn = null;
  const fakeCtx = {
    remote: { $mount: async () => async () => {} },
    slots: {
      inject: (k, f) => { f(); },
      register: (opts, fn) => { renderFn = fn; return () => {}; },
    },
    get: () => ({ async status() { return { ok: true, value: status }; }, async start() { return { ok: true, value: status }; }, async stop() { return { ok: true, value: status }; } }),
  };
  await client.apply(fakeCtx);
  const el = renderFn({});
  const OcmsType = el.type;
  const tree = OcmsType(Object.assign({}, el.props, { status, lifecycle }));
  await new Promise((r) => setTimeout(r, 20));
  return { tree, captures, box };
}
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe('K0 stub-DOM negative control (must come first)', () => {
  it('the harness distinguishes a button-bearing tree from an empty one', async () => {
    const m = await loadClientSourceModule();
    const view = m.makeModelsView(h, {});
    const real = view({ status: { state: 'OFFLINE', port: 18751 } });
    assert.ok(buttons(real).length >= 1, 'real OFFLINE tree bears buttons (positive control)');
    const empty = h('div', {}, []);
    assert.equal(buttons(empty).length, 0, 'empty tree bears no buttons');
    assert.throws(() => assert.ok(buttons(empty).length >= 1, 'require a button'), 'harness FAILS on an empty action bar (negative control has teeth)');
  });
});

describe('K1 client-starting-state', () => {
  it('STARTING renders a Refresh control (disabled) instead of an empty action bar', async () => {
    const m = await loadClientSourceModule();
    const view = m.makeModelsView(h, {});
    const tree = view({ status: { state: 'STARTING', port: 18751 } });
    const found = buttons(tree);
    assert.ok(found.length >= 1, 'STARTING must render at least a Refresh control, got ' + found.length + ' buttons');
    assert.ok(found.some((b) => /refresh/i.test(label(b))), 'a Refresh control is present while STARTING');
    assert.equal(frames(tree).length, 0, 'no iframe while STARTING');
  });

  it('a failed Stop surfaces ERROR when the refresh fallback also fails', async () => {
    // Mount refresh succeeds (ONLINE shown); only the post-Stop refresh fails.
    // Without the fix, face.stop keeps the retained ONLINE and this is RED.
    let refreshCalls = 0;
    const online = { state: 'ONLINE', port: 18751, url: 'http://127.0.0.1:18751/' };
    const lifecycle = {
      async refresh() { refreshCalls += 1; if (refreshCalls === 1) return online; throw Object.assign(new Error('gone'), { code: 'ocms/stop-failed' }); },
      async stop() { throw Object.assign(new Error('nope'), { code: 'ocms/stop-failed' }); },
    };
    const { tree, captures } = await mountFace(online, lifecycle);
    assert.equal(captures[captures.length - 1].state, 'ONLINE', 'mount shows ONLINE before Stop is pressed');
    const stop = buttons(tree).find((b) => /stop/i.test(label(b)));
    assert.ok(stop, 'Stop button rendered while ONLINE');
    const before = captures.length;
    await stop.props.onClick();
    await tick();
    assert.ok(captures.length > before, 'setStatus was called after failed Stop (no silent swallow)');
    const last = captures[captures.length - 1];
    assert.equal(last.state, 'ERROR', 'failed Stop + failed refresh surfaces ERROR, got ' + JSON.stringify(last));
  });

  it('a busy/port-in-use Start rejection refreshes status instead of showing ERROR', async () => {
    const external = { state: 'EXTERNAL', port: 18751, message: 'Port 18751 is already in use by a process not owned by this DSH instance.' };
    const lifecycle = {
      async refresh() { return external; },
      async start() { throw Object.assign(new Error('busy'), { code: 'ocms/busy' }); },
    };
    const { tree, captures } = await mountFace({ state: 'OFFLINE', port: 18751 }, lifecycle);
    const start = buttons(tree).find((b) => /start/i.test(label(b)));
    assert.ok(start, 'Start button rendered while OFFLINE');
    await start.props.onClick();
    await tick();
    const last = captures[captures.length - 1];
    assert.ok(last, 'setStatus was called after rejected Start');
    assert.equal(last.state, 'EXTERNAL', 'busy Start refreshes to EXTERNAL, got ' + JSON.stringify(last));
  });
});
