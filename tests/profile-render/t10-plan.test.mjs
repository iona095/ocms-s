// S3 plan-builder — thin wrapper (P1-A \u00a75 S3, SPEC \u00a711.3).
// Reuses sync.mjs public pure functions; no refetch, no write.
import { describe, it } from 'node:test';
import { buildProfileAwarePlan } from '../../profile/plan-builder.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { assert, minimalSources } from './helpers.mjs';
import { MANAGED_ROUTE_KEYS } from '../../sync.mjs';

function sha(b) { return crypto.createHash('sha256').update(b).digest('hex'); }
function decoyPatchText() { return '- id: llm-pi-ai\n  name: LLM Pi AI\n  config:\n    providers:\n      other:\n        displayName: other\n        models: []\n'; }
function boundTarget(digest, overrides = {}) {
  return { profileName: 'fixture', profileDirReal: path.join(os.tmpdir(), 'ocms-s3-fixture-profile'), patchPathReal: path.join(os.tmpdir(), 'ocms-s3-fixture-profile', 'cordis.patch.yml'), pluginEntryName: 'LLM Pi AI', classification: 'SCRATCH', dshHomeReal: os.tmpdir(), patchDigest: digest, declaredOverlays: [], liveAttestation: null, ...overrides };
}
function boundReader({ patchText, storedConfig, status = 'MATCHED' } = {}) {
  const text = patchText || decoyPatchText();
  const bytes = Buffer.from(text, 'utf8');
  const digest = sha(bytes);
  const stored = storedConfig || { providers: { other: { displayName: 'other', models: [] } } };
  const target = boundTarget(digest);
  return { ok: true, status, target: structuredClone(target), patchBytes: bytes, patchDigest: digest, storedConfig: structuredClone(stored), effectiveConfig: structuredClone(stored), effectiveDigest: digest, documentModel: { root: 'sequence', size: 1, rows: [{ id: 'llm-pi-ai' }] }, llmEntryIndex: 0, overriddenBy: [], warnings: [] };
}

describe('S3 plan-builder — thin wrapper', () => {
  it('builds READY with desired from planning semantics (no refetch)', () => {
    const sources = minimalSources({ goIds: ['go-a'], zenIds: ['zen-b'] });
    const readerResult = boundReader({});
    const target = structuredClone(readerResult.target);
    const res = buildProfileAwarePlan({ target, readerResult, sources });
    assert.equal(res.ok, true);
    assert.equal(res.status, 'READY');
    assert.ok(res.desired, 'must carry desired');
    assert.ok(res.desired['opencode-go'] && res.desired['opencode-go'].length === 1, 'go desired missing: ' + JSON.stringify(res.desired));
    assert.ok(res.sourceSnapshotDigest && /^[0-9a-f]{64}$/.test(res.sourceSnapshotDigest), 'must bind source digest');
    assert.equal(res.patchDigest, readerResult.patchDigest);
    assert.ok(res.candidateBytes, 'READY must carry candidate');
    assert.ok(res.verification && res.verification.remainderEqual === true, 'must carry excision proof');
  });
  it('returns NO_CHANGE when desired already matches stored', async () => {
    const sources = minimalSources({ goIds: ['go-a'], zenIds: ['zen-b'] });
    const firstReader = boundReader({});
    const first = buildProfileAwarePlan({ target: structuredClone(firstReader.target), readerResult: firstReader, sources });
    assert.equal(first.ok, true);
    assert.equal(first.status, 'READY');
    assert.ok(first.footprint, 'must carry footprint');
    assert.ok(first.desired, 'first must carry desired');
    const secondProviders = {};
    for (const [route, models] of Object.entries(first.desired)) secondProviders[route] = { displayName: route, models: structuredClone(models) };
    const secondStored = { providers: secondProviders };
    const secondText = stringifyYaml([{ id: 'llm-pi-ai', name: 'LLM Pi AI', config: secondStored }]);
    const secondReader = boundReader({ patchText: secondText, storedConfig: secondStored });
    const second = buildProfileAwarePlan({ target: structuredClone(secondReader.target), readerResult: secondReader, sources });
    assert.equal(second.ok, true, 'second must succeed: ' + JSON.stringify(second).slice(0, 500));
    assert.equal(second.status, 'NO_CHANGE', 'second must be NO_CHANGE, got ' + JSON.stringify({ status: second.status, footprint: second.footprint }).slice(0, 800));
    assert.ok(!('candidateBytes' in second) || second.candidateBytes === undefined, 'NO_CHANGE must not carry candidate');
    assert.equal(MANAGED_ROUTE_KEYS.length, 6);
    assert.ok(second.footprint && typeof second.footprint === 'object' && !Array.isArray(second.footprint), 'second must carry footprint object');
    assert.deepEqual(Object.keys(second.footprint).sort(), [...MANAGED_ROUTE_KEYS].sort(), 'footprint must cover all six managed routes exactly');
    for (const route of MANAGED_ROUTE_KEYS) assert.equal(second.footprint[route], 'F0', 'route ' + route + ' must be F0');
  });
  it('returns BLOCKED on invalid sources without rendering', () => {
    const sources = { rosters: { go: [], zen: [] }, catalog: { go: { models: {} }, zen: { models: {} } }, docs: { go: {}, zen: {} } };
    const rr = boundReader({});
    const res = buildProfileAwarePlan({ target: structuredClone(rr.target), readerResult: rr, sources });
    assert.equal(res.ok, false);
    assert.ok(res.code || res.status === 'BLOCKED', 'must be blocked, got ' + JSON.stringify(res).slice(0, 300));
    assert.ok(!res.candidateBytes, 'BLOCKED must not carry candidate');
  });
  it('performs no disk mutation', () => {
    const sources = minimalSources();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-s3-plan-nomut-'));
    try {
      // A real scratch patch the planner is pointed at. Its bytes, mtime and
      // the directory entries around it must all survive planning untouched;
      // this replaces the tautology "res.ok === true || res.ok === false".
      const patchPath = path.join(dir, 'cordis.patch.yml');
      fs.writeFileSync(patchPath, decoyPatchText(), 'utf8');
      const beforeStat = fs.statSync(patchPath);
      const beforeBytes = fs.readFileSync(patchPath);
      const beforeEntries = fs.readdirSync(dir).sort();
      const beforeCwd = process.cwd();
      const rr = boundReader({});
      const target = { ...structuredClone(rr.target), profileDirReal: dir, patchPathReal: patchPath, dshHomeReal: dir };
      const res = buildProfileAwarePlan({ target, readerResult: { ...rr, target: structuredClone(target) }, sources });
      assert.equal(res.ok, true, 'plan must succeed: ' + JSON.stringify(res).slice(0, 300));
      assert.equal(res.status, 'READY');
      assert.equal(process.cwd(), beforeCwd, 'planning must not change the working directory');
      const afterStat = fs.statSync(patchPath);
      assert.equal(afterStat.mtimeMs, beforeStat.mtimeMs, 'planning must not rewrite the scratch patch file');
      assert.equal(afterStat.size, beforeStat.size, 'planning must not resize the scratch patch file');
      assert.deepEqual([...fs.readFileSync(patchPath)], [...beforeBytes], 'planning must not alter the scratch patch bytes');
      assert.deepEqual(fs.readdirSync(dir).sort(), beforeEntries, 'planning must not create or remove files next to the patch');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
