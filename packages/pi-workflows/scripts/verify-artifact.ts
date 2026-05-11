/**
 * Artifact verifier for pi-workflows dist output.
 *
 * Checks:
 *   1. Every path declared in package.json (main, types, exports, pi.extensions,
 *      pi.workflows) exists on disk.
 *   2. Every .js file under pi.workflows directories contains no source-leaking
 *      import patterns (../src/ or /src/index.js).
 *   3. Every .js file under pi.workflows directories uses only bare-specifier
 *      imports or relative imports that stay within dist/ — no relative path
 *      escaping into a src/ directory tree.
 *
 * Exits non-zero and prints diagnostics if any check fails.
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { resolve, dirname, join, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PackageJson {
  main?: string;
  types?: string;
  exports?: Record<string, { import?: string; types?: string }>;
  pi?: {
    extensions?: string[];
    workflows?: string[];
    [key: string]: unknown;
  };
}

// ---------------------------------------------------------------------------
// Pure helpers (also used by unit tests via inline copy)
// ---------------------------------------------------------------------------

/** Forbidden import substrings that indicate a source-tree leak in emitted JS. */
export const FORBIDDEN_SRC_PATTERNS = ["../src/", "/src/index.js"] as const;

/**
 * Scan workflow JS content for forbidden source-path import patterns.
 * Returns every forbidden pattern found in the content.
 */
export function scanWorkflowForSrcImports(content: string): string[] {
  return FORBIDDEN_SRC_PATTERNS.filter((p) => content.includes(p));
}

/**
 * Extract all static import/require specifiers from bundled JS content.
 * Handles both ESM `import ... from "..."` and CJS `require("...")`.
 */
export function extractImportSpecifiers(content: string): string[] {
  const specifiers: string[] = [];
  // ESM: import ... from "specifier" or import("specifier")
  const esmRe = /from\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = esmRe.exec(content)) !== null) {
    specifiers.push(m[1]);
  }
  // CJS: require("specifier")
  const cjsRe = /require\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((m = cjsRe.exec(content)) !== null) {
    specifiers.push(m[1]);
  }
  return specifiers;
}

/**
 * Given a workflow JS file's absolute path and its import specifiers, return
 * any relative specifiers that resolve outside the dist/ tree or into a src/
 * directory — these would break when installed (src is not published).
 */
export function findLeakyRelativeImports(
  fileAbs: string,
  specifiers: string[],
  pkgRootAbs: string
): string[] {
  const leaky: string[] = [];
  for (const spec of specifiers) {
    if (!spec.startsWith(".")) continue; // bare specifier — fine
    const resolved = resolve(dirname(fileAbs), spec);
    const rel = relative(pkgRootAbs, resolved);
    // Leaky if it resolves outside pkgRoot, or into a src/ path
    if (rel.startsWith("..") || rel.startsWith("src/") || rel.includes("/src/")) {
      leaky.push(spec);
    }
  }
  return leaky;
}

// ---------------------------------------------------------------------------
// Load package.json
// ---------------------------------------------------------------------------

const pkg: PackageJson = (await import(resolve(pkgRoot, "package.json"), {
  with: { type: "json" },
})).default;

// ---------------------------------------------------------------------------
// 1. Collect declared paths and verify they exist
// ---------------------------------------------------------------------------

const required: string[] = [];

if (pkg.main) required.push(pkg.main);
if (pkg.types) required.push(pkg.types);

if (pkg.exports) {
  for (const [, condition] of Object.entries(pkg.exports)) {
    if (condition.import) required.push(condition.import);
    if (condition.types) required.push(condition.types);
  }
}

if (pkg.pi?.extensions) {
  for (const ext of pkg.pi.extensions) {
    required.push(ext);
  }
}

if (pkg.pi?.workflows) {
  for (const wfDir of pkg.pi.workflows) {
    required.push(wfDir);
  }
}

const missingPaths: string[] = [];
for (const rel of required) {
  const abs = resolve(pkgRoot, rel);
  if (!existsSync(abs)) {
    missingPaths.push(rel);
  }
}

if (missingPaths.length > 0) {
  console.error("artifact verification FAILED — missing declared paths:");
  for (const p of missingPaths) {
    console.error(`  ${p}`);
  }
  process.exit(1);
}

console.log(`[1/3] declared paths OK — all ${required.length} present`);

// ---------------------------------------------------------------------------
// 2 & 3. Scan dist/workflows/**/*.js for source-leaking imports
// ---------------------------------------------------------------------------

/** Collect all .js files under a directory (non-recursive for workflows flat dir). */
function collectJsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => join(dir, f));
}

const workflowDirs: string[] = (pkg.pi?.workflows ?? []).map((d) =>
  resolve(pkgRoot, d)
);

const srcLeaks: Array<{ file: string; patterns: string[] }> = [];
const leakyImports: Array<{ file: string; imports: string[] }> = [];

for (const wfDir of workflowDirs) {
  const jsFiles = collectJsFiles(wfDir);

  if (jsFiles.length === 0) {
    console.warn(`  warning: no .js files found in ${relative(pkgRoot, wfDir)}`);
  }

  for (const jsFile of jsFiles) {
    const content = readFileSync(jsFile, "utf-8");
    const relFile = relative(pkgRoot, jsFile);

    // Check 2: forbidden src patterns in content
    const forbidden = scanWorkflowForSrcImports(content);
    if (forbidden.length > 0) {
      srcLeaks.push({ file: relFile, patterns: forbidden });
    }

    // Check 3: relative imports that escape dist/ or reach src/
    const specifiers = extractImportSpecifiers(content);
    const leaky = findLeakyRelativeImports(jsFile, specifiers, pkgRoot);
    if (leaky.length > 0) {
      leakyImports.push({ file: relFile, imports: leaky });
    }
  }
}

let failed = false;

if (srcLeaks.length > 0) {
  console.error(
    "artifact verification FAILED — workflow JS files contain source-path imports:"
  );
  for (const { file, patterns } of srcLeaks) {
    console.error(`  ${file}`);
    for (const p of patterns) {
      console.error(`    forbidden pattern: ${p}`);
    }
  }
  failed = true;
}

if (leakyImports.length > 0) {
  console.error(
    "artifact verification FAILED — workflow JS files contain relative imports escaping dist/:"
  );
  for (const { file, imports } of leakyImports) {
    console.error(`  ${file}`);
    for (const imp of imports) {
      console.error(`    leaky import: ${imp}`);
    }
  }
  failed = true;
}

if (failed) {
  process.exit(1);
}

const totalJsFiles = workflowDirs.reduce(
  (sum, d) => sum + collectJsFiles(d).length,
  0
);
console.log(
  `[2/3] workflow src-import scan OK — ${totalJsFiles} JS file(s) clean`
);
console.log(
  `[3/3] workflow relative-import scan OK — no dist/-escaping imports`
);

console.log("artifact verification PASSED");
