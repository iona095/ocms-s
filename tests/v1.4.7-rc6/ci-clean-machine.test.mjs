// CI1: the CI clean-machine gate must not require HOME on a Windows runner,
// and must keep every other hermeticity assertion.
//
// The gate that shipped in pass 2 (A3) required USERPROFILE, HOME, APPDATA and
// LOCALAPPDATA on every platform; windows-latest sets no HOME, so both test jobs
// failed at that step with "required temp-profile variable(s) not set: HOME"
// and never ran the suite (Actions run 38732017995).
//
// The logic now lives in scripts/ci-check-clean-machine.mjs and is driven here
// entirely by fakes: positive control, negative controls for each retained
// assertion, and the exact Windows-shaped regression.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkCleanMachine, requiredProfileVars } from '../../scripts/ci-check-clean-machine.mjs';

const WIN_ENV = {
  USERPROFILE: 'C:\\Users\\runneradmin',
  APPDATA: 'C:\\Users\\runneradmin\\AppData\\Roaming',
  LOCALAPPDATA: 'C:\\Users\\runneradmin\\AppData\\Local',
  PATH: 'C:\\hostedtoolcache\\node',
};
const POSIX_ENV = {
  HOME: '/home/runner',
  PATH: '/opt/hostedtoolcache/node',
};
const neverExists = () => false;
const noCommand = () => null;

describe('CI1 — CI clean-machine condition', () => {
  it('POSITIVE CONTROL: a Windows runner with no HOME passes', () => {
    const res = checkCleanMachine({ env: WIN_ENV, platform: 'win32', exists: neverExists, hasCommand: noCommand });
    assert.equal(res.ok, true, 'a Windows-shaped env without HOME must pass: ' + res.failures.join('; '));
  });

  it('POSITIVE CONTROL: a POSIX runner with HOME passes', () => {
    const res = checkCleanMachine({ env: POSIX_ENV, platform: 'linux', exists: neverExists, hasCommand: noCommand });
    assert.equal(res.ok, true, res.failures.join('; '));
  });

  it('REGRESSION: HOME is not required on win32 but still is elsewhere', () => {
    assert.deepEqual(requiredProfileVars('win32'), ['USERPROFILE', 'APPDATA', 'LOCALAPPDATA']);
    assert.deepEqual(requiredProfileVars('linux'), ['HOME']);
    assert.equal(requiredProfileVars('darwin').includes('HOME'), true);

    const winWithoutHome = { ...WIN_ENV };
    assert.equal('HOME' in winWithoutHome, false, 'the fixture models the real runner: no HOME');
    const ok = checkCleanMachine({ env: winWithoutHome, platform: 'win32', exists: neverExists, hasCommand: noCommand });
    assert.equal(ok.ok, true, 'the exact Actions failure shape must now pass');

    const posixWithoutHome = { ...POSIX_ENV };
    delete posixWithoutHome.HOME;
    const bad = checkCleanMachine({ env: posixWithoutHome, platform: 'linux', exists: neverExists, hasCommand: noCommand });
    assert.equal(bad.ok, false, 'HOME is still required off Windows');
    assert.match(bad.failures.join(' '), /HOME/);
  });

  it('NEGATIVE CONTROL: a missing USERPROFILE or APPDATA still fails on win32', () => {
    for (const name of ['USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
      const env = { ...WIN_ENV };
      delete env[name];
      const res = checkCleanMachine({ env, platform: 'win32', exists: neverExists, hasCommand: noCommand });
      assert.equal(res.ok, false, name + ' must still be required on win32');
      assert.match(res.failures.join(' '), new RegExp(name));
    }
  });

  it('NEGATIVE CONTROL: a real .dsh under the profile anchor still fails', () => {
    const res = checkCleanMachine({
      env: WIN_ENV,
      platform: 'win32',
      exists: (p) => String(p).toLowerCase().endsWith('\\.dsh'),
      hasCommand: noCommand,
    });
    assert.equal(res.ok, false, 'a real .dsh must fail the gate');
    assert.match(res.failures.join(' '), /real \.dsh/);
  });

  it('NEGATIVE CONTROL: a dsh on PATH still fails', () => {
    const res = checkCleanMachine({
      env: WIN_ENV,
      platform: 'win32',
      exists: neverExists,
      hasCommand: () => 'C:\\npm-global\\dsh.cmd',
    });
    assert.equal(res.ok, false, 'dsh on PATH must fail the gate');
    assert.match(res.failures.join(' '), /dsh on PATH/);
  });

  it('NEGATIVE CONTROL: DSH_HOME set still fails', () => {
    const res = checkCleanMachine({
      env: { ...WIN_ENV, DSH_HOME: 'C:\\Users\\runneradmin\\.dsh' },
      platform: 'win32',
      exists: neverExists,
      hasCommand: noCommand,
    });
    assert.equal(res.ok, false, 'DSH_HOME must fail the gate');
    assert.match(res.failures.join(' '), /DSH_HOME/);
  });

  it('NEGATIVE CONTROL: an empty or whitespace-only variable counts as missing', () => {
    const res = checkCleanMachine({
      env: { ...WIN_ENV, APPDATA: '   ' },
      platform: 'win32',
      exists: neverExists,
      hasCommand: noCommand,
    });
    assert.equal(res.ok, false, 'a whitespace-only APPDATA must fail');
  });

  it('every failure is reported at once, each named', () => {
    const env = { ...WIN_ENV, DSH_HOME: 'C:\\x' };
    delete env.LOCALAPPDATA;
    const res = checkCleanMachine({
      env,
      platform: 'win32',
      exists: (p) => String(p).toLowerCase().endsWith('\\.dsh'),
      hasCommand: () => 'C:\\npm\\dsh.cmd',
    });
    assert.equal(res.ok, false);
    assert.equal(res.failures.length, 4, 'four independent problems are named: ' + res.failures.join(' | '));
  });
});
