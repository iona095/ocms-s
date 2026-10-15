// K7 client-seq-persistence [pass-7 auditor]. K2's sequence guard lives in the
// render closure, so a real React re-render resets it: a slow refresh started
// before the re-render is no longer recognized as stale afterward. The fix
// persists the generation in a ref (useRef when the host provides it).
// This harness models real hook-slot persistence (state slots + one ref object
// shared across explicit rerenders) and drives refresh -> rerender -> stop.
// Stub factory + stub hooks only; no browser, no live DSH.
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

// Hook slots with React persistence semantics: useState slots keep their values
// across rerenders of the same mount; useRef returns one stable object.
function makeHooks() {
  const H = { slots: [], idx: 0, refObj: null, captures: [] };
  return {
    captures: H.captures,
    useState: (initial) => {
      const i = H.idx++;
      if (!(i in H.slots)) H.slots[i] = initial;
      return [H.slots[i], (v) => { H.slots[i] = v; H.captures.push(v); }];
    },
    useEffect: (fn) => { try { const r = fn(); if (r && typeof r.then === 'function') r.catch(() => {}); } catch {} },
    useRef: (initial) => {
      if (H.refObj === null) H.refObj = { current: initial };
      return H.refObj;
    },
    beginRender: () => { H.idx = 0; },
  };
}

async function mountRefFace(status, lifecycle) {
  const m = await loadClientSourceModule();
  const hooks = makeHooks();
  const client = m.createOcmsClient({
    createElement: h, useState: hooks.useState, useEffect: hooks.useEffect, useRef: hooks.useRef,
  });
  let renderFn = null;
  const fakeCtx = {
    remote: { $mount: async () => async () => {} },
    slots: { inject: (k, f) => { f(); }, register: (opts, fn) => { renderFn = fn; return () => {}; } },
    get: () => ({ async status() { return { ok: true, value: status }; }, async start() { return { ok: true, value: status }; }, async stop() { return { ok: true, value: status }; } }),
  };
  await client.apply(fakeCtx);
  const el = renderFn({});
  const OcmsType = el.type;
  const baseProps = Object.assign({}, el.props, { status, lifecycle });
  hooks.beginRender();
  let tree = OcmsType(baseProps);
  await sleep(10);
  return {
    tree, captures: hooks.captures,
    rerender: async () => { hooks.beginRender(); tree = OcmsType(baseProps); await sleep(10); return tree; },
  };
}

describe('K7 client-seq-persistence', () => {
  it('a slow refresh from before a re-render never overwrites a fresh post-render stop', async () => {
    const online = { state: 'ONLINE', port: 18751, url: 'http://127.0.0.1:18751/' };
    const offline = { state: 'OFFLINE', port: 18751 };
    let refreshCalls = 0;
    const lifecycle = {
      // Mount refresh (call 1) fast; every later refresh slow.
      async refresh() { refreshCalls += 1; if (refreshCalls === 1) return online; await sleep(80); return online; },
      async stop() { return offline; },
    };
    const mounted = await mountRefFace(online, lifecycle);
    const refresh = buttons(mounted.tree).find((b) => /refresh/i.test(label(b)));
    assert.ok(refresh, 'Refresh rendered while ONLINE');
    await refresh.props.onClick();
    await sleep(10);
    // A re-render lands (React re-executes the component on any state change)
    // while the slow refresh is still in flight.
    const tree2 = await mounted.rerender();
    const stop = buttons(tree2).find((b) => /stop/i.test(label(b)));
    assert.ok(stop, 'Stop rendered after re-render');
    await stop.props.onClick();
    await sleep(150);
    const last = mounted.captures[mounted.captures.length - 1];
    assert.equal(last.state, 'OFFLINE', 'fresh post-render Stop wins over pre-render refresh, got ' + JSON.stringify(last));
  });

  it('NEGATIVE CONTROL: the ref object is stable across rerenders in this harness', async () => {
    const hooks = makeHooks();
    hooks.beginRender();
    const a = hooks.useRef(0);
    hooks.beginRender();
    const b = hooks.useRef(0);
    assert.equal(a, b, 'same ref object across rerenders (else the test above is vacuous)');
    a.current += 1;
    assert.equal(b.current, 1, 'mutations visible across rerenders');
  });
});
