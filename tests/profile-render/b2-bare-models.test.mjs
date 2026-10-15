// B2: a bare "models:" key (null YAML value) is an empty list, not a mismatch.
// LF control plus CRLF companion. Accepted edits preserve line endings and
// the renderer never writes the target file.
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
const patch = ['- id: llm-pi-ai', '  name: LLM Pi AI', '  config:', '    providers:', '      opencode:', '        displayName: opencode', '        models:', ''].join(LF);

describe('B2 — bare models key', () => {
  for (const eol of ['LF', 'CRLF']) {
    it(eol + ' bare models key renders READY as an empty list', () => {
      const scratch = makeTempDir('ocms-b2-');
      try {
        const input = eol === 'CRLF' ? toCrlf(patch) : patch;
        const file = path.join(scratch.dir, 'cordis.patch.yml');
        fs.writeFileSync(file, input, 'utf8');
        const before = fs.readFileSync(file);
        const res = renderDesiredState({ patchBytes: before, storedConfig: structuredClone(stored), desired: structuredClone(desired) });
        assert.equal(res.ok, true, JSON.stringify(res.code || res.status) + ' ' + JSON.stringify(res.detail || res.message || '').slice(0, 300));
        assert.equal(res.status, 'READY');
        assert.deepEqual(fs.readFileSync(file), before, 'the renderer never writes the target');
        const candidate = Buffer.from(res.candidateBytes).toString('utf8');
        if (eol === 'CRLF') assert.ok(candidate.includes(CR + LF), 'accepted CRLF edits keep CRLF');
        else assert.ok(!candidate.includes(CR), 'LF edits gain no CR');
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
