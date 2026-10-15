// P1-2: F1-add when the route map is the last block of cordis.patch.yml
// with NO final newline, in LF and CRLF.
//
// The insertion point is the route-map end, which is mid-line at EOF. The
// renderer must start the inserted `models:` block on its own line (using
// the file's EOL) instead of gluing it onto the final content line. The
// candidate must parse, carry the desired models, and leave every byte
// outside the edit span untouched. Pure render-only fixtures; no disk writes.
import { describe, it } from 'node:test';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { renderDesiredState } from '../../profile/surgical-render.mjs';
import { assert, desiredSix, modelRecord } from './helpers.mjs';

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);

function providersNoModels() {
  return { opencode: { displayName: 'opencode', api: 'openai-responses', baseURL: 'https://example.invalid', apiKeyEnv: 'K' } };
}

function patchNoFinalNewline(eol) {
  const rows = [{ id: 'llm-pi-ai', name: 'LLM Pi AI', config: { providers: providersNoModels() } }];
  const lf = stringifyYaml(rows);
  const text = eol === 'CRLF' ? lf.split(LF).join(CR + LF) : lf;
  const nl = eol === 'CRLF' ? CR + LF : LF;
  return text.endsWith(nl) ? text.slice(0, -nl.length) : text;
}

function candidateProviders(res) {
  const text = Buffer.from(res.candidateBytes).toString('utf8');
  const rows = parseYaml(text);
  const llm = rows.find((row) => row && row.id === 'llm-pi-ai');
  return { text, providers: (llm && llm.config && llm.config.providers) || {} };
}

for (const eol of ['LF', 'CRLF']) {
  it('F1-add at EOF without a final newline (' + eol + ') renders a parseable candidate', () => {
    const input = patchNoFinalNewline(eol);
    const res = renderDesiredState({
      patchBytes: Buffer.from(input, 'utf8'),
      storedConfig: { providers: providersNoModels() },
      desired: desiredSix({ opencode: [modelRecord('b')] }),
    });
    assert.equal(res.ok, true, 'EOF F1-add must render: ' + JSON.stringify(res.refusal || res.status || res.code));
    assert.equal(res.status, 'READY');
    const { text, providers } = candidateProviders(res);
    assert.deepEqual((providers.opencode.models || []).map((m) => m.id), ['b'], 'desired models land on the route');
    assert.ok(Buffer.from(text, 'utf8').slice(0, input.length).toString('utf8') === input, 'bytes outside the edit span are untouched');
    if (eol === 'CRLF') assert.ok(!text.includes(CR + CR), 'no double CR in the rendered candidate');
    else assert.ok(!text.includes(CR), 'the LF candidate gains no CR');
  });
}
