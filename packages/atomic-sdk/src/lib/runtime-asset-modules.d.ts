// Ambient declarations for static `with { type: "file" }` imports of runtime assets.
// Bun resolves these to absolute paths (dev) or /$bunfs/... paths (compiled binary).
declare module "*.conf" {
  const path: string;
  export default path;
}

// When a .script.js file is imported with { type: "file" }, Bun treats it as a
// data asset and returns the resolved path string — not the module exports.
// The `.script.js` bundles are emitted by `emitRuntimeScriptBundles` (RFC §5.3)
// into runtime-scripts/; the canonical sources keep `.ts` and remain module-imports.
declare module "*.script.js" {
  const path: string;
  export default path;
}
