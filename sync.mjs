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
import path from 'node:path';
import { isDeepStrictEqual as deepEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { parse as parseHtml } from 'node-html-parser';

// ---------------------------------------------------------------------------
// Sources (contract section 2). Fetched on every run.
// ---------------------------------------------------------------------------

export const SOURCE_URLS = {
  goRoster: 'https://opencode.ai/zen/go/v1/models',
  zenRoster: 'https://opencode.ai/zen/v1/models',
  catalog: 'https://models.opencode.ai/api.json',
  goDocs: 'https://opencode.ai/docs/go/',
  zenDocs: 'https://opencode.ai/docs/zen/',
};

export const FETCH_TIMEOUT_MS = 20000;

// ---------------------------------------------------------------------------
// Managed routes (contract section 3).
// ---------------------------------------------------------------------------

export const MANAGED_ROUTES = {
  'opencode-go': {
    gateway: 'go',
    api: 'openai-completions',
    baseURL: 'https://opencode.ai/zen/go/v1',
    apiKeyEnv: 'OPENCODE_GO_API_KEY',
  },
  'opencode-go-messages': {
    gateway: 'go',
    api: 'anthropic-messages',
    baseURL: 'https://opencode.ai/zen/go',
    apiKeyEnv: 'OPENCODE_GO_API_KEY',
  },
  'opencode-go-responses': {
    gateway: 'go',
    api: 'openai-responses',
    baseURL: 'https://opencode.ai/zen/go/v1',
    apiKeyEnv: 'OPENCODE_GO_API_KEY',
  },
  'opencode-completions': {
    gateway: 'zen',
    api: 'openai-completions',
    baseURL: 'https://opencode.ai/zen/v1',
    apiKeyEnv: 'OPENCODE_API_KEY',
  },
  'opencode-messages': {
    gateway: 'zen',
    api: 'anthropic-messages',
    baseURL: 'https://opencode.ai/zen',
    apiKeyEnv: 'OPENCODE_API_KEY',
  },
  'opencode': {
    gateway: 'zen',
    api: 'openai-responses',
    baseURL: 'https://opencode.ai/zen/v1',
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
  const base = gateway === 'go' ? '/zen/go/v1/' : '/zen/v1/';
  if (!url.pathname.startsWith(base)) throw unresolved('ENDPOINT_UNSUPPORTED: ' + gateway + '/' + id);
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
// (RESOLVED, PRESERVED_UNRESOLVED, SKIPPED_UNRESOLVED) unless a blocking
// ambiguity/conflict stops planning. compat (local DSH/provider
// configuration, never catalog metadata) is copied unchanged from the
// existing record indexed by gateway + model ID, and moves with the model
// when docs move it between routes in the same gateway. All other rebuilt
// model metadata is replaced by the newly generated metadata; an opaque
// CATALOG_MISSING preservation keeps its sole existing record unchanged.
export function planDesired({ rosters, catalog, docs, current }) {
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
  for (const [key, value] of desiredIndex) {
    const prior = priors.get(key);
    if (!prior) {
      added.push({ key, route: value.route });
      continue;
    }
    if (prior.route !== value.route) moved.push({ key, from: prior.route, to: value.route });
    if (!deepEqual(ownedOf(prior.record), ownedOf(value.record))) {
      metadataChanged.push({ key, route: value.route });
    }
  }
  for (const [key, prior] of priors) {
    if (!desiredIndex.has(key)) removed.push({ key, route: prior.route });
  }
  const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
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
  const home = process.env.USERPROFILE;
  if (home) return path.join(home, '.dsh', 'settings.yaml');
  return 'C:\\Users\\GNV\\.dsh\\settings.yaml';
}

export function resolveSettingsPath(argv = process.argv) {
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--settings=')) return arg.slice('--settings='.length);
  }
  return defaultSettingsPath();
}

export function readSettingsFile(settingsPath) {
  const bytes = fs.readFileSync(settingsPath);
  const text = bytes.toString('utf8');
  const config = parseYaml(text);
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

function timestampStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// Run the plan/validate/backup/write lifecycle against already-acquired
// sources and one explicit settings file. Network-free; tests drive this
// with scratch fixtures. Never writes when validation fails.
export function syncFromSources({ settingsPath, sources }) {
  try {
    validateSourceBundle(sources);
  } catch (err) {
    return notWritten([{ reason: err && err.message ? err.message : String(err) }]);
  }
  let originalBytes;
  let current;
  try {
    ({ bytes: originalBytes, config: current } = readSettingsFile(settingsPath));
    validateExistingProviderShapes(current);
  } catch (err) {
    return notWritten([{ reason: err && err.message ? err.message : String(err) }]);
  }
  let plan;
  let yamlText;
  let diff;
  let changed;
  let preservedUnresolved;
  let skippedUnresolved;
  let fallbackResolved;
  try {
    plan = planDesired({
      rosters: sources.rosters,
      catalog: sources.catalog,
      docs: sources.docs,
      current,
    });
    if (!plan.ok) return notWritten(plan.unresolved);
    const dispositions = plan.dispositions || [];
    const skipped = { go: [], zen: [] };
    for (const entry of dispositions) {
      if (entry.disposition === 'SKIPPED_UNRESOLVED' && (entry.gateway === 'go' || entry.gateway === 'zen')) {
        skipped[entry.gateway].push(entry.id);
      }
    }
    checkMembership(plan.desired, sources.rosters, skipped);
    preservedUnresolved = dispositions
      .filter((entry) => entry.disposition === 'PRESERVED_UNRESOLVED')
      .map(({ gateway, id, reason, route }) => ({ gateway, id, reason, route }));
    skippedUnresolved = dispositions
      .filter((entry) => entry.disposition === 'SKIPPED_UNRESOLVED')
      .map(({ gateway, id, reason }) => ({ gateway, id, reason }));
    fallbackResolved = dispositions
      .filter((entry) => entry.disposition === 'RESOLVED' && entry.provenance === 'FREE_COUNTERPART_FALLBACK')
      .map(({ gateway, id, counterpart, route, provenance }) => ({ gateway, id, counterpart, route, provenance }));
    const next = buildNewConfig(current, plan.desired);
    // Generated YAML must parse.
    yamlText = assertYamlRoundTrip(next);
    const generated = parseYaml(yamlText);
    if (!generated || !isMapping(generated)) {
      throw unresolved('GENERATED_SETTINGS_INVALID: YAML root must be a mapping');
    }
    assertGeneratedManagedArrays(generated, plan.desired);
    diff = diffDesired(plan.desired, plan.priors);
    changed = !managedArraysMatch(current, plan.desired);
  } catch (err) {
    return notWritten([{ reason: err && err.message ? err.message : String(err) }]);
  }
  if (!changed) return { result: 'NO CHANGE', ...diff, unresolved: [], preservedUnresolved, skippedUnresolved, fallbackResolved };

  const stamp = timestampStamp();
  const backupPath = settingsPath + '.bak-' + stamp;
  const tempPath = settingsPath + '.tmp';
  try {
    fs.writeFileSync(backupPath, originalBytes);
    fs.writeFileSync(tempPath, yamlText, 'utf8');
    // Parse the temporary file before replacing the original.
    const reparsed = parseYaml(fs.readFileSync(tempPath, 'utf8'));
    if (!reparsed || !isMapping(reparsed)) {
      throw unresolved('GENERATED_SETTINGS_INVALID: temporary YAML root must be a mapping');
    }
    assertGeneratedManagedArrays(reparsed, plan.desired);
    fs.renameSync(tempPath, settingsPath);
    return { result: 'UPDATED', ...diff, unresolved: [], preservedUnresolved, skippedUnresolved, fallbackResolved };
  } catch (err) {
    // A failed temporary-file validation or replacement leaves the original
    // settings file in place. Cleanup is limited to this run's own temp path.
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // Preserve the original error/result even if temp cleanup is unavailable.
    }
    return notWritten([{ reason: err && err.message ? err.message : String(err) }]);
  }
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

export function formatReport({ result, added = [], removed = [], moved = [], metadataChanged = [], unresolved = [], preservedUnresolved = [], skippedUnresolved = [], fallbackResolved = [] }) {
  const lines = [];
  const show = (label, items, render) => {
    lines.push(label + ' (' + items.length + '):');
    if (items.length === 0) lines.push('  (none)');
    else for (const item of items.slice().sort()) lines.push('  ' + render(item));
  };
  show('added', added.map((x) => x.key + ' -> ' + x.route), (x) => x);
  show('removed', removed.map((x) => x.key + ' was ' + x.route), (x) => x);
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
  const fallbacks = [...fallbackResolved].sort(byDisposition);
  lines.push('FREE_COUNTERPART_FALLBACK (' + fallbacks.length + '):');
  if (fallbacks.length === 0) lines.push('  (none)');
  else for (const item of fallbacks) lines.push('  - ' + item.gateway + '/' + item.id + ' counterpart=' + item.gateway + '/' + item.counterpart + ' route=' + item.route);
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

async function main() {
  const outcome = await runSync({});
  if (outcome.result === 'NOT WRITTEN') process.exitCode = 1;
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
