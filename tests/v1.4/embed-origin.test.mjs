// v1.4 embed-origin parser + framing-policy tests (contract v1.4 sections
// 27, 28, 29, 60-64, 90). Standalone framing stays 'none'; embed mode accepts
// exactly one validated loopback origin; nothing else changes.
import { test } from 'node:test';
import {
  assert,
  loadUiModule,
  probeEmbedOriginCapability,
  nextTestPort,
  scratchSettingsFile,
  V13_SYNC_SHA,
  V13_UI_HTML_SHA,
} from './helpers.mjs';

const hasEmbedOrigin = await probeEmbedOriginCapability();

test('anchor: ui.mjs exports parseEmbedOrigin + startServer seam', () => {
  assert.equal(hasEmbedOrigin, true, 'capability missing: ui.mjs must export parseEmbedOrigin(options) and startServer(options) (contract v1.4 sections 27/32)');
});

// §64/§27 acceptance matrix. Each accepted form must normalize to scheme://host:port.
const ACCEPTED = [
  ['http://127.0.0.1:3080', 'http://127.0.0.1:3080'],
  ['http://localhost:3080', 'http://localhost:3080'],
];

const REJECTED = [
  'https://evil.example',
  'http://evil.example',
  'http://127.0.0.1.evil.example',
  'http://localhost.evil.example',
  'http://user@127.0.0.1:3080',
  'http://127.0.0.1',
  'http://127.0.0.1:0',
  'http://127.0.0.1:99999',
  'http://127.0.0.1:3080/path',
  'http://127.0.0.1:3080/?x=1',
  'http://127.0.0.1:3080/#x',
  '*',
  "'none'",
  'http://127.0.0.1:3080 http://localhost:3080',
  '',
  'http://127.0.0.1:notaport',
  'ftp://127.0.0.1:3080',
];

test('embed-origin: accepted loopback forms normalize', { skip: !hasEmbedOrigin && 'capability missing: parseEmbedOrigin' }, async () => {
  const ui = await loadUiModule();
  for (const [raw, expected] of ACCEPTED) {
    const normalized = ui.parseEmbedOrigin(raw);
    assert.equal(normalized, expected, raw + ' normalizes to ' + expected);
  }
});

test('embed-origin: every rejected form throws', { skip: !hasEmbedOrigin && 'capability missing: parseEmbedOrigin' }, async () => {
  const ui = await loadUiModule();
  for (const raw of REJECTED) {
    assert.throws(() => ui.parseEmbedOrigin(raw), { name: 'Error' }, 'must reject: ' + JSON.stringify(raw));
  }
});

test('embed-origin: duplicate CLI option rejected', { skip: !hasEmbedOrigin && 'capability missing: parseEmbedOrigin' }, async () => {
  const ui = await loadUiModule();
  if (typeof ui.parseCliArgs !== 'function') {
    assert.fail('capability missing: ui.mjs must export parseCliArgs so duplicates are unit-testable');
  }
  assert.throws(() => ui.parseCliArgs(['--no-open', '--embed-origin=http://127.0.0.1:3080', '--embed-origin=http://localhost:3080']));
});

// CSP: standalone keeps 'none'; embed mode exposes exactly one origin; only the
// frame policy changes (§90: compare full response headers standalone vs embed).
async function getCsp(t, { embedOrigin } = {}) {
  const ui = await loadUiModule();
  const settingsPath = scratchSettingsFile(t);
  const port = nextTestPort();
  const started = await ui.startServer({ settingsPath, port, fetchFn: async () => { throw new Error('UNEXPECTED_LIVE_NETWORK'); }, embedOrigin });
  t.after(async () => { try { await started.close(); } catch { /* teardown */ } });
  const res = await fetch('http://127.0.0.1:' + started.port + '/', { headers: { Host: '127.0.0.1:' + started.port } });
  return { res, started };
}

test('CSP standalone: frame-ancestors none (byte-exact policy)', { skip: !hasEmbedOrigin && 'capability missing: startServer' }, async (t) => {
  const { res } = await getCsp(t);
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-security-policy')), /frame-ancestors 'none'/);
});

test('CSP embed mode: exactly one normalized origin', { skip: !hasEmbedOrigin && 'capability missing: startServer embedOrigin' }, async (t) => {
  const { res } = await getCsp(t, { embedOrigin: 'http://127.0.0.1:3080' });
  assert.match(String(res.headers.get('content-security-policy')), /frame-ancestors http:\/\/127\.0\.0\.1:3080(?![^;\d])/);
  assert.doesNotMatch(String(res.headers.get('content-security-policy')), /frame-ancestors[^;]*\*/);
});

test('embed mode changes ONLY the frame policy (headers otherwise identical)', { skip: !hasEmbedOrigin && 'capability missing: startServer embedOrigin' }, async (t) => {
  const standalone = await getCsp(t);
  const embedded = await getCsp(t, { embedOrigin: 'http://127.0.0.1:3080' });
  const names = new Set([...standalone.res.headers.keys(), ...embedded.res.headers.keys()]);
  for (const name of names) {
    if (name.toLowerCase() === 'content-security-policy') continue;
    const a = String(standalone.res.headers.get(name));
    const b = String(embedded.res.headers.get(name));
    if (a !== b) assert.fail('header ' + name + ' must not change between standalone and embed mode (' + a + ' -> ' + b + ')');
  }
  const directivesOf = (res) => new Map(String(res.headers.get('content-security-policy')).split(';').map((d) => d.trim()).map((d) => [d.slice(0, d.indexOf(' ')), d]));
  const sa = directivesOf(standalone.res);
  const sb = directivesOf(embedded.res);
  assert.deepEqual([...sa.keys()].sort(), [...sb.keys()].sort(), 'same CSP directive names');
  for (const [name, value] of sa) {
    if (name !== 'frame-ancestors') assert.equal(value, sb.get(name), 'directive ' + name + ' unchanged in embed mode');
  }
  assert.equal(sb.get('frame-ancestors'), 'frame-ancestors http://127.0.0.1:3080');
});
