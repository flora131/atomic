# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] — 2026-05-04

### Breaking Changes
- **SDK rename: `@bastani/atomic` → `@bastani/atomic-sdk`.** Library consumers of
  `defineWorkflow`, `createRegistry`, `WorkflowPicker`, etc. must migrate package
  name. No backwards-compat shim is published. See README "Migration from 0.6.x".
- **Wrapper carries no runtime dependencies.** `@bastani/atomic` is now a
  zero-dep wrapper that resolves a per-platform binary via `optionalDependencies`.

### Added
- Per-platform binary distribution: `@bastani/atomic-{linux,darwin,windows}-{x64,arm64}`.
- Bun workspace at repo root; CLI under `packages/atomic/`, SDK under `packages/atomic-sdk/`.
- `Bun.embeddedFiles`-backed config bundling — `.claude/`, `.opencode/`, `.github/`,
  `.agents/skills/` are inlined into the compiled binary and extracted to a
  platform cache on first run.

### Fixed
- Windows MAX_PATH (260-char) silent file-extraction truncation that produced
  `z.toJSONSchema is not a function` at runtime. Wrapper has no nested
  `node_modules` by construction.
