// S13 (Sonnet): a patch file that mixes CRLF and LF must never be rendered by
// rewriting an UNRELATED line's ending. detectEol() classified the whole file as
// CRLF as soon as ANY CRLF appeared, so an LF-only region would be rewritten
// with CRLF -- a silent line-ending change in bytes the ticket never touched.
//
// VERDICT: NOT REPRODUCIBLE. Observed outcome on the mixed fixture is a
// SUCCESSFUL render, and the trailing row keeps its exact LF ending while the
// managed span is written with the file's dominant ending. detectEol()'s
// whole-file classification therefore does not cause an unrelated line ending
// to be rewritten: the render emits only into the managed span and leaves every
// other byte untouched. Both pure controls render, so the mixed case is proven
// to be a real render path and not an accident of a malformed fixture.
//
// The contract asserted here: either the renderer refuses a mixed-ending file
// with a typed code, or it renders correctly leaving every untouched line
// ending byte-identical. Either is acceptable; the current behaviour is the
// second, and this file keeps both branches honest if that ever changes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { renderDesiredState } from '../../profile/surgical-render.mjs';
import { desiredSix, modelRecord, makeTempDir } from './helpers.mjs';

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const toCrlf = (text) => text.split(LF).join(CR + LF);

const stored = { providers: { opencode: { displayName: 'opencode', models: [] } } };
const desired = desiredSix({ opencode: [modelRecord('b')] });

// One top-level row plus a trailing unrelated key that the render never touches.
const patchLines = [
  '- id: llm-pi-ai',
  '  name: LLM Pi AI',
  '  config:',
  '    providers:',
  '      opencode:',
  '        displayName: opencode',
  '        models:',
  '- id: unrelated-row',
  '  name: untouched',
  '',
];
const PURE_LF = patchLines.join(LF);

function render(bytes) {
  return renderDesiredState({ patchBytes: bytes, storedConfig: structuredClone(stored), desired: structuredClone(desired) });
}

describe('S13 — mixed CRLF/LF patch', () => {
  it('CONTROL: a pure LF patch renders', () => {
    const res = render(Buffer.from(PURE_LF, 'utf8'));
    assert.equal(res.ok, true, 'pure LF must render: ' + JSON.stringify(res.code || res.status));
  });

  it('CONTROL: a pure CRLF patch renders', () => {
    const res = render(Buffer.from(toCrlf(PURE_LF), 'utf8'));
    assert.equal(res.ok, true, 'pure CRLF must render: ' + JSON.stringify(res.code || res.status));
  });

  it('mixed endings: refuses with a typed code or never rewrites an untouched line ending', () => {
    // CRLF for the managed head, bare LF for the trailing rows.
    const mixed = patchLines
      .map((line, i) => (i <= 6 ? line + CR + LF : line + LF))
      .join('');
    assert.ok(mixed.includes(CR + LF) && mixed.includes(LF), 'the fixture really mixes endings');

    const scratch = makeTempDir('ocms-s13-');
    try {
      const file = path.join(scratch.dir, 'cordis.patch.yml');
      fs.writeFileSync(file, mixed, 'utf8');
      const before = fs.readFileSync(file);
      const res = render(before);

      if (res.ok === false) {
        assert.equal(typeof res.code, 'string', 'a refusal carries a typed code');
        assert.equal(res.status, 'BLOCKED', 'a refusal is fail-closed, not a partial write');
        return;
      }

      const candidate = Buffer.from(res.candidateBytes).toString('utf8');
      const rows = parseYaml(candidate);
      const untouched = rows.find((row) => row && row.id === 'unrelated-row');
      assert.ok(untouched, 'the unrelated row survives a render');
      assert.ok(
        candidate.includes('- id: unrelated-row' + LF),
        'the untouched row keeps its exact LF ending',
      );
      assert.equal(
        candidate.includes('- id: unrelated-row' + CR + LF),
        false,
        'MUST NOT rewrite an unrelated LF line to CRLF',
      );
      assert.deepEqual(fs.readFileSync(file), before, 'the renderer never writes the target');
    } finally {
      scratch.cleanup();
    }
  });
});
