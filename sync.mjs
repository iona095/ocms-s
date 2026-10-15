// OpenCode Model Sync - Simple Script (contract v1.2, task OCMS-S1.2).
//
// One small Node.js script that manually synchronizes the OpenCode Go and Zen
// model definitions in DSH settings.yaml:
//
//   Go roster + Zen roster + models.opencode.ai/api.json + Go/Zen docs tables
//   -> classify every live model (resolved, safely preserved/skipped, or blocking)
//   -> build complete desired managed arrays -> read settings.yaml
//   -> preserve compat / narrow unresolved state -> replace six model arrays
//   -> validate -> backup -> write settings.yaml
//
// Importing this module must NOT execute synchronization automatically so its
// normalization functions can be tested. Only the main-module guard at the
// bottom of this file performs a live run.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual as deepEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml, stringify as stringifyYaml, parseDocument, isMap as isYamlMap } from 'yaml';
import { parse as parseHtml } from 'node-html-parser';

// ---------------------------------------------------------------------------
// Sources (contract section 2). Fetched on every run.
// ---------------------------------------------------------------------------

export const SOURCE_URLS = {
  goRoster: 'https://opencode.ai/zen/go/v1/models',
  zenRoster: 'https://opencode.ai/zen/v1/models',
  catalog: 'https://models.opencode.ai/api.json',
  goDocs: 'https://opencode.ai/v2/docs/console/go/',
  zenDocs: 'https://opencode.ai/v2/docs/console/models/',
};

export const FETCH_TIMEOUT_MS = 20000;

// ---------------------------------------------------------------------------
// Gateway bases (contract v1.4.6-rc1 R1/R2).
//
// One canonical base per gateway; every managed route URL is derived from it
// (anthropic-messages -> <base>, every other managed API -> <base>/v1).
// DOC_ENDPOINT_BASES lists the documented endpoint path bases recognized per
// gateway: canonical first, documented aliases after. Aliases affect docs
// recognition only and are never written to settings (I-ALIAS-INERT). The
// lists are closed and disjoint across gateways (I-DISJOINT).
// ---------------------------------------------------------------------------

export const GATEWAY_BASE = Object.freeze({
  go: 'https://opencode.ai/zen/go',
  zen: 'https://opencode.ai/zen',
});

export function routeBaseURL(gateway, api) {
  return api === 'anthropic-messages' ? GATEWAY_BASE[gateway] : GATEWAY_BASE[gateway] + '/v1';
}

export const DOC_ENDPOINT_BASES = Object.freeze({
  go: Object.freeze(['/zen/go/v1/', '/inference/go/v1/']),
  zen: Object.freeze(['/zen/v1/', '/inference/v1/']),
});

// ---------------------------------------------------------------------------
// Managed routes (contract section 3; baseURLs derived per v1.4.6-rc1 R1).
// ---------------------------------------------------------------------------

export const MANAGED_ROUTES = {
  'opencode-go': {
    gateway: 'go',
    api: 'openai-completions',
    baseURL: routeBaseURL('go', 'openai-completions'),
    apiKeyEnv: 'OPENCODE_GO_API_KEY',
  },
  'opencode-go-messages': {
    gateway: 'go',
    api: 'anthropic-messages',
    baseURL: routeBaseURL('go', 'anthropic-messages'),
    apiKeyEnv: 'OPENCODE_GO_API_KEY',
  },
  'opencode-go-responses': {
    gateway: 'go',
    api: 'openai-responses',
    baseURL: routeBaseURL('go', 'openai-responses'),
    apiKeyEnv: 'OPENCODE_GO_API_KEY',
  },
  'opencode-completions': {
    gateway: 'zen',
    api: 'openai-completions',
    baseURL: routeBaseURL('zen', 'openai-completions'),
    apiKeyEnv: 'OPENCODE_API_KEY',
  },
  'opencode-messages': {
    gateway: 'zen',
    api: 'anthropic-messages',
    baseURL: routeBaseURL('zen', 'anthropic-messages'),
    apiKeyEnv: 'OPENCODE_API_KEY',
  },
  'opencode': {
    gateway: 'zen',
    api: 'openai-responses',
    baseURL: routeBaseURL('zen', 'openai-responses'),
    apiKeyEnv: 'OPENCODE_API_KEY',
  },
};

export const MANAGED_ROUTE_KEYS = Object.keys(MANAGED_ROUTES);

// ---------------------------------------------------------------------------
// Input normalization (contract sections 7-8).
//
// The current DSH model schema accepts only the input modalities we
// explicitly support. OpenCode remains the source of the complete modality
// list (modalities.input); this allowlist is the only compatibility gate.
// See README.md ("Future input modality support") for the extension recipe.
// ---------------------------------------------------------------------------

export const DSH_INPUT_MODALITIES = ['text', 'image'];

// ---------------------------------------------------------------------------
// Reasoning normalization (contract section 9).
// ---------------------------------------------------------------------------

export const SUPPORTED_EFFORTS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

// Recognized nested per-model hints: catalog[gateway].models[id].provider.npm
// only. Gateway-level npm, model names, families and sibling models are never
// consulted. Docs win when docs and provider.npm disagree (docs are checked
// first in resolvePlacement).
export const NPM_HINT_TO_API = {
  '@ai-sdk/openai-compatible': 'openai-completions',
  '@ai-sdk/anthropic': 'anthropic-messages',
  '@ai-sdk/openai': 'openai-responses',
  '@ai-sdk/google': 'unsupported-google',
};

function unresolved(message) {
  return new Error(message);
}

// ---------------------------------------------------------------------------
// Digests (v1.3 Stage 1 shared engine seam). Node built-ins only.
// ---------------------------------------------------------------------------

// SHA-256 over exact input bytes (Buffer/string). Used for the settings
// digest (exact original file bytes, never parsed or re-serialized YAML) and
// for the canonical source snapshot serialization.
function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// Deterministic canonical JSON: object own enumerable keys sorted
// lexicographically (inherited properties excluded), array order preserved,
// primitive values preserved. Equivalent insertion orders therefore produce
// identical text, while array reordering changes it.
function canonicalJson(value) {
  if (value === undefined || value === null) return 'null';
  const t = typeof value;
  if (t === 'boolean' || t === 'string') return JSON.stringify(value);
  // S8 digest-numerics (same rule as profile/config-reader.mjs): non-finite numbers digest as distinct bare tokens,
  // never as 'null' (null vs .nan digested identically). Bare tokens cannot
  // collide with quoted strings, 'null', or containers.
  if (t === 'number') {
    if (Number.isFinite(value)) return JSON.stringify(value);
    if (Number.isNaN(value)) return 'NaN';
    return value < 0 ? '-Infinity' : 'Infinity';
  }
  if (t === 'bigint') return JSON.stringify(String(value));
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (t !== 'object') return 'null';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
}

// The normalized planning source bundle: exactly the planning-relevant
// value (per-gateway rosters, catalog records, and docs maps). Nothing
// nondeterministic (no timestamps) participates.
function planningSourceBundle(sources) {
  return {
    rosters: {
      go: sources && sources.rosters ? sources.rosters.go : undefined,
      zen: sources && sources.rosters ? sources.rosters.zen : undefined,
    },
    catalog: {
      go: sources && sources.catalog ? sources.catalog.go : undefined,
      zen: sources && sources.catalog ? sources.catalog.zen : undefined,
    },
    docs: {
      go: sources && sources.docs ? sources.docs.go : undefined,
      zen: sources && sources.docs ? sources.docs.zen : undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// Roster / catalog / docs parsing (contract section 2).
// ---------------------------------------------------------------------------

export function parseRoster(bodyText, gateway) {
  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw unresolved('ROSTER_INVALID: ' + gateway + ' roster is not parseable JSON');
  }
  let items = null;
  if (Array.isArray(parsed)) items = parsed;
  else if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.data)) items = parsed.data;
    else if (Array.isArray(parsed.models)) items = parsed.models;
  }
  if (!items) throw unresolved('ROSTER_INVALID: ' + gateway + ' roster has an unexpected shape');
  const ids = items.map((item) => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object' && typeof item.id === 'string') return item.id;
    throw unresolved('ROSTER_INVALID: ' + gateway + ' roster entry without a string id');
  });
  if (ids.length === 0) throw unresolved('ROSTER_INVALID: ' + gateway + ' roster is empty');
  if (ids.some((id) => !id)) throw unresolved('ROSTER_INVALID: ' + gateway + ' roster holds an empty id');
  if (new Set(ids).size !== ids.length) {
    throw unresolved('ROSTER_INVALID: ' + gateway + ' roster holds duplicates');
  }
  return ids;
}

export function parseCatalog(bodyText) {
  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw unresolved('CATALOG_INVALID: catalog is not parseable JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw unresolved('CATALOG_INVALID: catalog has an unexpected shape');
  }
  const out = {};
  for (const [rawKey, gateway] of [['opencode-go', 'go'], ['opencode', 'zen']]) {
    const record = parsed[rawKey];
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw unresolved('CATALOG_INVALID: catalog lacks a valid ' + rawKey + ' map');
    }
    if (!record.models || typeof record.models !== 'object' || Array.isArray(record.models)) {
      throw unresolved('CATALOG_INVALID: catalog lacks a valid ' + rawKey + '.models map');
    }
    if (Object.keys(record.models).length === 0) {
      throw unresolved('CATALOG_INVALID: catalog ' + rawKey + '.models map is empty');
    }
    // Gateway-level npm is preserved for reporting only; it must never drive
    // placement (contract section 4).
    out[gateway] = { npm: record.npm, models: record.models };
  }
  return out;
}

// Map one documented endpoint URL to the managed API it selects.
// Google-style /models/{exact-id} endpoints map to 'unsupported-google'.
// Anything else well-formed but unrecognized is ENDPOINT_UNSUPPORTED;
// malformed URLs are ENDPOINT_INVALID. Identity is by documented URL, never
// by a model-name substring.
export function endpointApi(endpoint, gateway, id) {
  let url;
  try {
    url = new URL(String(endpoint).trim());
  } catch {
    throw unresolved('ENDPOINT_INVALID: ' + gateway + '/' + id);
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'opencode.ai' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw unresolved('ENDPOINT_INVALID: ' + gateway + '/' + id);
  }
  // Contract v1.4.6-rc1 R2: closed per-gateway documented bases; the tail
  // map below is unchanged. No prefix guessing.
  const bases = Object.hasOwn(DOC_ENDPOINT_BASES, gateway) ? DOC_ENDPOINT_BASES[gateway] : [];
  const base = bases.find((candidate) => url.pathname.startsWith(candidate));
  // Contract v1.4.7-rc1 G2: a well-formed documented URL whose base is not in
  // this gateway's closed list fails closed with the base, gateway, model and
  // full URL named. It must never read as ENDPOINT_UNSUPPORTED (which feeds the
  // skip and catalog-hint fallback paths); those stay for unrecognized tails
  // on a KNOWN base below.
  if (base === undefined) throw unresolved('ENDPOINT_BASE_UNKNOWN: ' + gateway + '/' + id + ' ' + String(endpoint).trim());
  const tail = url.pathname.slice(base.length);
  if (tail === 'chat/completions') return 'openai-completions';
  if (tail === 'messages') return 'anthropic-messages';
  if (tail === 'responses') return 'openai-responses';
  if (tail === 'models/' + id) return 'unsupported-google';
  throw unresolved('ENDPOINT_UNSUPPORTED: ' + gateway + '/' + id);
}

export function routeFor(gateway, api) {
  return MANAGED_ROUTE_KEYS.find(
    (route) => MANAGED_ROUTES[route].gateway === gateway && MANAGED_ROUTES[route].api === api,
  );
}

// Contract v1.4.6-rc1 R3: visible, non-blocking report of live roster IDs
// whose exact docs row uses a documented alias base instead of the canonical
// base. Pure; never throws (malformed rows block through the planner path).
export function endpointBaseDrift({ rosters, docs } = {}) {
  const out = [];
  for (const gateway of ['go', 'zen']) {
    const ids = rosters && Array.isArray(rosters[gateway]) ? rosters[gateway] : [];
    const docsMap = docs && isMapping(docs[gateway]) ? docs[gateway] : undefined;
    if (!docsMap) continue;
    const aliases = DOC_ENDPOINT_BASES[gateway].slice(1);
    const counts = new Map();
    for (const id of ids) {
      if (!Object.hasOwn(docsMap, id)) continue;
      let url;
      try {
        url = new URL(String(docsMap[id]).trim());
      } catch {
        continue;
      }
      if (url.protocol !== 'https:' || url.hostname !== 'opencode.ai' || url.port || url.username || url.password || url.search || url.hash) continue;
      const alias = aliases.find((candidate) => url.pathname.startsWith(candidate));
      if (alias === undefined) continue;
      counts.set(alias, (counts.get(alias) || 0) + 1);
    }
    for (const alias of [...counts.keys()].sort()) {
      out.push({
        gateway,
        documentedBase: 'https://opencode.ai' + alias.slice(0, -1),
        routedBase: routeBaseURL(gateway, 'openai-completions'),
        models: counts.get(alias),
      });
    }
  }
  return out;
}

// Parse one gateway docs page: exactly one recognized endpoint table with
// Model ID and Endpoint columns and at least one structurally valid row.
// Endpoint protocol is interpreted later for exact live roster IDs, so
// docs-only rows cannot influence membership or abort placement.
export function parseDocs(html, gateway) {
  const root = parseHtml(String(html));
  const tables = root.querySelectorAll('table');
  const matches = [];
  for (const table of tables) {
    const rows = table.querySelectorAll('tr');
    if (rows.length === 0) continue;
    const headCells = rows[0].querySelectorAll('th,td').map((cell) =>
      cell.text.replace(/\s+/g, ' ').trim(),
    );
    const idIndex = headCells.indexOf('Model ID');
    const endpointIndex = headCells.indexOf('Endpoint');
    if (idIndex < 0 || endpointIndex < 0) continue;
    const map = {};
    for (const row of rows.slice(1)) {
      const cells = row.querySelectorAll('th,td').map((cell) =>
        cell.text.replace(/\s+/g, ' ').trim(),
      );
      const rowId = cells[idIndex];
      const rowEndpoint = cells[endpointIndex];
      if (!rowId || !rowEndpoint || Object.hasOwn(map, rowId)) {
        throw unresolved('DOCS_INVALID: ' + gateway + ' has a malformed endpoint row');
      }
      // Endpoint protocol is interpreted only for live roster IDs. A docs-only
      // row is intentionally inert under the roster-authoritative contract.
      Object.defineProperty(map, rowId, {
        value: rowEndpoint,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    if (Object.keys(map).length === 0) throw unresolved('DOCS_INVALID: ' + gateway + ' endpoint table is empty');
    matches.push(map);
  }
  if (matches.length !== 1) throw unresolved('DOCS_INVALID: ' + gateway + ' must have exactly one endpoint table');
  return matches[0];
}

// ---------------------------------------------------------------------------
// Model metadata (contract sections 6-9).
// ---------------------------------------------------------------------------

// OpenCode modalities.input -> DSH input: keep values present in
// DSH_INPUT_MODALITIES, preserving OpenCode order. Returns the filtered list,
// or null when no supported modality remains (caller marks unresolved).
// This filtering does NOT mean OpenCode or the model lacks the dropped
// capability; it only reflects what the current DSH target schema represents.
export function normalizeInput(modalitiesInput) {
  if (!Array.isArray(modalitiesInput) || modalitiesInput.some((x) => typeof x !== 'string')) {
    return null;
  }
  const kept = modalitiesInput.filter((x) => DSH_INPUT_MODALITIES.includes(x));
  if (kept.length === 0) return null;
  return kept;
}

// models.opencode.ai/api.json reasoning metadata -> DSH reasoningEfforts.
// Returns false for reasoning:false, an effort map for reasoning with an
// effort option, or undefined when the value must be omitted
// (reasoning:true with no type:"effort" option). Throws (unresolved) on
// malformed options, duplicate effort entries, or unsupported effort values.
export function extractReasoningEfforts(reasoning, reasoningOptions) {
  if (reasoning === false) return false;

  let list;
  if (reasoningOptions === undefined || reasoningOptions === null) list = [];
  else if (Array.isArray(reasoningOptions)) list = reasoningOptions;
  else if (reasoningOptions && typeof reasoningOptions === 'object') list = [reasoningOptions];
  else throw unresolved('EFFORT_SOURCE_CONFLICT: reasoning_options has an unexpected shape');
  for (const entry of list) {
    if (!entry || typeof entry !== 'object' || typeof entry.type !== 'string') {
      throw unresolved('EFFORT_SOURCE_CONFLICT: malformed reasoning_options entry');
    }
  }
  const efforts = list.filter((x) => x.type === 'effort');
  if (efforts.length === 0) return undefined;
  if (efforts.length > 1) throw unresolved('EFFORT_SOURCE_CONFLICT: multiple effort options');
  const values = efforts[0].values;
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.some((x) => typeof x !== 'string') ||
    new Set(values).size !== values.length
  ) {
    throw unresolved('EFFORT_SOURCE_CONFLICT: malformed effort values');
  }
  const map = {};
  for (const value of values) {
    const key = value === 'none' ? 'off' : value;
    if (!SUPPORTED_EFFORTS.includes(key)) {
      throw unresolved('EFFORT_NOT_PROJECTABLE: unsupported effort ' + value);
    }
    if (Object.hasOwn(map, key)) {
      throw unresolved('EFFORT_NOT_PROJECTABLE: duplicate projected effort key ' + key);
    }
    map[key] = value;
  }
  // toggle and budget_tokens entries are ignored (never projected, never
  // thinkingBudgets). Do not invent effort levels.
  return map;
}

// Build the DSH model record for one roster model from its exact matching
// catalog record (Go -> opencode-go.models[id], Zen -> opencode.models[id]).
// Throws (unresolved) when the record is missing or any required metadata
// must be invented: name, limits, input modalities, or reasoning efforts.
export function buildModelRecord(gateway, id, catalogRecord) {
  if (!catalogRecord || typeof catalogRecord !== 'object' || Array.isArray(catalogRecord)) {
    throw unresolved('CATALOG_MISSING: ' + gateway + '/' + id);
  }
  if (catalogRecord.id !== id) {
    throw unresolved('MODEL_INVALID: ' + gateway + '/' + id + ' catalog id does not match roster id');
  }
  const name = catalogRecord.name;
  if (typeof name !== 'string' || !name.trim()) {
    throw unresolved('MODEL_INVALID: ' + gateway + '/' + id + ' lacks a name');
  }
  const contextWindow = catalogRecord.limit ? catalogRecord.limit.context : undefined;
  const maxTokens = catalogRecord.limit ? catalogRecord.limit.output : undefined;
  if (!Number.isSafeInteger(contextWindow) || contextWindow < 1) {
    throw unresolved('MODEL_INVALID: ' + gateway + '/' + id + ' lacks limit.context');
  }
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1) {
    throw unresolved('MODEL_INVALID: ' + gateway + '/' + id + ' lacks limit.output');
  }
  const input = normalizeInput(catalogRecord.modalities ? catalogRecord.modalities.input : undefined);
  if (!input) throw unresolved('INPUT_NOT_PROJECTABLE: ' + gateway + '/' + id);
  let reasoningEfforts;
  try {
    reasoningEfforts = extractReasoningEfforts(catalogRecord.reasoning, catalogRecord.reasoning_options);
  } catch (err) {
    throw unresolved('EFFORT_NOT_PROJECTABLE: ' + gateway + '/' + id + ' (' + err.message + ')');
  }
  const record = {
    id,
    name,
    input,
    contextWindow,
    maxTokens,
  };
  if (reasoningEfforts !== undefined) record.reasoningEfforts = reasoningEfforts;
  return record;
}

// ---------------------------------------------------------------------------
// Placement (contract sections 4-5).
// ---------------------------------------------------------------------------

export function indexPriors(current) {
  const priors = new Map();
  const providers = current && current['llm-pi-ai'] && current['llm-pi-ai'].providers;
  if (!isMapping(providers)) return priors;
  for (const route of MANAGED_ROUTE_KEYS) {
    if (!Object.hasOwn(providers, route)) continue;
    const provider = providers[route];
    if (!isMapping(provider) || !Array.isArray(provider.models)) continue;
    const gateway = MANAGED_ROUTES[route].gateway;
    for (const record of provider.models) {
      if (!record || typeof record.id !== 'string') continue;
      const key = gateway + '/' + record.id;
      let prior = priors.get(key);
      if (!prior) {
        prior = { route, record, records: [], routes: [] };
        priors.set(key, prior);
      }
      prior.records.push({ route, record });
      if (!prior.routes.includes(route)) prior.routes.push(route);
    }
  }
  return priors;
}

function selectCompat(prior, desiredRoute) {
  if (!prior) return undefined;
  const choose = (entries) => {
    const values = entries
      .filter(({ record }) => record && record.compat !== undefined)
      .map(({ record }) => record.compat);
    if (values.length === 0) return undefined;
    const first = values[0];
    if (values.every((value) => deepEqual(value, first))) return structuredClone(first);
    throw unresolved('COMPAT_AMBIGUOUS: conflicting compat for ' + desiredRoute);
  };

  const records = prior.records || [{ route: prior.route, record: prior.record }];
  const desiredRouteCompat = choose(records.filter(({ route }) => route === desiredRoute));
  if (desiredRouteCompat !== undefined) return desiredRouteCompat;
  return choose(records.filter(({ route }) => route !== desiredRoute));
}

// True when any gateway docs map holds a row for this model ID (used by the
// W1 truncation guard: a model still documented anywhere keeps blocking).
function hasDocsRowAnywhere(docs, id) {
  if (!docs || typeof docs !== 'object') return false;
  for (const gateway of ['go', 'zen']) {
    const docsMap = docs[gateway];
    if (docsMap && typeof docsMap === 'object' && Object.hasOwn(docsMap, id)) return true;
  }
  return false;
}

// Decide the managed route for one (gateway, id):
// 1. exact docs row for this model ID (docs win over provider.npm);
// 2. otherwise the exact model catalog hint catalog[gateway].models[id].provider.npm.
// A well-formed but unrecognized docs path is not a usable exact docs row, so
// the nested hint is still consulted; a malformed docs identity stays
// fail-closed. Google-style models (documented /models/{id} or @ai-sdk/google)
// keep their current route when already present, else unresolved. Anything
// else without a resolvable authority is unresolved. No agent lookup, no guessing.
export function resolvePlacement({ gateway, id, docsMap, catalogRecord, priors }) {
  const doc = docsMap && Object.hasOwn(docsMap, id) ? docsMap[id] : undefined;
  if (doc !== undefined) {
    let api;
    try {
      api = endpointApi(doc, gateway, id);
    } catch (err) {
      if (!(err && err.message && err.message.startsWith('ENDPOINT_UNSUPPORTED:'))) throw err;
      api = undefined;
    }
    if (api !== undefined) {
      if (api === 'unsupported-google') {
        const prior = priors ? priors.get(gateway + '/' + id) : undefined;
        if (prior && prior.routes && prior.routes.length === 1) return prior.routes[0];
        if (prior && prior.routes && prior.routes.length > 1) {
          throw unresolved('PLACEMENT_AMBIGUOUS: ' + gateway + '/' + id + ' has multiple existing routes');
        }
        throw unresolved('UNSUPPORTED_NEW_MODEL: ' + gateway + '/' + id);
      }
      const route = routeFor(gateway, api);
      if (!route) throw unresolved('PLACEMENT_UNRESOLVED: ' + gateway + '/' + id);
      return route;
    }
  }
  const hint =
    catalogRecord && isMapping(catalogRecord.provider) && Object.hasOwn(catalogRecord.provider, 'npm') &&
    typeof catalogRecord.provider.npm === 'string'
      ? catalogRecord.provider.npm
      : undefined;
  if (hint === undefined) throw unresolved('PLACEMENT_UNRESOLVED: ' + gateway + '/' + id);
  const mapped = Object.hasOwn(NPM_HINT_TO_API, hint) ? NPM_HINT_TO_API[hint] : undefined;
  if (mapped === undefined) throw unresolved('PLACEMENT_UNRESOLVED: ' + gateway + '/' + id);
  if (mapped === 'unsupported-google') {
    const prior = priors ? priors.get(gateway + '/' + id) : undefined;
    if (prior && prior.routes && prior.routes.length === 1) return prior.routes[0];
    if (prior && prior.routes && prior.routes.length > 1) {
      throw unresolved('PLACEMENT_AMBIGUOUS: ' + gateway + '/' + id + ' has multiple existing routes');
    }
    throw unresolved('UNSUPPORTED_NEW_MODEL: ' + gateway + '/' + id);
  }
  const route = routeFor(gateway, mapped);
  if (!route) throw unresolved('PLACEMENT_UNRESOLVED: ' + gateway + '/' + id);
  return route;
}

// ---------------------------------------------------------------------------
// Protocol support classification (contract v1.4.1 sections 5-6).
//
// One explicit seam shared by planning and placement: determine whether the
// authoritative placement evidence for one (gateway, id) proves a SUPPORTED,
// UNSUPPORTED, or UNRESOLVED protocol BEFORE strict model-record
// construction. Reads only the exact docs string for this model ID and the
// exact nested model-local provider.npm string. Never reads limit.*,
// modalities, reasoning metadata, names, families, siblings, gateway-level
// npm, priors, rosters, or any probe result. Never branches on model-ID
// substrings. Never throws for classification inputs: malformed docs
// identity and absent evidence both report UNRESOLVED so the existing path
// stays fail-closed exactly as in v1.4.
// ---------------------------------------------------------------------------

// APIs selectable by endpointApi that belong to the managed protocol set.
function isManagedApi(api) {
  return api === 'openai-completions' || api === 'anthropic-messages' || api === 'openai-responses';
}

function usableSupportedHint(gateway, catalogRecord) {
  const hint =
    catalogRecord && isMapping(catalogRecord.provider) && Object.hasOwn(catalogRecord.provider, 'npm') &&
    typeof catalogRecord.provider.npm === 'string'
      ? catalogRecord.provider.npm
      : undefined;
  if (hint === undefined || !Object.hasOwn(NPM_HINT_TO_API, hint)) return undefined;
  const mapped = NPM_HINT_TO_API[hint];
  if (!isManagedApi(mapped)) return undefined;
  if (!routeFor(gateway, mapped)) return undefined;
  return mapped;
}

export function classifyProtocolSupport({ gateway, id, docsMap, catalogRecord }) {
  const doc = docsMap && Object.hasOwn(docsMap, id) ? docsMap[id] : undefined;
  if (doc !== undefined) {
    let api;
    try {
      api = endpointApi(doc, gateway, id);
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      if (!message.startsWith('ENDPOINT_UNSUPPORTED:')) {
        return { status: 'UNRESOLVED', reason: message };
      }
      if (usableSupportedHint(gateway, catalogRecord) !== undefined) return { status: 'SUPPORTED' };
      return { status: 'UNSUPPORTED', reason: 'UNSUPPORTED_PROTOCOL', endpoint: doc };
    }
    if (isManagedApi(api)) return { status: 'SUPPORTED', api };
    if (usableSupportedHint(gateway, catalogRecord) !== undefined) return { status: 'SUPPORTED' };
    return { status: 'UNRESOLVED', reason: 'UNSUPPORTED_GOOGLE_STYLE' };
  }
  if (usableSupportedHint(gateway, catalogRecord) !== undefined) return { status: 'SUPPORTED' };
  return { status: 'UNRESOLVED', reason: 'PLACEMENT_UNRESOLVED' };
}

// ---------------------------------------------------------------------------
// Desired-state planning (contract sections 10-11).
// ---------------------------------------------------------------------------

function sortById(records) {
  records.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return records;
}
function compareGatewayId(a, b) {
  if (a.gateway !== b.gateway) return a.gateway < b.gateway ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

// True only when the live model is Google-style by the same authorities
// placement uses: an exact docs row mapping to /models/{id}, or (with no
// usable docs row, including a well-formed but unrecognized docs path) an
// exact nested provider.npm hint of @ai-sdk/google. Never throws; a malformed
// docs identity returns false because resolvePlacement stays fail-closed.
function isGoogleStyleModel({ gateway, id, docsMap, catalogRecord }) {
  const doc = docsMap && Object.hasOwn(docsMap, id) ? docsMap[id] : undefined;
  if (doc !== undefined) {
    let api;
    try {
      api = endpointApi(doc, gateway, id);
    } catch (err) {
      if (!(err && err.message && err.message.startsWith('ENDPOINT_UNSUPPORTED:'))) return false;
      api = undefined;
    }
    if (api !== undefined) return api === 'unsupported-google';
  }
  const hint =
    catalogRecord && isMapping(catalogRecord.provider) && Object.hasOwn(catalogRecord.provider, 'npm') &&
    typeof catalogRecord.provider.npm === 'string'
      ? catalogRecord.provider.npm
      : undefined;
  return hint !== undefined && Object.hasOwn(NPM_HINT_TO_API, hint) && NPM_HINT_TO_API[hint] === 'unsupported-google';
}
// Resolve placement from the exact terminal `-free` counterpart only.
// This helper never consults existing YAML/priors, never recurses, and never
// fuzzes IDs: same gateway, exact counterpart roster membership, counterpart
// docs first else counterpart nested hint, supported non-Google route only.
// Returns { counterpartId, route } or undefined when the fallback fails.
export function resolveFreeCounterpartRoute({ gateway, id, rosters, catalog, docs }) {
  if (typeof id !== 'string' || !id.endsWith('-free')) return undefined;
  const counterpartId = id.slice(0, -'-free'.length);
  if (!counterpartId || counterpartId.endsWith('-free')) return undefined;
  const rosterIds = rosters && Array.isArray(rosters[gateway]) ? rosters[gateway] : [];
  if (!rosterIds.includes(counterpartId)) return undefined;
  const docsMap = docs ? docs[gateway] : undefined;
  const doc = docsMap && Object.hasOwn(docsMap, counterpartId) ? docsMap[counterpartId] : undefined;
  if (doc !== undefined) {
    let api;
    try {
      api = endpointApi(doc, gateway, counterpartId);
    } catch (err) {
      if (err && err.message && err.message.startsWith('ENDPOINT_UNSUPPORTED:')) {
        api = undefined;
      } else {
        return undefined;
      }
    }
    if (api !== undefined) {
      if (api === 'unsupported-google') return undefined;
      const route = routeFor(gateway, api);
      if (!route) return undefined;
      return { counterpartId, route };
    }
  }
  const counterpartRecord =
    catalog && catalog[gateway] && isMapping(catalog[gateway].models) && Object.hasOwn(catalog[gateway].models, counterpartId)
      ? catalog[gateway].models[counterpartId]
      : undefined;
  const hint =
    counterpartRecord && isMapping(counterpartRecord.provider) && Object.hasOwn(counterpartRecord.provider, 'npm') &&
    typeof counterpartRecord.provider.npm === 'string'
      ? counterpartRecord.provider.npm
      : undefined;
  if (hint === undefined || !Object.hasOwn(NPM_HINT_TO_API, hint)) return undefined;
  const mapped = NPM_HINT_TO_API[hint];
  if (mapped === 'unsupported-google') return undefined;
  const route = routeFor(gateway, mapped);
  if (!route) return undefined;
  return { counterpartId, route };
}

// Build all six desired arrays from the current sources under contract v1.2.
// Returns { ok:true, desired, priors, dispositions } or
// { ok:false, unresolved, desired:null, priors, dispositions: [] }.
// Every live roster ID finishes with exactly one non-blocking disposition
// (RESOLVED, PRESERVED_UNRESOLVED, SKIPPED_UNRESOLVED,
// SKIPPED_UNSUPPORTED_PROTOCOL) unless a blocking
// ambiguity/conflict stops planning. compat (local DSH/provider
// configuration, never catalog metadata) is copied unchanged from the
// existing record indexed by gateway + model ID, and moves with the model
// when docs move it between routes in the same gateway. All other rebuilt
// model metadata is replaced by the newly generated metadata; an opaque
// CATALOG_MISSING preservation keeps its sole existing record unchanged.
export function planDesired({ rosters, catalog, docs, current, allSourcesOk = true }) {
  const priors = indexPriors(current);
  const desired = {};
  for (const route of MANAGED_ROUTE_KEYS) desired[route] = [];
  const dispositions = [];
  const blocking = [];
  for (const gateway of ['go', 'zen']) {
    const ids = (rosters && rosters[gateway]) || [];
    for (const id of ids) {
      const key = gateway + '/' + id;
      const catalogRecord =
        catalog && catalog[gateway] && isMapping(catalog[gateway].models) && Object.hasOwn(catalog[gateway].models, id)
          ? catalog[gateway].models[id]
          : undefined;
      if (catalogRecord === undefined) {
        // Contract v1.4.1 rule U4: exact docs proving an unsupported protocol
        // establish the skip even without a catalog record (no hint exists to
        // consult). Anything else keeps existing CATALOG_MISSING handling.
        const unsupportedVerdict = classifyProtocolSupport({
          gateway,
          id,
          docsMap: docs ? docs[gateway] : undefined,
          catalogRecord: undefined,
        });
        if (unsupportedVerdict.status === 'UNSUPPORTED') {
          dispositions.push({
            gateway,
            id,
            disposition: 'SKIPPED_UNSUPPORTED_PROTOCOL',
            reason: 'UNSUPPORTED_PROTOCOL',
            endpoint: unsupportedVerdict.endpoint,
          });
          continue;
        }
        const prior = priors.get(key);
        const records = prior && prior.records ? prior.records : [];
        if (records.length === 1) {
          const existing = records[0];
          desired[existing.route].push(structuredClone(existing.record));
          dispositions.push({ gateway, id, disposition: 'PRESERVED_UNRESOLVED', reason: 'CATALOG_MISSING', route: existing.route });
        } else if (records.length === 0) {
          dispositions.push({ gateway, id, disposition: 'SKIPPED_UNRESOLVED', reason: 'CATALOG_MISSING' });
        } else {
          blocking.push({ gateway, id, reason: 'CATALOG_AMBIGUOUS: ' + key + ' has multiple existing records' });
        }
        continue;
      }
      // Contract v1.4.1 §6 step 3: protocol support is determined before
      // strict model-record construction. An explicitly unsupported protocol
      // skips without building a record, placing, or consulting counterparts
      // or priors. Anything else follows the existing path unchanged.
      const protocolVerdict = classifyProtocolSupport({
        gateway,
        id,
        docsMap: docs ? docs[gateway] : undefined,
        catalogRecord,
      });
      if (protocolVerdict.status === 'UNSUPPORTED') {
        dispositions.push({
          gateway,
          id,
          disposition: 'SKIPPED_UNSUPPORTED_PROTOCOL',
          reason: 'UNSUPPORTED_PROTOCOL',
          endpoint: protocolVerdict.endpoint,
        });
        continue;
      }
      let record;
      try {
        record = buildModelRecord(gateway, id, catalogRecord);
      } catch (err) {
        blocking.push({ gateway, id, reason: err.message });
        continue;
      }
      let route;
      try {
        route = resolvePlacement({
          gateway,
          id,
          docsMap: docs ? docs[gateway] : undefined,
          catalogRecord,
          priors,
        });
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        if (message.startsWith('PLACEMENT_UNRESOLVED:')) {
          const fallback = resolveFreeCounterpartRoute({ gateway, id, rosters, catalog, docs });
          if (fallback) {
            let compat;
            try {
              compat = selectCompat(priors.get(key), fallback.route);
            } catch (compatErr) {
              blocking.push({ gateway, id, reason: compatErr.message });
              continue;
            }
            if (compat !== undefined) record.compat = compat;
            desired[fallback.route].push(record);
            dispositions.push({ gateway, id, disposition: 'RESOLVED', reason: null, route: fallback.route, provenance: 'FREE_COUNTERPART_FALLBACK', counterpart: fallback.counterpartId });
            continue;
          }
          const prior = priors.get(key);
          const routes = prior && prior.routes ? prior.routes : [];
          if (routes.length === 1) {
            const finalRoute = routes[0];
            let compat;
            try {
              compat = selectCompat(prior, finalRoute);
            } catch (compatErr) {
              blocking.push({ gateway, id, reason: compatErr.message });
              continue;
            }
            if (compat !== undefined) record.compat = compat;
            desired[finalRoute].push(record);
            dispositions.push({ gateway, id, disposition: 'PRESERVED_UNRESOLVED', reason: 'PLACEMENT_UNRESOLVED', route: finalRoute });
          } else if (routes.length === 0) {
            dispositions.push({ gateway, id, disposition: 'SKIPPED_UNRESOLVED', reason: 'PLACEMENT_UNRESOLVED' });
          } else if (allSourcesOk !== false && !hasDocsRowAnywhere(docs, id)) {
            const copies = prior && Array.isArray(prior.records) ? prior.records : [];
            for (const entry of copies) {
              if (!entry || typeof entry.route !== 'string') continue;
              dispositions.push({ gateway, id, disposition: 'SKIPPED_UNRESOLVED', reason: 'DOCS_WITHDRAWN', route: entry.route });
            }
          } else {
            blocking.push({ gateway, id, reason: 'PLACEMENT_AMBIGUOUS: ' + key + ' has multiple existing routes' });
          }
          continue;
        }
        if (message.startsWith('UNSUPPORTED_NEW_MODEL:')) {
          dispositions.push({ gateway, id, disposition: 'SKIPPED_UNRESOLVED', reason: 'UNSUPPORTED_GOOGLE_STYLE' });
          continue;
        }
        blocking.push({ gateway, id, reason: message });
        continue;
      }
      let compat;
      try {
        compat = selectCompat(priors.get(key), route);
      } catch (err) {
        blocking.push({ gateway, id, reason: err.message });
        continue;
      }
      if (compat !== undefined) record.compat = compat;
      desired[route].push(record);
      if (isGoogleStyleModel({ gateway, id, docsMap: docs ? docs[gateway] : undefined, catalogRecord })) {
        dispositions.push({ gateway, id, disposition: 'PRESERVED_UNRESOLVED', reason: 'UNSUPPORTED_GOOGLE_STYLE', route });
      } else {
        dispositions.push({ gateway, id, disposition: 'RESOLVED', reason: null, route });
      }
    }
  }
  if (blocking.length > 0) {
    return { ok: false, unresolved: [...blocking].sort(compareGatewayId), desired: null, priors, dispositions: [] };
  }
  for (const route of MANAGED_ROUTE_KEYS) sortById(desired[route]);
  dispositions.sort(compareGatewayId);
  return { ok: true, unresolved: [], desired, priors, dispositions };
}

// Every non-skipped live roster model must appear exactly once inside its Go
// or Zen managed routes. Models absent from the roster disappear automatically
// (they are simply absent from the desired arrays); SKIPPED_UNRESOLVED live
// IDs must occur zero times. `skipped` is an optional {go:[...],zen:[...]} map.
export function checkMembership(desired, rosters, skipped) {
  for (const gateway of ['go', 'zen']) {
    const skippedIds = skipped && Array.isArray(skipped[gateway]) ? skipped[gateway] : [];
    const ids = [];
    for (const route of MANAGED_ROUTE_KEYS) {
      if (MANAGED_ROUTES[route].gateway !== gateway) continue;
      for (const record of desired[route] || []) ids.push(record.id);
    }
    const rosterIds = [...(rosters[gateway] || [])].filter((id) => !skippedIds.includes(id)).sort();
    const desiredIds = [...ids].sort();
    if (new Set(ids).size !== ids.length) {
      throw unresolved('MEMBERSHIP_MISMATCH: duplicate model in ' + gateway);
    }
    if (!deepEqual(desiredIds, rosterIds)) {
      throw unresolved('MEMBERSHIP_MISMATCH: desired membership differs from the ' + gateway + ' roster');
    }
  }
}

function ownedOf(record) {
  return {
    id: record.id,
    input: record.input,
    name: record.name,
    contextWindow: record.contextWindow,
    maxTokens: record.maxTokens,
    reasoningEfforts: record.reasoningEfforts,
  };
}

function isMapping(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Existing provider containers and managed routes are part of the local DSH
// configuration. Only an absent container/route may be created; malformed
// existing structures must fail closed rather than being discarded.
function validateExistingProviderShapes(current) {
  if (Object.hasOwn(current, 'llm-pi-ai') && !isMapping(current['llm-pi-ai'])) {
    throw unresolved('SETTINGS_INVALID: llm-pi-ai must be a mapping');
  }
  const llm = current['llm-pi-ai'];
  if (!llm || !Object.hasOwn(llm, 'providers')) return;
  if (!isMapping(llm.providers)) {
    throw unresolved('SETTINGS_INVALID: llm-pi-ai.providers must be a mapping');
  }
  const providers = llm.providers;
  for (const route of MANAGED_ROUTE_KEYS) {
    if (!Object.hasOwn(providers, route)) continue;
    const provider = providers[route];
    if (!isMapping(provider)) {
      throw unresolved('SETTINGS_INVALID: managed route ' + route + ' must be a mapping');
    }
    if (Object.hasOwn(provider, 'models') && !Array.isArray(provider.models)) {
      throw unresolved('SETTINGS_INVALID: managed route ' + route + '.models must be an array');
    }
  }
}

function currentModelsArray(current, route) {
  const providers = current && current['llm-pi-ai'] && current['llm-pi-ai'].providers;
  if (!isMapping(providers) || !Object.hasOwn(providers, route)) return [];
  const provider = providers[route];
  if (!isMapping(provider) || !Array.isArray(provider.models)) return [];
  return provider.models;
}

function hasCurrentModelsArray(current, route) {
  const providers = current && current['llm-pi-ai'] && current['llm-pi-ai'].providers;
  if (!isMapping(providers) || !Object.hasOwn(providers, route)) return false;
  const provider = providers[route];
  return isMapping(provider) && Object.hasOwn(provider, 'models') && Array.isArray(provider.models);
}

// The reduced report diff is intentionally not the write authority. A write
// is unnecessary only when every actual managed models array is exactly equal
// to its generated desired array, including order, multiplicity, and fields.
function managedArraysMatch(current, desired) {
  for (const route of MANAGED_ROUTE_KEYS) {
    // A route absent from the current document is equivalent to an empty
    // desired array because §5 only requires creating missing routes that
    // receive models. An existing route without a models array is malformed
    // as a managed array and must be normalized to models: [].
    if (!hasCurrentModelsArray(current, route)) {
      const providers = current && current['llm-pi-ai'] && current['llm-pi-ai'].providers;
      const routeExists = isMapping(providers) && Object.hasOwn(providers, route);
      if (!routeExists && (desired[route] || []).length === 0) continue;
      return false;
    }
    if (!deepEqual(currentModelsArray(current, route), desired[route] || [])) return false;
  }
  return true;
}

function assertGeneratedManagedArrays(config, desired) {
  for (const route of MANAGED_ROUTE_KEYS) {
    const actual = currentModelsArray(config, route);
    if (!deepEqual(actual, desired[route] || [])) {
      throw unresolved('GENERATED_MEMBERSHIP_MISMATCH: ' + route);
    }
  }
}

function notWritten(unresolved) {
  return {
    result: 'NOT WRITTEN',
    added: [],
    removed: [],
    moved: [],
    metadataChanged: [],
    unresolved,
  };
}

function validateRosterBundle(rosters) {
  if (!isMapping(rosters)) throw unresolved('SOURCE_INVALID: rosters must be a mapping');
  for (const gateway of ['go', 'zen']) {
    if (!Object.hasOwn(rosters, gateway) || !Array.isArray(rosters[gateway]) || rosters[gateway].length === 0) {
      throw unresolved('SOURCE_INVALID: ' + gateway + ' roster is missing or empty');
    }
    const ids = rosters[gateway];
    if (ids.some((id) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) {
      throw unresolved('SOURCE_INVALID: ' + gateway + ' roster is malformed');
    }
  }
}

function validateSourceBundle(sources) {
  if (!isMapping(sources)) throw unresolved('SOURCE_INVALID: source bundle must be a mapping');
  validateRosterBundle(sources.rosters);
  if (!isMapping(sources.catalog)) throw unresolved('SOURCE_INVALID: catalog is missing');
  for (const gateway of ['go', 'zen']) {
    if (
      !Object.hasOwn(sources.catalog, gateway) ||
      !isMapping(sources.catalog[gateway]) ||
      !isMapping(sources.catalog[gateway].models) ||
      Object.keys(sources.catalog[gateway].models).length === 0
    ) {
      throw unresolved('SOURCE_INVALID: catalog ' + gateway + '.models is missing or empty');
    }
  }
  if (!isMapping(sources.docs)) throw unresolved('SOURCE_INVALID: docs are missing');
  for (const gateway of ['go', 'zen']) {
    if (!Object.hasOwn(sources.docs, gateway) || !isMapping(sources.docs[gateway])) {
      throw unresolved('SOURCE_INVALID: docs ' + gateway + ' map is missing');
    }
  }
}

// Attach withdrawn-docs reasons to removed rows from per-copy dispositions.
// Report-only join: rows without a matching disposition keep their shape.
function attachWithdrawnReasons(changes, dispositions) {
  if (!changes || !Array.isArray(changes.removed) || !Array.isArray(dispositions)) return changes;
  const reasonOf = new Map();
  for (const entry of dispositions) {
    if (entry && entry.reason === 'DOCS_WITHDRAWN' && typeof entry.route === 'string') {
      reasonOf.set(entry.gateway + '/' + entry.id + ' ' + entry.route, entry.reason);
    }
  }
  for (const row of changes.removed) {
    if (row && row.reason === undefined) {
      const found = reasonOf.get(row.key + ' ' + row.route);
      if (found !== undefined) row.reason = found;
    }
  }
  return changes;
}

// Diff the desired plan against current priors for the section 13 report.
export function diffDesired(desired, priors) {
  const desiredIndex = new Map();
  for (const route of MANAGED_ROUTE_KEYS) {
    for (const record of desired[route] || []) {
      desiredIndex.set(MANAGED_ROUTES[route].gateway + '/' + record.id, { route, record });
    }
  }
  const added = [];
  const removed = [];
  const moved = [];
  const metadataChanged = [];
  // Contract v1.4.7-rc2 Amendment B B1: report per (gateway/id, route) copy
  // using prior.records, not only prior.route. Every stored copy not kept at
  // its route is listed in removed; moved stays for a model whose only stored
  // copy changes route. Desired arrays are untouched: report-only.
  const copiesOf = (prior) => {
    if (prior && Array.isArray(prior.records)) return prior.records;
    if (prior && typeof prior.route === 'string') return [{ route: prior.route }];
    return [];
  };
  for (const [key, value] of desiredIndex) {
    const prior = priors.get(key);
    if (!prior) {
      added.push({ key, route: value.route });
      continue;
    }
    const copies = copiesOf(prior);
    const keptHere = copies.some((entry) => entry && entry.route === value.route);
    if (!keptHere) {
      if (copies.length === 1) {
        const from = copies[0].route;
        if (from !== value.route) moved.push({ key, from, to: value.route });
      } else {
        added.push({ key, route: value.route });
      }
    }
    if (!deepEqual(ownedOf(prior.record), ownedOf(value.record))) {
      metadataChanged.push({ key, route: value.route });
    }
  }
  for (const [key, prior] of priors) {
    const copies = copiesOf(prior);
    const wanted = desiredIndex.get(key);
    for (const entry of copies) {
      if (!entry || typeof entry.route !== 'string') continue;
      if (wanted && wanted.route === entry.route) continue;
      if (wanted && copies.length === 1) continue;
      removed.push({ key, route: entry.route });
    }
  }
  const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : (a.route < b.route ? -1 : a.route > b.route ? 1 : 0));
  added.sort(byKey);
  removed.sort(byKey);
  moved.sort(byKey);
  metadataChanged.sort(byKey);
  return { added, removed, moved, metadataChanged };
}

// ---------------------------------------------------------------------------
// YAML config (contract section 12).
// ---------------------------------------------------------------------------

export function defaultSettingsPath() {
  // P1: never fall back to a literal machine path. USERPROFILE is the
  // Windows anchor, DSH_HOME the cross-platform one; ambient HOME is
  // deliberately ignored so a stray HOME cannot redirect the target.
  // With neither anchor the run refuses with a typed error rather than
  // guessing a target that belongs to no account on this machine.
  const userProfile = process.env.USERPROFILE;
  if (userProfile) return path.join(userProfile, '.dsh', 'settings.yaml');
  // DSH_HOME is already the DSH home directory (the '.dsh' folder itself),
  // so the settings file sits directly inside it.
  const dshHome = process.env.DSH_HOME;
  if (dshHome) return path.join(dshHome, 'settings.yaml');
  throw unresolved('SETTINGS_UNRESOLVABLE: no USERPROFILE and no DSH_HOME; refusing to guess a settings path');
}

export function resolveSettingsPath(argv = process.argv) {
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--settings=')) return arg.slice('--settings='.length);
  }
  return defaultSettingsPath();
}

// S5 profile CLI (additive). See ticket S5 scope.
export function parseProfileCliArgs(argv = []) {
  const flags = Array.isArray(argv) ? argv : [];
  let profile;
  let profileCount = 0;
  let liveStateRaw;
  let liveCount = 0;
  let scratch = false;
  let scratchCount = 0;
  let settings;
  let settingsCount = 0;
  for (let i = 0; i < flags.length; i++) {
    const arg = flags[i];
    if (arg === "--profile") {
      profileCount += 1;
      if (profileCount > 1) throw new Error("DUPLICATE_PROFILE");
      const next = flags[i + 1];
      if (next === undefined || (typeof next === "string" && next.startsWith("--"))) throw new Error("INVALID_PROFILE");
      if (typeof next !== "string" || next.length === 0) throw new Error("INVALID_PROFILE");
      profile = next;
      i += 1;
      continue;
    }
    if (typeof arg === "string" && arg.indexOf("--profile=") === 0) {
      profileCount += 1;
      if (profileCount > 1) throw new Error("DUPLICATE_PROFILE");
      const raw = arg.slice(10);
      if (!raw) throw new Error("INVALID_PROFILE");
      profile = raw;
      continue;
    }
    if (typeof arg === "string" && arg.indexOf("--profile") === 0) throw new Error("INVALID_PROFILE");
    if (arg === "--live-state") {
      liveCount += 1;
      if (liveCount > 1) throw new Error("DUPLICATE_LIVE_STATE");
      const next = flags[i + 1];
      if (next === undefined || (typeof next === "string" && next.startsWith("--"))) throw new Error("INVALID_LIVE_STATE");
      if (typeof next !== "string" || next.length === 0) throw new Error("INVALID_LIVE_STATE");
      liveStateRaw = next;
      i += 1;
      continue;
    }
    if (typeof arg === "string" && arg.indexOf("--live-state=") === 0) {
      liveCount += 1;
      if (liveCount > 1) throw new Error("DUPLICATE_LIVE_STATE");
      const raw = arg.slice(13);
      if (!raw) throw new Error("INVALID_LIVE_STATE");
      liveStateRaw = raw;
      continue;
    }
    if (typeof arg === "string" && arg.indexOf("--live-state") === 0) throw new Error("INVALID_LIVE_STATE");
    if (arg === "--scratch") {
      scratchCount += 1;
      if (scratchCount > 1) throw new Error("DUPLICATE_SCRATCH");
      scratch = true;
      continue;
    }
    if (typeof arg === "string" && arg.indexOf("--scratch") === 0) throw new Error("INVALID_SCRATCH");
    if (arg === "--settings") {
      settingsCount += 1;
      if (settingsCount > 1) throw new Error("DUPLICATE_SETTINGS");
      const next = flags[i + 1];
      if (next === undefined || (typeof next === "string" && next.startsWith("--"))) throw new Error("INVALID_SETTINGS");
      if (typeof next !== "string" || next.length === 0) throw new Error("INVALID_SETTINGS");
      settings = next;
      i += 1;
      continue;
    }
    if (typeof arg === "string" && arg.indexOf("--settings=") === 0) {
      settingsCount += 1;
      if (settingsCount > 1) throw new Error("DUPLICATE_SETTINGS");
      const raw = arg.slice(11);
      if (!raw) throw new Error("INVALID_SETTINGS");
      settings = raw;
      continue;
    }
    if (typeof arg === "string" && arg.indexOf("--settings") === 0) throw new Error("INVALID_SETTINGS");
    if (arg === "--help" || arg === "-h") return { help: true, profile: undefined, liveStateRaw: undefined, scratch: false, settings: undefined };
    throw new Error("UNKNOWN_FLAG: " + String(arg));
  }
  if (profile === undefined) throw new Error("PROFILE_REQUIRED");
  return { profile, liveStateRaw, scratch, settings };
}
export function formatProfileCliHelp() {
  return "Usage: node sync.mjs --profile <name> [--live-state=<not-running|overlays:<paths>>] [--scratch] [--settings=<path>]";
}

// S5-R2 B1 — explicitly selected target handling (no default-settings writes).
// The legacy pure planning/placement functions below are untouched; only the
// executable dispatch is replaced. Profile flows fetch once, Preview once,
// then commit the retained plan after an explicit affirmative confirmation
// (never replan/refetch at Apply, never legacy commitPlan for profiles).
export function defaultDshHomeDir() {
  if (process.env.DSH_HOME) return process.env.DSH_HOME;
  return path.join(os.homedir(), ".dsh");
}
export function classifySettingsPath(settingsPath, dshHome) {
  const homeInput = dshHome !== undefined && dshHome !== null ? String(dshHome) : defaultDshHomeDir();
  let fileReal = null;
  let homeReal = null;
  try {
    fileReal = fs.realpathSync(path.resolve(String(settingsPath)));
  } catch {
    return "UNREADABLE";
  }
  try {
    homeReal = fs.realpathSync(path.resolve(homeInput));
  } catch {
    return "UNREADABLE";
  }
  const norm = (p) => (process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));
  const rel = path.relative(norm(homeReal), norm(fileReal));
  if (rel !== "" && rel !== "." && rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel)) return "PRODUCTION";
  return "SCRATCH";
}
// S5-R4 B2 — narrow canonical-target binding for legacy SCRATCH identity.
// Binds the canonical real path plus the real DSH home at Preview; Apply
// re-resolves and requires both identity and SCRATCH to be unchanged before
// commitPlan. No general filesystem framework; planning semantics untouched.
export function resolveLegacyBinding(settingsPath, dshHome) {
  const homeInput = dshHome !== undefined && dshHome !== null ? String(dshHome) : defaultDshHomeDir();
  let canonicalTarget = null;
  let homeReal = null;
  try {
    canonicalTarget = fs.realpathSync(path.resolve(String(settingsPath)));
  } catch {
    return { ok: false, code: 'SETTINGS_UNREADABLE', message: 'The explicit settings path cannot be resolved.' };
  }
  try {
    homeReal = fs.realpathSync(path.resolve(homeInput));
  } catch {
    return { ok: false, code: 'SETTINGS_UNREADABLE', message: 'The DSH home cannot be resolved.' };
  }
  const norm = (p) => (process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));
  let classification;
  try {
    const rel = path.relative(norm(homeReal), norm(canonicalTarget));
    if (rel !== "" && rel !== "." && rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel)) classification = "PRODUCTION";
    else classification = "SCRATCH";
  } catch {
    return { ok: false, code: 'SETTINGS_UNREADABLE', message: 'The explicit settings path cannot be resolved.' };
  }
  return { ok: true, canonicalTarget, homeReal, classification };
}
export function legacyBindingsEqual(a, b) {
  if (!a || !b || typeof a.canonicalTarget !== 'string' || typeof b.canonicalTarget !== 'string' || typeof a.homeReal !== 'string' || typeof b.homeReal !== 'string') return false;
  const norm = (p) => (process.platform === "win32" ? path.resolve(String(p)).toLowerCase() : path.resolve(String(p)));
  try {
    return norm(a.canonicalTarget) === norm(b.canonicalTarget) && norm(a.homeReal) === norm(b.homeReal);
  } catch {
    return false;
  }
}
function formatProfilePreviewText(preview) {
  const lines = [];
  const t = preview.target || {};
  lines.push("profile: " + t.profileName);
  lines.push("classification: " + t.classification);
  lines.push("patch: " + t.patchPathReal);
  lines.push("status: " + preview.status);
  lines.push("storedDigest: " + preview.patchDigest);
  if (preview.effectiveDigest) lines.push("effectiveDigest: " + preview.effectiveDigest);
  if (preview.sourceSnapshotDigest) lines.push("sourceSnapshotDigest: " + preview.sourceSnapshotDigest);
  lines.push("attestation: " + (preview.attestationText || "UNATTESTED"));
  if (preview.plan && preview.plan.changes) {
    const c = preview.plan.changes;
    const n = (k) => (Array.isArray(c[k]) ? c[k].length : 0);
    lines.push("changes: added=" + n("added") + " removed=" + n("removed") + " moved=" + n("moved") + " metadata=" + n("metadataChanged"));
  }
  // Contract v1.4.7-rc2 U4 with Amendment B B2: one per-route current turning
  // into desired line per managed route, read from the stored managed lists
  // (plan.currentRouteCounts). The derivation is removed.
  if (preview.plan && preview.plan.desired && preview.plan.currentRouteCounts) {
    const desired = preview.plan.desired;
    const stored = preview.plan.currentRouteCounts;
    for (const route of MANAGED_ROUTE_KEYS) {
      const want = Array.isArray(desired[route]) ? desired[route].length : 0;
      const got = Number(stored[route]);
      lines.push(route + ": current " + (Number.isFinite(got) ? got : 0) + " -> desired " + want);
    }
  }
  return lines.join("\n");
}
// C02: a missing interactive terminal must be visible, not a silent decline.
function noteNonInteractiveDecline() {
  try {
    process.stderr.write('ocms-s: confirmation requires an interactive terminal (stdin is not a TTY); refusing without writing.' + String.fromCharCode(10));
  } catch { /* diagnostics are best effort */ }
}

async function defaultConfirmCli(promptText) {
  try {
    if (!process.stdin || process.stdin.isTTY !== true) {
      noteNonInteractiveDecline();
      return false;
    }
    const readline = await import("node:readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // S9: on Ctrl-D/EOF only 'close' fires and the question callback never
    // runs — without this listener the confirm (and the whole sync) hangs
    // forever instead of declining through the verdict path.
    const answer = await new Promise((resolve) => {
      let done = false;
      const doneOnce = (v) => { if (!done) { done = true; resolve(v); } };
      rl.on('close', () => doneOnce(false));
      rl.question(String(promptText || "Apply? [y/N] "), doneOnce);
    });
    try { rl.close(); } catch {}
    return /^(y|yes)$/i.test(String(answer).trim());
  } catch {
    return false;
  }
}
export async function runProfileSync(opts = {}) {
  const src = opts ?? {};
  const profile = src.profile;
  const liveStateRaw = src.liveStateRaw;
  const scratch = src.scratch === true;
  const fetchFn = src.fetchFn;
  const confirmFn = typeof src.confirmFn === "function" ? src.confirmFn : defaultConfirmCli;
  const dshHome = src.dshHome;
  const installAnchorDir = src.installAnchorDir !== undefined ? src.installAnchorDir : null;
  const pathEnv = src.pathEnv !== undefined ? src.pathEnv : (process.env.PATH ?? "");
  const waitMs = src.waitMs !== undefined ? src.waitMs : 15000;
  const say = typeof src.print === "function" ? src.print : (s) => { try { console.log(s); } catch {} };
  if (typeof profile !== "string" || profile.length === 0) {
    return { ok: false, mode: "profile", code: "PROFILE_REQUIRED", message: "Explicit --profile <name> is required." };
  }
  let sources;
  try {
    sources = await fetchSources(fetchFn);
  } catch (err) {
    return { ok: false, mode: "profile", code: "FETCH_FAILED", message: String((err && err.message) || err) };
  }
  const { buildProfilePreview } = await import("./profile/preview-session.mjs");
  const built = await buildProfilePreview({ profileName: profile, dshHome, liveStateRaw, origin: "CLI", scratchMode: scratch, sources, installAnchorDir, pathEnv });
  if (!built || built.ok !== true) {
    return { ok: false, mode: "profile", code: (built && built.code) || "VERIFY_FAILED", message: (built && built.message) || "Preview failed.", detail: built && built.detail };
  }
  const preview = built.preview;
  try { say(formatProfilePreviewText(preview)); } catch {}
  if (preview.status !== "READY" && preview.status !== "NO_CHANGE") {
    return { ok: false, mode: "profile", code: "PREVIEW_NOT_READY", message: "Preview is not ready for Apply." };
  }
  let confirmed = false;
  try {
    const answer = await confirmFn("Apply profile " + JSON.stringify(profile) + "? [y/N] ");
    confirmed = answer === true || (typeof answer === "string" && /^(y|yes)$/i.test(answer.trim()));
  } catch {
    confirmed = false;
  }
  if (!confirmed) {
    return { ok: false, mode: "profile", code: "CONFIRMATION_DECLINED", message: "Apply requires an explicit affirmative confirmation following the displayed Preview; declining refuses with zero writes." };
  }
  const { ProfileAwareCommit } = await import("./profile/commit.mjs");
  const outcome = await ProfileAwareCommit({ plan: preview.plan, waitMs, installAnchorDir, pathEnv });
  if (!outcome || outcome.ok !== true) {
    return { ok: false, mode: "profile", code: (outcome && outcome.code) || "ERROR", message: (outcome && outcome.message) || "Apply failed.", detail: outcome && outcome.detail };
  }
  return { ok: true, mode: "profile", status: outcome.status, liveActivation: outcome.liveActivation, backupPath: outcome.backupPath, newDigest: outcome.newDigest, patchDigest: outcome.patchDigest, target: outcome.target };
}
export async function runSettingsSync(opts = {}) {
  const src = opts ?? {};
  const settingsPath = src.settingsPath;
  const fetchFn = src.fetchFn;
  const confirmFn = typeof src.confirmFn === "function" ? src.confirmFn : defaultConfirmCli;
  const say = typeof src.print === "function" ? src.print : (s) => { try { console.log(s); } catch {} };
  if (typeof settingsPath !== "string" || settingsPath.length === 0) {
    return { ok: false, mode: "legacy-settings", code: "INVALID_SETTINGS", message: "Explicit settings path required." };
  }
  const initialBinding = resolveLegacyBinding(settingsPath, src.dshHome);
  if (!initialBinding.ok) {
    return { ok: false, mode: "legacy-settings", code: "SETTINGS_UNREADABLE", message: "The explicit settings path cannot be resolved." };
  }
  if (initialBinding.classification !== "SCRATCH") {
    return { ok: false, mode: "legacy-settings", code: "PRODUCTION_SETTINGS_REFUSED", message: "Production-classified settings paths refuse; --scratch never reclassifies production." };
  }
  const realTarget = initialBinding.canonicalTarget;
  const cls = initialBinding.classification;
  let sources;
  try { sources = await fetchSources(fetchFn); }
  catch (err) { return { ok: false, mode: "legacy-settings", code: "FETCH_FAILED", message: String((err && err.message) || err) }; }
  const plan = buildPlan({ settingsPath, sources });
  try {
    say("settings: " + realTarget + " (" + cls + ")\nstate: " + plan.state + "\n" + formatReport({
      result: plan.state,
      added: (plan.changes && plan.changes.added) || [],
      removed: (plan.changes && plan.changes.removed) || [],
      moved: (plan.changes && plan.changes.moved) || [],
      metadataChanged: (plan.changes && plan.changes.metadataChanged) || [],
      unresolved: [],
      preservedUnresolved: plan.preservedUnresolved || [],
      skippedUnresolved: plan.skippedUnresolved || [],
      unsupportedSkipped: plan.unsupportedSkipped || [],
      fallbackResolved: plan.fallbackResolved || [],
      endpointBaseDrift: plan.endpointBaseDrift || [],
    }));
  } catch {}
  if (plan.state === "BLOCKED") return { ok: false, mode: "legacy-settings", code: "PREVIEW_BLOCKED", message: "Settings Preview is blocked.", reasons: plan.blockedReasons };
  if (plan.state === "NO_CHANGE") return { ok: true, mode: "legacy-settings", result: "NO_CHANGE", settingsPath, settingsDigest: plan.settingsDigest };
  let confirmed = false;
  try {
    const answer = await confirmFn("Apply settings " + realTarget + "? [y/N] ");
    confirmed = answer === true || (typeof answer === "string" && /^(y|yes)$/i.test(answer.trim()));
  } catch { confirmed = false; }
  if (!confirmed) return { ok: false, mode: "legacy-settings", code: "CONFIRMATION_DECLINED", message: "Apply requires explicit affirmative confirmation; declining refuses with zero writes." };
  const freshBinding = resolveLegacyBinding(settingsPath, src.dshHome);
  if (!freshBinding.ok) {
    return { ok: false, mode: "legacy-settings", code: "SETTINGS_UNREADABLE", message: "The explicit settings path cannot be resolved before commit." };
  }
  if (freshBinding.classification !== "SCRATCH") {
    return { ok: false, mode: "legacy-settings", code: "PRODUCTION_SETTINGS_REFUSED", message: "Production-classified settings paths refuse; --scratch never reclassifies production." };
  }
  if (!legacyBindingsEqual(initialBinding, freshBinding)) {
    return { ok: false, mode: "legacy-settings", code: "SETTINGS_TARGET_CHANGED", message: "Settings target identity changed since Preview; refusing before commit." };
  }
  const outcome = commitPlan(plan);
  if (outcome && outcome.stale === true) {
    const reason = (outcome.unresolved && outcome.unresolved[0] && outcome.unresolved[0].reason) || "STALE_SETTINGS";
    return { ok: false, mode: "legacy-settings", code: "STALE_SETTINGS", message: String(reason) };
  }
  if (!outcome || outcome.result !== "UPDATED") {
    const reason = (outcome && outcome.unresolved && outcome.unresolved[0] && outcome.unresolved[0].reason) || "Commit refused.";
    return { ok: false, mode: "legacy-settings", code: "COMMIT_REFUSED", message: String(reason) };
  }
  return { ok: true, mode: "legacy-settings", result: "UPDATED", settingsPath, report: formatReport(outcome) };
}
export async function dispatchSyncCli(argv = [], deps = {}) {
  const flags = Array.isArray(argv) ? argv : [];
  const d = deps ?? {};
  const hasFlag = (name) => flags.some((a) => a === name || (typeof a === "string" && a.startsWith(name + "=")));
  if (flags.some((a) => a === "--help" || a === "-h")) return { ok: true, mode: "help", help: formatProfileCliHelp() };
  const hasProfile = hasFlag("--profile");
  const hasSettings = flags.some((a) => a === "--settings" || (typeof a === "string" && a.startsWith("--settings=")));
  if (hasProfile && hasSettings) {
    return { ok: false, mode: "refused", code: "CONFLICTING_TARGETS", message: "--profile and --settings cannot be combined; select exactly one target." };
  }
  if (hasProfile) {
    let parsed;
    try {
      parsed = parseProfileCliArgs(flags);
    } catch (err) {
      const text = String((err && err.message) || err);
      const code = text.split(":")[0] || "INVALID_PROFILE_ARGS";
      return { ok: false, mode: "refused", code, message: text };
    }
    if (parsed && parsed.help) return { ok: true, mode: "help", help: formatProfileCliHelp() };
    if (parsed.settings !== undefined) {
      return { ok: false, mode: "refused", code: "CONFLICTING_TARGETS", message: "--profile and --settings cannot be combined; select exactly one target." };
    }
    return runProfileSync({ profile: parsed.profile, liveStateRaw: parsed.liveStateRaw, scratch: parsed.scratch, fetchFn: d.fetchFn, confirmFn: d.confirmFn, dshHome: d.dshHome, installAnchorDir: d.installAnchorDir !== undefined ? d.installAnchorDir : null, pathEnv: d.pathEnv, waitMs: d.waitMs, print: d.print });
  }
  if (hasSettings) {
    // S5-R3 B1: strict flag validation first (before source acquisition or
    // file mutation), then real-path classification before fetching, then a
    // Previewed + displayed + confirmed retained plan. The executable
    // dispatch never uses the unconfirmed runSync write path; runSync
    // itself stays available for its existing explicit library/test uses.
    let value = null;
    let count = 0;
    let scratchCount = 0;
    for (let i = 0; i < flags.length; i++) {
      const a = flags[i];
      if (a === "--settings") {
        count += 1;
        if (count > 1) return { ok: false, mode: "refused", code: "DUPLICATE_SETTINGS", message: "--settings given more than once." };
        const next = flags[i + 1];
        if (next === undefined || (typeof next === "string" && next.startsWith("--")) || typeof next !== "string" || next.length === 0) {
          return { ok: false, mode: "refused", code: "INVALID_SETTINGS", message: "--settings requires a path." };
        }
        value = next;
        i += 1;
      } else if (typeof a === "string" && a.startsWith("--settings=")) {
        count += 1;
        if (count > 1) return { ok: false, mode: "refused", code: "DUPLICATE_SETTINGS", message: "--settings given more than once." };
        value = a.slice("--settings=".length);
        if (!value) return { ok: false, mode: "refused", code: "INVALID_SETTINGS", message: "--settings requires a path." };
      } else if (a === "--scratch") {
        scratchCount += 1;
        if (scratchCount > 1) return { ok: false, mode: "refused", code: "DUPLICATE_SCRATCH", message: "--scratch given more than once." };
      } else if (typeof a === "string" && a.startsWith("--scratch")) {
        return { ok: false, mode: "refused", code: "INVALID_SCRATCH", message: "Malformed --scratch flag." };
      } else if (typeof a === "string" && (a.startsWith("--live-state") || a.startsWith("--profile"))) {
        return { ok: false, mode: "refused", code: "CONFLICTING_TARGETS", message: "Profile flags cannot be combined with --settings; select exactly one target." };
      } else {
        return { ok: false, mode: "refused", code: "UNKNOWN_FLAG", message: "Unknown flag: " + String(a) };
      }
    }
    const cls = classifySettingsPath(value, d.dshHome);
    if (cls === "UNREADABLE") return { ok: false, mode: "refused", code: "SETTINGS_UNREADABLE", message: "The explicit settings path cannot be resolved." };
    if (cls === "PRODUCTION") {
      const scratchAsked = flags.some((a) => a === "--scratch");
      return { ok: false, mode: "refused", code: scratchAsked ? "SCRATCH_MODE_PRODUCTION_REFUSED" : "PRODUCTION_SETTINGS_REFUSED", message: "Production-classified settings paths refuse; --scratch never reclassifies production." };
    }
    return runSettingsSync({ settingsPath: value, fetchFn: d.fetchFn, confirmFn: d.confirmFn, print: d.print, dshHome: d.dshHome });
  }
  for (const a of flags) {
    if (a === "--scratch") continue;
    return { ok: false, mode: "refused", code: "UNKNOWN_FLAG", message: "Unknown flag: " + String(a) };
  }
  return { ok: false, mode: "refused", code: "PROFILE_REQUIRED", message: "Explicit --profile <name> is required; refusing to write default settings." };
}

export function readSettingsFile(settingsPath) {
  const bytes = fs.readFileSync(settingsPath);
  const text = bytes.toString('utf8');
  let config = null;
  try {
    config = parseYaml(text);
  } catch {
    throw unresolved('SETTINGS_INVALID: settings file is not valid YAML');
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw unresolved('SETTINGS_INVALID: settings root must be a mapping');
  }
  return { bytes, config };
}

// Build the new config: replace the six managed models arrays, keep every
// route-level setting outside models untouched, and create a missing managed
// route (displayName/api/baseURL/apiKeyEnv/models) only when it needs models.
export function buildNewConfig(current, desired) {
  const next = structuredClone(current);
  if (!Object.hasOwn(next, 'llm-pi-ai')) next['llm-pi-ai'] = {};
  if (!Object.hasOwn(next['llm-pi-ai'], 'providers')) next['llm-pi-ai'].providers = {};
  const providers = next['llm-pi-ai'].providers;
  for (const route of MANAGED_ROUTE_KEYS) {
    const wanted = desired[route] || [];
    const existing = Object.hasOwn(providers, route) ? providers[route] : undefined;
    if (existing) {
      existing.models = structuredClone(wanted);
    } else if (wanted.length > 0) {
      providers[route] = {
        displayName: route,
        api: MANAGED_ROUTES[route].api,
        baseURL: MANAGED_ROUTES[route].baseURL,
        apiKeyEnv: MANAGED_ROUTES[route].apiKeyEnv,
        models: structuredClone(wanted),
      };
    }
  }
  return next;
}

export function assertYamlRoundTrip(config) {
  const text = stringifyYaml(config);
  parseYaml(text);
  return text;
}

// D05: update only the managed models arrays inside the existing settings
// document instead of re-serializing the whole file. Parsing to a Document
// and editing nodes in place keeps comments, key order, and scalar styles
// of everything the sync does not own; only the replaced models arrays are
// re-emitted. Throws an unresolved SETTINGS_INVALID on unparseable input.
export function surgicalLegacyUpdate(text, desired) {
  let doc = null;
  try {
    doc = parseDocument(String(text));
  } catch {
    throw unresolved('SETTINGS_INVALID: settings file is not valid YAML');
  }
  if (!doc || (doc.errors && doc.errors.length > 0) || !isYamlMap(doc.contents)) {
    throw unresolved('SETTINGS_INVALID: settings root must be a mapping');
  }
  let llm = doc.contents.get('llm-pi-ai', true);
  if (!llm || !isYamlMap(llm)) {
    llm = doc.createNode({});
    doc.contents.set('llm-pi-ai', llm);
  }
  let providers = llm.get('providers', true);
  if (!providers || !isYamlMap(providers)) {
    providers = doc.createNode({});
    llm.set('providers', providers);
  }
  for (const route of MANAGED_ROUTE_KEYS) {
    const wanted = (desired && Array.isArray(desired[route])) ? structuredClone(desired[route]) : [];
    let provider = providers.get(route, true);
    if (!provider || !isYamlMap(provider)) {
      if (wanted.length === 0) continue;
      const def = MANAGED_ROUTES[route] || {};
      provider = doc.createNode({
        displayName: route,
        api: def.api || 'openai-responses',
        baseURL: def.baseURL || 'https://example.com',
        apiKeyEnv: def.apiKeyEnv || 'OPENCODE_API_KEY',
      });
      providers.set(route, provider);
    }
    provider.set('models', doc.createNode(wanted));
  }
  return String(doc.toString());
}

function timestampStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// D04: two commits inside one timestamp tick must never share (and overwrite)
// a backup path. The first free suffixed name wins; the tick stamp stays the
// prefix so existing backup listings keep sorting together.
export function legacyBackupPath(settingsPath, stamp) {
  const base = String(settingsPath) + '.bak-' + String(stamp);
  if (!fs.existsSync(base)) return base;
  let n = 1;
  while (fs.existsSync(base + '-' + n)) n += 1;
  return base + '-' + n;
}

// ---------------------------------------------------------------------------
// Shared PLAN / WRITE engine seam (contract v1.3 Stage 1).
//
// buildPlan performs the complete planning path with zero disk mutation and
// returns an engine-owned PlanResult. commitPlan executes an already-computed
// READY plan against the current target bytes through the existing v1.2
// transaction (stale-check -> backup -> temp -> verify -> rename). There is
// exactly one planning path and one commit path; syncFromSources is now a
// thin orchestrator over the two.
// ---------------------------------------------------------------------------

function refusalOutcome(reasons, stale) {
  return {
    result: 'NOT WRITTEN',
    stale: stale === true,
    added: [],
    removed: [],
    moved: [],
    metadataChanged: [],
    unresolved: reasons,
  };
}

function blockedPlan(settingsPath, blockedReasons, generatedAt) {
  return {
    state: 'BLOCKED',
    changed: false,
    desired: null,
    dispositions: [],
    changes: { added: [], removed: [], moved: [], metadataChanged: [] },
    preservedUnresolved: [],
    skippedUnresolved: [],
    unsupportedSkipped: [],
    fallbackResolved: [],
    endpointBaseDrift: [],
    settingsPath,
    settingsDigest: null,
    sourceSnapshotDigest: null,
    generatedAt,
    blockedReasons,
  };
}

function planFailureReason(err) {
  return { reason: err && err.message ? err.message : String(err) };
}

// Plan the desired managed arrays from already-acquired sources and the
// current settings file WITHOUT any disk mutation: no backup, no temp file,
// no rename, no network. The settings file is read exactly once and the
// digest is taken over the exact original bytes (never parsed or
// re-serialized YAML).
export function buildPlan({ settingsPath, sources }) {
  const generatedAt = new Date().toISOString();
  try {
    validateSourceBundle(sources);
  } catch (err) {
    return blockedPlan(settingsPath, [planFailureReason(err)], generatedAt);
  }
  // The source snapshot digest binds to the normalized planning bundle.
  const sourceSnapshotDigest = sha256Hex(canonicalJson(planningSourceBundle(sources)));
  let originalBytes;
  let current;
  try {
    ({ bytes: originalBytes, config: current } = readSettingsFile(settingsPath));
    validateExistingProviderShapes(current);
  } catch (err) {
    return blockedPlan(settingsPath, [planFailureReason(err)], generatedAt);
  }
  const settingsDigest = sha256Hex(originalBytes);
  try {
    const plan = planDesired({
      rosters: sources.rosters,
      catalog: sources.catalog,
      docs: sources.docs,
      current,
    });
    if (!plan.ok) {
      return blockedPlan(settingsPath, plan.unresolved, generatedAt);
    }
    const dispositions = plan.dispositions || [];
    const skipped = { go: [], zen: [] };
    for (const entry of dispositions) {
      if (
        (entry.disposition === 'SKIPPED_UNRESOLVED' ||
          entry.disposition === 'SKIPPED_UNSUPPORTED_PROTOCOL') &&
        (entry.gateway === 'go' || entry.gateway === 'zen')
      ) {
        skipped[entry.gateway].push(entry.id);
      }
    }
    checkMembership(plan.desired, sources.rosters, skipped);
    const preservedUnresolved = dispositions
      .filter((entry) => entry.disposition === 'PRESERVED_UNRESOLVED')
      .map(({ gateway, id, reason, route }) => ({ gateway, id, reason, route }));
    const skippedUnresolved = dispositions
      .filter((entry) => entry.disposition === 'SKIPPED_UNRESOLVED' && entry.reason !== 'DOCS_WITHDRAWN')
      .map(({ gateway, id, reason }) => ({ gateway, id, reason }));
    const unsupportedSkipped = dispositions
      .filter((entry) => entry.disposition === 'SKIPPED_UNSUPPORTED_PROTOCOL')
      .map(({ gateway, id, reason, endpoint }) => ({ gateway, id, reason, endpoint }));
    const fallbackResolved = dispositions
      .filter((entry) => entry.disposition === 'RESOLVED' && entry.provenance === 'FREE_COUNTERPART_FALLBACK')
      .map(({ gateway, id, counterpart, route, provenance }) => ({ gateway, id, counterpart, route, provenance }));
    // Candidate config must round-trip through YAML and expose exactly the
    // generated managed arrays. Validation only; nothing is written here.
    const candidate = buildNewConfig(current, plan.desired);
    const yamlText = assertYamlRoundTrip(candidate);
    const generated = parseYaml(yamlText);
    if (!generated || !isMapping(generated)) {
      throw unresolved('GENERATED_SETTINGS_INVALID: YAML root must be a mapping');
    }
    assertGeneratedManagedArrays(generated, plan.desired);
    const changes = attachWithdrawnReasons(diffDesired(plan.desired, plan.priors), dispositions);
    const changed = !managedArraysMatch(current, plan.desired);
    return {
      state: changed ? 'READY' : 'NO_CHANGE',
      changed,
      desired: plan.desired,
      dispositions,
      changes,
      preservedUnresolved,
      skippedUnresolved,
      unsupportedSkipped,
      fallbackResolved,
      endpointBaseDrift: endpointBaseDrift({ rosters: sources.rosters, docs: sources.docs }),
      settingsPath,
      settingsDigest,
      sourceSnapshotDigest,
      generatedAt,
    };
  } catch (err) {
    return blockedPlan(settingsPath, [planFailureReason(err)], generatedAt);
  }
}

// A plan may be committed only when it is READY and carries a complete,
// well-formed desired state plus the digest binding to its target bytes.
function commitable(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return { ok: false, reason: 'COMMIT_REFUSED: plan is missing or malformed' };
  }
  if (plan.state === 'BLOCKED') {
    return { ok: false, reason: 'COMMIT_REFUSED: BLOCKED plan cannot be committed' };
  }
  if (plan.state === 'NO_CHANGE') {
    return { ok: false, reason: 'COMMIT_REFUSED: NO_CHANGE plan cannot be committed' };
  }
  if (plan.state !== 'READY') {
    return { ok: false, reason: 'COMMIT_REFUSED: plan has an unknown state' };
  }
  if (!isMapping(plan.desired)) {
    return { ok: false, reason: 'COMMIT_REFUSED: plan.desired is missing or malformed' };
  }
  for (const route of MANAGED_ROUTE_KEYS) {
    if (!Object.hasOwn(plan.desired, route) || !Array.isArray(plan.desired[route])) {
      return { ok: false, reason: 'COMMIT_REFUSED: plan.desired.' + route + ' is missing or not an array' };
    }
  }
  if (typeof plan.settingsPath !== 'string' || plan.settingsPath.length === 0) {
    return { ok: false, reason: 'COMMIT_REFUSED: plan.settingsPath is missing' };
  }
  if (typeof plan.settingsDigest !== 'string' || !/^[0-9a-f]{64}$/.test(plan.settingsDigest)) {
    return { ok: false, reason: 'COMMIT_REFUSED: plan.settingsDigest is missing or malformed' };
  }
  return { ok: true };
}

// Execute an already-computed READY plan against the current settings file.
// commitPlan performs no source fetching, no replanning, and no source
// interpretation: the retained desired arrays are the only authority. The
// stale check runs first, before any backup or temp file exists.
export function commitPlan(plan) {
  const check = commitable(plan);
  if (!check.ok) return refusalOutcome([{ reason: check.reason }]);
  let currentBytes;
  try {
    currentBytes = fs.readFileSync(plan.settingsPath);
  } catch (err) {
    return refusalOutcome([planFailureReason(err)]);
  }
  // Byte-level staleness first: an external edit (even parse-equivalent)
  // refuses the commit and touches nothing.
  if (sha256Hex(currentBytes) !== plan.settingsDigest) {
    return refusalOutcome([{ reason: 'STALE_SETTINGS: current settings bytes differ from the planned snapshot' }], true);
  }
  let current;
  try {
    const config = parseYaml(currentBytes.toString('utf8'));
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw unresolved('SETTINGS_INVALID: settings root must be a mapping');
    }
    validateExistingProviderShapes(config);
    current = config;
  } catch (err) {
    return refusalOutcome([planFailureReason(err)]);
  }
  const stamp = timestampStamp();
  const backupPath = legacyBackupPath(plan.settingsPath, stamp);
  const tempPath = plan.settingsPath + '.tmp';
  try {
    // D05: edit the managed arrays inside the existing document so
    // comments, key order, and unrelated styling survive the write.
    const yamlText = surgicalLegacyUpdate(currentBytes.toString('utf8'), plan.desired);
    const generated = parseYaml(yamlText);
    if (!generated || !isMapping(generated)) {
      throw unresolved('GENERATED_SETTINGS_INVALID: YAML root must be a mapping');
    }
    assertGeneratedManagedArrays(generated, plan.desired);
    // Exact-byte backup of the settings as read immediately before commit.
    fs.writeFileSync(backupPath, currentBytes);
    fs.writeFileSync(tempPath, yamlText, 'utf8');
    // Parse the temporary file before replacing the original.
    const reparsed = parseYaml(fs.readFileSync(tempPath, 'utf8'));
    if (!reparsed || !isMapping(reparsed)) {
      throw unresolved('GENERATED_SETTINGS_INVALID: temporary YAML root must be a mapping');
    }
    assertGeneratedManagedArrays(reparsed, plan.desired);
    fs.renameSync(tempPath, plan.settingsPath);
    return {
      result: 'UPDATED',
      stale: false,
      ...plan.changes,
      unresolved: [],
      preservedUnresolved: plan.preservedUnresolved,
      skippedUnresolved: plan.skippedUnresolved,
      unsupportedSkipped: Array.isArray(plan.unsupportedSkipped) ? plan.unsupportedSkipped : [],
      fallbackResolved: plan.fallbackResolved,
      endpointBaseDrift: Array.isArray(plan.endpointBaseDrift) ? plan.endpointBaseDrift : [],
    };
  } catch (err) {
    // A failed temporary-file validation or replacement leaves the original
    // settings file in place. Cleanup is limited to this run's own temp path.
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // Preserve the original error/result even if temp cleanup is unavailable.
    }
    return refusalOutcome([planFailureReason(err)]);
  }
}

// Run the plan/commit lifecycle against already-acquired sources and one
// explicit settings file. Network-free; tests drive this with scratch
// fixtures. Never writes when validation fails. This is now an orchestration
// over the shared buildPlan / commitPlan seam only.
export function syncFromSources({ settingsPath, sources }) {
  const plan = buildPlan({ settingsPath, sources });
  if (plan.state === 'BLOCKED') {
    return notWritten(plan.blockedReasons);
  }
  if (plan.state === 'NO_CHANGE') {
    return {
      result: 'NO CHANGE',
      ...plan.changes,
      unresolved: [],
      preservedUnresolved: plan.preservedUnresolved,
      skippedUnresolved: plan.skippedUnresolved,
      unsupportedSkipped: Array.isArray(plan.unsupportedSkipped) ? plan.unsupportedSkipped : [],
      fallbackResolved: plan.fallbackResolved,
      endpointBaseDrift: Array.isArray(plan.endpointBaseDrift) ? plan.endpointBaseDrift : [],
    };
  }
  return commitPlan(plan);
}

// ---------------------------------------------------------------------------
// Network acquisition + live run.
// ---------------------------------------------------------------------------

async function fetchText(url, fetchFn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('request timeout')), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchFn(url, {
      method: 'GET',
      headers: {
        'user-agent': 'ocms-s/1.2 (+contract v1.2 source acquisition)',
        accept: url.endsWith('/go/') || url.endsWith('/zen/') ? 'text/html,*/*;q=0.8' : 'application/json,*/*;q=0.8',
      },
      signal: controller.signal,
    });
    if (!response.ok) throw unresolved('FETCH_FAILED: ' + url + ' answered ' + response.status);
    return await response.text();
  } catch (err) {
    if (err && typeof err.message === 'string' && /^(FETCH_FAILED|ROSTER_INVALID|CATALOG_INVALID|DOCS_INVALID)/.test(err.message)) {
      throw err;
    }
    throw unresolved('FETCH_FAILED: ' + url + ' (' + (err && err.message ? err.message : err) + ')');
  } finally {
    clearTimeout(timer);
  }
}

// Fetch all five sources once per run. If either roster fails or is empty,
// or the catalog or either docs page cannot be fetched or parsed, the caller
// must not write (fetchSources throws, main reports NOT WRITTEN).
export async function fetchSources(fetchFn = globalThis.fetch) {
  if (typeof fetchFn !== 'function') throw unresolved('FETCH_FAILED: no fetch implementation available');
  const [goRosterBody, zenRosterBody, catalogBody, goDocsBody, zenDocsBody] = await Promise.all([
    fetchText(SOURCE_URLS.goRoster, fetchFn),
    fetchText(SOURCE_URLS.zenRoster, fetchFn),
    fetchText(SOURCE_URLS.catalog, fetchFn),
    fetchText(SOURCE_URLS.goDocs, fetchFn),
    fetchText(SOURCE_URLS.zenDocs, fetchFn),
  ]);
  return {
    rosters: {
      go: parseRoster(goRosterBody, 'go'),
      zen: parseRoster(zenRosterBody, 'zen'),
    },
    catalog: parseCatalog(catalogBody),
    docs: {
      go: parseDocs(goDocsBody, 'go'),
      zen: parseDocs(zenDocsBody, 'zen'),
    },
  };
}

export function formatReport({ result, added = [], removed = [], moved = [], metadataChanged = [], unresolved = [], preservedUnresolved = [], skippedUnresolved = [], unsupportedSkipped = [], fallbackResolved = [], endpointBaseDrift = [] }) {
  const lines = [];
  const show = (label, items, render) => {
    lines.push(label + ' (' + items.length + '):');
    if (items.length === 0) lines.push('  (none)');
    else for (const item of items.slice().sort()) lines.push('  ' + render(item));
  };
  show('added', added.map((x) => x.key + ' -> ' + x.route), (x) => x);
  show('removed', removed.map((x) => x.key + ' was ' + x.route + (typeof x.reason === 'string' ? ' ' + x.reason : '')), (x) => x);
  show(
    'moved',
    moved.map((x) => x.key + ': ' + x.from + ' -> ' + x.to),
    (x) => x,
  );
  show(
    'metadata changed',
    metadataChanged.map((x) => x.key + ' in ' + x.route),
    (x) => x,
  );
  const byDisposition = (a, b) => {
    if (a.gateway !== b.gateway) return a.gateway < b.gateway ? -1 : 1;
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
  };
  const preserved = [...preservedUnresolved].sort(byDisposition);
  lines.push('preserved unresolved (' + preserved.length + '):');
  if (preserved.length === 0) lines.push('  (none)');
  else for (const item of preserved) lines.push('  - ' + item.gateway + '/' + item.id + ' reason=' + item.reason + ' route=' + item.route);
  const skipped = [...skippedUnresolved].sort(byDisposition);
  lines.push('skipped unresolved (' + skipped.length + '):');
  if (skipped.length === 0) lines.push('  (none)');
  else for (const item of skipped) lines.push('  - ' + item.gateway + '/' + item.id + ' reason=' + item.reason);
  const unsupported = [...unsupportedSkipped].sort(byDisposition);
  lines.push('SKIPPED_UNSUPPORTED_PROTOCOL (' + unsupported.length + '):');
  if (unsupported.length === 0) lines.push('  (none)');
  else for (const item of unsupported) {
    lines.push('  - ' + item.gateway + '/' + item.id + ' endpoint=' + item.endpoint + ' reason=' + item.reason);
  }
  const fallbacks = [...fallbackResolved].sort(byDisposition);
  lines.push('FREE_COUNTERPART_FALLBACK (' + fallbacks.length + '):');
  if (fallbacks.length === 0) lines.push('  (none)');
  else for (const item of fallbacks) lines.push('  - ' + item.gateway + '/' + item.id + ' counterpart=' + item.gateway + '/' + item.counterpart + ' route=' + item.route);
  const drift = [...endpointBaseDrift].sort((a, b) =>
    a.gateway !== b.gateway ? (a.gateway < b.gateway ? -1 : 1) : a.documentedBase < b.documentedBase ? -1 : a.documentedBase > b.documentedBase ? 1 : 0,
  );
  lines.push('ENDPOINT_BASE_DRIFT (' + drift.length + '):');
  if (drift.length === 0) lines.push('  (none)');
  else for (const item of drift) {
    lines.push('  - ' + item.gateway + ' documented=' + item.documentedBase + ' routed=' + item.routedBase + ' models=' + item.models);
  }
  show(
    'unresolved',
    unresolved.map((x) => (x.gateway || '') + (x.id ? '/' + x.id : '') + (x.reason ? ': ' + x.reason : '')),
    (x) => x,
  );
  lines.push(result);
  return lines.join('\n');
}

export async function runSync({ settingsPath, fetchFn } = {}) {
  const resolvedPath = settingsPath || resolveSettingsPath();
  let sources;
  try {
    sources = await fetchSources(fetchFn);
  } catch (err) {
    const report = formatReport({
      result: 'NOT WRITTEN',
      added: [],
      removed: [],
      moved: [],
      metadataChanged: [],
      unresolved: [{ reason: err && err.message ? err.message : String(err) }],
    });
    console.log(report);
    return { result: 'NOT WRITTEN', report };
  }
  let outcome;
  try {
    outcome = syncFromSources({ settingsPath: resolvedPath, sources });
  } catch (err) {
    const report = formatReport({
      result: 'NOT WRITTEN',
      added: [],
      removed: [],
      moved: [],
      metadataChanged: [],
      unresolved: [{ reason: err && err.message ? err.message : String(err) }],
    });
    console.log(report);
    return { result: 'NOT WRITTEN', report };
  }
  console.log(formatReport(outcome));
  return { ...outcome, report: formatReport(outcome) };
}

// v1.4.6-rc2 R1/R3/R4: expand a blocked-profile result into unresolved
// entries. First entry is always "<code>: <message>"; each detail.reasons
// string follows verbatim in order. Non-reasons details yield the single
// entry only. Pure and total; exit-code mapping is unchanged.
export function blockedProfileUnresolved(result) {
  const code = String((result && result.code) || 'REFUSED');
  const message = String((result && result.message) || 'refused');
  const out = [{ reason: code + ': ' + message }];
  const d = result && result.detail;
  if (d && typeof d === 'object' && !Array.isArray(d) && Array.isArray(d.reasons) && d.reasons.length > 0 && d.reasons.every((r) => typeof r === 'string')) {
    for (const r of d.reasons) out.push({ reason: r });
  }
  return out;
}

// C02/C03: legacy `--settings` refusals must be visible and must fail the
// process, and every completed legacy run must end with exactly one verdict
// (contract v1.2 section 17). Pure mapping, no I/O.
export function legacySettingsUnresolved(result) {
  const code = String((result && result.code) || 'REFUSED');
  const message = String((result && result.message) || 'refused');
  const out = [{ reason: code + ': ' + message }];
  const reasons = result && Array.isArray(result.reasons) ? result.reasons : [];
  // C05: plan-blocked reasons arrive as { reason } objects; surface their
  // coded text instead of dropping them (strings still pass through).
  for (const r of reasons) {
    if (typeof r === 'string') out.push({ reason: r });
    else if (r && typeof r.reason === 'string') out.push({ reason: r.reason });
  }
  return out;
}

async function main() {
  // S5-R2 B1: explicitly selected targets only. Bare invocation refuses
  // without fetching or writing; legacy runSync({}) is never entered here.
  let result = null;
  try {
    result = await dispatchSyncCli(process.argv.slice(2), {});
  } catch (err) {
    console.log(formatReport({
      result: 'NOT WRITTEN',
      added: [],
      removed: [],
      moved: [],
      metadataChanged: [],
      unresolved: [{ reason: String((err && err.message) || err) }],
    }));
    process.exitCode = 1;
    return;
  }
  if (result && result.mode === 'help') {
    console.log(result.help);
    return;
  }
  if (result && result.mode === 'legacy-settings') {
    // C02/C03: refuse loudly (NOT WRITTEN + exit 1) and report the verdict on
    // success (UPDATED / NO CHANGE), matching the profile branch below.
    if (result.ok !== true) {
      try {
        console.log(formatReport({
          result: 'NOT WRITTEN',
          added: [],
          removed: [],
          moved: [],
          metadataChanged: [],
          unresolved: legacySettingsUnresolved(result),
        }));
      } catch {}
      process.exitCode = 1;
      return;
    }
    try {
      console.log(formatReport({ result: String(result.result || 'NO CHANGE'), ...(result.report ? {} : {}),
        added: (result.report && result.report.added) || [],
        removed: (result.report && result.report.removed) || [],
        moved: (result.report && result.report.moved) || [],
        metadataChanged: (result.report && result.report.metadataChanged) || [],
        preservedUnresolved: (result.report && result.report.preservedUnresolved) || [],
        skippedUnresolved: (result.report && result.report.skippedUnresolved) || [],
        unsupportedSkipped: (result.report && result.report.unsupportedSkipped) || [],
        fallbackResolved: (result.report && result.report.fallbackResolved) || [],
        endpointBaseDrift: (result.report && result.report.endpointBaseDrift) || [],
      }));
    } catch {}
    return;
  }
  if (result && result.ok === true) return;
  // C05: a missing --settings file is a usage error, not a sync refusal:
  // verdict plus usage, exit 2. Every other refusal keeps verdict + exit 1.
  if (result && result.mode === 'refused' && result.code === 'SETTINGS_UNREADABLE') {
    try {
      console.log(formatReport({
        result: 'NOT WRITTEN',
        added: [],
        removed: [],
        moved: [],
        metadataChanged: [],
        unresolved: [{ reason: 'SETTINGS_UNREADABLE: The explicit settings path cannot be resolved.' }],
      }));
    } catch {}
    console.log('Usage: node sync.mjs --settings=<path> [--scratch]');
    process.exitCode = 2;
    return;
  }
  try {
    console.log(formatReport({
      result: 'NOT WRITTEN',
      added: [],
      removed: [],
      moved: [],
      metadataChanged: [],
      unresolved: blockedProfileUnresolved(result),
    }));
  } catch {}
  process.exitCode = 1;
}

const invokedAsMain =
  typeof process !== 'undefined' &&
  process.argv &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsMain) {
  main().catch((err) => {
    console.log(formatReport({
      result: 'NOT WRITTEN',
      added: [],
      removed: [],
      moved: [],
      metadataChanged: [],
      unresolved: [{ reason: err && err.message ? err.message : String(err) }],
    }));
    process.exitCode = 1;
  });
}
