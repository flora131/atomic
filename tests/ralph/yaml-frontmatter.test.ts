import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Tests for YAML frontmatter parsing and writing utilities
 *
 * Tests the core YAML frontmatter functionality used across Ralph loop scripts:
 * - .github/scripts/start-ralph-session.ts
 * - .github/scripts/cancel-ralph.ts
 * - .github/hooks/stop-hook.ts
 * - .opencode/plugin/ralph.ts
 *
 * Feature 7 from research/feature-list.json
 */

const TEST_DIR = ".github-test-yaml";
const STATE_FILE = join(TEST_DIR, "ralph-loop.local.md");

// ============================================================================
// INTERFACES (duplicated from source for testing)
// ============================================================================

interface RalphState {
  active: boolean;
  iteration: number;
  maxIterations: number;
  completionPromise: string | null;
  featureListPath: string;
  startedAt: string;
  prompt: string;
}

// ============================================================================
// YAML FRONTMATTER UTILITIES (extracted for testing)
// These mirror the implementations in the source files
// ============================================================================

function parseRalphState(filePath: string): RalphState | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    // Normalize line endings to LF for cross-platform compatibility
    const content = readFileSync(filePath, "utf-8").replace(/\r\n/g, "\n");

    // Parse YAML frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!frontmatterMatch) {
      return null;
    }

    const [, frontmatter, prompt] = frontmatterMatch;
    if (!frontmatter) return null;

    // Parse frontmatter values
    const getValue = (key: string): string | null => {
      const match = frontmatter.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
      if (!match?.[1]) return null;
      // Remove surrounding quotes if present
      return match[1].replace(/^["'](.*)["']$/, "$1");
    };

    const active = getValue("active") === "true";
    const iteration = parseInt(getValue("iteration") || "1", 10);
    const maxIterations = parseInt(getValue("max_iterations") || "0", 10);
    const completionPromise = getValue("completion_promise");
    const featureListPath = getValue("feature_list_path") || "research/feature-list.json";
    const startedAt = getValue("started_at") || new Date().toISOString();

    return {
      active,
      iteration,
      maxIterations,
      completionPromise:
        completionPromise === "null" || !completionPromise ? null : completionPromise,
      featureListPath,
      startedAt,
      prompt: (prompt ?? "").trim(),
    };
  } catch {
    return null;
  }
}

function writeRalphState(filePath: string, state: RalphState): void {
  const completionPromiseYaml =
    state.completionPromise === null ? "null" : `"${state.completionPromise}"`;

  const content = `---
active: ${state.active}
iteration: ${state.iteration}
max_iterations: ${state.maxIterations}
completion_promise: ${completionPromiseYaml}
feature_list_path: ${state.featureListPath}
started_at: "${state.startedAt}"
---

${state.prompt}
`;

  writeFileSync(filePath, content, "utf-8");
}

// ============================================================================
// TEST SETUP
// ============================================================================

describe("YAML Frontmatter Utilities", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  // ==========================================================================
  // PARSING TESTS
  // ==========================================================================

  describe("parseRalphState", () => {
    describe("valid YAML frontmatter", () => {
      test("parses all fields correctly", () => {
        const content = `---
active: true
iteration: 5
max_iterations: 20
completion_promise: "All tests pass"
feature_list_path: custom/features.json
started_at: "2026-01-24T10:00:00Z"
---

This is the prompt content.
`;
        writeFileSync(STATE_FILE, content);

        const state = parseRalphState(STATE_FILE);

        expect(state).not.toBeNull();
        expect(state!.active).toBe(true);
        expect(state!.iteration).toBe(5);
        expect(state!.maxIterations).toBe(20);
        expect(state!.completionPromise).toBe("All tests pass");
        expect(state!.featureListPath).toBe("custom/features.json");
        expect(state!.startedAt).toBe("2026-01-24T10:00:00Z");
        expect(state!.prompt).toBe("This is the prompt content.");
      });

      test("parses active: false correctly", () => {
        const content = `---
active: false
iteration: 3
max_iterations: 10
completion_promise: null
feature_list_path: research/feature-list.json
started_at: "2026-01-24T10:00:00Z"
---

Inactive loop prompt.
`;
        writeFileSync(STATE_FILE, content);

        const state = parseRalphState(STATE_FILE);

        expect(state).not.toBeNull();
        expect(state!.active).toBe(false);
      });

      test("parses iteration: 1 as default start", () => {
        const content = `---
active: true
iteration: 1
max_iterations: 0
completion_promise: null
feature_list_path: research/feature-list.json
started_at: "2026-01-24T10:00:00Z"
---

First iteration prompt.
`;
        writeFileSync(STATE_FILE, content);

        const state = parseRalphState(STATE_FILE);

        expect(state).not.toBeNull();
        expect(state!.iteration).toBe(1);
      });

      test("parses max_iterations: 0 as unlimited", () => {
        const content = `---
active: true
iteration: 10
max_iterations: 0
completion_promise: "DONE"
feature_list_path: research/feature-list.json
started_at: "2026-01-24T10:00:00Z"
---

Unlimited iterations prompt.
`;
        writeFileSync(STATE_FILE, content);

        const state = parseRalphState(STATE_FILE);

        expect(state).not.toBeNull();
        expect(state!.maxIterations).toBe(0);
      });
    });

    describe("missing optional fields", () => {
      test("uses default feature_list_path when missing", () => {
        const content = `---
active: true
iteration: 1
max_iterations: 10
completion_promise: null
started_at: "2026-01-24T10:00:00Z"
---

Prompt without feature path.
`;
        writeFileSync(STATE_FILE, content);

        const state = parseRalphState(STATE_FILE);

        expect(state).not.toBeNull();
        expect(state!.featureListPath).toBe("research/feature-list.json");
      });

      test("handles missing iteration with default of 1", () => {
        const content = `---
active: true
max_iterations: 10
completion_promise: null
feature_list_path: research/feature-list.json
started_at: "2026-01-24T10:00:00Z"
---

No iteration specified.
`;
        writeFileSync(STATE_FILE, content);

        const state = parseRalphState(STATE_FILE);

        expect(state).not.toBeNull();
        expect(state!.iteration).toBe(1);
      });

      test("handles missing max_iterations with default of 0", () => {
        const content = `---
active: true
iteration: 5
completion_promise: null
feature_list_path: research/feature-list.json
started_at: "2026-01-24T10:00:00Z"
---

No max iterations specified.
`;
        writeFileSync(STATE_FILE, content);

        const state = parseRalphState(STATE_FILE);

        expect(state).not.toBeNull();
        expect(state!.maxIterations).toBe(0);
      });

      test("generates started_at when missing", () => {
        const content = `---
active: true
iteration: 1
max_iterations: 10
completion_promise: null
feature_list_path: research/feature-list.json
---

No started_at specified.
`;
        writeFileSync(STATE_FILE, content);

        const state = parseRalphState(STATE_FILE);

        expect(state).not.toBeNull();
        expect(state!.startedAt).toBeTruthy();
        // Should be a valid ISO date string
        expect(() => new Date(state!.startedAt)).not.toThrow();
      });
    });

    describe("empty or malformed frontmatter", () => {
      test("returns null for missing file", () => {
        const state = parseRalphState(join(TEST_DIR, "nonexistent.md"));
        expect(state).toBeNull();
      });

      test("returns null for empty file", () => {
        writeFileSync(STATE_FILE, "");

        const state = parseRalphState(STATE_FILE);
        expect(state).toBeNull();
      });

      test("returns null for file without frontmatter delimiters", () => {
        writeFileSync(STATE_FILE, "Just plain text without frontmatter.");

        const state = parseRalphState(STATE_FILE);
        expect(state).toBeNull();
      });

      test("returns null for incomplete frontmatter (missing closing ---)", () => {
        const content = `---
active: true
iteration: 1

This has no closing delimiter.
`;
        writeFileSync(STATE_FILE, content);

        const state = parseRalphState(STATE_FILE);
        expect(state).toBeNull();
      });

      test("returns null for frontmatter without opening ---", () => {
        const content = `active: true
iteration: 1
---

Missing opening delimiter.
`;
        writeFileSync(STATE_FILE, content);

        const state = parseRalphState(STATE_FILE);
        expect(state).toBeNull();
      });

      test("returns null for file with only frontmatter delimiters (no newline after opening)", () => {
        // The regex requires a newline after the opening ---
        // This is intentional - empty frontmatter is not valid
        const content = `------

`;
        writeFileSync(STATE_FILE, content);

        const state = parseRalphState(STATE_FILE);
        expect(state).toBeNull();
      });

      test("parses minimal valid frontmatter with empty body", () => {
        // Valid frontmatter requires newline after opening ---
        const content = `---
active: true
---

`;
        writeFileSync(STATE_FILE, content);

        const state = parseRalphState(STATE_FILE);

        expect(state).not.toBeNull();
        expect(state!.active).toBe(true);
        expect(state!.iteration).toBe(1);
        expect(state!.prompt).toBe("");
      });
    });

    describe("completion_promise variations", () => {
      test("parses null completion_promise correctly", () => {
        const content = `---
active: true
iteration: 1
max_iterations: 10
completion_promise: null
feature_list_path: research/feature-list.json
started_at: "2026-01-24T10:00:00Z"
---

Null promise prompt.
`;
        writeFileSync(STATE_FILE, content);

        const state = parseRalphState(STATE_FILE);

        expect(state).not.toBeNull();
        expect(state!.completionPromise).toBeNull();
      });

      test("parses quoted string completion_promise", () => {
        const content = `---
active: true
iteration: 1
max_iterations: 10
completion_promise: "DONE"
feature_list_path: research/feature-list.json
started_at: "2026-01-24T10:00:00Z"
---

Simple promise prompt.
`;
        writeFileSync(STATE_FILE, content);

        const state = parseRalphState(STATE_FILE);

        expect(state).not.toBeNull();
        expect(state!.completionPromise).toBe("DONE");
      });

      test("parses completion_promise with spaces", () => {
        const content = `---
active: true
iteration: 1
max_iterations: 10
completion_promise: "All tests pass and feature is complete"
feature_list_path: research/feature-list.json
started_at: "2026-01-24T10:00:00Z"
---

Promise with spaces prompt.
`;
        writeFileSync(STATE_FILE, content);

        const state = parseRalphState(STATE_FILE);

        expect(state).not.toBeNull();
        expect(state!.completionPromise).toBe("All tests pass and feature is complete");
      });

      test("parses single-quoted completion_promise", () => {
        const content = `---
active: true
iteration: 1
max_iterations: 10
completion_promise: 'Single quoted promise'
feature_list_path: research/feature-list.json
started_at: "2026-01-24T10:00:00Z"
---

Single quote prompt.
`;
        writeFileSync(STATE_FILE, content);

        const state = parseRalphState(STATE_FILE);

        expect(state).not.toBeNull();
        expect(state!.completionPromise).toBe("Single quoted promise");
      });
    });

    describe("cross-platform compatibility", () => {
      test("handles Windows line endings (CRLF)", () => {
        const content =
          "---\r\nactive: true\r\niteration: 3\r\nmax_iterations: 10\r\ncompletion_promise: \"DONE\"\r\nfeature_list_path: research/feature-list.json\r\nstarted_at: \"2026-01-24T10:00:00Z\"\r\n---\r\n\r\nWindows CRLF prompt.\r\n";
        writeFileSync(STATE_FILE, content);

        const state = parseRalphState(STATE_FILE);

        expect(state).not.toBeNull();
        expect(state!.active).toBe(true);
        expect(state!.iteration).toBe(3);
        expect(state!.prompt).toBe("Windows CRLF prompt.");
      });

      test("handles mixed line endings", () => {
        const content =
          "---\nactive: true\r\niteration: 2\nmax_iterations: 5\r\ncompletion_promise: null\nfeature_list_path: research/feature-list.json\r\nstarted_at: \"2026-01-24T10:00:00Z\"\n---\r\n\nMixed endings prompt.\n";
        writeFileSync(STATE_FILE, content);

        const state = parseRalphState(STATE_FILE);

        expect(state).not.toBeNull();
        expect(state!.active).toBe(true);
        expect(state!.iteration).toBe(2);
      });

      test("handles trailing whitespace in frontmatter values", () => {
        const content = `---
active: true
iteration: 5
max_iterations: 10
completion_promise: "DONE"
feature_list_path: research/feature-list.json
started_at: "2026-01-24T10:00:00Z"
---

Trailing whitespace prompt.
`;
        writeFileSync(STATE_FILE, content);

        const state = parseRalphState(STATE_FILE);

        // Note: Current implementation may include trailing spaces
        // This test documents current behavior
        expect(state).not.toBeNull();
        expect(state!.active).toBe(true);
      });
    });

    describe("special characters in prompts", () => {
      test("handles prompt with markdown formatting", () => {
        const content = `---
active: true
iteration: 1
max_iterations: 10
completion_promise: null
feature_list_path: research/feature-list.json
started_at: "2026-01-24T10:00:00Z"
---

# Heading

**Bold text** and *italic text*

- List item 1
- List item 2

\`\`\`javascript
const code = "example";
\`\`\`
`;
        writeFileSync(STATE_FILE, content);

        const state = parseRalphState(STATE_FILE);

        expect(state).not.toBeNull();
        expect(state!.prompt).toContain("# Heading");
        expect(state!.prompt).toContain("**Bold text**");
        expect(state!.prompt).toContain("```javascript");
      });

      test("handles prompt with special YAML characters", () => {
        const content = `---
active: true
iteration: 1
max_iterations: 10
completion_promise: null
feature_list_path: research/feature-list.json
started_at: "2026-01-24T10:00:00Z"
---

Prompt with special chars: @#$%^&*()[]{}|\\;':",.<>?/\`~
`;
        writeFileSync(STATE_FILE, content);

        const state = parseRalphState(STATE_FILE);

        expect(state).not.toBeNull();
        expect(state!.prompt).toContain("@#$%^&*()");
      });

      test("handles prompt with unicode characters", () => {
        const content = `---
active: true
iteration: 1
max_iterations: 10
completion_promise: null
feature_list_path: research/feature-list.json
started_at: "2026-01-24T10:00:00Z"
---

Unicode: 日本語 中文 한국어 🎉 🚀 ✅
`;
        writeFileSync(STATE_FILE, content);

        const state = parseRalphState(STATE_FILE);

        expect(state).not.toBeNull();
        expect(state!.prompt).toContain("日本語");
        expect(state!.prompt).toContain("🎉");
      });

      test("handles multiline prompt correctly", () => {
        const content = `---
active: true
iteration: 1
max_iterations: 10
completion_promise: null
feature_list_path: research/feature-list.json
started_at: "2026-01-24T10:00:00Z"
---

Line 1 of the prompt.

Line 2 after blank line.

Line 3 with more content.
Final line.
`;
        writeFileSync(STATE_FILE, content);

        const state = parseRalphState(STATE_FILE);

        expect(state).not.toBeNull();
        expect(state!.prompt).toContain("Line 1 of the prompt.");
        expect(state!.prompt).toContain("Line 2 after blank line.");
        expect(state!.prompt).toContain("Final line.");
      });
    });
  });

  // ==========================================================================
  // WRITING TESTS
  // ==========================================================================

  describe("writeRalphState", () => {
    describe("basic writing", () => {
      test("writes all fields correctly", () => {
        const state: RalphState = {
          active: true,
          iteration: 5,
          maxIterations: 20,
          completionPromise: "All tests pass",
          featureListPath: "custom/features.json",
          startedAt: "2026-01-24T10:00:00Z",
          prompt: "This is the prompt content.",
        };

        writeRalphState(STATE_FILE, state);

        const content = readFileSync(STATE_FILE, "utf-8");

        expect(content).toContain("active: true");
        expect(content).toContain("iteration: 5");
        expect(content).toContain("max_iterations: 20");
        expect(content).toContain('completion_promise: "All tests pass"');
        expect(content).toContain("feature_list_path: custom/features.json");
        expect(content).toContain('started_at: "2026-01-24T10:00:00Z"');
        expect(content).toContain("This is the prompt content.");
      });

      test("writes active: false correctly", () => {
        const state: RalphState = {
          active: false,
          iteration: 3,
          maxIterations: 10,
          completionPromise: null,
          featureListPath: "research/feature-list.json",
          startedAt: "2026-01-24T10:00:00Z",
          prompt: "Inactive state.",
        };

        writeRalphState(STATE_FILE, state);

        const content = readFileSync(STATE_FILE, "utf-8");
        expect(content).toContain("active: false");
      });

      test("writes null completion_promise correctly", () => {
        const state: RalphState = {
          active: true,
          iteration: 1,
          maxIterations: 10,
          completionPromise: null,
          featureListPath: "research/feature-list.json",
          startedAt: "2026-01-24T10:00:00Z",
          prompt: "Null promise.",
        };

        writeRalphState(STATE_FILE, state);

        const content = readFileSync(STATE_FILE, "utf-8");
        expect(content).toContain("completion_promise: null");
      });

      test("writes max_iterations: 0 (unlimited) correctly", () => {
        const state: RalphState = {
          active: true,
          iteration: 1,
          maxIterations: 0,
          completionPromise: null,
          featureListPath: "research/feature-list.json",
          startedAt: "2026-01-24T10:00:00Z",
          prompt: "Unlimited iterations.",
        };

        writeRalphState(STATE_FILE, state);

        const content = readFileSync(STATE_FILE, "utf-8");
        expect(content).toContain("max_iterations: 0");
      });
    });

    describe("special content handling", () => {
      test("writes multiline prompt correctly", () => {
        const state: RalphState = {
          active: true,
          iteration: 1,
          maxIterations: 10,
          completionPromise: null,
          featureListPath: "research/feature-list.json",
          startedAt: "2026-01-24T10:00:00Z",
          prompt: "Line 1\n\nLine 2\n\nLine 3",
        };

        writeRalphState(STATE_FILE, state);

        const content = readFileSync(STATE_FILE, "utf-8");
        expect(content).toContain("Line 1\n\nLine 2\n\nLine 3");
      });

      test("writes prompt with markdown correctly", () => {
        const state: RalphState = {
          active: true,
          iteration: 1,
          maxIterations: 10,
          completionPromise: null,
          featureListPath: "research/feature-list.json",
          startedAt: "2026-01-24T10:00:00Z",
          prompt: "# Heading\n\n**Bold** and *italic*\n\n```code```",
        };

        writeRalphState(STATE_FILE, state);

        const content = readFileSync(STATE_FILE, "utf-8");
        expect(content).toContain("# Heading");
        expect(content).toContain("**Bold**");
      });

      test("writes prompt with special characters correctly", () => {
        const state: RalphState = {
          active: true,
          iteration: 1,
          maxIterations: 10,
          completionPromise: null,
          featureListPath: "research/feature-list.json",
          startedAt: "2026-01-24T10:00:00Z",
          prompt: "Special: @#$%^&*()[]{}|\\;':\",.<>?/`~",
        };

        writeRalphState(STATE_FILE, state);

        const content = readFileSync(STATE_FILE, "utf-8");
        expect(content).toContain("@#$%^&*()");
      });

      test("writes unicode content correctly", () => {
        const state: RalphState = {
          active: true,
          iteration: 1,
          maxIterations: 10,
          completionPromise: null,
          featureListPath: "research/feature-list.json",
          startedAt: "2026-01-24T10:00:00Z",
          prompt: "Unicode: 日本語 🎉 ✅",
        };

        writeRalphState(STATE_FILE, state);

        const content = readFileSync(STATE_FILE, "utf-8");
        expect(content).toContain("日本語");
        expect(content).toContain("🎉");
      });

      test("writes completion_promise with spaces correctly", () => {
        const state: RalphState = {
          active: true,
          iteration: 1,
          maxIterations: 10,
          completionPromise: "All tests pass and feature complete",
          featureListPath: "research/feature-list.json",
          startedAt: "2026-01-24T10:00:00Z",
          prompt: "Promise with spaces.",
        };

        writeRalphState(STATE_FILE, state);

        const content = readFileSync(STATE_FILE, "utf-8");
        expect(content).toContain('"All tests pass and feature complete"');
      });
    });
  });

  // ==========================================================================
  // ROUND-TRIP TESTS
  // ==========================================================================

  describe("round-trip consistency", () => {
    test("write then parse preserves all fields", () => {
      const originalState: RalphState = {
        active: true,
        iteration: 7,
        maxIterations: 25,
        completionPromise: "Feature implemented",
        featureListPath: "custom/path/features.json",
        startedAt: "2026-01-24T15:30:00Z",
        prompt: "Original prompt content.",
      };

      writeRalphState(STATE_FILE, originalState);
      const parsedState = parseRalphState(STATE_FILE);

      expect(parsedState).not.toBeNull();
      expect(parsedState!.active).toBe(originalState.active);
      expect(parsedState!.iteration).toBe(originalState.iteration);
      expect(parsedState!.maxIterations).toBe(originalState.maxIterations);
      expect(parsedState!.completionPromise).toBe(originalState.completionPromise);
      expect(parsedState!.featureListPath).toBe(originalState.featureListPath);
      expect(parsedState!.startedAt).toBe(originalState.startedAt);
      expect(parsedState!.prompt).toBe(originalState.prompt);
    });

    test("write then parse preserves null completion_promise", () => {
      const originalState: RalphState = {
        active: true,
        iteration: 1,
        maxIterations: 10,
        completionPromise: null,
        featureListPath: "research/feature-list.json",
        startedAt: "2026-01-24T10:00:00Z",
        prompt: "Null promise round-trip.",
      };

      writeRalphState(STATE_FILE, originalState);
      const parsedState = parseRalphState(STATE_FILE);

      expect(parsedState).not.toBeNull();
      expect(parsedState!.completionPromise).toBeNull();
    });

    test("write then parse preserves multiline prompt", () => {
      const originalState: RalphState = {
        active: true,
        iteration: 1,
        maxIterations: 10,
        completionPromise: null,
        featureListPath: "research/feature-list.json",
        startedAt: "2026-01-24T10:00:00Z",
        prompt: "Line 1\n\nLine 2\n\nLine 3\n\n# Heading\n\n- Item 1\n- Item 2",
      };

      writeRalphState(STATE_FILE, originalState);
      const parsedState = parseRalphState(STATE_FILE);

      expect(parsedState).not.toBeNull();
      expect(parsedState!.prompt).toBe(originalState.prompt);
    });

    test("multiple write-parse cycles maintain consistency", () => {
      let state: RalphState = {
        active: true,
        iteration: 1,
        maxIterations: 100,
        completionPromise: "DONE",
        featureListPath: "research/feature-list.json",
        startedAt: "2026-01-24T10:00:00Z",
        prompt: "Initial prompt.",
      };

      // Simulate multiple iterations
      for (let i = 1; i <= 5; i++) {
        writeRalphState(STATE_FILE, state);
        const parsed = parseRalphState(STATE_FILE);

        expect(parsed).not.toBeNull();
        expect(parsed!.iteration).toBe(state.iteration);

        // Increment for next iteration
        state = { ...parsed!, iteration: parsed!.iteration + 1 };
      }

      expect(state.iteration).toBe(6);
    });

    test("write-parse cycle preserves unicode content", () => {
      const originalState: RalphState = {
        active: true,
        iteration: 1,
        maxIterations: 10,
        completionPromise: "完了",
        featureListPath: "research/feature-list.json",
        startedAt: "2026-01-24T10:00:00Z",
        prompt: "日本語テスト 🎉 中文测试 한국어 테스트",
      };

      writeRalphState(STATE_FILE, originalState);
      const parsedState = parseRalphState(STATE_FILE);

      expect(parsedState).not.toBeNull();
      expect(parsedState!.completionPromise).toBe("完了");
      expect(parsedState!.prompt).toContain("日本語テスト");
      expect(parsedState!.prompt).toContain("🎉");
    });
  });

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe("edge cases", () => {
    test("handles empty prompt", () => {
      const state: RalphState = {
        active: true,
        iteration: 1,
        maxIterations: 10,
        completionPromise: null,
        featureListPath: "research/feature-list.json",
        startedAt: "2026-01-24T10:00:00Z",
        prompt: "",
      };

      writeRalphState(STATE_FILE, state);
      const parsed = parseRalphState(STATE_FILE);

      expect(parsed).not.toBeNull();
      expect(parsed!.prompt).toBe("");
    });

    test("handles very large iteration number", () => {
      const state: RalphState = {
        active: true,
        iteration: 999999,
        maxIterations: 1000000,
        completionPromise: null,
        featureListPath: "research/feature-list.json",
        startedAt: "2026-01-24T10:00:00Z",
        prompt: "Large iteration test.",
      };

      writeRalphState(STATE_FILE, state);
      const parsed = parseRalphState(STATE_FILE);

      expect(parsed).not.toBeNull();
      expect(parsed!.iteration).toBe(999999);
      expect(parsed!.maxIterations).toBe(1000000);
    });

    test("handles very long prompt", () => {
      const longPrompt = "A".repeat(10000) + "\n\n" + "B".repeat(10000);
      const state: RalphState = {
        active: true,
        iteration: 1,
        maxIterations: 10,
        completionPromise: null,
        featureListPath: "research/feature-list.json",
        startedAt: "2026-01-24T10:00:00Z",
        prompt: longPrompt,
      };

      writeRalphState(STATE_FILE, state);
      const parsed = parseRalphState(STATE_FILE);

      expect(parsed).not.toBeNull();
      expect(parsed!.prompt).toBe(longPrompt);
    });

    test("handles path with spaces in feature_list_path", () => {
      const state: RalphState = {
        active: true,
        iteration: 1,
        maxIterations: 10,
        completionPromise: null,
        featureListPath: "path/with spaces/features.json",
        startedAt: "2026-01-24T10:00:00Z",
        prompt: "Path with spaces test.",
      };

      writeRalphState(STATE_FILE, state);
      const parsed = parseRalphState(STATE_FILE);

      expect(parsed).not.toBeNull();
      expect(parsed!.featureListPath).toBe("path/with spaces/features.json");
    });

    test("handles prompt that looks like YAML", () => {
      const state: RalphState = {
        active: true,
        iteration: 1,
        maxIterations: 10,
        completionPromise: null,
        featureListPath: "research/feature-list.json",
        startedAt: "2026-01-24T10:00:00Z",
        prompt: "key: value\nanother_key: another_value\nlist:\n  - item1\n  - item2",
      };

      writeRalphState(STATE_FILE, state);
      const parsed = parseRalphState(STATE_FILE);

      expect(parsed).not.toBeNull();
      expect(parsed!.prompt).toContain("key: value");
      expect(parsed!.prompt).toContain("- item1");
    });

    test("handles prompt with --- delimiter inside content", () => {
      const state: RalphState = {
        active: true,
        iteration: 1,
        maxIterations: 10,
        completionPromise: null,
        featureListPath: "research/feature-list.json",
        startedAt: "2026-01-24T10:00:00Z",
        prompt: "Before delimiter\n---\nAfter delimiter (not frontmatter)",
      };

      writeRalphState(STATE_FILE, state);
      const parsed = parseRalphState(STATE_FILE);

      expect(parsed).not.toBeNull();
      // The --- inside the prompt should be preserved
      expect(parsed!.prompt).toContain("---");
      expect(parsed!.prompt).toContain("After delimiter");
    });
  });
});
