import { $ } from "bun";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SDK_PKG_ROOT = fileURLToPath(new URL("..", import.meta.url));

await $`bun ${join(SDK_PKG_ROOT, "script/build.ts")}`;

const pkgPath = join(SDK_PKG_ROOT, "package.json");
const pkg = await Bun.file(pkgPath).json();

// Snapshot original exports for restore after publish (so dev still resolves to src/).
const originalExports = pkg.exports;
// `types` MUST come before `import` — TS resolves conditional exports
// left-to-right under node16 / bundler resolution, so an `import`-first
// shape would match the `.js` and miss the `.d.ts`.
const rewritten: Record<string, { types: string; import: string }> = {};
for (const [key, src] of Object.entries(originalExports as Record<string, string>)) {
  const base = (src as string).replace(/^\.\/src\//, "./dist/").replace(/\.tsx?$/, "");
  rewritten[key] = { types: `${base}.d.ts`, import: `${base}.js` };
}
pkg.exports = rewritten;

await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// Default prerelease versions to the `next` tag so `latest` is reserved for stable.
const defaultTag = (pkg.version as string).includes("-") ? "next" : "latest";
const tag = process.env.NPM_TAG ?? defaultTag;
// `NPM_REGISTRY` is set by the validate workflow to point at a throwaway
// verdaccio. In that mode we skip --provenance (OIDC-only) and pass the
// override registry explicitly.
const registry = process.env.NPM_REGISTRY;
const args = ["publish", "--access", "public", "--tag", tag];
if (registry) args.push("--registry", registry);
if (process.env.GITHUB_ACTIONS === "true" && !registry) args.push("--provenance");

// process.exit() terminates synchronously and skips pending async I/O,
// so we MUST NOT exit from inside `finally` before the restore lands.
// Capture the exit code, restore + flush package.json, then exit.
let exitCode = 0;
try {
  // Capture stderr so we can recognise "already published" — the wrapper
  // publish script swallows the same case via isAlreadyPublished(), and
  // the multi-step pipeline (validate → publish, or rerun-after-mid-loop
  // failure) means the SDK can be re-attempted at the same version. npm
  // surfaces same-version republishes as E403/E409/EPUBLISHCONFLICT, all
  // of which we should treat as success rather than fail the whole run.
  const result = Bun.spawnSync(["npm", ...args], {
    cwd: SDK_PKG_ROOT,
    stdout: "inherit",
    stderr: "pipe",
  });
  const stderr = result.stderr ? new TextDecoder().decode(result.stderr) : "";
  if (stderr) process.stderr.write(stderr);
  exitCode = result.exitCode ?? 1;
  if (exitCode !== 0 && isAlreadyPublished(stderr)) {
    console.log(`[publish] @bastani/atomic-sdk@${pkg.version} already published — skipping`);
    exitCode = 0;
  }
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  // Always restore so dev checkouts keep resolving to src/.
  pkg.exports = originalExports;
  await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}
if (exitCode !== 0) process.exit(exitCode);

function isAlreadyPublished(stderr: string): boolean {
  // Same matchers used by packages/atomic/script/publish.ts.
  return /EPUBLISHCONFLICT|previously published|cannot publish over/i.test(stderr);
}
