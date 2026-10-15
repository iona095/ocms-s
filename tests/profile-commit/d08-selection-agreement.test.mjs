// D08/C22: reader, renderer, and commit must agree on duplicate and insert
// row selection, validated through the installed DSH composition libraries.
// Same-file duplicates refuse identically at S1 bind and in the renderer;
// an id-less insert directive processes identically in read and plan.
// (Parity against a booted native runtime's last-wins application is
// F5-gated and stays an owner option; composition-library behavior is fully
// exercised here.)
//
// NOTE (adjacent, not this ticket): F2 into an EMPTY providers map refuses
// UNPRESERVABLE_STRUCTURE for lack of a sibling indentation reference. Left
// for a follow-up ticket; D08 fixtures below keep a populated sibling route.
import { describe, it, beforeEach, afterEach } from 'node:test';
import { readManagedConfig } from '../../profile/config-reader.mjs';
import { buildProfileAwarePlan } from '../../profile/plan-builder.mjs';
import { renderDesiredState } from '../../profile/surgical-render.mjs';
import {
  assert,
  makeTempHome,
  sandboxDshHome,
  makeProfile,
  makeFixtureBundle,
  bindReal,
  readerOpts,
  minimalSources,
  llmRow,
} from './helpers.mjs';

let home;
let cleanupHome;
let restoreDshHome;

function bind(name) {
  return bindReal(home, name);
}

function populated() {
  return { providers: { opencode: { displayName: 'opencode', models: [{ id: 'm0' }] } } };
}

describe('D08 — duplicate and insert selection agreement', () => {
  beforeEach(() => {
    restoreDshHome = sandboxDshHome();
    ({ home, cleanup: cleanupHome } = makeTempHome());
  });
  afterEach(() => {
    cleanupHome();
    restoreDshHome();
  });

  it('same-file duplicates refuse identically at bind and in render', async () => {
    const profileDir = makeProfile(home, 'd08dup', {
      entries: [llmRow({ config: populated() }), llmRow({ config: populated() })],
      bundles: ['@fixture/base'],
    });
    makeFixtureBundle(profileDir);
    let bindCode = null;
    try {
      bind('d08dup');
    } catch (err) {
      bindCode = String((err && err.message) || err);
    }
    assert.ok(bindCode !== null && bindCode.includes('PLUGIN_ENTRY_DUPLICATE'), 'S1 refuses duplicates, got: ' + bindCode);
    const { stringify: stringifyYaml } = await import('yaml');
    const raw = stringifyYaml([
      { id: 'llm-pi-ai', name: 'x', config: populated() },
      { id: 'llm-pi-ai', name: 'x', config: populated() },
    ]);
    const res = renderDesiredState({
      patchBytes: Buffer.from(raw, 'utf8'),
      storedConfig: { providers: {} },
      desired: { 'opencode-go': [], 'opencode-go-messages': [], 'opencode-go-responses': [], 'opencode-completions': [], 'opencode-messages': [], opencode: [] },
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'PLUGIN_ENTRY_DUPLICATE');
  });

  it('an id-less insert directive reads and plans identically', async () => {
    const profileDir = makeProfile(home, 'd08ins', {
      entries: [llmRow({ config: populated() }), { insert: [{ id: 'helper', name: 'Elsewhere' }] }],
      bundles: ['@fixture/base'],
    });
    makeFixtureBundle(profileDir);
    const target = bind('d08ins');
    const readerResult = await readManagedConfig(readerOpts(target));
    assert.equal(readerResult.ok, true, 'read proceeds: ' + JSON.stringify(readerResult.code || readerResult.status));
    const plan = buildProfileAwarePlan({ target: structuredClone(target), readerResult, sources: minimalSources() });
    assert.equal(plan.ok, true, 'plan proceeds: ' + JSON.stringify(plan.code || plan.status));
  });
});
