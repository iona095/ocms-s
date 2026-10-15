// D07: an F1-add route that is the last child of providers plus F2 routes
// shares one insertion offset legitimately. Both insertions must apply (the
// models block inside the last route, then the new routes after it) instead
// of refusing a duplicate site. LF control plus CRLF companion.
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
const desired = desiredSix({ opencode: [modelRecord('b')], 'opencode-go': [modelRecord('g')] });
const patch = ['- id: llm-pi-ai', '  name: LLM Pi AI', '  config:', '    providers:', '      opencode:', '        displayName: opencode', ''].join(LF);

describe('D07 — mixed F1-add plus F2 footprint', () => {
  for (const eol of ['LF', 'CRLF']) {
    it(eol + ' applies both insertions at the shared offset', () => {
      const scratch = makeTempDir('ocms-d07-');
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
        const rows = parseYaml(candidate);
        const providers = rows.find((row) => row && row.id === 'llm-pi-ai').config.providers;
        assert.deepEqual(providers.opencode.models.map((m) => m.id), ['b']);
        assert.deepEqual(providers['opencode-go'].models.map((m) => m.id), ['g']);
      } finally {
        scratch.cleanup();
      }
    });
  }
});
