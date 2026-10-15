// S9 confirm-eof [DeepSeek F18]. defaultConfirmCli awaited rl.question with no
// close path: on Ctrl-D/EOF only 'close' fires and the answer callback never
// runs, so the confirm promise (and the whole sync) hangs forever instead of
// declining through the C02/C03 verdict path. Closed-pipe stdin with isTTY
// stubbed true is the hermetic Ctrl-D proxy (readline sees EOF + close).
// Scratch settings under os.tmpdir(); stubbed fetch; bounded 15 s race;
// stdin restored afterwards.
import { describe, it, beforeEach, afterEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { assert, makeTempHome, sandboxDshHome } from '../profile-cli-ui/helpers.mjs';
import { fetchFromBodies, validSourceBodies } from '../v1.3/helpers.mjs';
import { runSettingsSync } from '../../sync.mjs';

describe('S9 confirm-eof: EOF during confirm declines instead of hanging', () => {
  let home; let cleanupHome; let restore; let savedIsTTY; let hadIsTTY;
  beforeEach(() => { restore = sandboxDshHome(); const h = makeTempHome('ocms-s9-'); home = h.home; cleanupHome = h.cleanup; });
  afterEach(() => {
    try { cleanupHome(); } catch {}
    try { restore(); } catch {}
    try {
      if (hadIsTTY) Object.defineProperty(process.stdin, 'isTTY', { value: savedIsTTY, configurable: true });
      else delete process.stdin.isTTY;
    } catch {}
  });

  it('closed stdin settles to CONFIRMATION_DECLINED with zero writes (no hang)', { timeout: 30000 }, async () => {
    const dsh = path.join(home, '.dsh');
    fs.mkdirSync(dsh, { recursive: true });
    const scratch = path.join(home, 'scratch');
    fs.mkdirSync(scratch, { recursive: true });
    const file = path.join(scratch, 'settings.yaml');
    fs.writeFileSync(file, ['llm:', '  unrelated: true', 'llm-pi-ai:', '  providers: {}', ''].join(String.fromCharCode(10)), 'utf8');
    const before = fs.readFileSync(file);
    // Hermetic Ctrl-D: a TTY-shaped stdin already at EOF.
    hadIsTTY = Object.hasOwn(process.stdin, 'isTTY');
    savedIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    process.stdin.push(null);
    const res = await Promise.race([
      runSettingsSync({ settingsPath: file, dshHome: dsh, fetchFn: fetchFromBodies(validSourceBodies()) }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('S9-HUNG: confirm never settled on EOF')), 15000)),
    ]);
    assert.equal(res.ok, false, JSON.stringify(res).slice(0, 200));
    assert.equal(res.code, 'CONFIRMATION_DECLINED', 'EOF declines loudly: ' + JSON.stringify(res).slice(0, 200));
    assert.ok(fs.readFileSync(file).equals(before), 'zero writes on declined confirm');
  });
});
