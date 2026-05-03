import { test, expect } from "bun:test";
import { join } from "node:path";

const README_PATH = join(import.meta.dir, "../../README.md");

function stripMigrationSection(md: string): string {
  const lines = md.split("\n");
  const start = lines.findIndex(l => /^## Migration\b/.test(l));
  if (start < 0) return md;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) { end = i; break; }
  }
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n");
}

test("README does not reference @bastani/atomic for SDK consumers", async () => {
  const md = stripMigrationSection(await Bun.file(README_PATH).text());
  const lines = md.split("\n");
  const offenders: string[] = [];
  let inFence = false;
  let fenceContext = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      if (!inFence) { fenceContext = ""; inFence = true; }
      else { inFence = false; }
      continue;
    }
    if (inFence) fenceContext += line + "\n";
    // Match @bastani/atomic" (closing quote) NOT followed by -sdk; check both `"@bastani/atomic"` and `from "@bastani/atomic/...`
    const matches = [...line.matchAll(/@bastani\/atomic(?!-sdk)(?:["/])/g)];
    if (matches.length === 0) continue;
    const isGlobalCliInstall = inFence && /\b(bun|npm)\s+install\s+-g\b/.test(fenceContext);
    if (isGlobalCliInstall) continue;
    offenders.push(`L${i + 1}: ${line.trim()}`);
  }
  expect(offenders).toEqual([]);
});
