// OCMS-S v1.4.7-rc3 visual test: PixelCrafts look (V1-V6 + Amendment A).
// Static page + node:vm checks only. No live calls, no Apply, no profiles.
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { assert, REPO_ROOT } from '../v1.3/helpers.mjs';

const UI_PATH = path.join(REPO_ROOT, 'ui', 'index.html');
const UIMJS_PATH = path.join(REPO_ROOT, 'ui.mjs');

const getHtml = () => fs.readFileSync(UI_PATH, 'utf8');
const getOld = () => execFileSync('git', ['show', 'HEAD:ui/index.html'], { cwd: REPO_ROOT, encoding: 'utf8' });

const getCss = (html) => { const m = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i); assert.ok(m, 'page has a <style> block'); return m[1]; };
const getRoot = (css) => { const m = css.match(/:root\s*\{([^}]*)\}/); assert.ok(m, ':root block present'); return { body: m[1], start: m.index, end: m.index + m[0].length }; };

const TOK = { '--base': '#0B0F17', '--panel': '#141B27', '--raised': '#1B2433', '--border': '#2A3850', '--fg': '#E6ECF5', '--muted': '#8A97AD', '--lime': '#BAFF70', '--cyan': '#81D6F1', '--violet': '#BDABFF', '--orange': '#FFC190', '--pink': '#F3AACC', '--control-border': '#8A97AD' };
const lumOf = (hex) => { const v = hex.replace('#', ''); const f = (i) => { const x = parseInt(v.slice(i, i + 2), 16) / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(0) + 0.7152 * f(2) + 0.0722 * f(4); };
const ratioOf = (a, b) => { const x = lumOf(a), y = lumOf(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const pureOf = (src, name) => { const s = '// __PURE:' + name + ':START'; const e = '// __PURE:' + name + ':END'; const i = src.indexOf(s), j = src.indexOf(e); assert.ok(i >= 0 && j > i, '__PURE banners present for ' + name); return src.slice(i, j + e.length); };
const vmFn = (fnSrc, fnName) => { const sb = {}; vm.createContext(sb); vm.runInContext(fnSrc + '\nthis.__fn = ' + fnName + ';', sb); assert.equal(typeof sb.__fn, 'function', fnName + ' loads in node:vm'); return sb.__fn; };

describe('v1.4.7-rc3 PixelCrafts look (visual only)', () => {
  it('V1 tokens present on :root with reference values', () => {
    const root = getRoot(getCss(getHtml())).body;
    for (const [name, hex] of Object.entries(TOK)) {
      const re = new RegExp(name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\s*:\\s*' + hex, 'i');
      assert.ok(re.test(root), name + ' is ' + hex + ' on :root');
    }
    assert.match(getCss(getHtml()), /color-scheme\s*:\s*dark/i, 'dark color-scheme declared');
  });

  it('V1/V3 only tokens used for colour; no remote resources', () => {
    const html = getHtml();
    const css = getCss(html);
    const root = getRoot(css);
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const outside = [...flat.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].filter((m) => m.index < root.start || m.index > root.end);
    assert.equal(outside.length, 0, 'every colour literal lives in :root');
    assert.ok(!/rgba?\s*\(/i.test(flat), 'no rgb()/rgba() literals');
    assert.ok(!/hsla?\s*\(/i.test(flat), 'no hsl()/hsla() literals');
    assert.ok(!/googleapis|gstatic|cdn|unpkg|jsdelivr/i.test(html), 'no CDN or font-host references');
    for (const m of html.matchAll(/(src|href)\s*=\s*"([^"]*)"/gi)) { assert.ok(!/https?:\/\//i.test(m[2]), 'no remote src/href'); }
    for (const m of html.matchAll(/url\(\s*([^)]*)\)/gi)) { assert.ok(!/https?:\/\//i.test(m[1]), 'no remote url()'); }
    assert.ok(!/@import/i.test(css), 'no CSS @import');
    assert.match(css, /Segoe UI/i, 'system fallback stack present');
    assert.match(css, /system-ui/i, 'system-ui in the stack');
  });

  it('V1 header look: pixel logo, split heading, lede, constellation', () => {
    const html = getHtml();
    const css = getCss(html);
    assert.ok(/pixel-logo/i.test(html), '2x2 pixel logo markup');
    assert.ok(/OCMS-S/.test(html), 'OCMS-S wordmark kept');
    assert.ok(/font-weight:\s*200/i.test(css) && /font-weight:\s*800/i.test(css), 'light/heavy 200/800 weights');
    assert.ok(/>Model<\/span>[\s\S]{0,80}>Sync<\/span>/i.test(html), 'Model light / Sync heavy split heading');
    assert.ok(/class="lede"/i.test(html), 'lime lede line');
    assert.ok(/<svg[^>]*aria-hidden="true"/i.test(html), 'static constellation svg aria-hidden');
    assert.ok(!/<animate/i.test(html), 'no svg animation');
  });

  it('V2 fixed accent roles carry text; Removed and loss warning prominent', () => {
    const html = getHtml();
    const css = getCss(html);
    for (const v of ['var(--lime)', 'var(--cyan)', 'var(--violet)', 'var(--orange)', 'var(--pink)']) { assert.ok(css.includes(v), v + ' used'); }
    assert.ok(/count-removed/i.test(html), 'Removed count keeps its text carrier');
    assert.ok(/route-loss-warning/i.test(html), 'loss warning keeps its text carrier');
    assert.ok(/removed-hero/i.test(html + css), 'Removed count is prominent when non-zero');
    assert.ok(/#apply-btn[^}]*var\(--pink\)/s.test(css), 'enabled Apply is destructive-primary');
    assert.ok(/#apply-btn:disabled/s.test(css), 'disabled Apply styled inert');
  });

  it('V6+A1 text contrast >= 4.5:1 from token hex values', () => {
    for (const bg of ['--base', '--panel', '--raised']) {
      for (const fg of ['--fg', '--muted', '--lime', '--cyan', '--violet', '--orange', '--pink']) {
        const r = ratioOf(TOK[fg], TOK[bg]);
        assert.ok(r >= 4.5, fg + ' on ' + bg + ' = ' + r.toFixed(2));
      }
    }
  });

  it('A1 control boundaries and focus >= 3:1', () => {
    for (const [a, b] of [['--control-border', '--panel'], ['--control-border', '--base'], ['--lime', '--panel'], ['--lime', '--base']]) {
      const r = ratioOf(TOK[a], TOK[b]);
      assert.ok(r >= 3, a + ' on ' + b + ' = ' + r.toFixed(2));
    }
    const css = getCss(getHtml());
    assert.ok(/--control-border/.test(css), '--control-border declared');
    assert.ok(/var\(--control-border\)/.test(css), 'control boundaries use --control-border');
    assert.ok(/:focus-visible[\s\S]{0,220}var\(--lime\)/.test(css), 'lime focus ring on :focus-visible');
  });

  it('A2 pink Apply label pair base-on-pink >= 4.5:1', () => {
    assert.ok(ratioOf(TOK['--base'], TOK['--pink']) >= 4.5, 'base on pink pair');
    const css = getCss(getHtml());
    assert.ok(/#apply-btn:not\(\:disabled\)[\s\S]{0,320}var\(--pink\)/.test(css), 'enabled Apply uses pink fill');
    assert.ok(/#apply-btn:not\(\:disabled\)[\s\S]{0,320}var\(--base\)/.test(css), 'enabled Apply label uses --base');
  });

  it('V4 every rc2 element id still present', () => {
    const oldIds = [...new Set([...getOld().matchAll(/id="([^"]+)"/g)].map((m) => m[1]))];
    assert.ok(oldIds.length > 50, 'rc2 baseline has its id set');
    const now = getHtml();
    for (const id of oldIds) { assert.ok(now.includes('id="' + id + '"'), 'id kept: ' + id); }
  });

  it('V4 A2 pure function bodies byte-identical to rc2', () => {
    const oldSrc = getOld(), nowSrc = getHtml();
    for (const name of ['previewDetailsComplete', 'routeLossWarnings']) {
      assert.equal(pureOf(nowSrc, name), pureOf(oldSrc, name), name + ' unchanged');
    }
    assert.ok(nowSrc.includes('previewDetailsComplete('), 'page still calls previewDetailsComplete');
    assert.ok(nowSrc.includes('routeLossWarnings('), 'page still calls routeLossWarnings');
  });

  it('V5 source display pure function in node:vm', () => {
    const raw = vmFn(pureOf(getHtml(), 'sourceStatusText'), 'sourceStatusText');
    const fn = (v) => JSON.parse(JSON.stringify(raw(v)));
    assert.deepEqual(fn({ ok: true }), { text: 'OK', tone: 'ok' });
    assert.deepEqual(fn({ ok: false }), { text: 'unavailable', tone: 'error' });
    assert.deepEqual(fn({ count: 3 }), { text: '3', tone: '' });
    assert.deepEqual(fn({ ids: ['a', 'b'] }), { text: '2', tone: '' });
    assert.deepEqual(fn('x'), { text: 'x', tone: '' });
    assert.deepEqual(fn(7), { text: '7', tone: '' });
    assert.deepEqual(fn([]), { text: '0', tone: '' });
    assert.deepEqual(fn({ a: 1, b: 2 }), { text: '2 field(s)', tone: '' });
    assert.deepEqual(fn({}), { text: '\u2014', tone: '' });
  });

  it('V5 legacy Settings-target panel labelled in profile mode', () => {
    const nowSrc = getHtml();
    assert.ok(/not used in profile mode/i.test(nowSrc), 'profile-mode note present');
    assert.ok(/legacy-note/i.test(nowSrc), 'legacy note hook present');
  });

  it('V3/V4 safety markers unchanged: text-only, placeholders', () => {
    const uimjs = fs.readFileSync(UIMJS_PATH, 'utf8');
    assert.ok(uimjs.includes('frame-ancestors'), 'CSP frame-ancestors builder kept');
    const nowSrc = getHtml();
    assert.ok(!/\.innerHTML/.test(nowSrc), 'no innerHTML for data');
    assert.ok(/\.textContent/.test(nowSrc), 'text-only rendering kept');
    assert.ok(nowSrc.includes('__OCMS_TOKEN__') && nowSrc.includes('__OCMS_VERSION__'), 'server placeholders kept');
  });
});
