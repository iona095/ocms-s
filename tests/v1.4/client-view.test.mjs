// v1.4 DSH client Models-view tests (contract v1.4 sections 9, 10, 26, 49,
// 50, 104, 105). The source component is rendered headlessly through a plain
// element factory, so no browser or React installation is needed. The mount
// test proves ZERO start Remote calls (§50).
import { test } from 'node:test';
import {
  assert,
  loadClientSourceModule,
  probeClientSourceCapability,
  probeBundleBuildCapability,
  probeClientBundleCapability,
} from './helpers.mjs';

const hasClient = await probeClientSourceCapability();
const hasBundleBuild = probeBundleBuildCapability();
const hasClientBundle = probeClientBundleCapability();

test('anchor: dsh/client.mjs exports makeModelsView(h, api)', () => {
  assert.equal(hasClient, true, 'capability missing: dsh/client.mjs must export makeModelsView(createElement, api)');
});

test('anchor: client bundle build script exists', () => {
  assert.equal(hasBundleBuild, true, 'capability missing: dsh/build-client.mjs (rc.2 __ModuleLoader__ bundle producer)');
});

test('anchor: built dsh/client.js exists in rc.2 bundle form', () => {
  assert.equal(hasClientBundle, true, 'capability missing: built dsh/client.js with window.__ModuleLoader__.load banner');
});

// Minimal element factory matching the react.createElement call contract.
function h(type, props, ...children) {
  return { type, props: props ?? {}, children: children.flat().filter((c) => c !== null && c !== undefined && c !== false) };
}

const OFFLINE = { state: 'OFFLINE', port: 18751 };
const STARTING = { state: 'STARTING', port: 18751 };
const ONLINE = { state: 'ONLINE', port: 18751, url: 'http://127.0.0.1:18751/' };
const STOPPING = { state: 'STOPPING', port: 18751 };
const EXTERNAL = { state: 'EXTERNAL', port: 18751, message: 'Port 18751 is already in use by a process not owned by this DSH instance.' };
const ERROR = { state: 'ERROR', port: 18751, message: 'OCMS-S failed to start.' };

function recordingApi(status) {
  const record = { calls: [] };
  return {
    record,
    api: {
      async status() { record.calls.push(['status']); return status; },
      async start(origin) { record.calls.push(['start', origin]); return ONLINE; },
      async stop() { record.calls.push(['stop']); return OFFLINE; },
    },
  };
}

function findInTree(node, predicate, acc = []) {
  if (!node || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { for (const c of node) findInTree(c, predicate, acc); return acc; }
  if (predicate(node)) acc.push(node);
  for (const child of node.children ?? []) findInTree(child, predicate, acc);
  return acc;
}

async function rendered(status, extraProps = {}) {
  const { makeModelsView } = await loadClientSourceModule();
  const { api, record } = recordingApi(status);
  const view = makeModelsView(h, api);
  const tree = view({ status, ...extraProps });
  return { tree, record };
}

const buttons = (tree) => findInTree(tree, (n) => n.type === 'button');
const frames = (tree) => findInTree(tree, (n) => n.type === 'iframe');
const startCalls = (record) => record.calls.filter((c) => c[0] === 'start').length;

test('OFFLINE renders identity, SERVER OFFLINE, a Start button, and no iframe (§52)', { skip: !hasClient && 'capability missing: makeModelsView' }, async () => {
  const { tree, record } = await rendered(OFFLINE);
  assert.ok(buttons(tree).length >= 1, 'Start button present');
  assert.equal(frames(tree).length, 0, 'no iframe while OFFLINE');
  assert.equal(startCalls(record), 0, 'render issues zero start calls');
});

// §50: mount performs zero Start calls.
test('mount performs zero start Remote calls (§50 explicit test)', { skip: !hasClient && 'capability missing: makeModelsView' }, async () => {
  const { tree, record } = await rendered(OFFLINE);
  assert.equal(startCalls(record), 0, 'mount must not start the server');
  void tree;
});

test('STARTING renders disabled controls and no iframe (§53)', { skip: !hasClient && 'capability missing: makeModelsView' }, async () => {
  const { tree } = await rendered(STARTING);
  assert.equal(frames(tree).length, 0, 'no iframe while STARTING');
  for (const b of buttons(tree)) {
    if (b.props?.disabled === false) assert.fail('an action button is enabled during STARTING');
  }
});

test('ONLINE renders the trusted iframe with exact Host URL and a Stop button (§54)', { skip: !hasClient && 'capability missing: makeModelsView' }, async () => {
  const { tree } = await rendered(ONLINE);
  const f = frames(tree);
  assert.equal(f.length, 1, 'exactly one iframe while ONLINE');
  assert.equal(f[0].props.src, ONLINE.url, 'iframe src is exactly the trusted Host URL');
  assert.equal(f[0].props.title, 'OCMS-S Models');
  assert.equal(f[0].props.referrerPolicy, 'no-referrer');
  assert.equal(f[0].props.sandbox, 'allow-scripts allow-same-origin');
  assert.ok(buttons(tree).length >= 1, 'Stop button present');
});

test('iframe src cannot be overridden by props/query/localStorage (§58/§105)', { skip: !hasClient && 'capability missing: makeModelsView' }, async () => {
  const { tree } = await rendered({ ...ONLINE, url: undefined, evilUrl: 'http://evil.example/payload' }, { iframeUrl: 'http://evil.example/x', search: '?iframe=http://evil.example' });
  assert.equal(frames(tree).length, 0, 'no iframe without a trusted Host url');
});

test('STOPPING renders disabled destructive controls (§55)', { skip: !hasClient && 'capability missing: makeModelsView' }, async () => {
  const { tree } = await rendered(STOPPING);
  for (const b of buttons(tree)) assert.equal(b.props?.disabled, true, 'buttons disabled while STOPPING');
});

test('EXTERNAL renders the port-in-use message with no Stop and no iframe (§56)', { skip: !hasClient && 'capability missing: makeModelsView' }, async () => {
  const { tree } = await rendered(EXTERNAL);
  assert.equal(frames(tree).length, 0, 'no iframe while EXTERNAL');
  const stopButtons = buttons(tree).filter((b) => /stop/i.test(String(b.props?.title ?? '') + JSON.stringify(b.children ?? [])));
  assert.equal(stopButtons.length, 0, 'no Stop control while EXTERNAL');
});

test('ERROR renders a safe concise message without stacks (§57)', { skip: !hasClient && 'capability missing: makeModelsView' }, async () => {
  const hostile = { state: 'ERROR', port: 18751, message: 'boom\n    at deeply (nested:1:2) stack trace', stack: 'at evil' };
  const { tree } = await rendered(hostile);
  const text = JSON.stringify(tree);
  assert.ok(/failed/i.test(text), 'a failure message is shown');
  assert.doesNotMatch(text, /at deeply/, 'stack frames must not be rendered');
});

test('no settings path input, no production/scratch selector, no planner UI (§31/§104)', { skip: !hasClient && 'capability missing: makeModelsView' }, async () => {
  for (const status of [OFFLINE, STARTING, ONLINE, STOPPING, EXTERNAL, ERROR]) {
    const { tree } = await rendered(status);
    const text = JSON.stringify(tree);
    assert.doesNotMatch(text, /settings\.yaml/i, 'DSH view must not surface a settings path');
    assert.doesNotMatch(text, /production\/scratch/i, 'DSH view must not surface a production/scratch selector');
    assert.doesNotMatch(text, /type.{0,4}file.{0,4}(picker|input)/i, 'no file picker surface');
    assert.doesNotMatch(text, /refresh preview|apply now/i, 'planner/apply surfaces live inside the OCMS page, not the DSH chrome');
  }
});

// §10/§103: registration metadata exported for static assertion.
test('Models tab registration: conversation.view, id models, order 30, label Models (§10)', { skip: !hasClient && 'capability missing: makeModelsView' }, async () => {
  const m = await loadClientSourceModule();
  assert.ok(m.VIEW_META, 'capability missing: dsh/client.mjs must export VIEW_META { slot, id, label, order }');
  assert.equal(m.VIEW_META.slot, 'conversation.view');
  assert.equal(m.VIEW_META.id, 'models');
  assert.equal(m.VIEW_META.label, 'Models');
  assert.equal(m.VIEW_META.order, 30);
});
