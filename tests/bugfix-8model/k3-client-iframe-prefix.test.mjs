// K3 client-iframe-prefix [Muse/Space Bunny]. The iframe src prefix check accepts
// "http://127.0.0.1:@evil.example/": it starts with the trusted prefix but parses
// with host evil.example (userinfo "127.0.0.1:"). Parse with URL, compare origin,
// reject credentials. Stub factory only; no browser, no live DSH.
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
const frames = (tree) => findInTree(tree, (n) => n.type === 'iframe');

describe('K3 client-iframe-prefix', () => {
  it('a userinfo-smuggled URL renders no iframe', async () => {
    const m = await loadClientSourceModule();
    const view = m.makeModelsView(h, {});
    const tree = view({ status: { state: 'ONLINE', port: 18751, url: 'http://127.0.0.1:@evil.example/' } });
    assert.equal(frames(tree).length, 0, 'evil.example must never reach an iframe src');
  });

  it('a credential-bearing loopback URL renders no iframe', async () => {
    const m = await loadClientSourceModule();
    const view = m.makeModelsView(h, {});
    const tree = view({ status: { state: 'ONLINE', port: 18751, url: 'http://admin:secret@127.0.0.1:18751/' } });
    assert.equal(frames(tree).length, 0, 'credentials must never reach an iframe src');
  });

  it('NEGATIVE CONTROL: the exact trusted Host URL still renders its iframe', async () => {
    const m = await loadClientSourceModule();
    const view = m.makeModelsView(h, {});
    const tree = view({ status: { state: 'ONLINE', port: 18751, url: 'http://127.0.0.1:18751/' } });
    assert.equal(frames(tree).length, 1, 'trusted URL keeps its iframe');
    assert.equal(frames(tree)[0].props.src, 'http://127.0.0.1:18751/');
  });
});
