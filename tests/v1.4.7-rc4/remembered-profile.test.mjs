// OCMS-S v1.4.7-rc4 remembered-profile test: P1 prefill/store rules.
// node:vm pure-function checks plus stub-DOM client runs. No live calls,
// no Apply, no acknowledgement, no real profiles.
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { assert, REPO_ROOT } from '../v1.3/helpers.mjs';
import { validateProfileName } from '../../profile/target-resolver.mjs';

const UI4 = path.join(REPO_ROOT, 'ui', 'index.html');
const R_html = () => fs.readFileSync(UI4, 'utf8');
const R_pureSrc = (src, name) => { const s = '// __PURE:' + name + ':START'; const e = '// __PURE:' + name + ':END'; const i = src.indexOf(s), j = src.indexOf(e); assert.ok(i >= 0 && j > i, '__PURE banners present for ' + name); return src.slice(i, j + e.length); };
const R_load = (fnSrc, fnName) => { const sb = {}; vm.createContext(sb); vm.runInContext(fnSrc + '\nthis.__fn = ' + fnName + ';', sb); assert.equal(typeof sb.__fn, 'function', fnName + ' loads in node:vm'); return sb.__fn; };

const NAME_TABLE = ['web', 'atlas', 'a', 'Z9', 'ok_name-1.2', 'UNDER_SCORE', 'mix.Ed-9_x', 'x'.repeat(128), 'x'.repeat(129), '', '   ', 'a/b', 'back\\slash', 'has space', '.', '..', 'node_modules', 'NODE_MODULES', 'Node_Modules', '-lead', 'trail.', 'trail ', 'nul', 'NUL', 'com1', 'COM9', 'lpt1', 'aux.txt', 'con.log', 'prn', '9lead', '.hidden', 'a..b', '-'];

function R_el(id) {
  const listeners = {};
  const el = {
    id, value: '', checked: false, textContent: '', disabled: true,
    dataset: {}, open: false,
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    querySelector() { return R_el(id + ':q'); },
    replaceChildren() {}, append() {},
    showModal() { el.open = true; },
    close() { el.open = false; const cbs = listeners.close || []; for (const fn of cbs) fn(); },
    fire(type, ev) { for (const fn of (listeners[type] || [])) fn(ev || {}); },
  };
  return el;
}

function R_drive(storage, routes) {
  const html = R_html();
  const start = html.indexOf('<script>');
  const end = html.indexOf('</scr' + 'ipt>');
  assert.ok(start !== -1 && end !== -1, 'inline client script found');
  const src = html.slice(start + 8, end);
  const els = {};
  const radios = [{ value: 'unattested', checked: true }, { value: 'not-running', checked: false }, { value: 'overlays', checked: false }];
  const calls = []; const stored = { sets: [] };
  const store = storage === 'absent' ? undefined : storage === 'throw' ? {
    getItem() { throw new Error('DENIED'); },
    setItem() { throw new Error('DENIED'); },
  } : {
    data: { ...(storage || {}) },
    getItem(k) { return Object.prototype.hasOwnProperty.call(this.data, k) ? this.data[k] : null; },
    setItem(k, v) { stored.sets.push([k, v]); this.data[k] = String(v); },
  };
  const context = {
    console,
    document: {
      getElementById: (id) => (els[id] = els[id] || R_el(id)),
      querySelector: (sel) => {
        if (String(sel).indexOf('live-state') !== -1) return radios.find((r) => r.checked) || null;
        return R_el('q' + sel);
      },
      body: { dataset: {}, setAttribute() {}, removeAttribute() {} },
      createElement: (tag) => R_el('el-' + tag),
    },
    fetch: async (url, opts) => {
      const body = opts && opts.body ? JSON.parse(opts.body) : null;
      calls.push({ url, body });
      return { ok: true, status: 200, json: async () => routes(url, body) };
    },
  };
  if (store !== undefined) context.localStorage = store;
  vm.createContext(context);
  vm.runInContext(src, context, { filename: 'client.mjs' });
  const tick = async (n) => { const k = n || 10; for (let i = 0; i < k; i++) await new Promise((r) => setImmediate(r)); };
  return { els, radios, calls, stored, tick };
}

function R_profilePreview(id, profileName) {
  return {
    ok: true, profile: true, state: 'READY', previewId: id,
    target: { profileName: profileName || 'zzz', profileDirReal: 'C:/h/profiles/x', patchPathReal: 'C:/h/profiles/x/cordis.patch.yml', pluginEntryName: 'llm-pi-ai', classification: 'SCRATCH' },
    attestation: null, attestationText: 'UNATTESTED',
    changes: { added: [], removed: [], moved: [], metadataChanged: [] },
    preservedUnresolved: [], skippedUnresolved: [], unsupportedSkipped: [], fallbackResolved: [],
    endpointBaseDrift: [],
    sources: { goRoster: { ok: true, count: 0 }, zenRoster: { ok: true, count: 0 }, catalog: { ok: true }, goDocs: { ok: true }, zenDocs: { ok: true } },
    routeCounts: {},
  };
}
function R_routes(preview) {
  return (url) => {
    if (url === '/api/state') return { ok: true, target: { displayPath: 'x', production: false } };
    if (url === '/api/preview') return preview;
    return { ok: true };
  };
}

describe('v1.4.7-rc4 remembered profile', () => {
  it('P1 pure decision: valid stored names prefill, rest stay empty', () => {
    const fn = R_load(R_pureSrc(R_html(), 'resolveRememberedProfile'), 'resolveRememberedProfile');
    assert.equal(fn('web', ''), 'web');
    assert.equal(fn('atlas', ''), 'atlas');
    assert.equal(fn('  atlas  ', ''), '', 'padded raw rejected like the server');
    assert.equal(fn('', ''), '');
    assert.equal(fn(null, ''), '');
    assert.equal(fn(undefined, ''), '');
    assert.equal(fn('web', 'other'), '');
    assert.equal(fn('web', '  '), 'web');
    for (const bad of ['a/b', 'has space', '.', '..', 'node_modules', '-lead', 'trail.', 'nul']) {
      assert.equal(fn(bad, ''), '', 'rejects: ' + bad);
    }
  });

  it('P1 grammar parity with the server validator over one table', () => {
    const fn = R_load(R_pureSrc(R_html(), 'resolveRememberedProfile'), 'resolveRememberedProfile');
    for (const name of NAME_TABLE) {
      const pageAccepts = fn(name, '') !== '';
      const serverAccepts = validateProfileName(name).ok === true;
      assert.equal(pageAccepts, serverAccepts, 'parity for ' + JSON.stringify(name));
    }
  });

  it('P1 load prefill without preview, attestation or ack', async () => {
    const h = R_drive({ 'ocms-s.lastProfile': 'web' }, R_routes(R_profilePreview('p1')));
    await h.tick();
    assert.equal(h.els['profile-picker'].value, 'web');
    assert.ok(h.calls.some((c) => c.url === '/api/state'), 'boot state loads');
    assert.ok(!h.calls.some((c) => c.url === '/api/preview'), 'prefill never previews');
    assert.equal(h.radios[0].checked, true, 'attestation untouched');
    assert.equal(h.els['attest-ack'].checked, false, 'acknowledgment untouched');
  });

  it('P1 invalid, absent and throwing storage stay empty and silent', async () => {
    for (const storage of [{ 'ocms-s.lastProfile': 'a/b' }, {}, 'absent', 'throw']) {
      const h = R_drive(storage, R_routes(R_profilePreview('p2')));
      await h.tick();
      assert.equal(h.els['profile-picker'].value, '', 'empty for ' + JSON.stringify(storage));
    }
  });

  it('P1 status payload never writes the picker; nothing stored before READY', async () => {
    const h = R_drive({}, (url) => {
      if (url === '/api/state') return { ok: true, target: { displayPath: 'x', production: false } };
      if (url === '/api/preview') return { ...R_profilePreview('p3'), state: 'BLOCKED', previewId: null, blockedReasons: [{ reason: 'NOPE' }] };
      return { ok: true };
    });
    await h.tick();
    h.els['profile-picker'].value = 'x';
    h.els['refresh-btn'].fire('click');
    await h.tick();
    assert.equal(h.els['profile-picker'].value, 'x', 'payload name never lands in the picker');
    assert.equal(h.stored.sets.length, 0, 'nothing stored before READY');
  });

  it('P1 trimmed request name stored after READY', async () => {
    const h = R_drive({}, R_routes(R_profilePreview('p4')));
    await h.tick();
    h.els['profile-picker'].value = ' web ';
    h.els['refresh-btn'].fire('click');
    await h.tick();
    assert.equal(h.els['state-badge'].textContent, 'READY');
    const posts = h.calls.filter((c) => c.url === '/api/preview');
    assert.ok(posts.length > 0 && posts[0].body.profileName === 'web', 'trimmed name sent');
    assert.deepEqual(h.stored.sets, [['ocms-s.lastProfile', 'web']], 'exact trimmed name stored once');
  });

  it('P1 label, key and no web default outside placeholders', () => {
    const html = R_html();
    assert.ok(/ocms-s\.lastProfile/.test(html), 'documented storage key present');
    const label = html.match(/<label for="profile-picker">([\s\S]*?)<\/label>/);
    assert.ok(label, 'picker label present');
    assert.ok(/remembered/i.test(label[1]), 'label says the name is remembered');
    assert.ok(/Refresh Preview/.test(label[1]), 'label requires Refresh Preview confirmation');
    const stripped = html.replace(/placeholder="[^"]*"/g, '');
    assert.ok(!/\bweb\b/.test(stripped), 'no literal web default outside placeholders');
  });
});
