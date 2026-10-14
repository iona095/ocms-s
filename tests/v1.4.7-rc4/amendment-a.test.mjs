// OCMS-S v1.4.7-rc4 Amendment A: freeze pin plus token-confinement test.
// No live calls, no Apply to a real profile, no acknowledgement.
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { assert, REPO_ROOT } from '../v1.3/helpers.mjs';
import { AMENDMENT_A_FILE, AMENDMENT_A_SHA256, AMENDMENT_A_LINES, amendmentABytes, sha256HexBytes, countTextLines } from './helpers.mjs';

const TOKEN_SENTINEL = 'TOK-9f8e7d6c5b4a3901';
const UI4 = path.join(REPO_ROOT, 'ui', 'index.html');

function A_el(id) {
  const listeners = {}; const touches = { cookie: 0 };
  const el = {
    id, value: '', checked: false, textContent: '', disabled: true,
    dataset: {}, open: false,
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    querySelector() { return A_el(id + ':q'); },
    replaceChildren() {}, append() {},
    showModal() { el.open = true; },
    close() { el.open = false; const cbs = listeners.close || []; for (const fn of cbs) fn(); },
    fire(type, ev) { for (const fn of (listeners[type] || [])) fn(ev || {}); },
  };
  return el;
}

function A_drive() {
  const raw = fs.readFileSync(UI4, 'utf8').split('__OCMS_TOKEN__').join(TOKEN_SENTINEL);
  const start = raw.indexOf('<script>');
  const end = raw.indexOf('</scr' + 'ipt>');
  assert.ok(start !== -1 && end !== -1, 'inline client script found');
  const src = raw.slice(start + 8, end);
  const els = {};
  const radios = [{ value: 'unattested', checked: true }, { value: 'not-running', checked: false }, { value: 'overlays', checked: false }];
  const calls = []; const storeOps = []; const cookieTouches = []; const sessionTouches = []; let ackChecked = false;
  const store = { data: {},
    getItem(k) { storeOps.push(['get', k, null]); return Object.prototype.hasOwnProperty.call(this.data, k) ? this.data[k] : null; },
    setItem(k, v) { storeOps.push(['set', k, v]); this.data[k] = String(v); } };
  const doc = {
    getElementById: (id) => (els[id] = els[id] || A_el(id)),
    querySelector: (sel) => { if (String(sel).indexOf('live-state') !== -1) return radios.find((r) => r.checked) || null; return A_el('q' + sel); },
    body: { dataset: {}, setAttribute() {}, removeAttribute() {} },
    createElement: (tag) => A_el('el-' + tag),
  };
  Object.defineProperty(doc, 'cookie', { configurable: true, get() { cookieTouches.push('get'); return ''; }, set(v) { cookieTouches.push('set:' + v); } });
  const context = { console, document: doc,
    fetch: async (url, opts) => {
      const headers = (opts && opts.body !== undefined && opts.headers) || {};
      calls.push({ url, headers, body: opts && opts.body ? JSON.parse(opts.body) : null });
      if (url === '/api/state') return { ok: true, status: 200, json: async () => ({ ok: true, target: { displayPath: 'x', production: false } }) };
      if (url === '/api/preview') return { ok: true, status: 200, json: async () => A_preview('tok-p1') };
      if (url === '/api/apply') return { ok: true, status: 200, json: async () => ({ ok: true, profile: true, status: 'UPDATED', liveActivation: 'X', backupPath: null }) };
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  };
  context.localStorage = store;
  Object.defineProperty(context, 'session' + 'Storage', { configurable: true, get() { sessionTouches.push('get'); return undefined; } });
  vm.createContext(context);
  vm.runInContext(src, context, { filename: 'client.mjs' });
  const tick = async (n) => { const k = n || 12; for (let i = 0; i < k; i++) await new Promise((r) => setImmediate(r)); };
  return { els, radios, calls, storeOps, cookieTouches, sessionTouches, tick };
}

function A_preview(id) {
  return { ok: true, profile: true, state: 'READY', previewId: id,
    target: { profileName: 'web', profileDirReal: 'C:/h/profiles/x', patchPathReal: 'C:/h/profiles/x/cordis.patch.yml', pluginEntryName: 'llm-pi-ai', classification: 'SCRATCH' },
    attestation: null, attestationText: 'UNATTESTED',
    changes: { added: [], removed: [], moved: [], metadataChanged: [] },
    preservedUnresolved: [], skippedUnresolved: [], unsupportedSkipped: [], fallbackResolved: [],
    endpointBaseDrift: [],
    sources: { goRoster: { ok: true, count: 0 }, zenRoster: { ok: true, count: 0 }, catalog: { ok: true }, goDocs: { ok: true }, zenDocs: { ok: true } },
    routeCounts: {} };
}

describe('v1.4.7-rc4 Amendment A', () => {
  it('amendment A freeze anchor is intact', () => {
    const bytes = amendmentABytes();
    assert.equal(sha256HexBytes(bytes), AMENDMENT_A_SHA256, 'amendment SHA-256 must match the frozen value');
    assert.equal(countTextLines(bytes), AMENDMENT_A_LINES, 'amendment line count must match the frozen value');
    assert.ok(AMENDMENT_A_FILE.length > 0);
  });

  it('A1 token confinement across load, READY and the Apply confirm path', async () => {
    const h = A_drive();
    await h.tick();
    h.els['profile-picker'].value = 'web ';
    h.els['refresh-btn'].fire('click');
    await h.tick();
    assert.equal(h.els['state-badge'].textContent, 'READY');
    h.els['apply-btn'].fire('click');
    assert.equal(h.els['confirm-dialog'].open, true, 'confirm opens (stub-normative flow)');
    h.els['confirm-apply'].fire('click');
    await h.tick();
    for (const [op, k] of h.storeOps) {
      assert.equal(k, 'ocms-s.lastProfile', 'storage op uses the single literal key, got ' + op + ':' + k);
    }
    const sets = h.storeOps.filter((o) => o[0] === 'set');
    assert.ok(sets.length > 0, 'profile name stored');
    for (const [, , v] of sets) { assert.equal(v, 'web', 'stored value is the trimmed profileName'); }
    const seen = JSON.stringify({ ops: h.storeOps, urls: h.calls.map((c) => c.url), bodies: h.calls.map((c) => c.body) });
    assert.ok(!seen.includes(TOKEN_SENTINEL), 'token in no storage key, value, URL or body');
    assert.ok(h.calls.some((c) => c.headers && c.headers['X-OCMS-Token'] === TOKEN_SENTINEL), 'auth header still carries the token');
    assert.equal(h.cookieTouches.length, 0, 'cookie never touched');
    assert.equal(h.sessionTouches.length, 0, 'session storage never touched');
  });

  it('A1 storage references live only inside rememberedStore', () => {
    const html = fs.readFileSync(UI4, 'utf8');
    assert.ok(!html.includes('session' + 'Storage'), 'sessionStorage banned outright');
    assert.ok(!html.includes('document.cookie'), 'document.cookie banned outright');
    assert.equal(html.split('__OCMS_TOKEN__').length - 1, 1, 'bootstrap placeholder occurs exactly once');
    assert.ok(!html.includes('REMEMBERED_KEY'), 'no key indirection anywhere');
    const begin = html.indexOf('function rememberedStore');
    assert.ok(begin >= 0, 'single storage helper rememberedStore present');
    const close = html.indexOf('\n  }\n', begin);
    assert.ok(close > begin, 'helper body closes at top level');
    const end = close + 5;
    const span = html.slice(begin, end);
    for (const m of span.matchAll(/(getItem|setItem)\(\s*([^,)]*)\)/g)) {
      assert.equal(m[2].trim(), "'ocms-s.lastProfile'", 'direct literal key in ' + m[1]);
    }
    assert.ok(!/\.(removeItem|clear|key)\s*\(/.test(span), 'no other storage method');
    assert.ok(!/Storage\s*\[/.test(span), 'no bracket access into storage');
    let at = -1; let count = 0;
    while ((at = html.indexOf('localStorage', at + 1)) !== -1) { count += 1; assert.ok(at > begin && at < end, 'localStorage occurrence inside rememberedStore'); }
    assert.ok(count >= 1, 'storage reference present, got ' + count);
  });
});
