// OCMS-S v1.3 contract tests — A (baseline/compatibility), B (shared engine
// seam), J (digest determinism, engine side). Pre-implementation controlled
// RED gate: the two capability anchors may RED; every dependent test
// conditionally skips until the capability exists and then runs unedited.
// No live network, no production target, no runtime implementation here.
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { parse as parseYaml } from 'yaml';
import {
  REPO_ROOT,
  sync,
  hasBuildPlan,
  hasCommitPlan,
  hasEngineSeam,
  assertScratchTarget,
  productionSettingsPath,
  scratchDir,
  scratchSettingsFile,
  readSettingsBytes,
  assertNoBackupOrTemp,
  backupCount,
  tempResidue,
  validSources,
  catRecord,
  nodeSpawn,
  sha256Hex,
} from './helpers.mjs';

const ALLOWED_TEST_MODULES = [
  'node:test', 'node:assert', 'node:assert/strict', 'node:fs', 'node:path',
  'node:os', 'node:http', 'node:crypto', 'node:url', 'node:child_process',
  './helpers.mjs', 'yaml', '../sync.mjs',
];

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

function listTestSources() {
  return fs.readdirSync(THIS_DIR).filter((f) => f.endsWith('.mjs'));
}

function importedSpecifiers(source) {
  const specifiers = [];
  for (const match of source.matchAll(/from\s+'([^']+)'/g)) specifiers.push(match[1]);
  for (const match of source.matchAll(/import\('([^']+)'\)/g)) specifiers.push(match[1]);
  return specifiers;
}

function hex64Fields(plan) {
  return Object.keys(plan)
    .filter((k) => typeof plan[k] === 'string' && /^[0-9a-f]{64}$/.test(plan[k]))
    .sort();
}

function digestValues(plan) {
  return hex64Fields(plan).map((k) => plan[k]);
}

function fallbackSources() {
  return validSources({
    rosters: { go: ['widget-free', 'widget', 'model-a'], zen: ['model-z'] },
    catalog: {
      go: {
        npm: '@ai-sdk/openai-compatible',
        models: {
          'widget-free': catRecord({ id: 'widget-free', name: 'Widget Free' }),
          widget: catRecord({ id: 'widget', name: 'Widget Counterpart', provider: { npm: '@ai-sdk/anthropic' } }),
          'model-a': catRecord({ provider: { npm: '@ai-sdk/openai-compatible' } }),
        },
      },
      zen: { npm: '@ai-sdk/openai', models: { 'model-z': catRecord({ id: 'model-z', name: 'Z', provider: { npm: '@ai-sdk/openai' } }) } },
    },
    docs: {
      go: { widget: 'https://opencode.ai/zen/go/v1/chat/completions', 'model-a': 'https://opencode.ai/zen/go/v1/chat/completions' },
      zen: { 'model-z': 'https://opencode.ai/zen/v1/responses' },
    },
  });
}

// ---------------------------------------------------------------------------
// Capability anchors — the only intentional RED tests in this file.
// ---------------------------------------------------------------------------

test('capability anchor: sync.mjs exports buildPlan (v1.3 contract 5.5 / 9 plan boundary)', () => {
  assert.equal(hasBuildPlan, true, 'sync.mjs must export buildPlan for the shared plan/commit boundary');
});

test('capability anchor: sync.mjs exports commitPlan (v1.3 contract 11.2 / 17 transaction boundary)', () => {
  assert.equal(hasCommitPlan, true, 'sync.mjs must export commitPlan for the shared transaction boundary');
});

// ---------------------------------------------------------------------------
// A — baseline / compatibility (already-satisfied v1.2 invariants; GREEN).
// ---------------------------------------------------------------------------

test('A1: importing sync.mjs performs no synchronization, fetch, or write', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-v13-import-'));
  const settings = path.join(dir, 'settings.yaml');
  fs.writeFileSync(settings, 'llm-pi-ai:\n  providers: {}\n', 'utf8');
  const launcher = path.join(dir, 'launcher.mjs');
  fs.writeFileSync(launcher, [
    "globalThis.fetch = async () => { throw new Error('AUDIT_FETCH_BLOCKED'); };",
    'await import(' + JSON.stringify(pathToFileURL(path.join(REPO_ROOT, 'sync.mjs')).href) + ');',
    "console.log('IMPORTED_OK');",
  ].join('\n'), 'utf8');
  try {
    const run = await nodeSpawn([launcher], { env: { OCMS_SETTINGS: 'C:\\must-not-be-used.yaml' } });
    assert.equal(run.code, 0, 'launcher exits cleanly; stderr=' + run.stderr);
    assert.equal(run.stderr, '', 'no import-time errors');
    assert.equal(run.stdout.trim(), 'IMPORTED_OK', 'only the launcher marker is printed');
    assert.deepEqual(fs.readdirSync(dir).sort(), ['launcher.mjs', 'settings.yaml'], 'import created no residue');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('A2: explicit --settings and default target semantics remain unchanged', () => {
  assert.equal(sync.resolveSettingsPath(['node', 'sync.mjs', '--settings=C:\\scratch\\settings.yaml']), 'C:\\scratch\\settings.yaml');
  const fallback = sync.defaultSettingsPath();
  assert.ok(fallback.endsWith(path.join('.dsh', 'settings.yaml')), 'default resolves to the DSH settings file');
});

test('A3: ambient HOME cannot redirect the production target', () => {
  const savedUser = process.env.USERPROFILE;
  const savedHome = process.env.HOME;
  try {
    process.env.USERPROFILE = 'C:\\user-trap-v13';
    process.env.HOME = 'C:\\home-trap-v13';
    assert.equal(sync.defaultSettingsPath(), path.join('C:\\user-trap-v13', '.dsh', 'settings.yaml'));
    delete process.env.USERPROFILE;
    const fallback = sync.defaultSettingsPath();
    assert.notEqual(fallback, path.join('C:\\home-trap-v13', '.dsh', 'settings.yaml'));
    assert.ok(fallback.endsWith(path.join('.dsh', 'settings.yaml')));
  } finally {
    if (savedUser === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = savedUser;
    if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome;
  }
});

test('A4: OCMS_SETTINGS cannot redirect production execution', () => {
  const saved = process.env.OCMS_SETTINGS;
  try {
    process.env.OCMS_SETTINGS = 'C:\\must-not-be-used-v13.yaml';
    assert.equal(sync.resolveSettingsPath(['node', 'sync.mjs']), sync.defaultSettingsPath());
  } finally {
    if (saved === undefined) delete process.env.OCMS_SETTINGS; else process.env.OCMS_SETTINGS = saved;
  }
});

test('A5: CLI entry remains available (syntax-valid module exposing the v1.2 surface)', async () => {
  const run = await nodeSpawn(['--check', path.join(REPO_ROOT, 'sync.mjs')]);
  assert.equal(run.code, 0, 'sync.mjs parses; stderr=' + run.stderr);
  assert.equal(typeof sync.runSync, 'function');
  assert.equal(typeof sync.formatReport, 'function');
  assert.equal(typeof sync.fetchSources, 'function');
});

test('A6: v1.2 managed route identities remain exactly six and unchanged', () => {
  const expected = {
    'opencode-go': { gateway: 'go', api: 'openai-completions', baseURL: 'https://opencode.ai/zen/go/v1', apiKeyEnv: 'OPENCODE_GO_API_KEY' },
    'opencode-go-messages': { gateway: 'go', api: 'anthropic-messages', baseURL: 'https://opencode.ai/zen/go', apiKeyEnv: 'OPENCODE_GO_API_KEY' },
    'opencode-go-responses': { gateway: 'go', api: 'openai-responses', baseURL: 'https://opencode.ai/zen/go/v1', apiKeyEnv: 'OPENCODE_GO_API_KEY' },
    'opencode-completions': { gateway: 'zen', api: 'openai-completions', baseURL: 'https://opencode.ai/zen/v1', apiKeyEnv: 'OPENCODE_API_KEY' },
    'opencode-messages': { gateway: 'zen', api: 'anthropic-messages', baseURL: 'https://opencode.ai/zen', apiKeyEnv: 'OPENCODE_API_KEY' },
    opencode: { gateway: 'zen', api: 'openai-responses', baseURL: 'https://opencode.ai/zen/v1', apiKeyEnv: 'OPENCODE_API_KEY' },
  };
  assert.deepEqual(sync.MANAGED_ROUTES, expected);
  assert.deepEqual(sync.MANAGED_ROUTE_KEYS.slice().sort(), Object.keys(expected).sort());
});

test('A7: test harness guard refuses the production target and accepts scratch paths', () => {
  assert.throws(() => assertScratchTarget(productionSettingsPath()), /TEST_HARNESS_GUARD/, 'guard fails loudly for production');
  const scratch = 'C:\\temp\\ocms-test-v13\\settings.yaml';
  assert.equal(assertScratchTarget(scratch), path.resolve(scratch));
});

test('A8: no new package dependency and only sanctioned test modules are used', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}).sort(), ['node-html-parser', 'yaml']);
  assert.deepEqual(pkg.devDependencies ?? {}, {});
  const offenders = [];
  for (const file of listTestSources()) {
    const source = fs.readFileSync(path.join(THIS_DIR, file), 'utf8');
    for (const spec of importedSpecifiers(source)) {
      if (!ALLOWED_TEST_MODULES.includes(spec) && !spec.startsWith('node:')) offenders.push(file + ' -> ' + spec);
    }
  }
  assert.deepEqual(offenders, [], 'only sanctioned modules may be imported');
});

test('A9: no v1.3 test file embeds the real production settings path', () => {
  const production = productionSettingsPath();
  const offending = listTestSources().filter((f) => fs.readFileSync(path.join(THIS_DIR, f), 'utf8').includes(production));
  assert.deepEqual(offending, [], 'the production path must never appear in test sources');
});

// ---------------------------------------------------------------------------
// B — shared engine seam (dependent on buildPlan/commitPlan capabilities).
// ---------------------------------------------------------------------------

test('B1: buildPlan performs zero disk mutation (no backup, no temp, no settings write)',
  { skip: !hasBuildPlan },
  (t) => {
    const file = scratchSettingsFile(t);
    const dir = path.dirname(file);
    const beforeBytes = fs.readFileSync(file);
    const beforeFiles = fs.readdirSync(dir).sort();
    const plan = sync.buildPlan({ settingsPath: file, sources: validSources() });
    assert.ok(plan, 'buildPlan returned a plan');
    assert.deepEqual(fs.readFileSync(file), beforeBytes, 'settings bytes unchanged');
    assert.deepEqual(fs.readdirSync(dir).sort(), beforeFiles, 'directory listing unchanged');
    assertNoBackupOrTemp(dir);
  });

test('B2: planning desired arrays deep-equal the existing v1.2 synchronization result',
  { skip: !hasEngineSeam },
  (t) => {
    const sources = validSources();
    const fileA = scratchSettingsFile(t);
    assert.equal(sync.syncFromSources({ settingsPath: fileA, sources }).result, 'UPDATED');
    const writtenProviders = parseYaml(fs.readFileSync(fileA, 'utf8'))['llm-pi-ai'].providers;
    const fileB = path.join(scratchDir(t), 'settings.yaml');
    fs.writeFileSync(fileB, readSettingsBytes(fileA), 'utf8');
    const plan = sync.buildPlan({ settingsPath: fileB, sources: validSources() });
    for (const route of sync.MANAGED_ROUTE_KEYS) {
      const written = writtenProviders[route] && Array.isArray(writtenProviders[route].models) ? writtenProviders[route].models : [];
      assert.deepEqual(plan.desired[route], written, 'desired matches written for ' + route);
    }
  });

test('B3: buildPlan dispositions preserve v1.2 preserved/skipped semantics',
  { skip: !hasEngineSeam },
  (t) => {
    const sources = validSources({
      rosters: { go: ['ghost', 'model-a'], zen: ['model-z'] },
      catalog: {
        go: { npm: '@ai-sdk/openai-compatible', models: { 'model-a': catRecord({ provider: { npm: '@ai-sdk/openai-compatible' } }) } },
        zen: { npm: '@ai-sdk/openai', models: { 'model-z': catRecord({ id: 'model-z', name: 'Z', provider: { npm: '@ai-sdk/openai' } }) } },
      },
      docs: {
        go: { 'model-a': 'https://opencode.ai/zen/go/v1/chat/completions' },
        zen: { 'model-z': 'https://opencode.ai/zen/v1/responses' },
      },
    });
    const file = scratchSettingsFile(t);
    const plan = sync.buildPlan({ settingsPath: file, sources });
    assert.equal(plan.state, 'READY');
    assert.deepEqual(
      plan.dispositions.filter((d) => d.disposition === 'SKIPPED_UNRESOLVED'),
      [{ gateway: 'go', id: 'ghost', disposition: 'SKIPPED_UNRESOLVED', reason: 'CATALOG_MISSING' }],
    );
    assert.deepEqual(plan.dispositions.filter((d) => d.disposition === 'PRESERVED_UNRESOLVED'), []);
  });

test('B4: buildPlan preserves FREE_COUNTERPART_FALLBACK provenance semantics',
  { skip: !hasEngineSeam },
  (t) => {
    const file = scratchSettingsFile(t);
    const plan = sync.buildPlan({ settingsPath: file, sources: fallbackSources() });
    assert.equal(plan.state, 'READY');
    assert.deepEqual(
      plan.dispositions.find((d) => d.id === 'widget-free'),
      { gateway: 'go', id: 'widget-free', disposition: 'RESOLVED', reason: null, route: 'opencode-go', provenance: 'FREE_COUNTERPART_FALLBACK', counterpart: 'widget' },
    );
  });

test('B5: buildPlan BLOCKED preserves v1.2 NOT WRITTEN meaning and mutates nothing',
  { skip: !hasBuildPlan },
  (t) => {
    const file = scratchSettingsFile(t);
    const beforeBytes = fs.readFileSync(file);
    const plan = sync.buildPlan({ settingsPath: file, sources: validSources({ catalog: { go: {} } }) });
    assert.equal(plan.state, 'BLOCKED');
    assert.ok(Array.isArray(plan.blockedReasons) && plan.blockedReasons.length > 0, 'blocked reasons present');
    assert.match(plan.blockedReasons[0].reason, /SOURCE_INVALID|CATALOG_INVALID|ROSTER_INVALID|DOCS_INVALID/, 'reason preserves v1.2 source-failure meaning');
    assert.equal(plan.desired, null, 'blocked plan carries no desired arrays');
    assertNoBackupOrTemp(path.dirname(file), beforeBytes);
  });

test('B6: NO_CHANGE is represented by buildPlan without any commit side effect',
  { skip: !hasEngineSeam },
  (t) => {
    const sources = validSources();
    const file = scratchSettingsFile(t);
    assert.equal(sync.syncFromSources({ settingsPath: file, sources }).result, 'UPDATED');
    const beforeBytes = fs.readFileSync(file);
    const backups = backupCount(path.dirname(file));
    const plan = sync.buildPlan({ settingsPath: file, sources });
    assert.equal(plan.state, 'NO_CHANGE');
    assert.equal(plan.changed, false);
    assert.equal(backupCount(path.dirname(file)), backups, 'no extra backup from planning');
    assert.deepEqual(fs.readFileSync(file), beforeBytes, 'bytes unchanged');
  });

test('B7: buildPlan+commitPlan is CLI-equivalent (same outcome, bytes, and backup count)',
  { skip: !hasEngineSeam },
  (t) => {
    const sources = validSources();
    const fileA = scratchSettingsFile(t);
    const originalBytes = fs.readFileSync(fileA);
    const outcomeA = sync.syncFromSources({ settingsPath: fileA, sources });
    assert.equal(outcomeA.result, 'UPDATED');
    const bytesA = fs.readFileSync(fileA);
    const backupsA = backupCount(path.dirname(fileA));

    const fileB = path.join(scratchDir(t), 'settings.yaml');
    fs.writeFileSync(fileB, originalBytes, 'utf8');
    const plan = sync.buildPlan({ settingsPath: fileB, sources });
    const outcomeB = sync.commitPlan(plan);
    assert.equal(outcomeB.result, 'UPDATED');
    assert.deepEqual(fs.readFileSync(fileB), bytesA, 'commitPlan writes the same document bytes');
    assert.equal(backupCount(path.dirname(fileB)), backupsA, 'same backup count');
    for (const field of ['added', 'removed', 'moved', 'metadataChanged', 'preservedUnresolved', 'skippedUnresolved', 'fallbackResolved']) {
      assert.deepEqual(outcomeB[field], outcomeA[field], field + ' identical');
    }
  });

test('B8: commitPlan refuses stale settings bytes (no backup, no temp, no write)',
  { skip: !hasCommitPlan },
  (t) => {
    const file = scratchSettingsFile(t);
    const plan = sync.buildPlan({ settingsPath: file, sources: validSources() });
    fs.appendFileSync(file, '\n# external edit\n', 'utf8');
    const mutated = fs.readFileSync(file);
    const outcome = sync.commitPlan(plan);
    assert.equal(outcome.result, 'NOT WRITTEN');
    assert.equal(outcome.stale, true, 'commitPlan reports the stale refusal distinctly');
    assert.deepEqual(fs.readFileSync(file), mutated, 'mutated bytes untouched by the refusal');
    assert.equal(backupCount(path.dirname(file)), 0, 'no backup on stale');
    assert.equal(tempResidue(path.dirname(file)).length, 0, 'no temp on stale');
  });

// ---------------------------------------------------------------------------
// J — digest determinism (engine side; retained-state immutability lives in
// the server suites where the retained record exists).
// ---------------------------------------------------------------------------

test('J1: settings digest binds to exact bytes (LF vs CRLF and whitespace differ)',
  { skip: !hasBuildPlan },
  (t) => {
    const sources = validSources();
    const file = scratchSettingsFile(t);
    const originalBytes = fs.readFileSync(file);
    const plan1 = sync.buildPlan({ settingsPath: file, sources });
    const fields1 = hex64Fields(plan1);
    assert.ok(fields1.length >= 2, 'plan carries settings and source-snapshot digests');
    assert.ok(fields1.some((k) => plan1[k] === sha256Hex(originalBytes)), 'some digest equals SHA-256 of the exact file bytes');

    const fileCrlf = path.join(scratchDir(t), 'settings.yaml');
    fs.writeFileSync(fileCrlf, originalBytes.toString('utf8').replace(/\n/g, '\r\n'), 'utf8');
    const plan2 = sync.buildPlan({ settingsPath: fileCrlf, sources });

    const fileWs = path.join(scratchDir(t), 'settings.yaml');
    fs.writeFileSync(fileWs, originalBytes.toString('utf8') + '\n', 'utf8');
    const plan3 = sync.buildPlan({ settingsPath: fileWs, sources });

    for (const [other, label] of [[plan2, 'CRLF'], [plan3, 'whitespace']]) {
      const differing = fields1.filter((k) => plan1[k] !== other[k]);
      assert.ok(differing.length >= 1, 'byte-variant settings change at least one digest (' + label + ')');
    }
  });

test('J2: parse-equivalent but byte-different settings are digest-distinguishable',
  { skip: !hasBuildPlan },
  (t) => {
    const file = scratchSettingsFile(t);
    const plan1 = sync.buildPlan({ settingsPath: file, sources: validSources() });
    const bytes = fs.readFileSync(file).toString('utf8');
    fs.writeFileSync(file, bytes.replace('providers:', 'providers:   '), 'utf8');
    const plan2 = sync.buildPlan({ settingsPath: file, sources: validSources() });
    const differ = hex64Fields(plan1).some((k) => plan1[k] !== plan2[k]);
    assert.equal(differ, true, 'byte-level variation must change the digest');
  });

test('J3: source snapshot digest is independent of object key insertion order',
  { skip: !hasBuildPlan },
  (t) => {
    const file = scratchSettingsFile(t);
    const ordered = validSources();
    const reordered = validSources();
    reordered.catalog.go.models = Object.fromEntries(Object.entries(reordered.catalog.go.models).reverse());
    reordered.catalog.zen.models = Object.fromEntries(Object.entries(reordered.catalog.zen.models).reverse());
    reordered.docs.go = Object.fromEntries(Object.entries(reordered.docs.go).reverse());
    reordered.docs.zen = Object.fromEntries(Object.entries(reordered.docs.zen).reverse());
    const plan1 = sync.buildPlan({ settingsPath: file, sources: ordered });
    const plan2 = sync.buildPlan({ settingsPath: file, sources: reordered });
    assert.deepEqual(hex64Fields(plan1), hex64Fields(plan2), 'digest field sets match');
    assert.deepEqual(digestValues(plan1), digestValues(plan2), 'all digests equal across key insertion orders');
  });

test('J4: source snapshot digest is sensitive to array order and value changes',
  { skip: !hasBuildPlan },
  (t) => {
    const file = scratchSettingsFile(t);
    const ordered = validSources();
    ordered.rosters = { go: ['model-a', 'model-b'], zen: ['model-z'] };
    ordered.catalog.go.models['model-b'] = catRecord({ id: 'model-b', name: 'B', provider: { npm: '@ai-sdk/openai-compatible' } });
    ordered.docs.go['model-b'] = 'https://opencode.ai/zen/go/v1/chat/completions';
    const reversed = validSources();
    reversed.rosters = { go: ['model-b', 'model-a'], zen: ['model-z'] };
    reversed.catalog.go.models['model-b'] = catRecord({ id: 'model-b', name: 'B', provider: { npm: '@ai-sdk/openai-compatible' } });
    reversed.docs.go['model-b'] = 'https://opencode.ai/zen/go/v1/chat/completions';
    const renamed = validSources();
    renamed.catalog.go.models['model-a'] = catRecord({ name: 'Renamed Model A', provider: { npm: '@ai-sdk/openai-compatible' } });
    const planOrdered = sync.buildPlan({ settingsPath: file, sources: ordered });
    const planReversed = sync.buildPlan({ settingsPath: file, sources: reversed });
    const planRenamed = sync.buildPlan({ settingsPath: file, sources: renamed });
    assert.notDeepEqual(digestValues(planOrdered), digestValues(planReversed), 'array order remains significant');
    assert.notDeepEqual(digestValues(planOrdered), digestValues(planRenamed), 'source value changes change the digest');
  });
