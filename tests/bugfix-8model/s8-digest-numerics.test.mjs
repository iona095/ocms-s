// S8 digest-numerics [report C23; Space Bunny #9, GLM L18]. config-reader
// canonicalJson maps .nan/.inf/-.inf AND null to the same 'null' text, so two
// genuinely different admitted configs digest identically (staleness and
// NO_CHANGE checks go blind). sync.mjs:161 and plan-builder.mjs:29 share the
// collision; the reader additionally lacks their bigint arm. Scratch-only:
// synthetic profiles under os.tmpdir(), sandboxed DSH_HOME, stub scope.
import { describe, it, beforeEach, afterEach } from 'node:test';
import { assert, makeTempHome, sandboxDshHome, makeProfile, makeFixtureBundle, llmRow, bindReal, readerOpts } from '../profile-commit/helpers.mjs';
import { readManagedConfig } from '../../profile/config-reader.mjs';

async function digestFor(home, tag, temperature) {
  const row = llmRow({ config: { providers: { other: { displayName: 'other', models: [], temperature } } } });
  const dir = makeProfile(home, 's8' + tag, { entries: [row], bundles: ['@fixture/base'] });
  makeFixtureBundle(dir);
  const target = bindReal(home, 's8' + tag);
  const r = await readManagedConfig(readerOpts(target));
  assert.equal(r.ok, true, tag + ' must be admitted: ' + JSON.stringify(r).slice(0, 300));
  return r.effectiveDigest;
}

describe('S8 digest-numerics: distinct configs digest distinctly', () => {
  let home; let restore; let cleanupHome;
  beforeEach(() => { restore = sandboxDshHome(); const h = makeTempHome('ocms-s8-'); home = h.home; cleanupHome = h.cleanup; });
  afterEach(() => { try { cleanupHome(); } catch {} try { restore(); } catch {} });

  it('null, NaN and +/-Infinity in an admitted scalar digest distinctly', async () => {
    const dNull = await digestFor(home, 'null', null);
    const dNaN = await digestFor(home, 'nan', NaN);
    const dInf = await digestFor(home, 'inf', Infinity);
    const dNegInf = await digestFor(home, 'ninf', -Infinity);
    assert.notEqual(dNaN, dNull, 'NaN must not digest as null');
    assert.notEqual(dInf, dNull, 'Infinity must not digest as null');
    assert.notEqual(dNegInf, dNull, '-Infinity must not digest as null');
    assert.notEqual(dInf, dNegInf, 'opposite infinities digest distinctly');
  });
});
