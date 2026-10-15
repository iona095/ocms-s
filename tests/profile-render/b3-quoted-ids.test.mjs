// B3: quoted scalar model IDs are data, never code, and must not change
// footprint accounting. LF control plus CRLF companion, including a hostile
// HTML-shaped ID that must survive as text and never execute.
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
const hostileId = '<img src=x onerror=alert(1)>';

function patchText(idStyle) {
  const quote = (value) => (idStyle === 'single' ? "'" + value + "'" : '"' + value + '"');
  return ['- id: llm-pi-ai', '  name: LLM Pi AI', '  config:', '    providers:', '      opencode:', '        displayName: opencode', '        models:', '          - id: ' + quote('a'), '            name: A', ''].join(LF);
}

describe('B3 — quoted scalar model IDs', () => {
  for (const eol of ['LF', 'CRLF']) {
    for (const idStyle of ['single', 'double']) {
      it(eol + ' ' + idStyle + '-quoted IDs render READY', () => {
        const scratch = makeTempDir('ocms-b3-');
        try {
          const stored = { providers: { opencode: { displayName: 'opencode', models: [{ ...modelRecord('a'), id: 'a' }] } } };
          const input = eol === 'CRLF' ? toCrlf(patchText(idStyle)) : patchText(idStyle);
          const file = path.join(scratch.dir, 'cordis.patch.yml');
          fs.writeFileSync(file, input, 'utf8');
          const before = fs.readFileSync(file);
          const res = renderDesiredState({ patchBytes: before, storedConfig: structuredClone(stored), desired: desiredSix({ opencode: [modelRecord('b')] }) });
          assert.equal(res.ok, true, JSON.stringify(res.code || res.status) + ' ' + JSON.stringify(res.detail || res.message || '').slice(0, 300));
          assert.equal(res.status, 'READY');
          assert.deepEqual(fs.readFileSync(file), before, 'the renderer never writes the target');
        } finally {
          scratch.cleanup();
        }
      });
    }
  }

  it('a hostile HTML-shaped ID stays text and never executes', () => {
    const scratch = makeTempDir('ocms-b3-hostile-');
    try {
      const stored = { providers: { opencode: { displayName: 'opencode', models: [{ ...modelRecord('x'), id: hostileId }] } } };
      const raw = ['- id: llm-pi-ai', '  name: LLM Pi AI', '  config:', '    providers:', '      opencode:', '        displayName: opencode', '        models:', '          - id: "' + hostileId + '"', '            name: Hostile', ''].join(LF);
      const file = path.join(scratch.dir, 'cordis.patch.yml');
      fs.writeFileSync(file, raw, 'utf8');
      const before = fs.readFileSync(file);
      const res = renderDesiredState({ patchBytes: before, storedConfig: structuredClone(stored), desired: desiredSix({ opencode: [modelRecord('b')] }) });
      assert.equal(res.ok, true, JSON.stringify(res.code || res.status));
      assert.equal(res.status, 'READY');
      const candidate = Buffer.from(res.candidateBytes).toString('utf8');
      assert.ok(!candidate.includes('<img'), 'the hostile markup must not survive into the candidate');
      const rows = parseYaml(candidate);
      const models = rows.find((row) => row && row.id === 'llm-pi-ai').config.providers.opencode.models;
      assert.ok(models.every((model) => model.id === 'b'), 'only the desired model remains; the hostile ID was replaced as data');
      assert.deepEqual(fs.readFileSync(file), before, 'the renderer never writes the target');
    } finally {
      scratch.cleanup();
    }
  });
});
