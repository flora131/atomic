export * from "./types.ts";
export * from "./registry.ts";

// Side-effect import: registers all per-category handler descriptors
import "./handlers/index.ts";
