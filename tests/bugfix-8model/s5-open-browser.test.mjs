// S5 open-browser-error [GLM L10]. defaultOpenBrowser spawns the platform opener with
// no 'error' listener; a missing opener is an async ENOENT that must not crash the server.
// Reproduced in a child Node process with an empty PATH so the opener cannot be found.
// Scratch only: every home and the settings file live under os.tmpdir(); bounded timeouts.
import { it } from 'node:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { assert } from '../profile-cli-ui/helpers.mjs';

const UI = fileURLToPath(new URL('../../ui.mjs', import.meta.url));
const CHILD = `
import { startServer } from ${JSON.stringify(pathToFileURL(UI).href)};
const srv = await startServer({ settingsPath: process.env.S5_SETTINGS, port: 0, fetchFn: async () => { throw new Error('no network in S5'); }, openBrowser: true });
console.log('READY');
await new Promise((r) => setTimeout(r, 1500));
console.log('ALIVE');
try { srv && srv.close && srv.close(); } catch {}
process.exit(0);
`;

it('a missing browser opener does not crash the server process (async ENOENT is handled)', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-s5-'));
  t.after(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch {} });
  const settings = path.join(home, 'settings.yaml');
  fs.writeFileSync(settings, 'llm:\n  unrelated: true\n', 'utf8');
  const env = { PATH: '', SystemRoot: process.env.SystemRoot || '', HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, TMPDIR: home, TEMP: home, TMP: home, S5_SETTINGS: settings, DSH_HOME: path.join(home, '.dsh') };
  const child = spawn(process.execPath, ['--input-type=module', '-e', CHILD], { env, cwd: home, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => { try { child.kill(); } catch {} resolve({ code: 'TIMEOUT' }); }, 20000);
    child.on('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
  assert.notEqual(result.code, 'TIMEOUT', 'child did not exit within 20s: ' + out + err);
  assert.ok(out.includes('ALIVE'), 'server must survive the failed opener. exit=' + JSON.stringify(result) + ' stderr=' + err.slice(0, 400));
  assert.equal(result.code, 0, 'child must exit cleanly. stderr=' + err.slice(0, 400));
});
