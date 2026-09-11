# Changelog

All notable project-level changes are summarized here.

This file is intentionally concise. The authoritative behavioral specification remains the current contract.

## v1.2.0

Current release line.

### Added

- Model-local dispositions:
  - `RESOLVED`
  - `PRESERVED_UNRESOLVED`
  - `SKIPPED_UNRESOLVED`
- Conservative handling of live models with incomplete placement authority.
- Opaque preservation of a uniquely existing `CATALOG_MISSING` model record.
- Explicit handling of unsupported Google-style models.
- `FREE_COUNTERPART_FALLBACK` for eligible exact terminal `-free` model IDs.
- Deterministic reporting of every preserved, skipped, and fallback-resolved model.
- `UPDATED` / `NO CHANGE` reporting that can coexist with unresolved warnings and fallback provenance.

### Safety / hardening

- Desired managed arrays are rebuilt from authoritative roster membership rather than incrementally patched.
- Existing YAML is used only for narrowly permitted local-state preservation.
- Ambiguous unresolved placement and conflicting `compat` fail closed.
- Production writes use backup → temp file → parse/verify → replace semantics.
- Default settings resolution uses `%USERPROFILE%`; ambient `HOME` and `OCMS_SETTINGS` do not redirect production execution.
- `--settings=<path>` remains available for deliberate scratch/test/audit use.
- No authenticated model probes or inference requests are required for synchronization.

### Fixed

- Fail closed when either required Go or Zen catalog model map is empty, instead of softening a broken whole-source catalog into per-model `CATALOG_MISSING` dispositions.

### Verification

v1.2 underwent unit/regression testing, adversarial synthetic validation, live-public-source synthetic validation, controlled production synchronization, backup verification, and idempotence verification. The current Windows regression suite contains 70 tests; the count is informational, not a compatibility promise.

## v1.1

### Changed / hardened

- Corrected the DSH managed-provider container to `llm-pi-ai.providers`.
- Hardened desired-route-first `compat` preservation/migration.
- Removed ambient environment-variable write-target redirection.
- Hardened default production-path resolution.

## v1.0

- Initial OCMS-S implementation.
- Manual OpenCode Go / Zen roster, metadata, and placement synchronization.
- Six managed DSH model arrays.
- YAML validation, backup, and replacement transaction.
