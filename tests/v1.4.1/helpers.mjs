// OCMS-S v1.4.1 test helpers (test-first gate).
// Freeze anchor for the frozen contract text plus shared unsupported-protocol
// fixtures. No production access: scratch settings only, no live network.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export { assert } from '../v1.3/helpers.mjs';
export {
  REPO_ROOT,
  assertScratchTarget,
  scratchDir,
  scratchSettingsFile,
  emptyCurrent,
  catRecord,
  validSources,
} from '../v1.3/helpers.mjs';
import { REPO_ROOT as ROOT } from '../v1.3/helpers.mjs';

// ---------------------------------------------------------------------------
// Contract freeze anchor (contract v1.4.1 §16). The contract file was frozen
// BEFORE any v1.4.1 test was written; the freeze test pins these values.
// ---------------------------------------------------------------------------

export const FROZEN_CONTRACT_FILE = 'OpenCode Model Sync \u2014 Simple Script Contract v1.4.1.md';
export const FROZEN_CONTRACT_SHA256 = 'f48e236f40ee5c15202f18c3e812d3f41742804304d0de0d070342c0adeeb05b';
export const FROZEN_CONTRACT_LINES = 392;

export function frozenContractBytes() {
  return fs.readFileSync(path.join(ROOT, FROZEN_CONTRACT_FILE));
}

export function sha256HexBytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

// Line count matching Get-Content semantics: a trailing final newline does
// not create an extra line.
export function countTextLines(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes);
  const parts = text.split('\n');
  return text.endsWith('\n') ? parts.length - 1 : parts.length;
}

// ---------------------------------------------------------------------------
// Unsupported-protocol fixtures. The implementation MUST NOT branch on these
// strings; they are fixture data only (contract §5 F4).
// ---------------------------------------------------------------------------

export const UNSUPPORTED_DOCS_URL = 'https://opencode.ai/zen/v1/systemone';
export const UNKNOWN_DOCS_URL = 'https://opencode.ai/zen/v1/future-protocol-9';
export const UNKNOWN_NPM = '@ai-sdk/unknown-pkg-zzz';

// A catalog record lacking limit.output (the observed Jev catalog shape).
export function missingOutputRecord(id, extra = {}) {
  return {
    id,
    name: 'Name ' + id,
    modalities: { input: ['text'] },
    limit: { context: 1000 },
    reasoning: false,
    ...extra,
  };
}

// A catalog record with complete projectable metadata.
export function completeRecord(id, extra = {}) {
  return {
    id,
    name: 'Name ' + id,
    modalities: { input: ['text'] },
    limit: { context: 1000, output: 100 },
    reasoning: false,
    ...extra,
  };
}
