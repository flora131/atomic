/**
 * Lint script: Enforce dependency direction (no services → commands).
 *
 * Rule: Files in `src/services/` must not import from `src/commands/`.
 * The intended dependency direction is: commands → services (not vice versa).
 *
 * Shared types that both layers need should live in `src/types/` or in
 * the service layer itself.
 *
 * Known legacy allowlist entries are tracked with TODOs for future cleanup.
 */

import { Glob } from "bun";
import * as path from "node:path";

const SERVICES_DIR = path.resolve(import.meta.dir, "../services");
const SRC_DIR = path.resolve(import.meta.dir, "..");

/**
 * Legacy re-exports that require a larger refactor to fix.
 * Each entry documents why the violation exists and what would fix it.
 *
 * Format: "relative/path/from/services:line-content-substring"
 */
const ALLOWLIST: ReadonlySet<string> = new Set([
  // TODO: Move discoverAgentInfos/getDiscoveredAgent implementation from
  // commands/catalog/agents/discovery.ts into services/agent-discovery/.
  // Blocked on also moving definition-integrity.ts and discovery-paths.ts.
  "agent-discovery/discovery.ts",
]);

const IMPORT_COMMANDS_RE =
  /from\s+["'](?:@\/commands\/[^"']+|\.\.\/(?:\.\.\/)*commands\/[^"']+)["']/;

interface Violation {
  file: string;
  line: number;
  text: string;
}

async function checkFile(filePath: string): Promise<Violation[]> {
  const violations: Violation[] = [];
  const content = await Bun.file(filePath).text();
  const lines = content.split("\n");
  const relativePath = path.relative(SERVICES_DIR, filePath);

  if (ALLOWLIST.has(relativePath)) {
    return [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (IMPORT_COMMANDS_RE.test(line)) {
      violations.push({
        file: path.relative(process.cwd(), filePath),
        line: i + 1,
        text: line.trim(),
      });
    }
  }

  return violations;
}

async function main(): Promise<void> {
  const allViolations: Violation[] = [];
  const glob = new Glob("**/*.{ts,tsx}");

  for await (const file of glob.scan({ cwd: SERVICES_DIR, absolute: true })) {
    const violations = await checkFile(file);
    allViolations.push(...violations);
  }

  if (allViolations.length === 0) {
    console.log(
      "✓ No dependency direction violations found (services/ does not import from commands/)",
    );
    process.exit(0);
  }

  console.error(
    `✗ Found ${allViolations.length} dependency direction violation(s):\n`,
  );
  for (const v of allViolations) {
    console.error(
      `  ${v.file}:${v.line} → services/ must not import from commands/`,
    );
    console.error(`    ${v.text}\n`);
  }
  console.error(
    "The dependency direction rule is: commands/ → services/ (not vice versa).\n" +
      "Move shared types to src/types/ or the service layer.",
  );
  process.exit(1);
}

main();
