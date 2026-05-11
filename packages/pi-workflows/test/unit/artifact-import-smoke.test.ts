/**
 * Artifact import smoke tests.
 *
 * Verifies that the compiled dist artefacts expose the correct runtime shape:
 *   - dist/index.js       → named exports defineWorkflow and createRegistry are functions
 *   - dist/extension/index.js → default export is a function (extension factory)
 *
 * Tests run against the actual dist/ output produced by `bun run build`.
 * They intentionally skip when dist is absent so the unit suite stays green
 * on clean checkouts (build CI step must precede this test step).
 */

import { test, expect, describe, beforeAll } from "bun:test";
import { existsSync } from "fs";
import { resolve } from "path";

const pkgRoot = resolve(import.meta.dir, "../..");
const distIndexPath = resolve(pkgRoot, "dist/index.js");
const distExtensionPath = resolve(pkgRoot, "dist/extension/index.js");

const distPresent = existsSync(distIndexPath) && existsSync(distExtensionPath);

// ---------------------------------------------------------------------------
// dist/index.js — public authoring API
// ---------------------------------------------------------------------------

describe("artifact-import-smoke — dist/index.js", () => {
  let mod: Record<string, unknown>;

  beforeAll(async () => {
    if (!distPresent) return;
    mod = await import(distIndexPath);
  });

  test("dist/index.js exists", () => {
    expect(existsSync(distIndexPath)).toBe(true);
  });

  test("defineWorkflow is a function", () => {
    if (!distPresent) return; // skip if no dist
    expect(typeof mod.defineWorkflow).toBe("function");
  });

  test("createRegistry is a function", () => {
    if (!distPresent) return;
    expect(typeof mod.createRegistry).toBe("function");
  });

  test("createRegistry() returns object with register and get", () => {
    if (!distPresent) return;
    const registry = (mod.createRegistry as () => unknown)();
    expect(registry).not.toBeNull();
    expect(typeof registry).toBe("object");
    const r = registry as Record<string, unknown>;
    expect(typeof r.register).toBe("function");
    expect(typeof r.get).toBe("function");
  });

  test("defineWorkflow returns builder with description/input/run/compile", () => {
    if (!distPresent) return;
    const dw = mod.defineWorkflow as (name: string) => Record<string, unknown>;
    const builder = dw("smoke-test");
    expect(typeof builder.description).toBe("function");
    expect(typeof builder.input).toBe("function");
    expect(typeof builder.run).toBe("function");
    expect(typeof builder.compile).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// dist/extension/index.js — pi extension factory
// ---------------------------------------------------------------------------

describe("artifact-import-smoke — dist/extension/index.js", () => {
  let extMod: { default?: unknown };

  beforeAll(async () => {
    if (!distPresent) return;
    extMod = await import(distExtensionPath);
  });

  test("dist/extension/index.js exists", () => {
    expect(existsSync(distExtensionPath)).toBe(true);
  });

  test("default export is a function (extension factory)", () => {
    if (!distPresent) return;
    expect(typeof extMod.default).toBe("function");
  });

  test("extension factory accepts pi-like object without throwing", () => {
    if (!distPresent) return;
    const factory = extMod.default as (pi: Record<string, unknown>) => void;
    // Minimal stub — factory should not throw when called with a compatible pi host
    const piStub: Record<string, unknown> = {
      registerSlashCommand: () => {},
      registerMessageRenderer: () => {},
      registerFlag: () => {},
      on: () => {},
      sessionManager: null,
    };
    expect(() => factory(piStub)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// package.json manifest field contract (no build required)
// ---------------------------------------------------------------------------

describe("artifact-import-smoke — package.json manifest contract", () => {
  let pkg: {
    main?: string;
    types?: string;
    exports?: Record<string, { import?: string; types?: string }>;
    pi?: { extensions?: string[] };
  };

  beforeAll(async () => {
    const { default: loaded } = await import(resolve(pkgRoot, "package.json"), {
      with: { type: "json" },
    });
    pkg = loaded;
  });

  test("package.json has main field pointing to dist/index.js", () => {
    expect(pkg.main).toBe("dist/index.js");
  });

  test("package.json has types field pointing to dist/index.d.ts", () => {
    expect(pkg.types).toBe("dist/index.d.ts");
  });

  test('exports["."].import points to ./dist/index.js', () => {
    expect(pkg.exports?.["."]?.import).toBe("./dist/index.js");
  });

  test('exports["."].types points to ./dist/index.d.ts', () => {
    expect(pkg.exports?.["."]?.types).toBe("./dist/index.d.ts");
  });

  test("pi.extensions contains at least one entry", () => {
    expect(Array.isArray(pkg.pi?.extensions)).toBe(true);
    expect((pkg.pi?.extensions ?? []).length).toBeGreaterThan(0);
  });

  test("pi.extensions[0] points to ./dist/extension/index.js", () => {
    expect(pkg.pi?.extensions?.[0]).toBe("./dist/extension/index.js");
  });
});
