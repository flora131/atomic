/**
 * Ambient module declarations for Bun's `import … with { type: "file" }`
 * attribute used by generated tree-sitter parser assets (src/parsers.ts).
 *
 * Each import resolves to an embedded file path string at runtime.
 */

declare module "*.wasm" {
  const path: string;
  export default path;
}

declare module "*.scm" {
  const path: string;
  export default path;
}
