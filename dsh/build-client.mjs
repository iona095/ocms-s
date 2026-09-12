// Produces dsh/client.js in the rc.2 client-bundle convention
// (window.__ModuleLoader__.load banner; shared react stays external through
// the factory require — no second React runtime, no bundler dependency).
// dsh/client.mjs is import-free by design, so the transform is a strict,
// line-anchored export strip followed by deterministic concatenation.
// Usage: node dsh/build-client.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const source = await readFile(path.join(dir, 'client.mjs'), 'utf8');

// Line-anchored export stripping: only top-level 'export const/function'
// declarations in this file. Any other 'export' form fails the build loudly.
const stripped = source.replace(/^export /gm, '');
if (/^\s*export\b/m.test(stripped)) {
  throw new Error('build-client: unexpected export form survived the transform');
}
if (stripped.includes('import ') && /^\s*import\b/m.test(stripped)) {
  throw new Error('build-client: dsh/client.mjs must stay import-free');
}

const banner =
  'window.__ModuleLoader__.load({ id: ' + JSON.stringify('ocms-s') + ', factory: (require) => {\n' +
  'var module = { exports: {} };\n' +
  'var exports = module.exports;\n' +
  'var React = require("react");\n';
const footer =
  'var ocmsClient = createOcmsClient({ createElement: React.createElement, useState: React.useState, useEffect: React.useEffect });\n' +
  'module.exports = { inject: ocmsClient.inject, apply: ocmsClient.apply };\n' +
  'return module.exports;\n' +
  '} });\n';

await writeFile(path.join(dir, 'client.js'), banner + stripped + footer, 'utf8');
console.log('dsh/client.js written');
