// Characterization of the legacy Apply write path as changed by commit
// 8108c98 (the legacy path now edits the parsed Document instead of
// re-serializing the whole file). This file pins EXACTLY what that change
// preserves and what it still loses, so an owner can approve or revert it.
//
// Scope: the legacy --settings write path only. Profile mode is untouched by
// 8108c98. Scratch temp dirs only; no production file, no network, no Apply
// outside the fixture. No ticket ID is claimed here: this characterizes an
// already-merged change, it is not a new defect ticket.
//
// PRESERVED by 8108c98 (was LOST before it):
//   * comments outside the replaced models span (leading, inner, trailing)
//   * anchor names and alias references (&base / *base kept verbatim)
//   * scalar quoting style of untouched keys ('single' and "double")
//   * key order of unrelated keys
// STILL NORMALIZED (unchanged by 8108c98; pre-existing in the old path too):
//   * CRLF input is written back as LF
//   * a file with no trailing newline gains one
//   * runs of spaces before a trailing comment collapse to one
// STILL LOST (necessarily): any comment inside the replaced models span.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { surgicalLegacyUpdate, syncFromSources } from '../../sync.mjs';

const NL = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const toCrlf = (text) => text.split(NL).join(CR + NL);

const DESIRED = {
  'opencode-go': [],
  'opencode-go-messages': [],
  'opencode-go-responses': [],
  'opencode-completions': [],
  'opencode-messages': [],
  opencode: [
    { id: 'model-z', name: 'Model Z', input: ['text'], contextWindow: 1000, maxTokens: 100, reasoningEfforts: false },
  ],
};

function catRecord(overrides) {
  return {
    id: 'model-a', name: 'Model A', modalities: { input: ['text'] },
    limit: { context: 1000, output: 100 }, reasoning: false, ...(overrides || {}),
  };
}

function validSources() {
  return {
    rosters: { go: ['model-a'], zen: ['model-z'] },
    catalog: {
      go: { npm: '@ai-sdk/openai-compatible', models: { 'model-a': catRecord({ provider: { npm: '@ai-sdk/openai-compatible' } }) } },
      zen: { npm: '@ai-sdk/openai-compatible', models: { 'model-z': catRecord({ id: 'model-z', name: 'Model Z', provider: { npm: '@ai-sdk/openai-compatible' } }) } },
    },
    docs: {
      go: { 'model-a': 'https://opencode.ai/zen/go/v1/chat/completions' },
      zen: { 'model-z': 'https://opencode.ai/zen/v1/responses' },
    },
  };
}

function scratchSettings(t, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-legacy-charset-'));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });
  const file = path.join(dir, 'settings.yaml');
  fs.writeFileSync(file, body, 'utf8');
  return { dir, file };
}

describe('legacy Apply charset characterization (commit 8108c98)', () => {
  describe('PRESERVED by 8108c98', () => {
    it('keeps comments outside the replaced models span', () => {
      const before = [
        '# top comment', 'llm-pi-ai:', '  providers:', '    opencode:',
        '      # inner comment', '      displayName: opencode  # trailing comment',
        '      models:', '        - id: old', 'other: kept', '',
      ].join(NL);
      const after = surgicalLegacyUpdate(before, DESIRED);
      assert.ok(after.includes('# top comment'), 'leading comment preserved');
      assert.ok(after.includes('# inner comment'), 'comment inside the route but outside models preserved');
      assert.ok(after.includes('# trailing comment'), 'trailing comment preserved');
    });

    it('keeps anchor names and alias references verbatim', () => {
      const before = [
        'defs: &base', '  k: v', 'llm-pi-ai:', '  providers:', '    opencode:',
        '      displayName: opencode', '      models: []', 'ref: *base', '',
      ].join(NL);
      const after = surgicalLegacyUpdate(before, DESIRED);
      assert.ok(after.includes('&base'), 'anchor name not regenerated');
      assert.ok(after.includes('*base'), 'alias reference not rewritten');
      assert.ok(!after.includes('&a1'), 'no regenerated anchor name');
    });

    it('keeps quoting style of untouched scalars', () => {
      const before = [
        'llm-pi-ai:', '  providers:', '    opencode:',
        "      displayName: 'single quoted'", '      other: "double quoted"',
        '      models: []', '',
      ].join(NL);
      const after = surgicalLegacyUpdate(before, DESIRED);
      assert.ok(after.includes("'single quoted'"), 'single quotes preserved');
      assert.ok(after.includes('"double quoted"'), 'double quotes preserved');
    });

    it('keeps the key order of unrelated keys', () => {
      const before = [
        'zzz: last', 'llm-pi-ai:', '  providers:', '    opencode:',
        '      displayName: opencode', '      models: []', 'aaa: first', '',
      ].join(NL);
      const after = surgicalLegacyUpdate(before, DESIRED);
      const keys = parseYaml(after);
      assert.deepEqual(Object.keys(keys), ['zzz', 'llm-pi-ai', 'aaa'], 'unrelated keys keep their positions');
    });
  });

  describe('STILL NORMALIZED (pre-existing, not introduced or fixed by 8108c98)', () => {
    it('writes CRLF input back as LF', () => {
      const before = toCrlf([
        'llm-pi-ai:', '  providers:', '    opencode:',
        '      displayName: opencode', '      models: []', '',
      ].join(NL));
      const after = surgicalLegacyUpdate(before, DESIRED);
      assert.ok(before.includes(CR + NL), 'fixture really is CRLF');
      assert.ok(!after.includes(CR + NL), 'CRLF is still normalized to LF');
    });

    it('adds a trailing newline to a file that had none', () => {
      const before = [
        'llm-pi-ai:', '  providers:', '    opencode:',
        '      displayName: opencode', '      models: []',
      ].join(NL);
      const after = surgicalLegacyUpdate(before, DESIRED);
      assert.ok(!before.endsWith(NL), 'fixture really has no trailing newline');
      assert.ok(after.endsWith(NL), 'a trailing newline is still added');
    });

    it('collapses spaces before a trailing comment to one', () => {
      const before = [
        'llm-pi-ai:', '  providers:', '    opencode:',
        '      displayName: opencode  # note', '      models: []', '',
      ].join(NL);
      const after = surgicalLegacyUpdate(before, DESIRED);
      assert.ok(after.includes('opencode # note'), 'two spaces become one');
      assert.ok(!after.includes('opencode  # note'), 'the double space is gone');
    });
  });

  describe('STILL LOST (necessarily)', () => {
    it('drops a comment inside the replaced models span', () => {
      const before = [
        'llm-pi-ai:', '  providers:', '    opencode:',
        '      displayName: opencode', '      models:', '        - id: old  # explain',
        '',
      ].join(NL);
      const after = surgicalLegacyUpdate(before, DESIRED);
      assert.ok(!after.includes('# explain'), 'comment inside the replaced span is dropped');
      assert.deepEqual(
        parseYaml(after)['llm-pi-ai'].providers.opencode.models.map((m) => m.id),
        ['model-z'],
        'the models array itself is replaced (the point of the write)',
      );
    });
  });

  describe('end-to-end legacy Apply against LF and CRLF scratch files', () => {
    for (const eol of ['LF', 'CRLF']) {
      it(eol + ': a real legacy Apply writes a parsable file and preserves the unrelated comment', (t) => {
        const body = [
          '# operator note',
          'llm-pi-ai:',
          '  providers:',
          '    opencode:',
          '      displayName: opencode',
          '      models:',
          "        - id: stale-model",
          '',
        ].join(eol === 'CRLF' ? CR + NL : NL);
        const { file } = scratchSettings(t, body);
        const outcome = syncFromSources({ settingsPath: file, sources: validSources() });
        assert.equal(outcome.result, 'UPDATED', JSON.stringify(outcome.unresolved || []));
        const after = fs.readFileSync(file, 'utf8');
        assert.ok(after.includes('# operator note'), 'comment survives a real Apply');
        const written = parseYaml(after);
        assert.deepEqual(
          written['llm-pi-ai'].providers.opencode.models.map((m) => m.id),
          ['model-z'],
          'the managed array is updated',
        );
        if (eol === 'CRLF') {
          assert.ok(!after.includes(CR + NL), 'CRLF is normalized to LF (pre-existing)');
        } else {
          assert.ok(after.includes(NL), 'LF stays LF');
        }
      });
    }
  });
});
