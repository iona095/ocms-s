// OCMS-S S3 — Surgical desired-state renderer (P0-R2 section 9, P1-A section 5 S3).
//
// Pure byte-surgical renderer: replaces ONLY owned models value spans (F1),
// adds a single models key (F1-add), or creates a minimal 5-key route (F2).
// Construction copies unowned bytes; verification excises owned spans on real
// bytes and asserts remainder byte-equality. No lock, no write, no network.
// No whole-Document serialization is used to produce the candidate.
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parseDocument, isSeq, isMap, isScalar, isAlias, visit, stringify } from 'yaml';

export const MANAGED_ROUTE_KEYS = [
  'opencode-go',
  'opencode-go-messages',
  'opencode-go-responses',
  'opencode-completions',
  'opencode-messages',
  'opencode',
];

export const REFUSAL_CODES = [
  'PATCH_PARSE_ERROR',
  'PATCH_ROOT_NOT_SEQUENCE',
  'PLUGIN_ENTRY_MISSING',
  'PLUGIN_ENTRY_DUPLICATE',
  'SETTINGS_INVALID',
  'ANCHOR_IN_MANAGED_SCOPE',
  'TAG_IN_MANAGED_ARRAY',
  'UNOWNED_COMMENT_AMBIGUOUS',
  'UNPRESERVABLE_STRUCTURE',
  'MEMBERSHIP_MISMATCH',
  'GENERATED_MEMBERSHIP_MISMATCH',
  'UNRELATED_CONTENT_CHANGED',
  'VERIFY_FAILED',
];

const JS_TAG = 'tag:yaml.org,2002:js';
const STR_TAG = 'tag:yaml.org,2002:str';
const KNOWN_TAGS = new Set([
  'tag:yaml.org,2002:seq',
  'tag:yaml.org,2002:map',
  'tag:yaml.org,2002:str',
  'tag:yaml.org,2002:int',
  'tag:yaml.org,2002:float',
  'tag:yaml.org,2002:bool',
  'tag:yaml.org,2002:null',
]);
const GATEWAY_OF = {
  'opencode-go': 'go',
  'opencode-go-messages': 'go',
  'opencode-go-responses': 'go',
  'opencode-completions': 'zen',
  'opencode-messages': 'zen',
  'opencode': 'zen',
};
import { MANAGED_ROUTES } from '../sync.mjs';

function refusal(code, message, detail) {
  const out = { ok: false, code, message, status: 'BLOCKED' };
  if (detail !== undefined) out.detail = detail;
  return out;
}

function shaHex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

function clone(v) {
  return structuredClone(v);
}

function charToByte(text, charOff) {
  return Buffer.byteLength(text.slice(0, charOff), 'utf8');
}

function detectEol(text) {
  if (text.includes('\r\n')) return '\r\n';
  return '\n';
}

function lineStartOf(text, off) {
  if (off <= 0) return 0;
  const i = text.lastIndexOf('\n', off - 1);
  return i < 0 ? 0 : i + 1;
}

function lineEndOf(text, off) {
  const i = text.indexOf('\n', off);
  return i < 0 ? text.length : i;
}

function indentStr(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += ' ';
  return s;
}

function indentBlock(blockText, indent, eol) {
  const lines = blockText.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (i === lines.length - 1 && ln === '') continue;
    if (ln.length === 0) out.push('');
    else out.push(indentStr(indent) + ln);
  }
  return out.join(eol) + eol;
}

// Quote-aware comment scan: true if a '#' outside single/double quotes acts as comment.
function hasCommentOutsideQuotes(segment) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (inSingle) {
      if (c === chr(39)) {
        if (segment[i + 1] === chr(39)) i++;
        else inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      if (c === '\\') { i++; continue; }
      if (c === '"') inDouble = false;
      continue;
    }
    if (c === chr(39)) { inSingle = true; continue; }
    if (c === '"') { inDouble = true; continue; }
    if (c === '#') {
      if (i === 0) return true;
      const prev = segment[i - 1];
      if (prev === ' ' || prev === '\t') return true;
    }
  }
  return false;
}

function chr(n) { return String.fromCharCode(n); }

function buildMissingAncestors(mapNode, origText) {
  if (!mapNode || !isMap(mapNode)) return { ok: false };
  if (isFlowNode(mapNode)) return { ok: false };
  if (!mapNode.items || mapNode.items.length === 0) return { ok: false };
  let first = null;
  for (const p of mapNode.items) {
    if (!p || !p.key || typeof p.key.range?.[0] !== 'number') return { ok: false };
    const ks = p.key.range[0];
    const ls = lineStartOf(origText, ks);
    const col = ks - ls;
    if (first === null) first = col;
    else if (col !== first) return { ok: false };
    if (p.key && p.key.flow === true) return { ok: false };
  }
  if (first === null) return { ok: false };
  return { ok: true, col: first };
}

export function classifyFootprint(input) {
  const storedConfig = input ? input.storedConfig : undefined;
  const desired = input ? input.desired : undefined;
  const out = {};
  const providers = storedConfig !== undefined && isPlainObject(storedConfig) && Object.hasOwn(storedConfig, 'providers') ? storedConfig.providers : undefined;
  const providersIsMap = providers !== undefined && isPlainObject(providers);
  for (const route of MANAGED_ROUTE_KEYS) {
    const wanted = desired && Object.hasOwn(desired, route) && Array.isArray(desired[route]) ? desired[route] : [];
    const hasRoute = providersIsMap && Object.hasOwn(providers, route) && isPlainObject(providers[route]);
    if (!hasRoute) {
      if (providers !== undefined && providersIsMap && Object.hasOwn(providers, route)) {
        out[route] = 'F1-add';
      } else if (!providersIsMap && providers !== undefined) {
        out[route] = 'F1-add';
      } else {
        let missingRoute = true;
        if (providersIsMap && Object.hasOwn(providers, route)) missingRoute = false;
        if (missingRoute) {
          out[route] = wanted.length === 0 ? 'F0' : 'F2';
        } else {
          out[route] = 'F1-add';
        }
      }
      if (providersIsMap && Object.hasOwn(providers, route) && isPlainObject(providers[route]) && !Object.hasOwn(providers[route], 'models')) {
        out[route] = 'F1-add';
      } else if (providersIsMap && Object.hasOwn(providers, route) && !isPlainObject(providers[route])) {
        out[route] = 'F1';
      }
      continue;
    }
    const prov = providers[route];
    if (!Object.hasOwn(prov, 'models')) {
      out[route] = 'F1-add';
      continue;
    }
    const storedModels = prov.models;
    if (!Array.isArray(storedModels)) {
      out[route] = 'F1';
      continue;
    }
    out[route] = isDeepStrictEqual(storedModels, wanted) ? 'F0' : 'F1';
  }
  // Fix-up for storedConfig undefined (all missing routes).
  if (storedConfig === undefined) {
    for (const route of MANAGED_ROUTE_KEYS) {
      const wanted = desired && Object.hasOwn(desired, route) && Array.isArray(desired[route]) ? desired[route] : [];
      out[route] = wanted.length === 0 ? 'F0' : 'F2';
    }
  }
  return out;
}

function validateDesired(desired) {
  if (!isPlainObject(desired)) return false;
  for (const r of MANAGED_ROUTE_KEYS) {
    if (!Object.hasOwn(desired, r) || !Array.isArray(desired[r])) return false;
  }
  return true;
}

function checkDesiredDuplicates(desired) {
  for (const gw of ['go', 'zen']) {
    const ids = [];
    for (const route of MANAGED_ROUTE_KEYS) {
      if (GATEWAY_OF[route] !== gw) continue;
      const arr = desired[route] || [];
      for (const rec of arr) {
        if (!rec || typeof rec.id !== 'string') return 'MEMBERSHIP_MISMATCH';
        ids.push(rec.id);
      }
    }
    if (new Set(ids).size !== ids.length) return 'MEMBERSHIP_MISMATCH';
  }
  return null;
}

function parseAndLocate(text) {
  let doc = null;
  try {
    doc = parseDocument(text, { customTags: [{ tag: JS_TAG, resolve: function (v) { return v; } }] });
  } catch (e) {
    return { error: refusal('PATCH_PARSE_ERROR', 'The profile patch cannot be parsed.', String((e && e.message) || e)) };
  }
  if (!doc || (doc.errors && doc.errors.length > 0)) {
    const msg = doc && doc.errors && doc.errors[0] ? String(doc.errors[0].message || doc.errors[0]) : 'parse-error';
    return { error: refusal('PATCH_PARSE_ERROR', 'The profile patch cannot be parsed.', msg.slice(0, 500)) };
  }
  // Unknown-tag policy: any tag outside known plain set and outside JS family refuses.
  let unknownOutside = null;
  visit(doc, {
    Node: function (k, n) {
      if (!n || typeof n !== 'object') return;
      if (n.tag === undefined) return;
      if (KNOWN_TAGS.has(n.tag)) return;
      if (typeof n.tag === 'string' && n.tag.indexOf(JS_TAG) === 0) return;
      if (n.tag === STR_TAG) return;
      unknownOutside = n.tag;
    }
  });
  // Defer unknown decision to caller (needs owned-span knowledge to choose TAG vs PARSE).
  // Here we only record; caller splits inside vs outside.
  if (!isSeq(doc.contents)) {
    return { error: refusal('PATCH_ROOT_NOT_SEQUENCE', 'The profile patch root must be a sequence.', typeof doc.contents) };
  }
  const cands = [];
  const items = doc.contents.items;
  for (let at = 0; at < items.length; at++) {
    const item = items[at];
    if (!isMap(item)) continue;
    if (item.has('insert')) {
      continue;
    }
    const idNode = item.get('id', true);
    if (isScalar(idNode) && idNode.value === 'llm-pi-ai' && (idNode.tag === undefined || idNode.tag === STR_TAG)) {
      cands.push(at);
    }
  }
  if (cands.length === 0) return { error: refusal('PLUGIN_ENTRY_MISSING', 'No llm-pi-ai entry exists in the profile patch.', 'entry-missing') };
  if (cands.length > 1) return { error: refusal('PLUGIN_ENTRY_DUPLICATE', 'More than one llm-pi-ai entry exists; refusing rather than picking.', 'duplicate') };
  const entryIndex = cands[0];
  const entryNode = items[entryIndex];
  let configPair = null;
  let configNode = null;
  for (const p of entryNode.items) {
    if (p.key && p.key.value === 'config') { configPair = p; configNode = p.value; break; }
  }
  let providersPair = null;
  let providersNode = null;
  if (configNode) {
    if (!isMap(configNode)) {
      return { error: refusal('SETTINGS_INVALID', 'The llm-pi-ai configuration must be a mapping when present.', { scope: 'stored', path: 'config' }) };
    }
    for (const p of configNode.items) {
      if (p.key && p.key.value === 'providers') { providersPair = p; providersNode = p.value; break; }
    }
    if (providersPair && !isMap(providersNode)) {
      return { error: refusal('SETTINGS_INVALID', 'The llm-pi-ai providers container must be a mapping when present.', { scope: 'stored', path: 'providers' }) };
    }
  }
  const routeInfo = {};
  if (providersNode && isMap(providersNode)) {
    for (const route of MANAGED_ROUTE_KEYS) {
      let rp = null;
      for (const p of providersNode.items) {
        if (p.key && p.key.value === route) { rp = p; break; }
      }
      if (!rp) { routeInfo[route] = { present: false }; continue; }
      const rm = rp.value;
      if (!isMap(rm)) {
        routeInfo[route] = { present: true, malformed: true, routePair: rp, routeMap: rm };
        continue;
      }
      let mp = null;
      for (const p of rm.items) {
        if (p.key && p.key.value === 'models') { mp = p; break; }
      }
      if (!mp) { routeInfo[route] = { present: true, hasModels: false, routePair: rp, routeMap: rm }; continue; }
      let mn = mp.value;
      if (mn === null || (isScalar(mn) && mn.value === null)) {
        // A bare "models:" key carries a null YAML value. Accept it as an
        // empty list without touching bytes: the synthetic empty sequence
        // spans only that key line's ending, so construction replaces the
        // line break with the rendered block and verification excises it.
        const keyEnd = mp.key && Array.isArray(mp.key.range) ? mp.key.range[1] : null;
        if (typeof keyEnd !== 'number') {
          routeInfo[route] = { present: true, hasModels: true, malformedModels: true, routePair: rp, routeMap: rm, modelsPair: mp, modelsNode: mn };
          continue;
        }
        let spanStart = keyEnd;
        if (text[spanStart] === ':') spanStart += 1;
        while (text[spanStart] === ' ' || text[spanStart] === '\t') spanStart += 1;
        let spanEnd = spanStart;
        if (text.slice(spanEnd, spanEnd + 2) === '\r\n') spanEnd += 2;
        else if (text[spanEnd] === '\n') spanEnd += 1;
        else {
          routeInfo[route] = { present: true, hasModels: true, malformedModels: true, routePair: rp, routeMap: rm, modelsPair: mp, modelsNode: mn };
          continue;
        }
        const emptyModels = doc.createNode([]);
        emptyModels.range = [spanStart, spanStart, spanEnd];
        mp.value = emptyModels;
        mn = emptyModels;
      }
      if (!isSeq(mn)) {
        routeInfo[route] = { present: true, hasModels: true, malformedModels: true, routePair: rp, routeMap: rm, modelsPair: mp, modelsNode: mn };
        continue;
      }
      routeInfo[route] = { present: true, hasModels: true, routePair: rp, routeMap: rm, modelsPair: mp, modelsNode: mn };
    }
  } else {
    for (const route of MANAGED_ROUTE_KEYS) routeInfo[route] = { present: false };
  }
  // Malformed provider shapes fail closed before footprint.
  for (const route of MANAGED_ROUTE_KEYS) {
    const ri = routeInfo[route];
    if (ri && ri.malformed) return { error: refusal('SETTINGS_INVALID', 'Managed route ' + route + ' must be a mapping when present.', { scope: 'stored', path: 'providers.' + route }) };
    if (ri && ri.malformedModels) return { error: refusal('SETTINGS_INVALID', 'Managed route ' + route + ' models must be an array when present.', { scope: 'stored', path: 'providers.' + route + '.models' }) };
  }
  return { doc, entryIndex, entryNode, configPair, configNode, providersPair, providersNode, routeInfo, unknownTag: unknownOutside };
}

function collectAnchorsInSubtree(root) {
  const anchors = new Set();
  visit(root, {
    Node: function (k, n) {
      if (n && typeof n === 'object' && typeof n.anchor === 'string' && n.anchor.length > 0) anchors.add(n.anchor);
    }
  });
  return anchors;
}

function collectAliasSources(doc) {
  const srcs = [];
  visit(doc, {
    Node: function (k, n) {
      if (isAlias(n)) srcs.push(n.source);
    }
  });
  return srcs;
}

function collectTagsInSubtree(root) {
  const tags = [];
  visit(root, {
    Node: function (k, n) {
      if (!n || typeof n !== 'object') return;
      if (n.tag === undefined) return;
      if (KNOWN_TAGS.has(n.tag)) return;
      if (n.tag === STR_TAG) return;
      tags.push(n.tag);
    }
  });
  return tags;
}

function isFlowNode(n) { return n && n.flow === true; }

export function renderDesiredState(input) {
  input = input || {};
  let patchBytes = input.patchBytes;
  let storedConfigInput = input.storedConfig;
  let desiredInput = input.desired;
  let targetInput = input.target;
  // Input snapshots (no mutation).
  let desired = null;
  try { desired = clone(desiredInput); } catch (e) { return refusal('MEMBERSHIP_MISMATCH', 'Desired state is not cloneable.', 'desired-uncloneable'); }
  if (!validateDesired(desired)) return refusal('MEMBERSHIP_MISMATCH', 'Desired managed arrays are malformed; six array routes required.', 'desired-malformed');
  const dupCode = checkDesiredDuplicates(desired);
  if (dupCode) return refusal(dupCode, 'Duplicate managed model IDs across routes.', 'duplicate-managed-id');
  if (!patchBytes || (!(patchBytes instanceof Uint8Array) && !Buffer.isBuffer(patchBytes) && typeof patchBytes !== 'string')) {
    return refusal('PATCH_PARSE_ERROR', 'Patch bytes must be supplied.', 'patch-bytes-missing');
  }
  let origBytes = null;
  if (typeof patchBytes === 'string') origBytes = Buffer.from(patchBytes, 'utf8');
  else origBytes = Buffer.from(patchBytes);
  const origText = origBytes.toString('utf8');
  const eol = detectEol(origText);
  const patchDigest = shaHex(origBytes);
  const located = parseAndLocate(origText);
  if (located.error) return located.error;
  const doc = located.doc;
  const routeInfo = located.routeInfo;
  // Unknown tags outside owned spans refuse (frozen policy). Inside tags handled below as TAG.
  // Build actual stored JS for footprint via YAML toJS (managed routes only).
  let actualStored = undefined;
  try {
    if (located.configNode && isMap(located.configNode)) {
      const js = located.configNode.toJS(doc);
      actualStored = js;
    } else if (located.configNode === null || located.configNode === undefined) {
      actualStored = undefined;
    } else {
      actualStored = undefined;
    }
  } catch (e) {
    return refusal('PATCH_PARSE_ERROR', 'Stored configuration cannot be materialized.', String((e && e.message) || e).slice(0, 300));
  }
  let storedForFootprint = undefined;
  if (actualStored !== undefined && isPlainObject(actualStored)) storedForFootprint = { providers: actualStored.providers };
  else if (actualStored === undefined) storedForFootprint = undefined;
  else storedForFootprint = { providers: {} };
  // Normalize: if providers missing, footprint treats as missing routes (F2/F0).
  const footprint = classifyFootprint({ storedConfig: storedForFootprint, desired });
  let hasWork = false;
  for (const r of MANAGED_ROUTE_KEYS) if (footprint[r] !== 'F0') hasWork = true;
  // Derive byte spans for F1 (original) early for safety scans.
  const origSpansChar = [];
  const warnings = [];
  // Safety: flow ancestors, anchors, tags, comments.
  // Collect owned anchors/tags sets for F1 routes.
  const ownedAnchors = new Set();
  for (const route of MANAGED_ROUTE_KEYS) {
    const fp = footprint[route];
    if (fp !== 'F1') continue;
    const ri = routeInfo[route];
    const mn = ri.modelsNode;
    const subs = collectAnchorsInSubtree(mn);
    for (const a of subs) ownedAnchors.add(a);
    if (typeof mn.anchor === 'string' && mn.anchor.length > 0) ownedAnchors.add(mn.anchor);
  }
  // Alias scope: any alias occurring inside a replaced models span refuses,
  // whether its anchor lives inside or outside the span. Replacing the span
  // would silently drop or rebind a non-local reference.
  for (const route of MANAGED_ROUTE_KEYS) {
    if (footprint[route] !== 'F1') continue;
    const ri = routeInfo[route];
    if (!ri || !ri.modelsNode) continue;
    let aliasInside = null;
    try {
      visit(ri.modelsNode, { Node: function (k, n) { if (aliasInside === null && isAlias(n)) aliasInside = n.source; } });
    } catch (e) { return refusal('VERIFY_FAILED', 'Owned-span alias scan failed.', String((e && e.message) || e)); }
    if (aliasInside !== null) return refusal('ANCHOR_IN_MANAGED_SCOPE', 'An alias occurs inside a replaced models span.', { route, anchor: String(aliasInside).slice(0, 100) });
  }
  // Anchor scope: any alias anywhere referencing owned anchor refuses.
  if (ownedAnchors.size > 0) {
    const aliases = collectAliasSources(doc);
    for (const s of aliases) {
      if (ownedAnchors.has(s)) return refusal('ANCHOR_IN_MANAGED_SCOPE', 'An alias references an anchor defined in a replaced models span.', { anchor: s });
    }
    // Anchor defined ON or WITHIN owned span already collected -> refuse.
    return refusal('ANCHOR_IN_MANAGED_SCOPE', 'An anchor is defined in a replaced models span.', { anchors: Array.from(ownedAnchors).slice(0, 5) });
  }
  // Tag scans.
  for (const route of MANAGED_ROUTE_KEYS) {
    const fp = footprint[route];
    if (fp !== 'F1') continue;
    const tags = collectTagsInSubtree(routeInfo[route].modelsNode);
    if (tags.length > 0) return refusal('TAG_IN_MANAGED_ARRAY', 'A custom tag occurs inside a replaced models span.', { route, tags: tags.slice(0, 3) });
  }
  // Unknown tags outside owned spans refuse PATCH_PARSE_ERROR.
  // Determine outside tags: any unknown tag not inside an F1 owned subtree.
  if (located.unknownTag) {
    let insideOwned = false;
    for (const route of MANAGED_ROUTE_KEYS) {
      if (footprint[route] !== 'F1') continue;
      const tags = collectTagsInSubtree(routeInfo[route].modelsNode);
      if (tags.indexOf(located.unknownTag) >= 0) { insideOwned = true; break; }
    }
    if (!insideOwned) return refusal('PATCH_PARSE_ERROR', 'An unresolvable tag is present; effective truth is not established.', String(located.unknownTag).slice(0, 200));
  }
  // Flow ancestors.
  for (const route of MANAGED_ROUTE_KEYS) {
    const fp = footprint[route];
    if (fp === 'F0') continue;
    if (fp === 'F1' || fp === 'F1-add') {
      const ri = routeInfo[route];
      if (!ri || !ri.present) continue;
      if (isFlowNode(located.configNode) || isFlowNode(located.providersNode) || isFlowNode(ri.routeMap)) {
        return refusal('UNPRESERVABLE_STRUCTURE', 'A managed ancestor is flow-styled; splice would require restyling.', { route });
      }
    }
    if (fp === 'F2') {
      if (located.providersNode && isMap(located.providersNode)) {
        if (isFlowNode(located.configNode) || isFlowNode(located.providersNode)) {
          return refusal('UNPRESERVABLE_STRUCTURE', 'A managed ancestor is flow-styled; splice would require restyling.', { route });
        }
      } else if (located.configNode && isMap(located.configNode)) {
        if (isFlowNode(located.configNode) || isFlowNode(located.entryNode)) {
          return refusal('UNPRESERVABLE_STRUCTURE', 'A managed ancestor is flow-styled; splice would require restyling.', { route });
        }
      } else if (!located.configNode) {
        if (!located.entryNode || !isMap(located.entryNode) || isFlowNode(located.entryNode)) {
          return refusal('UNPRESERVABLE_STRUCTURE', 'Missing providers container cannot be safely created.', { route });
        }
      } else {
        return refusal('UNPRESERVABLE_STRUCTURE', 'Missing providers container cannot be safely created.', { route });
      }
    }
  }
  // Comment boundary scans for F1.
  for (const route of MANAGED_ROUTE_KEYS) {
    const fp = footprint[route];
    if (fp !== 'F1') continue;
    const ri = routeInfo[route];
    const mp = ri.modelsPair;
    const mn = ri.modelsNode;
    const keyStart = mp.key.range[0];
    const valS = mn.range[0];
    const valM = mn.range[1];
    const valE = mn.range[2];
    const keyLineS = lineStartOf(origText, keyStart);
    const keyLineE = lineEndOf(origText, keyStart);
    const keyLine = origText.slice(keyLineS, keyLineE);
    const valLineS = lineStartOf(origText, valS);
    if (valLineS !== keyLineS && hasCommentOutsideQuotes(keyLine)) {
      return refusal('UNOWNED_COMMENT_AMBIGUOUS', 'Trailing comment on models key line with value on later line.', { route });
    }
    const trailing = origText.slice(valM, valE);
    if (hasCommentOutsideQuotes(trailing)) {
      return refusal('UNOWNED_COMMENT_AMBIGUOUS', 'Trailing comment intersects replaced value boundary.', { route });
    }
    // End-line trailing after span on same line (when span does not include it).
    const lastOwned = valE - 1;
    if (lastOwned >= 0) {
      const endLineS = lineStartOf(origText, lastOwned);
      const endLineE = lineEndOf(origText, lastOwned);
      const afterSpan = origText.slice(valE, endLineE);
      if (afterSpan.length > 0 && hasCommentOutsideQuotes(afterSpan)) {
        return refusal('UNOWNED_COMMENT_AMBIGUOUS', 'Trailing comment after replaced value on end line.', { route });
      }
    }
    // Interior warning: comment inside value part [valS, valM].
    const valuePart = origText.slice(valS, valM);
    if (hasCommentOutsideQuotes(valuePart)) {
      if (warnings.indexOf('REPLACED_SUBTREE_NORMALIZATION') < 0) warnings.push('REPLACED_SUBTREE_NORMALIZATION');
    }
  }
  // Indentation references for F1-add/F2.
  function siblingColOf(mapNode) {
    const cols = [];
    for (const p of mapNode.items) {
      const ks = p.key.range[0];
      const ls = lineStartOf(origText, ks);
      cols.push(ks - ls);
    }
    return cols;
  }
  for (const route of MANAGED_ROUTE_KEYS) {
    if (footprint[route] !== 'F1-add') continue;
    const ri = routeInfo[route];
    if (!ri || !ri.present || !ri.routeMap || !isMap(ri.routeMap)) return refusal('UNPRESERVABLE_STRUCTURE', 'Missing route map for models insertion.', { route });
    if (ri.routeMap.items.length === 0) return refusal('UNPRESERVABLE_STRUCTURE', 'No sibling reference for models insertion.', { route });
    const cols = siblingColOf(ri.routeMap);
    const first = cols[0];
    for (const c of cols) if (c !== first) return refusal('UNPRESERVABLE_STRUCTURE', 'Ambiguous indentation for models insertion.', { route });
  }
  // F2 insertion reference: providers siblings consistent and block, or safe ancestor creation.
  const f2Routes = MANAGED_ROUTE_KEYS.filter(function (r) { return footprint[r] === 'F2'; });
  let f2Ancestor = null;
  if (f2Routes.length > 0) {
    if (located.providersNode && isMap(located.providersNode)) {
      if (isFlowNode(located.providersNode)) return refusal('UNPRESERVABLE_STRUCTURE', 'Providers container is flow-styled.', {});
      if (located.providersNode.items.length === 0) return refusal('UNPRESERVABLE_STRUCTURE', 'No sibling reference for route creation.', {});
      const cols = siblingColOf(located.providersNode);
      const first = cols[0];
      for (const c of cols) if (c !== first) return refusal('UNPRESERVABLE_STRUCTURE', 'Ambiguous providers indentation.', {});
      f2Ancestor = { kind: 'providers-present' };
    } else if (located.configNode && isMap(located.configNode)) {
      if (isFlowNode(located.configNode)) return refusal('UNPRESERVABLE_STRUCTURE', 'A managed ancestor is flow-styled; splice would require restyling.', {});
      const built = buildMissingAncestors(located.configNode, origText);
      if (!built.ok) return refusal('UNPRESERVABLE_STRUCTURE', 'Missing providers container cannot be safely created.', {});
      f2Ancestor = { kind: 'providers-missing', col: built.col };
    } else if (!located.configNode) {
      if (!located.entryNode || !isMap(located.entryNode) || isFlowNode(located.entryNode)) return refusal('UNPRESERVABLE_STRUCTURE', 'Missing providers container cannot be safely created.', {});
      const built = buildMissingAncestors(located.entryNode, origText);
      if (!built.ok) return refusal('UNPRESERVABLE_STRUCTURE', 'Missing providers container cannot be safely created.', {});
      f2Ancestor = { kind: 'config-missing', col: built.col };
    } else {
      return refusal('UNPRESERVABLE_STRUCTURE', 'Missing providers for route creation.', {});
    }
  }
  if (!hasWork) {
    return { ok: true, status: 'NO_CHANGE', footprint: clone(footprint), desired: clone(desired), patchDigest, originalSpans: [], candidateSpans: [], verification: { remainderEqual: true, remainderSha256: shaHex(origBytes), candidateRemainderSha256: shaHex(origBytes), sixArraysEqual: true }, warnings: clone(warnings), target: targetInput ? clone(targetInput) : undefined };
  }
  // Construction: byte-surgical splicing.
  // Compute original byte spans for F1.
  const origByteSpans = [];
  const edits = [];
  for (const route of MANAGED_ROUTE_KEYS) {
    if (footprint[route] !== 'F1') continue;
    const mn = routeInfo[route].modelsNode;
    const cs = mn.range[0];
    const ce = mn.range[2];
    const bs = charToByte(origText, cs);
    const be = charToByte(origText, ce);
    origByteSpans.push({ route, kind: 'F1', start: bs, end: be, charStart: cs, charEnd: ce });
  }
  // Check overlapping original spans.
  const sortedOrig = origByteSpans.slice().sort(function (a, b) { return a.start - b.start; });
  for (let i = 1; i < sortedOrig.length; i++) {
    if (sortedOrig[i].start < sortedOrig[i - 1].end) return refusal('UNPRESERVABLE_STRUCTURE', 'Overlapping owned spans.', {});
  }
  // Build fragments for F1.
  for (const route of MANAGED_ROUTE_KEYS) {
    if (footprint[route] !== 'F1') continue;
    const ri = routeInfo[route];
    const mp = ri.modelsPair;
    const mn = ri.modelsNode;
    const wanted = desired[route] || [];
    let frag = '';
    const keyStart = mp.key.range[0];
    const valS = mn.range[0];
    const keyLineS = lineStartOf(origText, keyStart);
    const valLineS = lineStartOf(origText, valS);
    const sameLine = keyLineS === valLineS;
    const keyCol = keyStart - keyLineS;
    if (wanted.length === 0) {
      if (sameLine) frag = '[]';
      else {
        // Contract v1.4.7-rc1 G3: an emptied next-line list keeps its line
        // ending, or the following key lands on the same line as the brackets
        // and the candidate no longer parses.
        frag = '[]' + eol;
      }
    } else {
      const block = stringify(wanted);
      const blockEolFixed = block.split('\n').join(eol);
      if (sameLine) {
        const indent = keyCol + 2;
        // indentBlock owns the line-ending join. Pre-converting block to CRLF
        // here would leave stray CRs on CRLF patches (the F1-add path already
        // avoids that same double conversion).
        frag = eol + indentBlock(block, indent, eol);
      } else {
        const vcol = valS - valLineS;
        const blines = blockEolFixed.split(eol);
        const kept = [];
        for (let li = 0; li < blines.length; li++) {
          const ln = blines[li];
          if (li === blines.length - 1 && ln === '') continue;
          if (li === 0) kept.push(ln);
          else if (ln.length === 0) kept.push('');
          else kept.push(indentStr(vcol) + ln);
        }
        frag = kept.join(eol) + eol;
      }
    }
    // Normalize frag eol already; convert frag chars to bytes for splice (frag is JS string, will encode utf8).
    // For sameLine non-empty we built with leading eol; ensure exactly one trailing eol.
    // indentBlock guarantees trailing eol; for sameLine empty '[]' we need trailing eol to match original span trailing eol.
    if (sameLine && wanted.length === 0) frag = frag + eol;
    // For sameLine non-empty, frag already ends with eol (from indentBlock). Good.
    // For next-line cases, frag ends with eol. Good.
    const bs = charToByte(origText, mn.range[0]);
    const be = charToByte(origText, mn.range[2]);
    edits.push({ start: bs, end: be, text: frag, route, kind: 'F1' });
  }
  // F1-add insertions.
  const f1addEdits = [];
  for (const route of MANAGED_ROUTE_KEYS) {
    if (footprint[route] !== 'F1-add') continue;
    const ri = routeInfo[route];
    const rm = ri.routeMap;
    // sibling col
    const ks = rm.items[0].key.range[0];
    const col = ks - lineStartOf(origText, ks);
    const wanted = desired[route] || [];
    let insertText = '';
    if (wanted.length === 0) {
      insertText = indentStr(col) + 'models: []' + eol;
    } else {
      // indentBlock owns the line-ending join; pre-converting to eol here made
      // every rendered line end with a stray CR on a CRLF patch (C04/D01).
      const block = stringify(wanted);
      const indented = indentBlock(block, col + 2, eol);
      insertText = indentStr(col) + 'models:' + eol + indented;
    }
    // insertion byte offset: after last sibling line (routeMap end char -> byte).
    const charOff = rm.range[2];
    // rm.range[2] may be at line start of next sibling (providers next route) or at map end.
    // Find line-anchored insertion: if charOff is not at line start, advance to next line start.
    let insChar = charOff;
    // If rm ends mid-line (should not for block), move to next line start.
    // For block maps, range[2] is already at line start (after newline). Keep as is.
    const bs = charToByte(origText, insChar);
    f1addEdits.push({ start: bs, end: bs, text: insertText, route, kind: 'F1-add', charOff: insChar });
    origByteSpans.push({ route, kind: 'F1-add', start: bs, end: bs });
  }
  // F2 insertions (combined, shared ancestors once).
  let f2Edit = null;
  if (f2Routes.length > 0) {
    const ordered = MANAGED_ROUTE_KEYS.filter(function (r) { return footprint[r] === 'F2'; });
    if (!f2Ancestor || f2Ancestor.kind === 'providers-present') {
      const prov = located.providersNode;
      const ks = prov.items[0].key.range[0];
      const provCol = ks - lineStartOf(origText, ks);
      const innerCol = provCol + 2;
      const modelsCol = innerCol + 2;
      const valueCol = modelsCol + 2;
      let combined = '';
      for (const route of ordered) {
        const wanted = desired[route] || [];
        const def = MANAGED_ROUTES[route] || {};
        const api = def.api || 'openai-responses';
        const baseURL = def.baseURL || 'https://example.com';
        const apiKeyEnv = def.apiKeyEnv || 'OPENCODE_API_KEY';
        combined += indentStr(provCol) + route + ':' + eol;
        combined += indentStr(innerCol) + 'displayName: ' + route + eol;
        combined += indentStr(innerCol) + 'api: ' + api + eol;
        combined += indentStr(innerCol) + 'baseURL: ' + baseURL + eol;
        combined += indentStr(innerCol) + 'apiKeyEnv: ' + apiKeyEnv + eol;
        if (wanted.length === 0) combined += indentStr(innerCol) + 'models: []' + eol;
        else { combined += indentStr(innerCol) + 'models:' + eol; const block = stringify(wanted); combined += indentBlock(block, valueCol, eol); }
      }
      const charOff = prov.range[2];
      const bs = charToByte(origText, charOff);
      f2Edit = { start: bs, end: bs, text: combined, kind: 'F2' };
      for (const route of ordered) origByteSpans.push({ route, kind: 'F2', start: bs, end: bs });
    } else if (f2Ancestor.kind === 'providers-missing') {
      const providersCol = f2Ancestor.col;
      const routeCol = providersCol + 2;
      const fieldCol = routeCol + 2;
      const valueCol = fieldCol + 2;
      let combined = indentStr(providersCol) + 'providers:' + eol;
      for (const route of ordered) {
        const wanted = desired[route] || [];
        const def = MANAGED_ROUTES[route] || {};
        const api = def.api || 'openai-responses';
        const baseURL = def.baseURL || 'https://example.com';
        const apiKeyEnv = def.apiKeyEnv || 'OPENCODE_API_KEY';
        combined += indentStr(routeCol) + route + ':' + eol;
        combined += indentStr(fieldCol) + 'displayName: ' + route + eol;
        combined += indentStr(fieldCol) + 'api: ' + api + eol;
        combined += indentStr(fieldCol) + 'baseURL: ' + baseURL + eol;
        combined += indentStr(fieldCol) + 'apiKeyEnv: ' + apiKeyEnv + eol;
        if (wanted.length === 0) combined += indentStr(fieldCol) + 'models: []' + eol;
        else { combined += indentStr(fieldCol) + 'models:' + eol; const block = stringify(wanted); combined += indentBlock(block, valueCol, eol); }
      }
      const charOff = located.configNode.range[2];
      const bs = charToByte(origText, charOff);
      f2Edit = { start: bs, end: bs, text: combined, kind: 'F2' };
      for (const route of ordered) origByteSpans.push({ route, kind: 'F2', start: bs, end: bs });
    } else if (f2Ancestor.kind === 'config-missing') {
      const configCol = f2Ancestor.col;
      const providersCol = configCol + 2;
      const routeCol = providersCol + 2;
      const fieldCol = routeCol + 2;
      const valueCol = fieldCol + 2;
      let combined = indentStr(configCol) + 'config:' + eol;
      combined += indentStr(providersCol) + 'providers:' + eol;
      for (const route of ordered) {
        const wanted = desired[route] || [];
        const def = MANAGED_ROUTES[route] || {};
        const api = def.api || 'openai-responses';
        const baseURL = def.baseURL || 'https://example.com';
        const apiKeyEnv = def.apiKeyEnv || 'OPENCODE_API_KEY';
        combined += indentStr(routeCol) + route + ':' + eol;
        combined += indentStr(fieldCol) + 'displayName: ' + route + eol;
        combined += indentStr(fieldCol) + 'api: ' + api + eol;
        combined += indentStr(fieldCol) + 'baseURL: ' + baseURL + eol;
        combined += indentStr(fieldCol) + 'apiKeyEnv: ' + apiKeyEnv + eol;
        if (wanted.length === 0) combined += indentStr(fieldCol) + 'models: []' + eol;
        else { combined += indentStr(fieldCol) + 'models:' + eol; const block = stringify(wanted); combined += indentBlock(block, valueCol, eol); }
      }
      const charOff = located.entryNode.range[2];
      const bs = charToByte(origText, charOff);
      f2Edit = { start: bs, end: bs, text: combined, kind: 'F2' };
      for (const route of ordered) origByteSpans.push({ route, kind: 'F2', start: bs, end: bs });
    } else {
      return refusal('UNPRESERVABLE_STRUCTURE', 'Missing providers container cannot be safely created.', {});
    }
  }
  const allEdits = edits.concat(f1addEdits);
  if (f2Edit) allEdits.push(f2Edit);
  // Check overlapping edits (insertions at same offset are combined, so only F2 combined is one).
  const sortedEdits = allEdits.slice().sort(function (a, b) { return a.start - b.start || a.end - b.end; });
  for (let i = 1; i < sortedEdits.length; i++) {
    const prev = sortedEdits[i - 1];
    const cur = sortedEdits[i];
    // Zero-width insertions at same offset from different routes would overlap if not combined; F2 is combined, F1-add are distinct maps so distinct offsets.
    if (cur.start < prev.end) return refusal('UNPRESERVABLE_STRUCTURE', 'Overlapping splice sites.', {});
    if (cur.start === prev.start && cur.end === prev.end && !(prev.kind === 'F2' && cur.kind === 'F2')) {
      // Two zero-width at same offset (should not happen for distinct maps).
      if (prev.kind !== 'F2' || cur.kind !== 'F2') {
        // Allow only if same offset but different routes sharing ancestor? For F2 we combined, so this is error.
        return refusal('UNPRESERVABLE_STRUCTURE', 'Duplicate insertion site.', {});
      }
    }
  }
  // Apply edits descending by start.
  const desc = sortedEdits.slice().sort(function (a, b) { return b.start - a.start; });
  let candBytes = Buffer.from(origBytes);
  for (const ed of desc) {
    const fragBytes = Buffer.from(ed.text, 'utf8');
    candBytes = Buffer.concat([candBytes.slice(0, ed.start), fragBytes, candBytes.slice(ed.end)]);
  }
  const candidateDigest = shaHex(candBytes);
  // Verification: reparse candidate, assert six arrays, excision.
  const candText = candBytes.toString('utf8');
  const candLocated = parseAndLocate(candText);
  if (candLocated.error) {
    const e = candLocated.error;
    if (e.code === 'SETTINGS_INVALID') return e;
    return refusal('VERIFY_FAILED', 'Candidate reparses with error: ' + e.code, e.detail);
  }
  // Provider structure already validated in parseAndLocate.
  // Six-array equality.
  for (const route of MANAGED_ROUTE_KEYS) {
    const ri = candLocated.routeInfo[route];
    let actual = null;
    let missing = true;
    if (ri && ri.present && ri.hasModels && !ri.malformed && !ri.malformedModels) {
      missing = false;
      try { actual = ri.modelsNode.toJS(candLocated.doc); } catch (e) { return refusal('VERIFY_FAILED', 'Candidate models cannot be materialized.', { route }); }
    } else if (ri && ri.present && !ri.hasModels) {
      missing = true;
      actual = null;
    } else if (!ri || !ri.present) {
      missing = true;
      actual = null;
    } else {
      return refusal('SETTINGS_INVALID', 'Candidate provider malformed.', { route });
    }
    const wanted = desired[route] || [];
    if (missing) {
      if (wanted.length !== 0) return refusal('GENERATED_MEMBERSHIP_MISMATCH', 'Candidate missing route with non-empty desired.', { route });
    } else {
      if (!isDeepStrictEqual(actual, wanted)) return refusal('GENERATED_MEMBERSHIP_MISMATCH', 'Candidate array differs from desired.', { route });
    }
  }
  // Duplicate check on candidate (same as desired, but re-verify).
  const dup2 = checkDesiredDuplicates(desired);
  if (dup2) return refusal('GENERATED_MEMBERSHIP_MISMATCH', 'Duplicate managed IDs in candidate.', {});
  // Candidate spans independently. SameLine F1->block needs leading newline+indent included so excision matches.
  const candByteSpans = [];
  for (const route of MANAGED_ROUTE_KEYS) {
    const fp = footprint[route];
    if (fp === 'F1') {
      const mn = candLocated.routeInfo[route].modelsNode;
      if (!mn) return refusal('VERIFY_FAILED', 'Candidate F1 span missing.', { route });
      const cs = mn.range[0];
      const ce = mn.range[2];
      const wanted = desired[route] || [];
      const origRi = routeInfo[route];
      let sameLineOrig = false;
      try {
        const oks = origRi.modelsPair.key.range[0];
        const ovs = origRi.modelsNode.range[0];
        sameLineOrig = lineStartOf(origText, oks) === lineStartOf(origText, ovs);
      } catch (e) { sameLineOrig = false; }
      if (sameLineOrig && wanted.length > 0) {
        const candKey = candLocated.routeInfo[route].modelsPair.key;
        let expStartChar = candKey.range[1];
        // The separator after a same-line models key is not always ': '.
        // Skip the actual colon/space/tab separator and begin excision at the
        // inserted block's line break, so extra spaces or tabs stay in the
        // remainder exactly as they appear in the original.
        if (candText[expStartChar] === ':') expStartChar += 1;
        while (candText[expStartChar] === ' ' || candText[expStartChar] === '\t') expStartChar += 1;
        candByteSpans.push({ route, kind: 'F1', start: charToByte(candText, expStartChar), end: charToByte(candText, ce) });
      } else {
        candByteSpans.push({ route, kind: 'F1', start: charToByte(candText, cs), end: charToByte(candText, ce) });
      }
    } else if (fp === 'F1-add') {
      const ri = candLocated.routeInfo[route];
      if (!ri || !ri.present || !ri.modelsPair) return refusal('VERIFY_FAILED', 'Candidate F1-add span missing.', { route });
      const ks = ri.modelsPair.key.range[0];
      const ve = ri.modelsPair.value.range[2];
      candByteSpans.push({ route, kind: 'F1-add', start: charToByte(candText, ks), end: charToByte(candText, ve) });
      // Include leading indent? key range starts at key content, not indent. For excision, need to include indent+newline?
      // Our original insertion included indent. Candidate span from key start excludes indent, so remainder would retain indent spaces.
      // To make excision exact, expand candidate span to line start and include trailing eol.
    } else if (fp === 'F2') {
      const ri = candLocated.routeInfo[route];
      if (!ri || !ri.present) return refusal('VERIFY_FAILED', 'Candidate F2 span missing.', { route });
      const ks = ri.routePair.key.range[0];
      const ve = ri.routeMap.range[2];
      candByteSpans.push({ route, kind: 'F2', start: charToByte(candText, ks), end: charToByte(candText, ve) });
    }
  }
  if (f2Ancestor && (f2Ancestor.kind === 'providers-missing' || f2Ancestor.kind === 'config-missing')) {
    try {
      const firstRoute = f2Routes.length > 0 ? f2Routes[0] : 'opencode';
      if (candLocated.providersPair && candLocated.providersPair.key && Array.isArray(candLocated.providersPair.key.range)) {
        const ks = candLocated.providersPair.key.range[0];
        const ke = candLocated.providersPair.key.range[1];
        candByteSpans.push({ route: firstRoute, kind: 'F2', start: charToByte(candText, ks), end: charToByte(candText, ke) });
      }
      if (f2Ancestor.kind === 'config-missing' && candLocated.configPair && candLocated.configPair.key && Array.isArray(candLocated.configPair.key.range)) {
        const ks = candLocated.configPair.key.range[0];
        const ke = candLocated.configPair.key.range[1];
        candByteSpans.push({ route: firstRoute, kind: 'F2', start: charToByte(candText, ks), end: charToByte(candText, ke) });
      }
    } catch {}
  }
  // Adjust F1-add/F2 candidate spans to include full inserted lines (indent + trailing eol) for exact excision.
  // For F1-add: expand start to line start, end to next line start after value end (include eol).
  // For F2: similarly expand to line starts.
  const adjustedCandSpans = [];
  for (const s of candByteSpans) {
    if (s.kind === 'F1') { adjustedCandSpans.push(s); continue; }
    // Find char offsets corresponding to byte offsets? Need reverse mapping. Instead recompute via text line logic on candText char offsets.
    // We stored byte offsets; to expand, find char offsets first.
    // Simpler: recompute char spans then convert.
    adjustedCandSpans.push(s);
  }
  // Excision: original remainder vs candidate remainder.
  // For F1-add/F2, original spans are zero-width, candidate spans are as above (but need line-exact).
  // To achieve byte-exact remainder, we must ensure candidate spans cover exactly inserted bytes.
  // Our candidate spans currently cover key-to-value-end without leading indent/trailing eol nuances.
  // Instead, use construction edits for candidate excision? But spec requires independent extraction.
  // We bridge by expanding candidate spans to cover full lines as inserted.
  // Expand logic using candText and byte offsets via char search.
  function expandToFullLines(candTextStr, byteStart, byteEnd) {
    // Convert byte offsets to char offsets by scanning.
    let charS = 0;
    let acc = 0;
    const bytes = Buffer.from(candTextStr, 'utf8');
    // naive: find char offset whose byte offset equals target by iterating chars.
    function byteOfChar(charOff) { return Buffer.byteLength(candTextStr.slice(0, charOff), 'utf8'); }
    // binary search for char offset
    let lo = 0;
    let hi = candTextStr.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (byteOfChar(mid) < byteStart) lo = mid + 1;
      else hi = mid;
    }
    charS = lo;
    lo = 0; hi = candTextStr.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (byteOfChar(mid) < byteEnd) lo = mid + 1;
      else hi = mid;
    }
    let charE = lo;
    // Expand start to line start
    const ls = lineStartOf(candTextStr, charS);
    // Expand end to include trailing eol (if present)
    let expEndChar = charE;
    if (candTextStr.slice(charE, charE + 2) === '\r\n') expEndChar = charE + 2;
    else if (candTextStr[charE] === '\n') expEndChar = charE + 1;
    // If end is mid-line (before newline), extend to line end + eol? For F1-add/F2 inserted block ends with eol, so charE already at line start of next content (after eol). Keep as is if already at line start.
    // If charE is not at line start, extend to next line start.
    const endLineEnd = lineEndOf(candTextStr, Math.max(0, charE - 1));
    // If charE <= endLineEnd, then charE is within previous line; extend to after its eol.
    if (charE <= endLineEnd) {
      const after = candTextStr.slice(charE, endLineEnd + 2);
      // include up to newline
      const nl = candTextStr.indexOf('\n', charE);
      if (nl >= 0) expEndChar = nl + 1;
      else expEndChar = candTextStr.length;
    }
    return { start: Buffer.byteLength(candTextStr.slice(0, ls), 'utf8'), end: Buffer.byteLength(candTextStr.slice(0, expEndChar), 'utf8') };
  }
  const finalCandSpans = [];
  for (const s of candByteSpans) {
    if (s.kind === 'F1') finalCandSpans.push(s);
    else {
      const exp = expandToFullLines(candText, s.start, s.end);
      finalCandSpans.push({ route: s.route, kind: s.kind, start: exp.start, end: exp.end });
    }
  }
  function excise(buf, spans) {
    const sorted = spans.slice().sort(function (a, b) { return b.start - a.start; });
    let out = Buffer.from(buf);
    for (const sp of sorted) out = Buffer.concat([out.slice(0, sp.start), out.slice(sp.end)]);
    return out;
  }
  // For original F1-add/F2 zero-width spans, excision does nothing; for F1, excise value spans.
  const origExciseSpans = origByteSpans.filter(function (s) { return s.kind === 'F1'; }).map(function (s) { return { start: s.start, end: s.end }; });
  // F1-add/F2 original zero-width contribute nothing.
  const candExciseSpans = finalCandSpans.map(function (s) { return { start: s.start, end: s.end }; });
  // For F1-add/F2, candidate excision must remove exactly inserted bytes; verify by comparing remainders.
  // For F1, both sides excise value spans.
  const origRem = excise(origBytes, origExciseSpans.concat(origByteSpans.filter(function (s) { return s.kind !== 'F1'; }).map(function (s) { return { start: s.start, end: s.end }; })));
  const candRem = excise(candBytes, candExciseSpans);
  const origRemHash = shaHex(origRem);
  const candRemHash = shaHex(candRem);
  if (!origRem.equals(candRem)) {
    return refusal('UNRELATED_CONTENT_CHANGED', 'Byte-excision remainder mismatch; unowned bytes changed.', { remainderSha256: origRemHash, candidateRemainderSha256: candRemHash });
  }
  // Build span tables for evidence (byte offsets).
  const origTable = [];
  for (const s of origByteSpans) origTable.push({ route: s.route, kind: s.kind, start: s.start, end: s.end });
  // For F1, origTable already has value spans. For insertions, start==end insertion site.
  const candTable = [];
  for (const s of finalCandSpans) candTable.push({ route: s.route, kind: s.kind, start: s.start, end: s.end });
  return {
    ok: true,
    status: 'READY',
    footprint: clone(footprint),
    desired: clone(desired),
    patchDigest,
    candidateBytes: Buffer.from(candBytes),
    candidateText: candBytes.toString('utf8'),
    candidateDigest,
    originalSpans: origTable,
    candidateSpans: candTable,
    verification: { remainderEqual: true, remainderSha256: origRemHash, candidateRemainderSha256: candRemHash, sixArraysEqual: true, originalRemainderBytes: origRem.length, candidateRemainderBytes: candRem.length },
    warnings: clone(warnings),
    target: targetInput ? clone(targetInput) : undefined,
  };
}