/**
 * Lint script: Enforce state/chat sub-module boundary rules.
 *
 * Rule: No sub-module may import from another sub-module's internal files.
 *       Sibling imports must go through the sub-module's barrel (index.ts).
 *       Imports from shared/ and the module's own files are always allowed.
 */

import { Glob } from "bun";
import * as path from "node:path";

const SUB_MODULES = [
  "agent",
  "command",
  "composer",
  "controller",
  "keyboard",
  "session",
  "shell",
  "stream",
] as const;

const CHAT_DIR = path.resolve(import.meta.dir, "../state/chat");

// Matches: from "@/state/chat/<submodule>/<internal-file>"
// or:      from "../<submodule>/<internal-file>"
const ABSOLUTE_IMPORT_RE =
  /from\s+["']@\/state\/chat\/(agent|command|composer|controller|keyboard|session|shell|stream)\/([^"']+)["']/g;
const RELATIVE_IMPORT_RE =
  /from\s+["']\.\.\/(agent|command|composer|controller|keyboard|session|shell|stream)\/([^"']+)["']/g;

interface Violation {
  file: string;
  line: number;
  importedModule: string;
  importedPath: string;
  text: string;
}

async function checkFile(filePath: string, ownerModule: string): Promise<Violation[]> {
  const violations: Violation[] = [];
  const content = await Bun.file(filePath).text();
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    for (const regex of [ABSOLUTE_IMPORT_RE, RELATIVE_IMPORT_RE]) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(line)) !== null) {
        const importedModule = match[1] ?? "";
        const importedPath = match[2] ?? "";

        // Allow imports from own sub-module
        if (importedModule === ownerModule) continue;

        // Allow barrel imports (index.ts)
        if (importedPath === "index.ts" || importedPath === "index") continue;

        violations.push({
          file: path.relative(process.cwd(), filePath),
          line: i + 1,
          importedModule,
          importedPath,
          text: line.trim(),
        });
      }
    }
  }

  return violations;
}

async function main(): Promise<void> {
  const allViolations: Violation[] = [];

  for (const subModule of SUB_MODULES) {
    const subModuleDir = path.join(CHAT_DIR, subModule);
    const glob = new Glob("**/*.{ts,tsx}");

    for await (const file of glob.scan({ cwd: subModuleDir, absolute: true })) {
      // Skip barrel files themselves
      if (file.endsWith("/index.ts")) continue;

      const violations = await checkFile(file, subModule);
      allViolations.push(...violations);
    }
  }

  if (allViolations.length === 0) {
    console.log("✓ No sub-module boundary violations found in state/chat/");
    process.exit(0);
  }

  console.error(`✗ Found ${allViolations.length} sub-module boundary violation(s):\n`);
  for (const v of allViolations) {
    console.error(
      `  ${v.file}:${v.line} → imports internal file from sibling "${v.importedModule}/"`
    );
    console.error(`    ${v.text}\n`);
  }
  console.error(
    "Sub-modules must import from sibling barrels (index.ts) or shared/, not internal files."
  );
  process.exit(1);
}

main();
