// OCMS-S v1.4.7-rc4 Amendment C: freeze pin plus C1/C2 checks.
// Static page checks only. No live calls, no Apply, no profiles.
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { assert, REPO_ROOT } from '../v1.3/helpers.mjs';
import { AMENDMENT_C_FILE, AMENDMENT_C_SHA256, AMENDMENT_C_LINES, amendmentCBytes, sha256HexBytes, countTextLines } from './helpers.mjs';

const UI_C = path.join(REPO_ROOT, 'ui', 'index.html');
const C_html = () => fs.readFileSync(UI_C, 'utf8');
const C_css = (h) => { const m = h.match(/<style[^>]*>([\s\S]*?)<\/style>/i); assert.ok(m, 'page has a <style> block'); return m[1]; };
const C_tracks = (tpl) => { const r = tpl.trim().match(/^repeat\(\s*(\d+)\s*,/); if (r) return Number(r[1]); return tpl.trim().split(/\s+(?![^(]*\))/).map((s) => s.trim()).filter(Boolean).length; };
const C_segments = (css) => {
  const segs = []; let i = 0;
  while (i < css.length) {
    const at = css.indexOf('@media', i);
    if (at === -1) { segs.push({ cond: null, body: css.slice(i) }); break; }
    segs.push({ cond: null, body: css.slice(i, at) });
    const open = css.indexOf('{', at);
    const cond = css.slice(at + 6, open).trim();
    let d = 1, j = open + 1;
    while (j < css.length && d > 0) { if (css[j] === '{') d++; else if (css[j] === '}') d--; j++; }
    segs.push({ cond, body: css.slice(open + 1, j - 1) });
    i = j;
  }
  return segs;
};
const C_shapes = (css) => {
  const base = []; const byCond = {};
  for (const s of C_segments(css)) {
    const rules = [...s.body.matchAll(/\.counters\s*\{[^}]*grid-template-columns\s*:\s*([^;]+);/g)].map((m) => m[1]);
    if (s.cond === null) { for (const r of rules) base.push(C_tracks(r)); }
    else { for (const r of rules) { (byCond[s.cond] = byCond[s.cond] || []).push(C_tracks(r)); } }
  }
  return { base, byCond };
};

describe('v1.4.7-rc4 Amendment C (counters and lede)', () => {
  it('amendment C freeze anchor is intact', () => {
    const bytes = amendmentCBytes();
    assert.equal(sha256HexBytes(bytes), AMENDMENT_C_SHA256, 'amendment SHA-256 must match the frozen value');
    assert.equal(countTextLines(bytes), AMENDMENT_C_LINES, 'amendment line count must match the frozen value');
    assert.ok(AMENDMENT_C_FILE.length > 0);
  });

  it('C1 counters track counts per breakpoint; 2 across never appears', () => {
    const shapes = C_shapes(C_css(C_html()));
    assert.deepEqual(shapes.base, [4], 'base 4 across below 1100px');
    assert.deepEqual(shapes.byCond, { '(min-width: 1100px)': [8], '(min-width: 1400px)': [4] }, 'per-breakpoint shapes');
    assert.ok(![...shapes.base, ...Object.values(shapes.byCond).flat()].includes(2), '2 across never appears');
  });

  it('C2 lede keeps the rc3 lime token', () => {
    const css = C_css(C_html());
    assert.ok(/\.lede\s*\{[^}]*color:\s*var\(--lime\)/.test(css), 'lede uses var(--lime)');
  });
});
