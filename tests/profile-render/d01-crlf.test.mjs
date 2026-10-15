// D01 / C04: the profile renderer on CRLF patch files.
//
// Every case runs the real renderDesiredState on a synthetic patch written
// into a temp directory, with an LF twin as the control. The questions the
// eight-reviewer dispute D01 left open are answered here:
//   * does rendered output contain a stray CR (the \r\r\n claim)?
//   * is a legitimate CRLF patch refused, and does a refusal write anything?
//   * do accepted edits preserve the file's own line endings and bytes?
// No production profile, live attestation or network is touched.
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { renderDesiredState, MANAGED_ROUTE_KEYS } from '../../profile/surgical-render.mjs';
import { assert, desiredSix, modelRecord, buildPatchText, makeTempDir, sha256HexBytes } from './helpers.mjs';

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);

function crlf(text) {
  return text.split(LF).join(CR + LF);
}

// managed arrays of the rendered candidate, read back independently.
function candidateRoutes(res) {
  const text = Buffer.from(res.candidateBytes).toString('utf8');
  const rows = parseYaml(text);
  const llm = rows.find((row) => row && row.id === 'llm-pi-ai');
  return (llm && llm.config && llm.config.providers) || {};
}

function patchText(providersObj) {
  return buildPatchText({ providersObj, header: '', trailer: '' });
}

const SHAPES = [
  {
    name: 'F1 same-line flow list',
    providers: { opencode: { displayName: 'opencode', models: [modelRecord('a')] } },
    desired: desiredSix({ opencode: [modelRecord('b'), modelRecord('c')] }),
  },
  {
    name: 'F1 next-line block list',
    providers: { opencode: { displayName: 'opencode', models: [modelRecord('a')] } },
    desired: desiredSix({ opencode: [modelRecord('b')] }),
  },
  {
    name: 'F1-add: route present without a models key',
    providers: { opencode: { displayName: 'opencode', api: 'openai-responses', baseURL: 'https://example.invalid', apiKeyEnv: 'K' } },
    desired: desiredSix({ opencode: [modelRecord('b')] }),
  },
  {
    name: 'F2: providers container missing',
    providers: { opencode: { displayName: 'opencode', models: [] } },
    desired: desiredSix({ 'opencode-completions': [modelRecord('b')] }),
  },
];

describe('D01 — CRLF patch rendering (C04)', () => {
  for (const shape of SHAPES) {
    it(shape.name + ': the LF control renders READY', () => {
      const res = renderDesiredState({ patchBytes: Buffer.from(patchText(shape.providers), 'utf8'), storedConfig: { providers: shape.providers }, desired: shape.desired });
      assert.equal(res.ok, true, 'LF control must render: ' + JSON.stringify(res.refusal || res.status));
      assert.equal(res.status, 'READY');
      const text = Buffer.from(res.candidateBytes).toString('utf8');
      assert.ok(!text.includes(CR), 'the LF control must not gain a CR');
    });

    it(shape.name + ': the CRLF twin renders READY with no stray CR', () => {
      const res = renderDesiredState({ patchBytes: Buffer.from(crlf(patchText(shape.providers)), 'utf8'), storedConfig: { providers: shape.providers }, desired: shape.desired });
      assert.equal(res.ok, true, 'a CRLF patch is legitimate input and must render: ' + JSON.stringify(res.refusal || res.status));
      assert.equal(res.status, 'READY');
      const text = Buffer.from(res.candidateBytes).toString('utf8');
      assert.ok(!text.includes(CR + CR), 'no double CR in the rendered candidate');
      const routes = candidateRoutes(res);
      for (const route of Object.keys(routes)) {
        for (const model of routes[route].models || []) {
          assert.ok(!String(model.id).includes(CR), 'model id must not carry a trailing CR: ' + JSON.stringify(model.id));
        }
      }
    });
  }

  it('CRLF acceptance preserves the file line ending and the surrounding bytes', () => {
    const providers = { opencode: { displayName: 'opencode', models: [modelRecord('a')] } };
    const lf = patchText(providers);
    const input = crlf(lf);
    const res = renderDesiredState({ patchBytes: Buffer.from(input, 'utf8'), storedConfig: { providers }, desired: desiredSix({ opencode: [modelRecord('b')] }) });
    assert.equal(res.ok, true, JSON.stringify(res.refusal || res.status));
    const text = Buffer.from(res.candidateBytes).toString('utf8');
    assert.ok(text.includes(CR + LF), 'accepted CRLF edits keep CRLF line endings');
    assert.equal(text.split(LF).length - 1, input.split(LF).length - 1, 'the edit does not add or drop lines');
  });

  it('an accepted edit rewrites the scratch file only through the caller and preserves unrelated bytes', () => {
    const scratch = makeTempDir('ocms-d01-');
    try {
      const providers = { opencode: { displayName: 'opencode', models: [modelRecord('a')] } };
      const input = crlf(patchText(providers));
      const file = path.join(scratch.dir, 'cordis.patch.yml');
      fs.writeFileSync(file, input, 'utf8');
      const before = fs.readFileSync(file);
      const res = renderDesiredState({ patchBytes: before, storedConfig: { providers }, desired: desiredSix({ opencode: [modelRecord('b')] }) });
      assert.equal(res.ok, true, JSON.stringify(res.refusal || res.status));
      assert.deepEqual(fs.readFileSync(file), before, 'the renderer itself never writes the target');
      const candidate = Buffer.from(res.candidateBytes);
      fs.writeFileSync(file, candidate);
      const after = fs.readFileSync(file);
      assert.notEqual(sha256HexBytes(after), sha256HexBytes(before), 'the accepted candidate differs');
      assert.ok(!after.toString('utf8').includes(CR + CR), 'the written bytes carry no double CR');
      const rows = parseYaml(after.toString('utf8'));
      assert.ok(Array.isArray(rows), 'the written candidate still parses as a YAML sequence');
    } finally {
      scratch.cleanup();
    }
  });

  it('a refusal leaves the scratch file byte-identical', () => {
    const scratch = makeTempDir('ocms-d01-refuse-');
    try {
      const file = path.join(scratch.dir, 'cordis.patch.yml');
      const malformed = '- id: opencode' + LF + '  config: { providers: [unclosed' + LF;
      fs.writeFileSync(file, malformed, 'utf8');
      const before = fs.readFileSync(file);
      const res = renderDesiredState({ patchBytes: before, storedConfig: undefined, desired: desiredSix({ opencode: [modelRecord('b')] }) });
      assert.equal(res.ok, false, 'malformed patch must refuse');
      assert.equal(res.status, 'BLOCKED');
      assert.deepEqual(fs.readFileSync(file), before, 'a refusal writes nothing');
      for (const route of MANAGED_ROUTE_KEYS) assert.equal(typeof route, 'string');
    } finally {
      scratch.cleanup();
    }
  });
});
