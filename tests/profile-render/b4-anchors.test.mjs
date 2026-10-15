// B4: an alias or anchor inside the replaced models span must refuse
// ANCHOR_IN_MANAGED_SCOPE with zero writes. LF control plus CRLF companion.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { renderDesiredState } from '../../profile/surgical-render.mjs';
import { desiredSix, modelRecord, makeTempDir } from './helpers.mjs';

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const toCrlf = (text) => text.split(LF).join(CR + LF);
const stored = { providers: { opencode: { displayName: 'opencode', models: [modelRecord('a')] } } };
const desired = desiredSix({ opencode: [modelRecord('b')] });

const SHAPES = {
  'anchor-on-model': ['- id: llm-pi-ai', '  config:', '    providers:', '      opencode:', '        models:', '          - &mine id: a', ''].join(LF),
  'anchor-on-seq': ['- id: llm-pi-ai', '  config:', '    providers:', '      opencode:', '        models: &mine', '          - id: a', ''].join(LF),
  'alias-inside': ['- id: definer', '  extra: &mine a', '- id: llm-pi-ai', '  config:', '    providers:', '      opencode:', '        models:', '          - id: *mine', ''].join(LF),
};

describe('B4 — anchors and aliases in replaced spans', () => {
  for (const eol of ['LF', 'CRLF']) {
    for (const [name, patch] of Object.entries(SHAPES)) {
      it(eol + ' ' + name + ' refuses ANCHOR_IN_MANAGED_SCOPE', () => {
        const scratch = makeTempDir('ocms-b4-');
        try {
          const input = eol === 'CRLF' ? toCrlf(patch) : patch;
          const file = path.join(scratch.dir, 'cordis.patch.yml');
          fs.writeFileSync(file, input, 'utf8');
          const before = fs.readFileSync(file);
          const res = renderDesiredState({ patchBytes: before, storedConfig: structuredClone(stored), desired: structuredClone(desired) });
          assert.equal(res.ok, false, 'must refuse, got: ' + JSON.stringify(res.status || res.code));
          assert.equal(res.code, 'ANCHOR_IN_MANAGED_SCOPE');
          assert.deepEqual(fs.readFileSync(file), before, 'a refusal writes nothing');
        } finally {
          scratch.cleanup();
        }
      });
    }
  }
});
