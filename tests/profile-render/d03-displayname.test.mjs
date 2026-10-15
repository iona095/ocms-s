// D03: a displayName-only route (no models key) must gain a valid models
// block on F1-add, never "models: - ..." on one line. LF control plus CRLF
// companion; the renderer never writes the target.
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
const stored = { providers: { opencode: { displayName: 'opencode' } } };
const desired = desiredSix({ opencode: [modelRecord('b')] });
const patch = ['- id: llm-pi-ai', '  name: LLM Pi AI', '  config:', '    providers:', '      opencode:', '        displayName: opencode', ''].join(LF);

describe('D03 — displayName-only route F1-add', () => {
  for (const eol of ['LF', 'CRLF']) {
    it(eol + ' inserts a valid models block', () => {
      const scratch = makeTempDir('ocms-d03-');
      try {
        const input = eol === 'CRLF' ? toCrlf(patch) : patch;
        const file = path.join(scratch.dir, 'cordis.patch.yml');
        fs.writeFileSync(file, input, 'utf8');
        const before = fs.readFileSync(file);
        const res = renderDesiredState({ patchBytes: before, storedConfig: structuredClone(stored), desired: structuredClone(desired) });
        assert.equal(res.ok, true, JSON.stringify(res.code || res.status) + ' ' + JSON.stringify(res.detail || '').slice(0, 200));
        assert.equal(res.status, 'READY');
        assert.deepEqual(fs.readFileSync(file), before, 'the renderer never writes the target');
        const candidate = Buffer.from(res.candidateBytes).toString('utf8');
        assert.ok(!/models:[ \t]+-/.test(candidate), 'no dash on the models key line: ' + JSON.stringify(candidate));
        const rows = parseYaml(candidate);
        const models = rows.find((row) => row && row.id === 'llm-pi-ai').config.providers.opencode.models;
        assert.equal(models.length, 1);
        assert.equal(models[0].id, 'b');
      } finally {
        scratch.cleanup();
      }
    });
  }
});
