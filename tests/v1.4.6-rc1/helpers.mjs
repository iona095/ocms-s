// OCMS-S v1.4.6-rc1 test helpers (test-first gate).
// Freeze anchor for the frozen contract text plus captured docs fixtures.
// No production access: scratch settings only, no live network.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export { assert } from '../v1.3/helpers.mjs';
export { REPO_ROOT, scratchSettingsFile, emptyCurrent, catRecord, validSources } from '../v1.3/helpers.mjs';
import { REPO_ROOT as ROOT } from '../v1.3/helpers.mjs';

// ---------------------------------------------------------------------------
// Contract freeze anchor (contract v1.4.6-rc1 §12).
// ---------------------------------------------------------------------------

export const FROZEN_CONTRACT_FILE = 'OpenCode Model Sync — Simple Script Contract v1.4.6-rc1.md';
export const FROZEN_CONTRACT_SHA256 = 'f041e7540875e53419243316289cd9b98ef52606cdff4c8ec665c3c9df41fa38';
export const FROZEN_CONTRACT_LINES = 236;

export function frozenContractBytes() {
  return fs.readFileSync(path.join(ROOT, FROZEN_CONTRACT_FILE));
}

export function sha256HexBytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function countTextLines(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes);
  const parts = text.split('\n');
  return text.endsWith('\n') ? parts.length - 1 : parts.length;
}

// ---------------------------------------------------------------------------
// Captured 2026-10-12 docs pages (read-only fixtures, contract §8).
// ---------------------------------------------------------------------------

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
export function goDocsHtml() {
  return fs.readFileSync(path.join(FIXTURE_DIR, 'candidate-go-20261012.html'), 'utf8');
}
export function zenDocsHtml() {
  return fs.readFileSync(path.join(FIXTURE_DIR, 'candidate-models-20261012.html'), 'utf8');
}

// The six managed baseURL literals released in v1.4.5 (contract §3 I-EMIT).
export const V145_ROUTE_BASE_URLS = Object.freeze({
  'opencode-go': 'https://opencode.ai/zen/go/v1',
  'opencode-go-messages': 'https://opencode.ai/zen/go',
  'opencode-go-responses': 'https://opencode.ai/zen/go/v1',
  'opencode-completions': 'https://opencode.ai/zen/v1',
  'opencode-messages': 'https://opencode.ai/zen',
  'opencode': 'https://opencode.ai/zen/v1',
});

export const ZEN_ALIAS = 'https://opencode.ai/inference/v1';
