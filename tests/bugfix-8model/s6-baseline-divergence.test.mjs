// S6 baseline-divergence [GLM L14]. The resolver's dsh baseline must select the
// same candidate as config-reader and commit: the first readable, correctly named,
// pinned dsh among [scope/dsh, scope/../..] per scope, skipping mismatches. A skewed
// top-level dsh must not shadow a valid pinned nested scope. Synthetic npm layouts
// under os.tmpdir(); the PATH is passed explicitly; no real DSH is read.
import { describe, it, afterEach } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assert } from '../profile-cli-ui/helpers.mjs';
import { admitDependencyPackages } from '../../profile/target-resolver.mjs';

const V = { dsh: '0.2.1-alpha.2', boot: '0.2.1-alpha.2', atomic: '0.2.1-alpha.2', include: '1.0.10-alpha.1' };
const roots = [];
function writeJson(p, obj) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj), 'utf8'); }
function pkg(dir, name, version) { writeJson(path.join(dir, 'package.json'), { name: '@deepseek-ai/' + name, version }); }
// npm layout: <npm>/dsh.cmd, <npm>/node_modules/@deepseek-ai/{dsh (top, skewed?)}, nested under it.
function layout({ topDshVersion, nestedDsh }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-s6-'));
  roots.push(root);
  const npm = path.join(root, 'npm');
  fs.mkdirSync(npm, { recursive: true });
  fs.writeFileSync(path.join(npm, 'dsh.cmd'), '@echo off\n', 'utf8');
  const top = path.join(npm, 'node_modules', '@deepseek-ai');
  if (topDshVersion !== null) pkg(path.join(top, 'dsh'), 'dsh', topDshVersion);
  const nested = path.join(top, 'dsh', 'node_modules', '@deepseek-ai');
  pkg(path.join(nested, 'dsh-app-boot'), 'dsh-app-boot', V.boot);
  pkg(path.join(nested, 'dsh-atomic-write'), 'dsh-atomic-write', V.atomic);
  pkg(path.join(nested, 'cordis-plugin-include'), 'cordis-plugin-include', V.include);
  if (nestedDsh) pkg(path.join(nested, 'dsh'), 'dsh', V.dsh);
  return { npm, nestedDshDir: path.join(nested, 'dsh') };
}
describe('S6 dsh baseline selection mirrors config-reader and commit', () => {
  afterEach(() => { for (const r of roots.splice(0)) { try { fs.rmSync(r, { recursive: true, force: true }); } catch {} } });

  it('a skewed top-level dsh does not shadow a valid pinned nested scope', () => {
    const { npm, nestedDshDir } = layout({ topDshVersion: '9.9.9', nestedDsh: true });
    const res = admitDependencyPackages({ profileDirReal: null, installAnchorDir: null, pathEnv: npm });
    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 300));
    assert.equal(res.evidence.dshVersion, V.dsh);
    assert.equal(fs.realpathSync(res.evidence.dsh.path), fs.realpathSync(nestedDshDir), 'the selected dsh is the valid nested one');
  });

  it('NEGATIVE CONTROL: a skewed dsh with no valid pinned alternative still refuses INCOMPATIBLE_DSH', () => {
    const { npm } = layout({ topDshVersion: '9.9.9', nestedDsh: false });
    const res = admitDependencyPackages({ profileDirReal: null, installAnchorDir: null, pathEnv: npm });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'INCOMPATIBLE_DSH');
    assert.ok(String(res.detail).includes('version-skew') || String(res.detail).includes('9.9.9'), 'the skew is named: ' + String(res.detail));
  });
});
