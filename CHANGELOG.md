# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] — 2026-05-03

### Breaking Changes
- `@bastani/atomic` no longer exposes SDK exports. Library consumers must migrate to the new `@bastani/atomic-sdk` package. See the README "Migration from 0.6.x" section.

### Added
- Per-platform binary distribution: `@bastani/atomic-{linux,darwin,windows}-{x64,arm64}` packages. Globally installing `@bastani/atomic` now resolves a single matching binary with zero transitive `node_modules`, eliminating Windows MAX_PATH installation failures by construction.
- `@bastani/atomic-sdk` standalone library package with compiled JS + type definitions.
- Cross-platform install-smoke CI matrix covering Linux x64/arm64, macOS x64/arm64, Windows x64/arm64 to catch packaging regressions before they ship.

### Fixed
- `z.toJSONSchema is not a function` runtime error on Windows global installs caused by zod files exceeding the Windows 260-character MAX_PATH limit during nested `node_modules` extraction.

### Internal
- Repository converted to a Bun workspace under `packages/`. CLI source lives at `packages/atomic/`; SDK source at `packages/atomic-sdk/`.
- Build/publish scripts mirror OpenCode's wrapper + `optionalDependencies` distribution pattern (reference: `sst/opencode`'s `packages/opencode/script/{build,publish}.ts`).
