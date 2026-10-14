// OCMS-S v1.4.7-rc4 Amendment B freeze test (see helpers.mjs amendment anchor).
// B1-B5 checks land here post-review as the Step-2 RED work.
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  assert,
  AMENDMENT_B_FILE,
  AMENDMENT_B_SHA256,
  AMENDMENT_B_LINES,
  amendmentBBytes,
  sha256HexBytes,
  countTextLines,
} from './helpers.mjs';
import { REPO_ROOT } from '../v1.3/helpers.mjs';

const UI_B = path.join(REPO_ROOT, 'ui', 'index.html');
const B_html = () => fs.readFileSync(UI_B, 'utf8');
const B_css = (h) => { const m = h.match(/<style[^>]*>([\s\S]*?)<\/style>/i); assert.ok(m, 'page has a <style> block'); return m[1]; };
const B_pad = (rule) => rule.split(/\s+/).filter(Boolean).map((v) => Number(v.replace('px', '')));
const B_tracks = (decls) => decls.trim().split(/\s+(?![^(]*\))/).map((s) => s.trim()).filter(Boolean);
const B_mainCols = (css, from) => { const m = css.slice(from).match(/main\s*\{[^}]*grid-template-columns\s*:\s*([^;]+);/); assert.ok(m, 'main columns present'); return m[1]; };

describe('v1.4.7-rc4 Amendment B (density)', () => {
  it('amendment B freeze anchor is intact', () => {
    const bytes = amendmentBBytes();
    assert.equal(sha256HexBytes(bytes), AMENDMENT_B_SHA256, 'amendment SHA-256 must match the frozen value');
    assert.equal(countTextLines(bytes), AMENDMENT_B_LINES, 'amendment line count must match the frozen value');
    assert.ok(AMENDMENT_B_FILE.length > 0);
  });

  it('B1 single short header row with inline lede', () => {
    const html = B_html(); const css = B_css(html);
    const row = html.match(/<div class="brand-row">([\s\S]*?)<\/div>/);
    assert.ok(row, 'brand row present');
    for (const need of ['pixel-logo', '<h1', '<svg', 'class="lede"']) assert.ok(row[1].includes(need), need + ' on the row');
    assert.ok(!html.includes('class="sub"'), 'no sub line');
    assert.ok(/id="version"[^>]*title="Local Web UX"/.test(html), 'version tooltip');
    const disp = css.match(/\.display\s*\{[^}]*font-size:\s*(\d+)px/);
    assert.ok(disp && Number(disp[1]) <= 24, 'heading <= 24px');
    const pad = css.match(/\.app-header\s*\{[^}]*padding:\s*([^;]+);/);
    assert.ok(pad, 'header padding declared');
    const hv = B_pad(pad[1]);
    const htop = hv[0], hbot = hv.length > 2 ? hv[2] : hv[0], hleft = hv.length > 3 ? hv[3] : hv[1];
    assert.ok(htop <= 12 && hbot <= 12, 'header block <= 12px');
    const main = css.match(/main\s*\{[^}]*padding:\s*([^;]+);/);
    assert.ok(main, 'main padding declared');
    const mv = B_pad(main[1]);
    assert.equal(hleft, mv.length > 3 ? mv[3] : mv[1], 'header aligns with main left edge');
  });

  it('B2 full width without the cap, tighter spacing', () => {
    const css = B_css(B_html());
    assert.ok(!/max-width:\s*1200px/.test(css), '1200 cap gone');
    assert.ok(/max-width:\s*none/.test(css), 'no cap');
    const main = css.match(/main\s*\{[^}]*padding:\s*([^;]+);/);
    assert.ok(main, 'main padding declared');
    const mv = B_pad(main[1]);
    assert.ok(mv[0] <= 16 && mv[1] <= 16, 'page padding <= 16 sides and top');
    const gap = css.match(/main\s*\{[^}]*gap:\s*(\d+)px/);
    assert.ok(gap && Number(gap[1]) <= 12, 'grid gap <= 12');
    const panel = css.match(/\.panel\s*\{[^}]*padding:\s*([^;]+);/);
    assert.ok(panel && B_pad(panel[1])[0] <= 14, 'panel padding <= 14');
    const body = css.match(/body\s*\{[^}]*font-size:\s*(\d+)px/);
    assert.ok(body && Number(body[1]) >= 13 && Number(body[1]) <= 14, 'body 13-14px');
  });

  it('B3 column breakpoints with workflow placements', () => {
    const html = B_html(); const css = B_css(html);
    const i1024 = css.indexOf('@media (min-width: 1024px)');
    const i1400 = css.indexOf('@media (min-width: 1400px)');
    assert.ok(i1024 >= 0 && i1400 > i1024, 'both breakpoints present in order');
    assert.equal(B_tracks(B_mainCols(css, i1024)).length, 2, 'two columns 1024-1399');
    assert.equal(B_tracks(B_mainCols(css, i1400)).length, 3, 'three columns at 1400+');
    for (const id of ['profile-heading', 'actions-heading', 'sources-heading', 'preview-heading', 'routes-heading']) {
      assert.ok(css.includes('aria-labelledby="' + id + '"'), 'placement for ' + id);
    }
    assert.ok(!/\d+px/.test(B_mainCols(css, i1400)), 'tracks size to content, no fixed pixels');
    const order = ['profile-heading', 'actions-heading', 'sources-heading', 'preview-heading', 'routes-heading', 'target-heading', 'details-heading'];
    let prev = -1;
    for (const id of order) { const at = html.indexOf('id="' + id + '"'); assert.ok(at > prev, id + ' in workflow order'); prev = at; }
  });

  it('B4 status bar in flow with reserved height', () => {
    const css = B_css(B_html());
    const bar = css.match(/\.status-bar\s*\{[^}]*position:\s*(\w+)/);
    assert.ok(bar && (bar[1] === 'sticky' || bar[1] === 'static'), 'bar never covers content');
    const main = css.match(/main\s*\{[^}]*padding:\s*([^;]+);/);
    assert.ok(main, 'main padding declared');
    const mv = B_pad(main[1]);
    assert.ok((mv.length > 2 ? mv[2] : mv[0]) >= 48, 'main reserves bar height');
  });
});
