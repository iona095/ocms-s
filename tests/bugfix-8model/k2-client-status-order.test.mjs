// K2 client-status-order [report C24; Space Bunny]. Unordered setStatus writes:
// refresh-then-stop where stop settles first leaves ONLINE with an iframe on a
// dead port. A generation/sequence guard must drop the stale refresh.
// Stub DOM + stub hooks only; no browser, no live DSH.
import { describe, it } from 'node:test';
import { assert, loadClientSourceModule } from '../v1.4/helpers.mjs';

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
const label = (b) => JSON.stringify(b.children ?? []);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mountFace(status, lifecycle) {
  const m = await loadClientSourceModule();
  const captures = [];
  const box = { value: null };
  const setStatus = (v) => { box.value = v; captures.push(v); };
  const recH = (type, props, ...children) => h(type, props, ...children);
  const client = m.createOcmsClient({
    createElement: recH,
    useState: (initial) => [box.value, setStatus],
    useEffect: (fn) => { try { const r = fn(); if (r && typeof r.then === 'function') r.catch(() => {}); } catch {} },
  });
  let renderFn = null;
  const fakeCtx = {
    remote: { $mount: async () => async () => {} },
    slots: { inject: (k, f) => { f(); }, register: (opts, fn) => { renderFn = fn; return () => {}; } },
    get: () => ({ async status() { return { ok: true, value: status }; }, async start() { return { ok: true, value: status }; }, async stop() { return { ok: true, value: status }; } }),
  };
  await client.apply(fakeCtx);
  const el = renderFn({});
  const tree = el.type(Object.assign({}, el.props, { status, lifecycle }));
  await sleep(10);
  return { tree, captures, box };
}

describe('K2 client-status-order', () => {
  it('refresh-then-stop: the stale slow refresh never overwrites the fresh stop', async () => {
    const online = { state: 'ONLINE', port: 18751, url: 'http://127.0.0.1:18751/' };
    const offline = { state: 'OFFLINE', port: 18751 };
    let refreshCalls = 0;
    const lifecycle = {
      // Mount refresh (call 1) is fast; the user refresh (call 2) is slow.
      async refresh() { refreshCalls += 1; if (refreshCalls === 1) return online; await sleep(80); return online; },
      async stop() { return offline; },
    };
    const { tree, captures } = await mountFace(online, lifecycle);
    const refresh = buttons(tree).find((b) => /refresh/i.test(label(b)));
    const stop = buttons(tree).find((b) => /stop/i.test(label(b)));
    assert.ok(refresh && stop, 'ONLINE renders Refresh and Stop');
    await refresh.props.onClick();
    await sleep(10);
    await stop.props.onClick();
    await sleep(150);
    const last = captures[captures.length - 1];
    assert.equal(last.state, 'OFFLINE', 'fresh Stop wins over stale refresh, got ' + JSON.stringify(last));
  });

  it('stop-then-refresh: the fresh slow refresh still applies (guard drops only stale writes)', async () => {
    const online = { state: 'ONLINE', port: 18751, url: 'http://127.0.0.1:18751/' };
    const offline = { state: 'OFFLINE', port: 18751 };
    let refreshCalls = 0;
    const lifecycle = {
      async refresh() { refreshCalls += 1; if (refreshCalls === 1) return online; await sleep(60); return offline; },
      async stop() { return offline; },
    };
    const { tree, captures } = await mountFace(online, lifecycle);
    const refresh = buttons(tree).find((b) => /refresh/i.test(label(b)));
    const stop = buttons(tree).find((b) => /stop/i.test(label(b)));
    await stop.props.onClick();
    await sleep(10);
    await refresh.props.onClick();
    await sleep(120);
    const last = captures[captures.length - 1];
    assert.equal(last.state, 'OFFLINE', 'fresh refresh applies, got ' + JSON.stringify(last));
  });
});
