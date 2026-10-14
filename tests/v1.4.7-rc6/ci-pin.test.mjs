// OCMS-S v1.4.7-rc6 §7.3 CI-pin test (contract v1.4.7-rc6 §7.3, item 3).
//
// Pins the reproducible-CI shape of .github/workflows/ci.yml:
//   - the pinned DSH install carries --before=2026-10-14T11:40:00Z;
//   - a print-and-assert step reads package.json from the two Windows resolver
//     scopes admitDependencyPackages consults and asserts the eleven verified
//     alpha.1-package versions, failing loudly on drift;
//   - the same job carries a second, unpinned matrix entry (the alpha.2 tree new
//     users get today) asserting the eleven alpha.2 versions;
//   - every job keeps a bounded timeout-minutes.
//
// Read-only: this test never edits the workflow, never installs anything and
// never runs a step.
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CI_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml');

// Reproducibility pin (contract §2).
const BEFORE_FLAG = '--before=2026-10-14T11:40:00Z';
const DSH_SPEC = '@deepseek-ai/dsh@0.2.1-alpha.2';

// The two resolver scopes admitDependencyPackages reads on Windows
// (profile/target-resolver.mjs), plus the nested scope that holds
// node-addon-require-builtin.
const TOP_SCOPE = 'node_modules/@deepseek-ai';
const NESTED_SCOPE = 'node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai';
const NODE_ADDON_SCOPE = 'node_modules/@deepseek-ai/dsh/node_modules';

// The full verified set under the --before pin, and the alpha.2 set the
// unpinned fresh install resolves (contract §2 and §3).
const PINNED_SET = {
  dsh: '0.2.1-alpha.2',
  'dsh-app-boot': '0.2.1-alpha.2',
  'dsh-atomic-write': '0.2.1-alpha.2',
  cordis: '4.0.5-alpha.1',
  'cordis-plugin-group': '1.0.5-alpha.1',
  'cordis-plugin-include': '1.0.10-alpha.1',
  'cordis-plugin-loader': '1.0.6-alpha.1',
  'cordis-plugin-timer': '1.1.7-alpha.1',
  cosmokit: '1.8.6-alpha.1',
  schemastery: '3.18.5-alpha.1',
  'node-addon-require-builtin': '0.1.9',
};
const ALPHA_2_SET = {
  dsh: '0.2.1-alpha.2',
  'dsh-app-boot': '0.2.1-alpha.2',
  'dsh-atomic-write': '0.2.1-alpha.2',
  cordis: '4.0.5-alpha.2',
  'cordis-plugin-group': '1.0.5-alpha.2',
  'cordis-plugin-include': '1.0.10-alpha.2',
  'cordis-plugin-loader': '1.0.6-alpha.2',
  'cordis-plugin-timer': '1.1.7-alpha.2',
  cosmokit: '1.8.6-alpha.2',
  schemastery: '3.18.5-alpha.2',
  'node-addon-require-builtin': '0.1.9',
};

const escapeRe = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Token boundaries: bare 'dsh' must not match inside 'dsh-app-boot', while
// '@deepseek-ai/cordis' still counts as the bare token 'cordis'.
const tokenPattern = (name) => '(?<![A-Za-z0-9_-])' + escapeRe(name) + '(?![A-Za-z0-9_-])';

// A package/version pair counts as asserted when both appear on ONE line: a
// print step that lists a name and its expected version, then throws.
const pairAsserted = (text, pkg, version) => String(text)
  .split(/\r?\n/)
  .some((line) => new RegExp(tokenPattern(pkg)).test(line) && line.includes(version));

const missingPairs = (text, set) => Object.entries(set)
  .filter(([pkg, version]) => !pairAsserted(text, pkg, version))
  .map(([pkg, version]) => pkg + ' ' + version);

const readWorkflow = () => parse(fs.readFileSync(CI_PATH, 'utf8'));

const workflowJobs = (doc) => {
  const jobs = doc && doc.jobs;
  assert.ok(jobs && typeof jobs === 'object', CI_PATH + ' declares no jobs');
  return jobs;
};

const stepsOf = (job) => (Array.isArray(job && job.steps) ? job.steps : []);

const allJobs = (doc) => Object.entries(workflowJobs(doc));

// Step run scripts, joined whole: an install command may span lines with a
// shell continuation, so a per-line scan would miss it.
const runSteps = (doc) => allJobs(doc).flatMap(([jobId, job]) => stepsOf(job).map((step) => ({
  jobId,
  run: typeof step.run === 'string' ? step.run : '',
})));

const installSteps = (doc) => runSteps(doc).filter(({ run }) => run.includes('npm install'));

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// --- matrix model -------------------------------------------------------
//
// The DSH job's matrix is expanded into concrete entries the way GitHub does
// (cartesian product of the axes, then include merged into the entries it does
// not conflict with), so every later check can ask "does this step run for
// THIS entry?" instead of pattern-matching JSON.stringify(job) — which folds
// every run script into one escaped line and makes line-local pairing claims
// meaningless.
const expandMatrix = (matrix) => {
  if (!isPlainObject(matrix)) return [];
  const axisKeys = Object.keys(matrix).filter((key) => key !== 'include' && key !== 'exclude' && Array.isArray(matrix[key]));
  const excludes = Array.isArray(matrix.exclude) ? matrix.exclude.filter(isPlainObject) : [];
  let base = axisKeys.length === 0
    ? [{}]
    : axisKeys.reduce(
      (acc, key) => acc.flatMap((entry) => matrix[key].map((value) => ({ ...entry, [key]: value }))),
      [{}],
    );
  base = base.filter((entry) => !excludes.some((ex) => Object.entries(ex).every(([key, value]) => entry[key] === value)));
  const entries = base.map((entry) => ({ ...entry }));
  for (const inc of (Array.isArray(matrix.include) ? matrix.include : []).filter(isPlainObject)) {
    const mergeable = entries.filter((entry) => Object.entries(inc).every(([key, value]) => !(key in entry) || entry[key] === value));
    if (mergeable.length > 0) for (const entry of mergeable) Object.assign(entry, inc);
    else entries.push({ ...inc });
  }
  return entries;
};

const renderValue = (value) => {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
};

// The keys that actually tell the two entries apart.
const discriminatingKeys = (a, b) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((key) => renderValue(a[key]) !== renderValue(b[key]));
};

// ${{ matrix.tree }} and ${{ toJSON(matrix.expected) }} are both matrix-driven.
const MATRIX_PLACEHOLDER = /\$\{\{\s*(?:toJSON\(\s*)?matrix(?:\.([A-Za-z0-9_-]+)|\[['"]([^'"]+)['"]\])\s*\)?\s*\}\}/g;

const matrixPlaceholderKeys = (run) => [...String(run).matchAll(MATRIX_PLACEHOLDER)]
  .map((match) => match[1] ?? match[2]);

// The run script as GitHub renders it for one entry. A placeholder whose key
// the entry does not carry stays literal, so an unrendered value can never
// satisfy a pairing check by accident.
const renderRun = (run, entry) => String(run).replace(MATRIX_PLACEHOLDER, (whole, dotted, bracketed) => {
  const key = dotted ?? bracketed;
  return Object.prototype.hasOwnProperty.call(entry, key) ? renderValue(entry[key]) : whole;
});

// Step gating, evaluated per entry. Only a conjunction of
// `matrix.<key> == '<value>'` / `!=` clauses is decidable; anything else that
// mentions the matrix returns 'unknown' and the test fails loudly rather than
// guessing which entry a step belongs to. A gate with no matrix reference
// always runs.
const MATRIX_REF = /matrix(?:\.([A-Za-z0-9_-]+)|\[['"]([^'"]+)['"]\])/;
const GATE_CLAUSE = /^matrix(?:\.([A-Za-z0-9_-]+)|\[['"]([^'"]+)['"]\])\s*(===|==|!==|!=)\s*(['"])([^'"]*)\4$/;

const gateAllows = (condition, entry) => {
  if (condition === undefined || condition === null) return true;
  const text = String(condition).replace(/\$\{\{|\}\}/g, ' ').trim();
  if (!MATRIX_REF.test(text)) return true;
  for (const raw of text.split('&&')) {
    const clause = GATE_CLAUSE.exec(raw.trim());
    if (!clause) return 'unknown';
    const key = clause[1] ?? clause[2];
    if (!Object.prototype.hasOwnProperty.call(entry, key)) return 'unknown';
    const equal = renderValue(entry[key]) === clause[5];
    if (clause[3].startsWith('!') ? equal : !equal) return false;
  }
  return true;
};

const stepsFor = (job, entry) => stepsOf(job).filter((step) => gateAllows(step.if, entry) === true);

const stepLabel = (step) => String(step.name ?? '(unnamed step)') + ' (if: ' + JSON.stringify(step.if ?? null) + ')';

// Steps that belong to `entry` alone: either the step does not run for `other`,
// or its run text renders differently for the two entries (a matrix-provided
// flag). A step both entries run with the SAME text belongs to neither — a
// single step printing every version of every tree could never compare.
const entrySpecificSteps = (job, entry, other, predicate) => {
  const mine = stepsFor(job, entry).filter((step) => typeof step.run === 'string' && predicate(renderRun(step.run, entry)));
  return mine.filter((step) => !stepsFor(job, other).includes(step) || renderRun(step.run, other) !== renderRun(step.run, entry));
};

// A matrix key whose value is a mapping holding all eleven packages: allowed
// to carry the expected versions, but only if the assert step reads it back.
const matrixVersionKey = (entry, versionSet) => Object.keys(entry).find((key) => {
  const value = entry[key];
  return isPlainObject(value) && Object.keys(versionSet).every((pkg) => Object.prototype.hasOwnProperty.call(value, pkg));
});

const COMPARISON = /!==|!=|===|==| -ne | -eq /;

describe('v1.4.7-rc6 §7.3 CI pin', () => {
  it('RC6-CI-TIMEOUT every job declares a bounded timeout-minutes', () => {
    const jobs = workflowJobs(readWorkflow());
    const withoutTimeout = Object.entries(jobs)
      .filter(([, job]) => {
        const value = job && job['timeout-minutes'];
        return typeof value !== 'number' || !Number.isFinite(value) || value <= 0;
      })
      .map(([id]) => id);
    assert.deepEqual(withoutTimeout, [], 'these jobs declare no positive timeout-minutes');
  });

  it('RC6-CI-BEFORE the pinned DSH install carries --before=2026-10-14T11:40:00Z', () => {
    const pinned = installSteps(readWorkflow())
      .filter(({ run }) => run.includes(BEFORE_FLAG) && run.includes(DSH_SPEC));
    assert.ok(
      pinned.length > 0,
      'no "npm install -g --prefix <prefix> ' + BEFORE_FLAG + ' ' + DSH_SPEC + '" step exists; an '
      + 'unpinned install drifts onto the alpha.2 tree and the skew check refuses every new user',
    );
    for (const { jobId, run } of pinned) {
      assert.match(run, /npm\s+install\s+-g\b/, 'job ' + jobId + ': the pin must stay a global install');
      assert.match(run, /--prefix\b/, 'job ' + jobId + ': the pin must stay a global --prefix install (that is where the shim lands)');
    }
  });

  it('RC6-CI-PRINT-AND-ASSERT the pinned vehicle asserts the eleven alpha.1 versions from both resolver scopes', () => {
    const doc = readWorkflow();
    const step = runSteps(doc).find(({ run }) => run.includes(TOP_SCOPE)
      && run.includes(NESTED_SCOPE)
      && missingPairs(run, PINNED_SET).length === 0);
    assert.ok(
      step,
      'no step reads package.json from both Windows resolver scopes (' + TOP_SCOPE + ' and ' + NESTED_SCOPE
      + ') and asserts these eleven versions on one line each: ' + missingPairs(runSteps(doc).map((s) => s.run).join('\n'), PINNED_SET).join(', '),
    );
    assert.ok(
      step.run.includes(NODE_ADDON_SCOPE),
      'the step must read node-addon-require-builtin from ' + NODE_ADDON_SCOPE,
    );
    assert.match(step.run, /throw/, 'the print-and-assert step must fail loudly on drift');
    assert.deepEqual(missingPairs(step.run, PINNED_SET), [], 'these pinned versions are never asserted together on one line');
  });

  it('RC6-CI-MATRIX-ALPHA2 two entry-specific matrix entries, each asserting its own eleven versions', () => {
    const doc = readWorkflow();
    const dshJob = allJobs(doc).find(([, job]) => stepsOf(job)
      .some((step) => typeof step.run === 'string' && step.run.includes(DSH_SPEC)));
    assert.ok(dshJob, 'no job installs ' + DSH_SPEC);
    const [jobId, job] = dshJob;

    // 1. Exactly two entries, told apart by an explicit key.
    const entries = expandMatrix(job.strategy && job.strategy.matrix);
    assert.equal(
      entries.length,
      2,
      'job ' + jobId + ' must have EXACTLY two matrix entries (the --before verified tree and the '
      + 'unpinned alpha.2 tree new users get today); found ' + entries.length + ' from '
      + JSON.stringify(job.strategy && job.strategy.matrix),
    );
    const discriminators = discriminatingKeys(entries[0], entries[1]);
    assert.ok(
      discriminators.length > 0,
      'the two entries of job ' + jobId + ' are identical; they must be distinguished by an explicit key '
      + '(for example tree: verified / tree: alpha2), not by a bare include list: '
      + JSON.stringify(entries),
    );
    const [first, second] = entries;
    assert.ok(
      discriminators.every((key) => Object.prototype.hasOwnProperty.call(first, key) && Object.prototype.hasOwnProperty.call(second, key)),
      'the discriminating key(s) ' + JSON.stringify(discriminators) + ' must be readable on BOTH entries of job ' + jobId,
    );

    // 2. Every matrix-aware gate must be decidable; an opaque condition is a
    //    refusal, never an assumed "runs everywhere".
    const opaque = stepsOf(job).filter((step) => gateAllows(step.if, first) === 'unknown' || gateAllows(step.if, second) === 'unknown');
    assert.deepEqual(
      opaque.map((step) => stepLabel(step)),
      [],
      'these steps of job ' + jobId + ' gate on the matrix in a form that cannot be decided per entry; gate them with a '
      + 'conjunction of matrix.<key> == \'<value>\' / != clauses, or carry the expected versions in the matrix itself',
    );

    // 3. One install per entry, and the two installs are different steps: the
    //    --before install runs only for the verified entry, the unpinned install
    //    only for the alpha2 entry.
    const installs = (entry, other) => entrySpecificSteps(job, entry, other, (run) => run.includes('npm install') && run.includes(DSH_SPEC));
    const pinned = (entry, other) => installs(entry, other).filter((step) => renderRun(step.run, entry).includes(BEFORE_FLAG));
    const unpinned = (entry, other) => installs(entry, other).filter((step) => !renderRun(step.run, entry).includes(BEFORE_FLAG));

    const firstIsPinned = pinned(first, second).length === 1 && unpinned(second, first).length === 1;
    const secondIsPinned = pinned(second, first).length === 1 && unpinned(first, second).length === 1;
    assert.ok(
      firstIsPinned !== secondIsPinned,
      'job ' + jobId + ' must run exactly one ' + DSH_SPEC + ' install per matrix entry: the ' + BEFORE_FLAG
      + ' install for the verified entry only, the unpinned install for the alpha2 entry only. Found per entry: '
      + JSON.stringify({
        entryA: { pinned: pinned(first, second).length, unpinned: unpinned(first, second).length },
        entryB: { pinned: pinned(second, first).length, unpinned: unpinned(second, first).length },
      }, null, 1) + ' — a step that runs in BOTH entries belongs to neither.',
    );
    const [verified, alpha2] = firstIsPinned ? [first, second] : [second, first];

    assert.equal(
      stepsFor(job, verified).filter((step) => typeof step.run === 'string' && step.run.includes('npm install') && step.run.includes(DSH_SPEC)).length,
      1,
      'the verified entry must run exactly one DSH install step (the pinned one)',
    );
    assert.equal(
      stepsFor(job, alpha2).filter((step) => typeof step.run === 'string' && step.run.includes('npm install') && step.run.includes(DSH_SPEC)).length,
      1,
      'the alpha2 entry must run exactly one DSH install step (the unpinned one)',
    );
    assert.equal(unpinned(verified, alpha2).length, 0, 'the verified entry must not also run an unpinned DSH install');
    assert.equal(pinned(alpha2, verified).length, 0, 'the alpha2 entry must not also run the ' + BEFORE_FLAG + ' install');
    const ownInstalls = [['verified', verified, pinned(verified, alpha2)[0]], ['alpha2', alpha2, unpinned(alpha2, verified)[0]]];
    for (const [, entry, step] of ownInstalls) {
      assert.ok(renderRun(step.run, entry).includes('--prefix'), stepLabel(step) + ': the DSH install must stay a global --prefix install');
    }

    // 4. Per entry, a print-and-assert step that pairs its OWN eleven versions
    //    on one line each of the rendered run text and fails with throw.
    const context = stepsOf(job).map((step) => '  ' + stepLabel(step) + '\n    ' + String(step.run ?? '').replace(/\r?\n/g, '\n    ')).join('\n');
    const assertSteps = (entry, other, versionSet, label) => {
      const carriers = entrySpecificSteps(job, entry, other, (run) => run.includes('throw') && missingPairs(run, versionSet).length === 0);
      const complete = carriers.filter((step) => {
        const rendered = renderRun(step.run, entry);
        if (!rendered.includes(TOP_SCOPE) || !rendered.includes(NESTED_SCOPE) || !rendered.includes(NODE_ADDON_SCOPE)) return false;
        const versionKey = matrixVersionKey(entry, versionSet);
        // Versions carried by the matrix are only admissible when the step
        // reads them back and compares; inline versions need no read-back.
        if (versionKey !== undefined && !matrixPlaceholderKeys(step.run).includes(versionKey)) return false;
        if (versionKey !== undefined && !COMPARISON.test(rendered)) return false;
        return true;
      });
      assert.ok(
        complete.length > 0,
        'no print-and-assert step runs for the ' + label + ' entry of job ' + jobId + ' alone. It must read package.json from '
        + TOP_SCOPE + ' and ' + NESTED_SCOPE + ' (node-addon-require-builtin from ' + NODE_ADDON_SCOPE + '), pair these eleven '
        + 'versions on one line each of its own run text, and fail with throw: '
        + missingPairs(runSteps(doc).map((s) => s.run).join('\n'), versionSet).join(', ')
        + '\nsteps of the job:\n' + context,
      );
      return complete;
    };
    assertSteps(verified, alpha2, PINNED_SET, 'verified/--before (alpha.1 set)');
    assertSteps(alpha2, verified, ALPHA_2_SET, 'alpha2/unpinned (alpha.2 set)');
  });
});
