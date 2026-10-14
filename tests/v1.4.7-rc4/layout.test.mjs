// OCMS-S v1.4.7-rc4 layout test: L1 one-row header, L2 work-first grid.
// Static page checks only. No live calls, no Apply, no profiles.
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { assert, REPO_ROOT } from '../v1.3/helpers.mjs';

const UI4 = path.join(REPO_ROOT, 'ui', 'index.html');
const L_html = () => fs.readFileSync(UI4, 'utf8');
const L_old = () => execFileSync('git', ['show', 'HEAD:ui/index.html'], { cwd: REPO_ROOT, encoding: 'utf8' });
const L_css = (h) => { const m = h.match(/<style[^>]*>([\s\S]*?)<\/style>/i); assert.ok(m, 'page has a <style> block'); return m[1]; };
const L_pure = (src, name) => { const s = '// __PURE:' + name + ':START'; const e = '// __PURE:' + name + ':END'; const i = src.indexOf(s), j = src.indexOf(e); assert.ok(i >= 0 && j > i, '__PURE banners present for ' + name); return src.slice(i, j + e.length); };

describe('v1.4.7-rc4 work-first layout', () => {
  it('B1 single short header row with inline lede (Amendment B supersedes L1)', () => {
    const html = L_html();
    const css = L_css(html);
    const row = html.match(/<div class="brand-row">([\s\S]*?)<\/div>/);
    assert.ok(row, 'one-row brand container present');
    for (const need of ['pixel-logo', '<h1', '<svg', 'class="lede"']) assert.ok(row[1].includes(need), need + ' on the row');
    assert.ok(!html.includes('class="sub"'), 'no sub line');
    assert.ok(/id="version"[^>]*title="Local Web UX"/.test(html), 'version tooltip');
    const disp = css.match(/\.display\s*\{[^}]*font-size:\s*(\d+)px/);
    assert.ok(disp && Number(disp[1]) <= 24, 'heading <= 24px');
    const pad = css.match(/\.app-header\s*\{[^}]*padding:\s*([^;]+);/);
    assert.ok(pad, 'header padding declared');
    const hv = pad[1].split(/\s+/).filter(Boolean).map((v) => Number(v.replace('px', '')));
    assert.ok(hv[0] <= 12 && (hv.length > 2 ? hv[2] : hv[0]) <= 12, 'header block <= 12px');
    assert.ok(/id="state-badge"/.test(html), 'state badge kept');
  });

  it('L2 sections follow the workflow order in the DOM (Amendment B supersedes order)', () => {
    const html = L_html();
    const order = ['profile-heading', 'actions-heading', 'sources-heading', 'preview-heading', 'routes-heading', 'target-heading', 'details-heading'];
    let prev = -1;
    for (const id of order) {
      const at = html.indexOf('id="' + id + '"');
      assert.ok(at > prev, id + ' follows the visual order');
      prev = at;
    }
  });

  it('L2 counters responsive shape with Removed most prominent (Amendment B supersedes shape)', () => {
    const html = L_html();
    const css = L_css(html);
    const dl = html.match(/<dl class="counters">([\s\S]*?)<\/dl>/);
    assert.ok(dl, 'one counters container');
    for (const id of ['count-added', 'count-removed', 'count-moved', 'count-metadata', 'count-preserved', 'count-skipped', 'count-unsupported', 'count-fallback']) {
      assert.ok(dl[1].includes('id="' + id + '"'), id + ' in the counters container');
    }
    const segs = []; { let i = 0; while (i < css.length) { const at = css.indexOf('@media', i); if (at === -1) { segs.push({ cond: null, body: css.slice(i) }); break; } segs.push({ cond: null, body: css.slice(i, at) }); const open = css.indexOf('{', at); const cond = css.slice(at + 6, open).trim(); let d = 1, j = open + 1; while (j < css.length && d > 0) { if (css[j] === '{') d++; else if (css[j] === '}') d--; j++; } segs.push({ cond, body: css.slice(open + 1, j - 1) }); i = j; } }
    const colRules = (body) => [...body.matchAll(/\.counters\s*\{[^}]*grid-template-columns\s*:\s*([^;]+);/g)].map((m) => m[1]);
    const tracksOf = (tpl) => { const rr = tpl.trim().match(/^repeat\(\s*(\d+)\s*,/); if (rr) return Number(rr[1]); return tpl.trim().split(/\s+(?![^(]*\))/).map((s) => s.trim()).filter(Boolean).length; };
    assert.deepEqual(segs.filter((s) => s.cond === null).flatMap((s) => colRules(s.body)).map(tracksOf), [4], 'base 4 across below 1100px');
    const byCond = {};
    for (const s of segs) { if (s.cond === null) continue; for (const r of colRules(s.body)) { (byCond[s.cond] = byCond[s.cond] || []).push(tracksOf(r)); } }
    assert.deepEqual(byCond, { '(min-width: 1100px)': [8], '(min-width: 1400px)': [4] }, 'per-breakpoint shapes');
    assert.ok(!Object.values(byCond).flat().includes(2), '2 across never appears');
    assert.ok(/removed-hero/i.test(html + css), 'Removed stays most prominent');
    const base = css.match(/\.counters dd\s*\{[^}]*font-size:\s*(\d+)px/);
    const hero = css.match(/removed-hero dd\s*\{[^}]*font-size:\s*(\d+)px/);
    assert.ok(base && hero && Number(hero[1]) > Number(base[1]), 'Removed value larger than the rest');
  });

  it('L2 loss warnings render as separate items; pure body intact', () => {
    const nowSrc = L_html();
    assert.ok(/loss-item/.test(nowSrc), 'per-warning item marker');
    assert.ok(nowSrc.includes('document.createElement'), 'items built as elements');
    assert.ok(nowSrc.includes('routeLossWarnings('), 'page still calls routeLossWarnings');
    assert.equal(L_pure(nowSrc, 'routeLossWarnings'), L_pure(L_old(), 'routeLossWarnings'), 'pure body byte-identical to rc3');
  });

  it('L2 carried markers: every rc3 id present, no network URLs', () => {
    const nowSrc = L_html();
    const oldIds = [...new Set([...L_old().matchAll(/id="([^"]+)"/g)].map((m) => m[1]))];
    for (const id of oldIds) { assert.ok(nowSrc.includes('id="' + id + '"'), 'id kept: ' + id); }
    for (const m of nowSrc.matchAll(/(src|href)\s*=\s*"([^"]*)"/gi)) { assert.ok(!/https?:\/\//i.test(m[2]), 'no remote src/href'); }
    for (const m of nowSrc.matchAll(/url\(\s*([^)]*)\)/gi)) { assert.ok(!/https?:\/\//i.test(m[1]), 'no remote url()'); }
  });
});
