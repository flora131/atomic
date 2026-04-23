import { describe, test, expect } from "bun:test";
import {
  compactDiffStat,
  compactReminder,
  compactScratchFile,
  compactUncommitted,
  deriveHistoryBrief,
  infraInvalidationPaths,
  isInfraPath,
  maskChangeset,
  shouldReRunInfraDiscovery,
  truncateMarkdownReport,
} from "./masking.ts";
import {
  appendToSection,
  detectSpecPath,
  extractSection,
  replaceSection,
} from "./scratchpad.ts";

describe("isInfraPath", () => {
  test("matches lockfiles, manifests, configs, CI, agent instructions", () => {
    const hits = [
      "package.json",
      "packages/foo/package.json",
      "bun.lock",
      "bun.lockb",
      "go.sum",
      "Cargo.lock",
      "pnpm-lock.yaml",
      "tsconfig.json",
      "tsconfig.build.json",
      "vitest.config.ts",
      "jest.config.cjs",
      "eslint.config.mjs",
      "biome.json",
      ".eslintrc.json",
      ".github/workflows/ci.yml",
      ".gitlab-ci.yml",
      "Jenkinsfile",
      "CLAUDE.md",
      "AGENTS.md",
      ".claude/settings.json",
      ".github/copilot-instructions.md",
      ".github/agents/reviewer.md",
      ".agents/skills/foo.md",
    ];
    for (const p of hits) expect(isInfraPath(p)).toBe(true);
  });

  test("does NOT match ordinary source files", () => {
    const misses = [
      "src/index.ts",
      "src/package/foo.ts",
      "docs/readme.md",
      "tests/auth.test.ts",
    ];
    for (const p of misses) expect(isInfraPath(p)).toBe(false);
  });
});

describe("infraInvalidationPaths / shouldReRunInfraDiscovery", () => {
  const cs = (opts: Partial<{ nameStatus: string; uncommitted: string }>) => ({
    baseBranch: "main",
    diffStat: "",
    uncommitted: opts.uncommitted ?? "",
    nameStatus: opts.nameStatus ?? "",
    errors: [],
  });

  test("untracked infra file in `git status -s` triggers invalidation", () => {
    const result = infraInvalidationPaths(cs({ uncommitted: "?? package.json" }));
    expect(result).toEqual(["package.json"]);
    expect(shouldReRunInfraDiscovery(cs({ uncommitted: "?? package.json" }))).toBe(true);
  });

  test("renames use destination path", () => {
    const result = infraInvalidationPaths(
      cs({ nameStatus: "R100\told.ts\tnew.ts\nM\ttsconfig.json" }),
    );
    expect(result).toContain("tsconfig.json");
  });

  test("pure source-file changes do NOT trigger invalidation", () => {
    expect(
      shouldReRunInfraDiscovery(
        cs({
          nameStatus: "M\tsrc/auth.ts\nA\tsrc/newfile.ts",
          uncommitted: " M src/auth.ts",
        }),
      ),
    ).toBe(false);
  });
});

describe("compactDiffStat", () => {
  test("preserves output when under top-N", () => {
    const input = " file.ts | 5 +++++\n 1 file changed, 5 insertions(+)";
    expect(compactDiffStat(input)).toBe(input);
  });

  test("keeps top-N by churn + elision marker", () => {
    const lines: string[] = [];
    for (let i = 0; i < 30; i++) lines.push(` file${i}.ts | ${i + 1} +++`);
    lines.push(" 30 files changed, 465 insertions(+)");
    const out = compactDiffStat(lines.join("\n"));
    expect(out).toContain("30 files changed");
    expect(out).toContain("additional files elided");
    expect(out).toContain("file29.ts");
  });
});

describe("compactUncommitted — untracked safety", () => {
  test("ALL ?? entries retained", () => {
    const lines: string[] = [];
    for (let i = 0; i < 50; i++) lines.push(` M staged${i}.ts`);
    lines.push("?? untracked-1.ts");
    lines.push("?? untracked-2.ts");
    const out = compactUncommitted(lines.join("\n"));
    expect(out).toContain("?? untracked-1.ts");
    expect(out).toContain("?? untracked-2.ts");
    expect(out).toContain("additional staged/modified entries elided");
  });

  test("no elision when under threshold", () => {
    const input = " M a.ts\n M b.ts\n?? c.ts";
    expect(compactUncommitted(input)).toBe(input);
  });
});

describe("maskChangeset", () => {
  test("short-circuits for small changesets", () => {
    const cs = {
      baseBranch: "main",
      diffStat: "small",
      uncommitted: "",
      nameStatus: "",
      errors: [],
    };
    expect(maskChangeset(cs)).toBe(cs);
  });
});

describe("truncateMarkdownReport", () => {
  test("returns verbatim when under cap", () => {
    expect(truncateMarkdownReport("short", 100)).toBe("short");
  });

  test("inserts marker with head + tail when over cap", () => {
    const big = "a".repeat(20_000);
    const out = truncateMarkdownReport(big, 1000);
    expect(out.length).toBeLessThanOrEqual(1200);
    expect(out).toContain("[… truncated");
  });
});

describe("deriveHistoryBrief", () => {
  test("prefers Synthesis section", () => {
    const input = `### Documents Reviewed\n- \`a.md\`\n\n### Synthesis\nthe real content lives here`;
    const out = deriveHistoryBrief(input, 50);
    expect(out).toBe("the real content lives here");
  });

  test("caps at maxWords", () => {
    const many = Array(200).fill("word").join(" ");
    const out = deriveHistoryBrief(many, 10);
    expect(out.endsWith("…")).toBe(true);
  });

  test("empty input → empty output", () => {
    expect(deriveHistoryBrief("")).toBe("");
  });
});

describe("compactReminder", () => {
  test("joins with pipes", () => {
    expect(
      compactReminder({ intent: "refactor auth", iteration: 3, extra: "+5 files" }),
    ).toBe("iteration 3 | refactor auth | +5 files");
  });
});

describe("scratchpad section utilities", () => {
  const sample = `# Heading\n\n## A\nfirst\n\n## B\nsecond\n\n## C\nthird\n`;

  test("extractSection", () => {
    expect(extractSection(sample, "B")).toBe("second");
    expect(extractSection(sample, "missing")).toBe("");
  });

  test("replaceSection preserves order", () => {
    const out = replaceSection(sample, "B", "REPLACED");
    expect(extractSection(out, "B")).toBe("REPLACED");
    expect(extractSection(out, "A")).toBe("first");
    expect(extractSection(out, "C")).toBe("third");
  });

  test("appendToSection concatenates", () => {
    const out = appendToSection(sample, "A", "appended");
    expect(extractSection(out, "A")).toBe("first\n\nappended");
  });
});

describe("detectSpecPath", () => {
  test.each([
    ["specs/foo.md", "specs/foo.md"],
    ["./notes.txt", "./notes.txt"],
    ["/abs/path.md", "/abs/path.md"],
    ["~/docs/thing.rst", "~/docs/thing.rst"],
  ])("detects path %p", (input, expected) => {
    expect(detectSpecPath(input)).toBe(expected);
  });

  test.each([
    ["# Full RFC\n\nThis is inline."],
    ["Multi-line\nprose content."],
    [""],
  ])("rejects non-path %p", (input) => {
    expect(detectSpecPath(input)).toBeNull();
  });
});

describe("compactScratchFile", () => {
  test("returns verbatim when under cap", () => {
    const small = "## A\nbody\n## B\nbody";
    expect(compactScratchFile(small, 1000)).toBe(small);
  });

  test("preserves all ## headings even when bodies are elided", () => {
    const big =
      "## Scope\n" +
      "x".repeat(2000) +
      "\n## Files in Scope\n" +
      "y".repeat(2000) +
      "\n## How It Works\n" +
      "z".repeat(2000);
    const out = compactScratchFile(big, 600);
    expect(out).toContain("## Scope");
    expect(out).toContain("## Files in Scope");
    expect(out).toContain("## How It Works");
    expect(out).toContain("elided");
    expect(out.length).toBeLessThan(big.length);
  });

  test("preserves ### sub-headings", () => {
    const input =
      "## A\n" + "p".repeat(500) + "\n### Sub\n" + "q".repeat(500);
    const out = compactScratchFile(input, 200);
    expect(out).toContain("## A");
    expect(out).toContain("### Sub");
  });
});
