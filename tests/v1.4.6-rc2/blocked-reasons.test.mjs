// OCMS-S v1.4.6-rc2 tests: SHOW WHY A PROFILE PREVIEW IS BLOCKED.
// Test-first gate written against the frozen contract v1.4.6-rc2 (see
// helpers.mjs freeze anchor). Scratch profiles/settings only; no live network.
// Frozen test identities (§11): 6 tests.
import { describe, it, beforeEach, afterEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  assert,
  FROZEN_CONTRACT_FILE,
  FROZEN_CONTRACT_SHA256,
  FROZEN_CONTRACT_LINES,
  frozenContractBytes,
  sha256HexBytes,
  countTextLines,
  REPO_ROOT,
} from './helpers.mjs';
import {
  catRecord,
  validSources,
  validSourceBodies,
  fetchFromBodies,
  postJson,
  authHeaders,
  scratchSettingsFile,
} from '../v1.3/helpers.mjs';
import {
  makeTempHome,
  sandboxDshHome,
  withR2Port,
} from '../profile-cli-ui/helpers.mjs';
import {
  makeProfile as makeS4Profile,
  makeFixtureBundle,
  llmRow as s4Row,
} from '../profile-commit/helpers.mjs';

function blockingSources() {
  return {
    rosters: { go: ['blk-a', 'blk-b'], zen: ['ok-z'] },
    catalog: {
      go: {
        npm: '@ai-sdk/openai-compatible',
        models: {
          'blk-a': catRecord({ id: 'blk-a', name: 'Blk A', limit: { context: 1000 }, provider: { npm: '@ai-sdk/openai-compatible' } }),
          'blk-b': catRecord({ id: 'blk-b', name: 'Blk B', limit: { context: 1000 }, provider: { npm: '@ai-sdk/openai-compatible' } }),
        },
      },
      zen: { npm: '@ai-sdk/openai', models: { 'ok-z': catRecord({ id: 'ok-z', name: 'Ok Z', provider: { npm: '@ai-sdk/openai' } }) } },
    },
    docs: {
      go: {
        'blk-a': 'https://opencode.ai/zen/go/v1/chat/completions',
        'blk-b': 'https://opencode.ai/zen/go/v1/chat/completions',
      },
      zen: { 'ok-z': 'https://opencode.ai/zen/v1/responses' },
    },
  };
}

function seedEntries() {
  return [s4Row({ config: { providers: { other: { displayName: 'other', models: [] } } } })];
}

describe('v1.4.6-rc2 show why a profile Preview is blocked', () => {
  it('1. contract v1.4.6-rc2 freeze anchor is intact', () => {
    const bytes = frozenContractBytes();
    assert.equal(sha256HexBytes(bytes), FROZEN_CONTRACT_SHA256, 'contract SHA-256 must match the frozen value');
    assert.equal(countTextLines(bytes), FROZEN_CONTRACT_LINES, 'contract line count must match the frozen value');
    assert.ok(FROZEN_CONTRACT_FILE.length > 0);
  });

  describe('profile blocked reasons', () => {
    let home;
    let cleanupHome;
    let restore;
    beforeEach(() => {
      restore = sandboxDshHome();
      const h = makeTempHome();
      home = h.home;
      cleanupHome = h.cleanup;
    });
    afterEach(() => {
      try { cleanupHome(); } catch {}
      try { restore(); } catch {}
    });

    it('2. web-blocked-reasons: stubbed blocked Preview carries every reason verbatim in order', async (t) => {
      const dir = makeS4Profile(home, 'rc2blk', { entries: seedEntries(), bundles: ['@fixture/base'] });
      makeFixtureBundle(dir);
      const sources = blockingSources();
      const ui = await import('../../ui.mjs');
      const started = await withR2Port(t, (port) => ui.startServer({ port, fetchFn: fetchFromBodies(validSourceBodies(sources)), openBrowser: false }));
      const res = await postJson(started.port, '/api/preview', { profileName: 'rc2blk', dshHome: home }, authHeaders(started.token));
      assert.equal(res.status, 400, 'VERIFY_FAILED refusal keeps HTTP 400 (body: ' + res.body.slice(0, 300) + ')');
      assert.equal(res.json.ok, false);
      assert.equal(res.json.code, 'VERIFY_FAILED');
      assert.equal(res.json.message, 'Planning is blocked.');
      assert.ok(Array.isArray(res.json.blockedReasons), 'blockedReasons present');
      assert.equal(res.json.blockedReasons.length, 2);
      const { buildProfilePreview } = await import('../../profile/preview-session.mjs');
      const built = await buildProfilePreview({ profileName: 'rc2blk', dshHome: home, origin: 'UI', scratchMode: false, sources, installAnchorDir: null });
      assert.equal(built.ok, false);
      const expected = built.detail.reasons;
      assert.ok(Array.isArray(expected) && expected.length === 2, 'planner yields 2 reasons');
      assert.deepEqual(res.json.blockedReasons, expected.map((r) => ({ reason: r })), 'verbatim and in order');
      assert.equal('detail' in res.json, false, 'no detail key leaks');
    });

    it('3. web-no-leak: non-reasons detail yields no blockedReasons and no detail', async (t) => {
      const uiMod = await import('../../ui.mjs');
      assert.equal(typeof uiMod.profileRefusalBlockedReasons, 'function', 'web mapping helper must exist');
      const digest = { expected: 'a'.repeat(64), observed: 'b'.repeat(64) };
      assert.equal(uiMod.profileRefusalBlockedReasons(digest), undefined, 'digest object must not map');
      assert.equal(uiMod.profileRefusalBlockedReasons('reader-missing'), undefined, 'internal string must not map');
      assert.equal(uiMod.profileRefusalBlockedReasons({ reasons: [] }), undefined, 'empty array must not map');
      assert.equal(uiMod.profileRefusalBlockedReasons({ reasons: [1, 2] }), undefined, 'non-string array must not map');
      assert.deepEqual(uiMod.profileRefusalBlockedReasons({ reasons: ['x', 'y'] }), [{ reason: 'x' }, { reason: 'y' }], 'valid reasons map');
      const dir = makeS4Profile(home, 'rc2leak', { entries: seedEntries(), bundles: ['@fixture/base'] });
      makeFixtureBundle(dir);
      fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), 'llm-pi-ai:\n  providers: {}\n', 'utf8');
      const started = await withR2Port(t, (port) => uiMod.startServer({ port, fetchFn: fetchFromBodies(validSourceBodies()), openBrowser: false }));
      const res = await postJson(started.port, '/api/preview', { profileName: 'rc2leak', dshHome: home }, authHeaders(started.token));
      assert.equal(res.json.ok, false);
      assert.equal('blockedReasons' in res.json, false, 'object detail must not produce blockedReasons');
      assert.equal('detail' in res.json, false, 'object detail must not leak as detail');
    });

    it('5. cli-blocked-reasons: blocked profile run reports every reason with exit 1', async () => {
      const dir = makeS4Profile(home, 'rc2cli', { entries: seedEntries(), bundles: ['@fixture/base'] });
      makeFixtureBundle(dir);
      const sources = blockingSources();
      const syncMod = await import('../../sync.mjs');
      assert.equal(typeof syncMod.blockedProfileUnresolved, 'function', 'CLI mapping helper must exist');
      const { dispatchSyncCli } = syncMod;
      const result = await dispatchSyncCli(['--profile', 'rc2cli'], {
        fetchFn: fetchFromBodies(validSourceBodies(sources)),
        confirmFn: async () => false,
        dshHome: home,
        print: () => {},
      });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'VERIFY_FAILED');
      assert.equal(result.message, 'Planning is blocked.');
      assert.ok(result.detail && Array.isArray(result.detail.reasons) && result.detail.reasons.length === 2);
      const entries = syncMod.blockedProfileUnresolved(result);
      assert.equal(entries.length, 3, 'existing line plus 2 reasons');
      assert.deepEqual(entries[0], { reason: 'VERIFY_FAILED: Planning is blocked.' });
      assert.deepEqual(entries.slice(1), result.detail.reasons.map((r) => ({ reason: r })));
      assert.equal(result.ok, false, 'blocked run refuses');
      const syncSrc = fs.readFileSync(path.join(REPO_ROOT, 'sync.mjs'), 'utf8');
      assert.ok(syncSrc.includes('process.exitCode = 1'), 'CLI exit-code wiring intact');
      const report = syncMod.formatReport({ result: 'NOT WRITTEN', unresolved: entries });
      assert.ok(report.includes('unresolved (3):'), 'unresolved section present:\n' + report);
      assert.ok(report.includes('VERIFY_FAILED: Planning is blocked.'), 'existing line present:\n' + report);
      for (const r of result.detail.reasons) {
        assert.ok(report.includes(r), 'reason printed as own entry: ' + r + '\n' + report);
      }
    });
  });

  it('4. ui-blocked-vs-error: VERIFY_FAILED with reasons shows BLOCKED, others show ERROR', () => {
    const html = fs.readFileSync(path.join(REPO_ROOT, 'ui', 'index.html'), 'utf8');
    assert.ok(html.includes("err.code === 'VERIFY_FAILED'"), 'profile catch branches on VERIFY_FAILED');
    assert.ok(html.includes('err.blockedReasons'), 'profile catch reads blockedReasons from the refusal');
    assert.ok(html.includes('Synchronization blocked'), 'BLOCKED notice reuses the legacy format');
    assert.ok(html.includes("join(' | ')"), 'reasons joined with the legacy separator');
    assert.ok(html.includes("setState('BLOCKED')"), 'BLOCKED state reachable');
    assert.ok(html.includes("setState('ERROR')"), 'ERROR fallback retained');
  });

  it('6. http-drift-passthrough: legacy Preview payload carries endpointBaseDrift', async (t) => {
    const file = scratchSettingsFile(t);
    const sources = validSources({
      rosters: { zen: ['model-z'] },
      catalog: { zen: { npm: '@ai-sdk/openai', models: { 'model-z': catRecord({ id: 'model-z', name: 'Z', provider: { npm: '@ai-sdk/openai' } }) } } },
      docs: { zen: { 'model-z': 'https://opencode.ai/inference/v1/responses' } },
    });
    const { startTestServer } = await import('../v1.3/helpers.mjs');
    const { nextTestPort } = await import('../v1.3/helpers.mjs');
    const started = await startTestServer(t, { settingsPath: file, port: nextTestPort(), fetchFn: fetchFromBodies(validSourceBodies(sources)) });
    const preview = await postJson(started.port, '/api/preview', {}, authHeaders(started.token));
    assert.equal(preview.status, 200);
    assert.equal(preview.json.state, 'READY');
    assert.deepEqual(preview.json.endpointBaseDrift, [
      { gateway: 'zen', documentedBase: 'https://opencode.ai/inference/v1', routedBase: 'https://opencode.ai/zen/v1', models: 1 },
    ]);
  });
});
