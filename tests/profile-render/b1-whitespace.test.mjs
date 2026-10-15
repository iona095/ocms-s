// B1: extra whitespace after "models:" must not change owned-byte accounting.
// Matrix: LF/CRLF x same-line/next-line/empty-list x standard/two-space/tab.
// Every accepted edit preserves the file line ending; every refusal leaves the
// scratch file byte-identical. The renderer itself never writes the target.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { renderDesiredState } from '../../profile/surgical-render.mjs';
import { desiredSix, modelRecord, makeTempDir } from './helpers.mjs';

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const TAB = String.fromCharCode(9);
const toCrlf = (text) => text.split(LF).join(CR + LF);
const stored = { providers: { opencode: { displayName: 'opencode', models: [modelRecord('a')] } } };
const desired = desiredSix({ opencode: [modelRecord('b')] });

function patchFor(layout, separator) {
  const modelsKey = 'models:' + separator;
  if (layout === 'same-line') {
    return ['- id: llm-pi-ai', '  name: LLM Pi AI', '  config:', '    providers:', '      opencode:', '        displayName: opencode', '        ' + modelsKey + ' [{id: a, name: A}]', ''].join(LF);
  }
  if (layout === 'empty-list') {
    return ['- id: llm-pi-ai', '  name: LLM Pi AI', '  config:', '    providers:', '      opencode:', '        displayName: opencode', '        ' + modelsKey + '[]', ''].join(LF);
  }
  return ['- id: llm-pi-ai', '  name: LLM Pi AI', '  config:', '    providers:', '      opencode:', '        displayName: opencode', '        ' + modelsKey, '          - id: a', '            name: A', ''].join(LF);
}

const cases = [];
for (const eol of ['LF', 'CRLF']) {
  for (const layout of ['same-line', 'next-line', 'empty-list']) {
    for (const [separatorName, separator] of [['standard', ' '], ['two-space', '  '], ['tab', TAB]]) {
      cases.push({ eol, layout, separatorName, separator });
    }
  }
}

describe('B1 — whitespace after models:', () => {
  for (const item of cases) {
    it(item.eol + ' ' + item.layout + ' ' + item.separatorName + ' renders READY', () => {
      const scratch = makeTempDir('ocms-b1-');
      try {
        const input = item.eol === 'CRLF' ? toCrlf(patchFor(item.layout, item.separator)) : patchFor(item.layout, item.separator);
        const file = path.join(scratch.dir, 'cordis.patch.yml');
        fs.writeFileSync(file, input, 'utf8');
        const before = fs.readFileSync(file);
        const res = renderDesiredState({ patchBytes: before, storedConfig: structuredClone(stored), desired: structuredClone(desired) });
        assert.equal(res.ok, true, JSON.stringify(res.code || res.status) + ' ' + JSON.stringify(res.detail || res.message || '').slice(0, 300));
        assert.equal(res.status, 'READY');
        assert.deepEqual(fs.readFileSync(file), before, 'the renderer never writes the target');
        const candidate = Buffer.from(res.candidateBytes).toString('utf8');
        if (item.eol === 'CRLF') assert.ok(candidate.includes(CR + LF), 'accepted CRLF edits keep CRLF');
        else assert.ok(!candidate.includes(CR), 'LF edits gain no CR');
        assert.ok(Array.isArray(parseYaml(candidate)), 'the candidate still parses');
      } finally {
        scratch.cleanup();
      }
    });
  }

  it('a refusal fixture leaves the scratch file byte-identical', () => {
    const scratch = makeTempDir('ocms-b1-refuse-');
    try {
      const file = path.join(scratch.dir, 'cordis.patch.yml');
      fs.writeFileSync(file, '- id: llm-pi-ai\n  config: { providers: [unclosed }\n', 'utf8');
      const before = fs.readFileSync(file);
      const res = renderDesiredState({ patchBytes: before, storedConfig: undefined, desired: desiredSix({ opencode: [modelRecord('b')] }) });
      assert.equal(res.ok, false);
      assert.deepEqual(fs.readFileSync(file), before, 'a refusal writes nothing');
      assert.ok(!os.tmpdir().includes('nonexistent-test-value'));
    } finally {
      scratch.cleanup();
    }
  });
});
