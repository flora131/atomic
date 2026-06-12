# Changelog

## [Unreleased]

### Added

- Added the experimental `@bastani/cursor` bundled provider scaffold with Cursor PKCE OAuth, token refresh, estimated/live model mapping, transport isolation, stream adapter hooks, lifecycle cleanup, and fake-transport tests.
- Added a safe production UUID generator path for Cursor login, refresh, and streaming, plus an injectable HTTP/2 Connect transport boundary with frame helpers and protocol-codec seams for live Cursor RPC work.
- Added the production-default minimal Cursor protobuf codec, buffered Connect frame decoder, HTTP/2 non-2xx/session/stream lifecycle error classification, and stricter live-discovery fallback policy.
- Hardened Cursor Run streaming to write the initial Connect frame before response headers, eagerly observe stream/session terminal events, encode conversation/tool context, decode Cursor `execServerMessage.mcpArgs` tool calls with protobuf `Value` arguments and field-order-independent exec ids, classify Connect end-stream errors, parse checkpoint token details without counting `max_tokens` as output, and accumulate usage deltas without zeroing missing checkpoint fields.
- Preserved live Cursor model id fidelity by exposing advertised fast/thinking ids instead of synthesizing absent base ids.
- Added a token-free live model catalog cache with atomic writes, cached startup registration, best-effort auth-first refresh discovery, and bounded first-stream rediscovery cleanup.
- Corrected Cursor MCP tool advertisement to encode Cursor's `McpTools` wrapper schema, and stopped injecting static `composer-2` defaults into successful live or cached-live catalogs.

### Security

- Cursor credentials are handled through Atomic OAuth storage only; Authorization headers and token-like diagnostics are redacted, and no proxy or child-process bridge is introduced.
