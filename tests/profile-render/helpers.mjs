// S3 test helpers — synthetic disposable fixtures only.
//
// Every fixture lives under os.tmpdir() (fresh mkdtemp per test) and is
// removed afterwards. Nothing here may reference the real DSH home, the real
// web profile, accounts, credentials, or model gateways. All patch bytes are
// synthetic; credential-shaped values use SYNTHETIC markers only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { stringify as stringifyYaml } from 'yaml';

export { assert };

export const MANAGED_ROUTES = ['opencode-go', 'opencode-go-messages', 'opencode-go-responses', 'opencode-completions', 'opencode-messages', 'opencode'];

export const SECRET_MARKERS = [
  'SYNTHETIC_FAKE_KEY_alpha bravo 001',
  'SYNTHETIC_FAKE_TOKEN_charlie delta 002',
  'SYNTHETIC_FAKE_SECRET_echo foxtrot 003',
];

let counter = 0;

export function makeTempDir(prefix = 'ocms-s3-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix + process.pid + '-' + (counter++) + '-'));
  return {
    dir,
    cleanup() { fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

export function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function sha256HexBytes(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Minimal synthetic model record (planner-shaped).
export function modelRecord(id, overrides = {}) {
  return {
    id,
    name: 'Model ' + id,
    input: ['text'],
    contextWindow: 128000,
    maxTokens: 4096,
    ...overrides,
  };
}

// Build a synthetic desired six-array object. Missing routes default to [].
export function desiredSix(overrides = {}) {
  const out = {};
  for (const r of MANAGED_ROUTES) out[r] = [];
  for (const [k, v] of Object.entries(overrides)) out[k] = v;
  return out;
}

// Build a synthetic patch text with an llm-pi-ai entry at index 0 plus
// optional decoys. providersObj is the config.providers object (plain).
// extraEntries are additional root rows. header/trailer add comments.
export function buildPatchText({ providersObj = {}, extraEntries = [], header = '# header comment\n', trailer = '# trailer comment\n', entryName = 'LLM Pi AI' } = {}) {
  const llmEntry = { id: 'llm-pi-ai', name: entryName, config: { providers: providersObj } };
  const rows = [llmEntry, ...extraEntries];
  return header + stringifyYaml(rows) + trailer;
}

// Raw patch write under a temp dir (no profile semantics, just bytes).
export function writePatchFile(dir, filename, text) {
  const p = path.join(dir, filename);
  fs.writeFileSync(p, text, 'utf8');
  return p;
}

export function exciseBytes(bytes, spans) {
  // spans: [{start,end}] byte offsets, exclusive end. Sorted descending.
  const sorted = [...spans].sort((a, b) => b.start - a.start);
  let out = Buffer.from(bytes);
  for (const s of sorted) {
    out = Buffer.concat([out.slice(0, s.start), out.slice(s.end)]);
  }
  return out;
}

export function assertNoSecrets(value, label) {
  const text = JSON.stringify(value);
  for (const m of SECRET_MARKERS) {
    assert.ok(!text.includes(m), label + ': secret marker leaked');
  }
}

export function snapshotFile(filePath) {
  const st = fs.statSync(filePath);
  return { size: st.size, mtimeMs: st.mtimeMs, bytes: fs.readFileSync(filePath) };
}

// Minimal valid planning sources for plan-builder tests (no network).
// Uses provider.npm hints so placement is deterministic without docs.
export function minimalSources({ goIds = ['go-a'], zenIds = ['zen-b'] } = {}) {
  const goModels = {};
  for (const id of goIds) {
    goModels[id] = {
      id, name: 'Go ' + id,
      limit: { context: 64000, output: 4096 },
      modalities: { input: ['text'] },
      reasoning: true,
      provider: { npm: '@ai-sdk/openai-compatible' },
    };
  }
  const zenModels = {};
  for (const id of zenIds) {
    zenModels[id] = {
      id, name: 'Zen ' + id,
      limit: { context: 128000, output: 8192 },
      modalities: { input: ['text'] },
      reasoning: true,
      provider: { npm: '@ai-sdk/anthropic' },
    };
  }
  return {
    rosters: { go: [...goIds], zen: [...zenIds] },
    catalog: { go: { models: goModels }, zen: { models: zenModels } },
    docs: { go: {}, zen: {} },
  };
}

export function minimalTarget(overrides = {}) {
  return {
    profileName: 'fixture',
    profileDirReal: path.join(os.tmpdir(), 'ocms-s3-fixture-profile'),
    patchPathReal: path.join(os.tmpdir(), 'ocms-s3-fixture-profile', 'cordis.patch.yml'),
    pluginEntryName: 'LLM Pi AI',
    classification: 'SCRATCH',
    patchDigest: '0'.repeat(64),
    declaredOverlays: [],
    liveAttestation: null,
    ...overrides,
  };
}
