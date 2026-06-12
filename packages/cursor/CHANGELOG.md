# Changelog

## [Unreleased]

### Added

- Added the experimental `@bastani/cursor` bundled provider scaffold with Cursor PKCE OAuth, token refresh, estimated/live model mapping, transport isolation, stream adapter hooks, lifecycle cleanup, and fake-transport tests.
- Added a safe production UUID generator path for Cursor login, refresh, and streaming, plus an injectable HTTP/2 Connect transport boundary with frame helpers and protocol-codec seams for live Cursor RPC work.

### Security

- Cursor credentials are handled through Atomic OAuth storage only; Authorization headers and token-like diagnostics are redacted, and no proxy or child-process bridge is introduced.
