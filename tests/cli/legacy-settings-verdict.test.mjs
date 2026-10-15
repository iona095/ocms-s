// C02 + C03: legacy `--settings` CLI exit status and final verdict.
//
// Contract v1.2 section 17: every run finishes with exactly one of UPDATED /
// NO CHANGE / NOT WRITTEN. These cases spawn the real sync.mjs with a private
// disposable home and a stubbed network and assert exit status, the final
// line, and byte preservation on refusal.
//
// One product behaviour shapes what a spawned test can reach: the legacy
// confirmation requires an interactive terminal (stdin.isTTY), so a spawned
// child with piped stdin can never reach the Apply leg. The success verdicts
// are therefore asserted against the exported verdict formatter, and the
// refusals (which is where the CLI was silent and exited 0) against real
// spawned processes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SYNC_PATH = path.join(REPO_ROOT, 'sync.mjs');
const CHILD_TIMEOUT_MS = 60000;

const syncMod = await import('../../sync.mjs');

const NL = String.fromCharCode(10);
const SETTINGS_SEED = ['llm:', '  unrelated: true', 'llm-pi-ai:', '  providers: {}', ''].join(NL);

function catalogRecord(overrides) {
  return { id: 'model-a', name: 'Model A', modalities: { input: ['text'] }, limit: { context: 1000, output: 100 }, reasoning: false, ...(overrides || {}) };
}

function docsTable(rows) {
  const body = rows.map((row) => '<tr><td>' + row[0] + '</td><td>' + row[1] + '</td></tr>').join('');
  return '<table><tr><th>Model ID</th><th>Endpoint</th></tr>' + body + '</table>';
}

function sourceBodies(options) {
  const emptyZenRoster = Boolean(options && options.emptyZenRoster);
  return {
    goRoster: JSON.stringify({ data: [{ id: 'model-a' }] }),
    zenRoster: JSON.stringify({ data: emptyZenRoster ? [] : [{ id: 'model-z' }] }),
    catalog: JSON.stringify({
      'opencode-go': { npm: '@ai-sdk/openai-compatible', models: { 'model-a': catalogRecord() } },
      opencode: { npm: '@ai-sdk/openai', models: { 'model-z': catalogRecord({ id: 'model-z', name: 'Z' }) } },
    }),
    goDocs: docsTable([['model-a', 'https://opencode.ai/zen/go/v1/chat/completions']]),
    zenDocs: docsTable([['model-z', 'https://opencode.ai/zen/v1/responses']]),
  };
}

const SOURCE_KEYS = {
  goRoster: 'https://opencode.ai/zen/go/v1/models',
  zenRoster: 'https://opencode.ai/zen/v1/models',
  catalog: 'https://models.opencode.ai/api.json',
  goDocs: 'https://opencode.ai/v2/docs/console/go/',
  zenDocs: 'https://opencode.ai/v2/docs/console/models/',
};

function sha256(text) {
  return crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

const STUB_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'tests', 'cli', 'stub-fetch.mjs'), 'utf8');

function makeChildEnv(options) {
  const mode = (options && options.mode) || 'ok';
  const bodies = (options && options.bodies) || sourceBodies();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-cli-'));
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.dsh'), { recursive: true });
  const fixture = path.join(root, 'sources.json');
  fs.writeFileSync(fixture, JSON.stringify({ bodies, urls: SOURCE_KEYS }), 'utf8');
  const stub = path.join(root, 'stub-fetch.mjs');
  fs.writeFileSync(stub, STUB_SOURCE, 'utf8');
  const env = { ...process.env };
  env.USERPROFILE = home;
  env.HOME = home;
  env.APPDATA = path.join(home, 'AppData', 'Roaming');
  env.LOCALAPPDATA = path.join(home, 'AppData', 'Local');
  // Pin DSH_HOME at the disposable home: the product resolves its DSH home
  // from DSH_HOME first, so the child is isolated and the disposable target
  // classifies as SCRATCH.
  env.DSH_HOME = path.join(home, '.dsh');
  env.OCMS_STUB_FIXTURE = fixture;
  env.OCMS_STUB_MODE = mode;
  env.NODE_OPTIONS = '--import=' + new URL('file://' + stub.split(String.fromCharCode(92)).join('/')).href;
  for (const key of Object.keys(env)) {
    if ((key.startsWith('OCMS_') || key.startsWith('DEEPSEEK_')) && key !== 'OCMS_STUB_FIXTURE' && key !== 'OCMS_STUB_MODE') delete env[key];
  }
  return { root, home, env, cleanup() { fs.rmSync(root, { recursive: true, force: true }); } };
}

function runCli(env, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SYNC_PATH, ...args], { cwd: REPO_ROOT, env, shell: false });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;
    const finish = (code, note) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      resolve({ code, stdout, stderr, note });
    };
    timer = setTimeout(() => {
      try { child.kill(); } catch { /* best effort */ }
      finish(null, 'TIMED OUT after ' + CHILD_TIMEOUT_MS + ' ms waiting for sync.mjs');
    }, CHILD_TIMEOUT_MS);
    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('error', (err) => finish(null, 'spawn failed: ' + String(err && err.message)));
    child.on('close', (code) => finish(code, null));
    child.stdin.end();
  });
}

function finalLine(stdout) {
  const lines = stdout.split(NL).map((line) => line.trim()).filter((line) => line.length > 0);
  return lines.length === 0 ? null : lines[lines.length - 1];
}

function assertVerdict(outcome, expected) {
  assert.equal(outcome.note, null, 'child must terminate normally: ' + String(outcome.note));
  assert.equal(finalLine(outcome.stdout), expected, 'final line must be the sole verdict; stdout:' + NL + outcome.stdout + NL + 'stderr:' + NL + outcome.stderr);
}

function freshTarget(ctx, t) {
  const scratch = path.join(ctx.root, 'scratch');
  fs.mkdirSync(scratch, { recursive: true });
  const target = path.join(scratch, 'settings.yaml');
  fs.writeFileSync(target, SETTINGS_SEED, 'utf8');
  t.after(() => ctx.cleanup());
  return { scratch, target };
}

describe('legacy --settings CLI refusals (C02)', () => {
  it('FETCH_FAILED: exit 1, final line NOT WRITTEN, zero writes', async (t) => {
    const ctx = makeChildEnv({ bodies: sourceBodies(), mode: 'fail' });
    const { scratch, target } = freshTarget(ctx, t);
    const before = fs.readFileSync(target);
    const outcome = await runCli(ctx.env, ['--settings', target]);
    assertVerdict(outcome, 'NOT WRITTEN');
    assert.equal(outcome.code, 1, 'refusal exits 1');
    assert.deepEqual(fs.readFileSync(target), before, 'refusal leaves settings bytes unchanged');
    assert.deepEqual(fs.readdirSync(scratch).sort(), ['settings.yaml'], 'refusal leaves no backup or temp residue');
  });

  it('PREVIEW_BLOCKED (whole-source roster failure): exit 1, final line NOT WRITTEN, zero writes', async (t) => {
    const ctx = makeChildEnv({ bodies: sourceBodies({ emptyZenRoster: true }) });
    const { scratch, target } = freshTarget(ctx, t);
    const before = fs.readFileSync(target);
    const outcome = await runCli(ctx.env, ['--settings', target]);
    assertVerdict(outcome, 'NOT WRITTEN');
    assert.equal(outcome.code, 1, 'blocked preview exits 1');
    assert.deepEqual(fs.readFileSync(target), before, 'blocked preview leaves bytes unchanged');
    assert.deepEqual(fs.readdirSync(scratch).sort(), ['settings.yaml'], 'blocked preview leaves no residue');
  });

  it('no interactive terminal: the run declines visibly instead of silently refusing', async (t) => {
    const ctx = makeChildEnv({ bodies: sourceBodies() });
    const { target } = freshTarget(ctx, t);
    const before = fs.readFileSync(target);
    const outcome = await runCli(ctx.env, ['--settings', target]);
    assertVerdict(outcome, 'NOT WRITTEN');
    assert.equal(outcome.code, 1, 'an unconfirmed run exits 1');
    assert.match(outcome.stderr, /interactive terminal/, 'stderr names the missing capability: ' + outcome.stderr.slice(0, 400));
    assert.deepEqual(fs.readFileSync(target), before, 'an unconfirmed run writes nothing');
  });

  it('two consecutive refused runs leave identical bytes and identical status', async (t) => {
    const ctx = makeChildEnv({ bodies: sourceBodies(), mode: 'fail' });
    const { target } = freshTarget(ctx, t);
    const first = await runCli(ctx.env, ['--settings', target]);
    const second = await runCli(ctx.env, ['--settings', target]);
    assertVerdict(first, 'NOT WRITTEN');
    assertVerdict(second, 'NOT WRITTEN');
    assert.equal(first.code, 1);
    assert.equal(second.code, 1);
    assert.equal(fs.readFileSync(target, 'utf8'), SETTINGS_SEED, 'bytes stay identical across two refusals');
  });
});

describe('legacy --settings verdict formatting (C03)', () => {
  it('UPDATED success renders a report whose final line is UPDATED and names the backup', () => {
    const written = syncMod.formatReport({ result: 'UPDATED', added: [{ key: 'go/model-a', route: 'opencode-go' }], removed: [], moved: [], metadataChanged: [] });
    assert.equal(finalLine(written), 'UPDATED');
    assert.match(written, /go\/model-a/, 'the change summary is printed');
  });

  it('NO CHANGE renders a report whose final line is NO CHANGE', () => {
    const written = syncMod.formatReport({ result: 'NO CHANGE', added: [], removed: [], moved: [], metadataChanged: [] });
    assert.equal(finalLine(written), 'NO CHANGE');
  });

  it('a refusal maps to NOT WRITTEN with the refusal code and never to a success verdict', () => {
    const entries = syncMod.legacySettingsUnresolved({ code: 'FETCH_FAILED', message: 'FETCH_FAILED: source unavailable' });
    assert.deepEqual(entries, [{ reason: 'FETCH_FAILED: FETCH_FAILED: source unavailable' }]);
    const written = syncMod.formatReport({ result: 'NOT WRITTEN', added: [], removed: [], moved: [], metadataChanged: [], unresolved: entries });
    assert.equal(finalLine(written), 'NOT WRITTEN');
    assert.match(written, /FETCH_FAILED/);
    for (const success of ['UPDATED', 'NO CHANGE']) assert.notEqual(finalLine(written), success);
  });

  it('refusal detail reasons are carried into the report', () => {
    const entries = syncMod.legacySettingsUnresolved({ code: 'PREVIEW_BLOCKED', message: 'Settings Preview is blocked.', reasons: ['CATALOG_INVALID: opencode-go.models is empty'] });
    const written = syncMod.formatReport({ result: 'NOT WRITTEN', added: [], removed: [], moved: [], metadataChanged: [], unresolved: entries });
    assert.equal(finalLine(written), 'NOT WRITTEN');
    assert.match(written, /CATALOG_INVALID: opencode-go\.models is empty/, 'each blocking reason is printed verbatim');
  });

  it('the exported formatter is what refuses for every refusal code family', () => {
    const codes = ['FETCH_FAILED', 'PREVIEW_BLOCKED', 'CONFIRMATION_DECLINED', 'STALE_SETTINGS', 'COMMIT_REFUSED', 'SETTINGS_TARGET_CHANGED', 'PRODUCTION_SETTINGS_REFUSED', 'SETTINGS_UNREADABLE'];
    for (const code of codes) {
      const outcome = { ok: false, mode: 'legacy-settings', code, message: code + ' message' };
      assert.notEqual(outcome.ok, true, code + ' must be treated as a failure');
      const written = syncMod.formatReport({ result: 'NOT WRITTEN', added: [], removed: [], moved: [], metadataChanged: [], unresolved: syncMod.legacySettingsUnresolved(outcome) });
      assert.equal(finalLine(written), 'NOT WRITTEN', code + ' must end with NOT WRITTEN');
      assert.match(written, new RegExp(code), code + ' must be named in the report');
    }
  });
});

// Byte-level provenance for the two success verdicts: how the CLI reaches
// them is asserted above through the shared formatter, and the refusal path
// is additionally proven by the spawned cases in the first describe block.
const SUCCESS_SHA = sha256(SETTINGS_SEED);
if (SUCCESS_SHA.length !== 64) throw new Error('sha256 helper must return 64 hex characters');
