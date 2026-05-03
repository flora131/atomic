import { $ } from "bun";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SDK_PKG_ROOT = fileURLToPath(new URL("..", import.meta.url));

await $`bun ${join(SDK_PKG_ROOT, "script/build.ts")}`;

const pkgPath = join(SDK_PKG_ROOT, "package.json");
const pkg = await Bun.file(pkgPath).json();

// Snapshot original exports for restore after publish (so dev still resolves to src/).
const originalExports = pkg.exports;
const rewritten: Record<string, { import: string; types: string }> = {};
for (const [key, src] of Object.entries(originalExports as Record<string, string>)) {
  const base = (src as string).replace(/^\.\/src\//, "./dist/").replace(/\.tsx?$/, "");
  rewritten[key] = { import: `${base}.js`, types: `${base}.d.ts` };
}
pkg.exports = rewritten;

await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
try {
  await $`cd ${SDK_PKG_ROOT} && npm publish --provenance --access public --tag ${process.env.NPM_TAG ?? "latest"}`;
} finally {
  // Always restore so dev checkouts keep resolving to src/.
  pkg.exports = originalExports;
  await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}
