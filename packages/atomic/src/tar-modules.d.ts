// Ambient declarations for static `with { type: "file" }` imports of .tar bundles.
// These files are generated at build time (Cluster E-2) and inlined by `bun build --compile`.
declare module "*.tar" {
  const path: string;
  export default path;
}
