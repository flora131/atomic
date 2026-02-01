/**
 * Tests for Ralph Configuration Module
 *
 * Reference: Feature 32 - Add feature flag ATOMIC_USE_GRAPH_ENGINE for rollout
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  type RalphConfig,
  type LoadRalphConfigOptions,
  RALPH_ENV_VARS,
  RALPH_DEFAULTS,
  AGENT_STATE_DIRS,
  isGraphEngineEnabled,
  loadRalphConfig,
  describeRalphConfig,
  generateRalphSessionId,
  getRalphSessionPaths,
  extractSessionId,
} from "../../src/config/ralph.ts";

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Helper to save and restore environment variables.
 */
function withEnv(envVars: Record<string, string | undefined>, fn: () => void) {
  const savedVars: Record<string, string | undefined> = {};

  // Save current values
  for (const key of Object.keys(envVars)) {
    savedVars[key] = process.env[key];
  }

  // Set new values
  for (const [key, value] of Object.entries(envVars)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    fn();
  } finally {
    // Restore original values
    for (const [key, value] of Object.entries(savedVars)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

// ============================================================================
// Constants Tests
// ============================================================================

describe("RALPH_ENV_VARS", () => {
  test("defines ATOMIC_USE_GRAPH_ENGINE constant", () => {
    expect(RALPH_ENV_VARS.ATOMIC_USE_GRAPH_ENGINE).toBe("ATOMIC_USE_GRAPH_ENGINE");
  });
});

describe("RALPH_DEFAULTS", () => {
  test("useGraphEngine defaults to false", () => {
    expect(RALPH_DEFAULTS.useGraphEngine).toBe(false);
  });

  test("maxIterations defaults to 0 (unlimited)", () => {
    expect(RALPH_DEFAULTS.maxIterations).toBe(0);
  });

  test("featureListPath defaults to research/feature-list.json", () => {
    expect(RALPH_DEFAULTS.featureListPath).toBe("research/feature-list.json");
  });

  test("progressFilePath defaults to research/progress.txt", () => {
    expect(RALPH_DEFAULTS.progressFilePath).toBe("research/progress.txt");
  });
});

describe("AGENT_STATE_DIRS", () => {
  test("defines claude directory", () => {
    expect(AGENT_STATE_DIRS.claude).toBe(".claude");
  });

  test("defines opencode directory", () => {
    expect(AGENT_STATE_DIRS.opencode).toBe(".opencode");
  });

  test("defines copilot directory", () => {
    expect(AGENT_STATE_DIRS.copilot).toBe(".github");
  });
});

// ============================================================================
// isGraphEngineEnabled Tests
// ============================================================================

describe("isGraphEngineEnabled", () => {
  test("returns false when env var is not set", () => {
    withEnv({ ATOMIC_USE_GRAPH_ENGINE: undefined }, () => {
      expect(isGraphEngineEnabled()).toBe(false);
    });
  });

  test("returns false when env var is empty string", () => {
    withEnv({ ATOMIC_USE_GRAPH_ENGINE: "" }, () => {
      expect(isGraphEngineEnabled()).toBe(false);
    });
  });

  test("returns false when env var is 'false'", () => {
    withEnv({ ATOMIC_USE_GRAPH_ENGINE: "false" }, () => {
      expect(isGraphEngineEnabled()).toBe(false);
    });
  });

  test("returns false when env var is '0'", () => {
    withEnv({ ATOMIC_USE_GRAPH_ENGINE: "0" }, () => {
      expect(isGraphEngineEnabled()).toBe(false);
    });
  });

  test("returns true when env var is 'true'", () => {
    withEnv({ ATOMIC_USE_GRAPH_ENGINE: "true" }, () => {
      expect(isGraphEngineEnabled()).toBe(true);
    });
  });

  test("returns false when env var is 'TRUE' (case sensitive)", () => {
    withEnv({ ATOMIC_USE_GRAPH_ENGINE: "TRUE" }, () => {
      expect(isGraphEngineEnabled()).toBe(false);
    });
  });

  test("returns false when env var is '1' (strict comparison)", () => {
    withEnv({ ATOMIC_USE_GRAPH_ENGINE: "1" }, () => {
      expect(isGraphEngineEnabled()).toBe(false);
    });
  });
});

// ============================================================================
// loadRalphConfig Tests
// ============================================================================

describe("loadRalphConfig", () => {
  test("returns default config when no options provided and env not set", () => {
    withEnv({ ATOMIC_USE_GRAPH_ENGINE: undefined }, () => {
      const config = loadRalphConfig();
      expect(config.useGraphEngine).toBe(false);
      expect(config.maxIterations).toBe(0);
      expect(config.featureListPath).toBe("research/feature-list.json");
      expect(config.completionPromise).toBeUndefined();
    });
  });

  test("respects ATOMIC_USE_GRAPH_ENGINE=true", () => {
    withEnv({ ATOMIC_USE_GRAPH_ENGINE: "true" }, () => {
      const config = loadRalphConfig();
      expect(config.useGraphEngine).toBe(true);
    });
  });

  test("option override takes precedence over env var", () => {
    withEnv({ ATOMIC_USE_GRAPH_ENGINE: "true" }, () => {
      const config = loadRalphConfig({ useGraphEngine: false });
      expect(config.useGraphEngine).toBe(false);
    });
  });

  test("can override maxIterations", () => {
    const config = loadRalphConfig({ maxIterations: 50 });
    expect(config.maxIterations).toBe(50);
  });

  test("can override featureListPath", () => {
    const config = loadRalphConfig({ featureListPath: "custom/features.json" });
    expect(config.featureListPath).toBe("custom/features.json");
  });

  test("can set completionPromise", () => {
    const config = loadRalphConfig({ completionPromise: "DONE" });
    expect(config.completionPromise).toBe("DONE");
  });

  test("returns all options when fully specified", () => {
    const options: LoadRalphConfigOptions = {
      useGraphEngine: true,
      maxIterations: 100,
      featureListPath: "specs/features.json",
      completionPromise: "ALL_COMPLETE",
    };
    const config = loadRalphConfig(options);
    expect(config).toEqual({
      useGraphEngine: true,
      maxIterations: 100,
      featureListPath: "specs/features.json",
      completionPromise: "ALL_COMPLETE",
    });
  });
});

// ============================================================================
// describeRalphConfig Tests
// ============================================================================

describe("describeRalphConfig", () => {
  test("describes hook-based execution mode", () => {
    const config: RalphConfig = {
      useGraphEngine: false,
      maxIterations: 0,
      featureListPath: "research/feature-list.json",
    };
    const description = describeRalphConfig(config);
    expect(description).toContain("Execution mode: hook-based");
    expect(description).toContain("Max iterations: unlimited");
    expect(description).toContain("Feature list: research/feature-list.json");
  });

  test("describes graph engine execution mode", () => {
    const config: RalphConfig = {
      useGraphEngine: true,
      maxIterations: 50,
      featureListPath: "custom/features.json",
    };
    const description = describeRalphConfig(config);
    expect(description).toContain("Execution mode: graph engine");
    expect(description).toContain("Max iterations: 50");
    expect(description).toContain("Feature list: custom/features.json");
  });

  test("includes completion promise when set", () => {
    const config: RalphConfig = {
      useGraphEngine: false,
      maxIterations: 0,
      featureListPath: "research/feature-list.json",
      completionPromise: "FINISHED",
    };
    const description = describeRalphConfig(config);
    expect(description).toContain('Completion promise: "FINISHED"');
  });

  test("does not include completion promise when not set", () => {
    const config: RalphConfig = {
      useGraphEngine: false,
      maxIterations: 0,
      featureListPath: "research/feature-list.json",
    };
    const description = describeRalphConfig(config);
    expect(description).not.toContain("Completion promise");
  });
});

// ============================================================================
// Type Tests
// ============================================================================

describe("RalphConfig type", () => {
  test("is properly typed", () => {
    const config: RalphConfig = {
      useGraphEngine: true,
      maxIterations: 10,
      featureListPath: "test.json",
      completionPromise: "done",
    };

    expect(typeof config.useGraphEngine).toBe("boolean");
    expect(typeof config.maxIterations).toBe("number");
    expect(typeof config.featureListPath).toBe("string");
    expect(typeof config.completionPromise).toBe("string");
  });

  test("completionPromise is optional", () => {
    const config: RalphConfig = {
      useGraphEngine: false,
      maxIterations: 0,
      featureListPath: "test.json",
    };
    expect(config.completionPromise).toBeUndefined();
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("Ralph config integration", () => {
  test("loadRalphConfig produces valid RalphConfig", () => {
    const config = loadRalphConfig();

    // Verify all required fields are present and have correct types
    expect(typeof config.useGraphEngine).toBe("boolean");
    expect(typeof config.maxIterations).toBe("number");
    expect(typeof config.featureListPath).toBe("string");

    // describeRalphConfig should work on the loaded config
    const description = describeRalphConfig(config);
    expect(typeof description).toBe("string");
    expect(description.length).toBeGreaterThan(0);
  });

  test("env var changes are reflected in isGraphEngineEnabled", () => {
    // Initially should be false (assuming env not set in test environment)
    const initialValue = isGraphEngineEnabled();

    // Set env var and check
    withEnv({ ATOMIC_USE_GRAPH_ENGINE: "true" }, () => {
      expect(isGraphEngineEnabled()).toBe(true);
    });

    // After withEnv block, should be back to initial
    expect(isGraphEngineEnabled()).toBe(initialValue);
  });
});

// ============================================================================
// Session-Based Path Tests
// ============================================================================

describe("generateRalphSessionId", () => {
  test("generates unique session IDs", () => {
    const id1 = generateRalphSessionId();
    const id2 = generateRalphSessionId();
    expect(id1).not.toBe(id2);
  });

  test("session ID starts with sess_", () => {
    const id = generateRalphSessionId();
    expect(id.startsWith("sess_")).toBe(true);
  });

  test("session ID contains timestamp", () => {
    const id = generateRalphSessionId();
    // Format: sess_<timestamp>_<random>
    const parts = id.split("_");
    expect(parts.length).toBe(3);
    expect(Number(parts[1])).toBeGreaterThan(0);
  });

  test("session ID contains random suffix", () => {
    const id = generateRalphSessionId();
    const parts = id.split("_");
    expect(parts[2]!.length).toBeGreaterThan(0);
  });
});

describe("getRalphSessionPaths", () => {
  test("returns default paths when no sessionId provided", () => {
    const paths = getRalphSessionPaths("claude");
    expect(paths.featureListPath).toBe("research/feature-list.json");
    expect(paths.progressFilePath).toBe("research/progress.txt");
    expect(paths.stateFilePath).toBe(".claude/ralph-loop.local.md");
  });

  test("returns session-specific paths when sessionId provided", () => {
    const sessionId = "sess_123_abc";
    const paths = getRalphSessionPaths("claude", sessionId);
    expect(paths.featureListPath).toBe("research/feature-list-sess_123_abc.json");
    expect(paths.progressFilePath).toBe("research/progress-sess_123_abc.txt");
    expect(paths.stateFilePath).toBe(".claude/ralph-loop-sess_123_abc.local.md");
  });

  test("uses correct directory for opencode agent", () => {
    const paths = getRalphSessionPaths("opencode");
    expect(paths.stateFilePath).toBe(".opencode/ralph-loop.local.md");
  });

  test("uses correct directory for copilot agent", () => {
    const paths = getRalphSessionPaths("copilot");
    expect(paths.stateFilePath).toBe(".github/ralph-loop.local.md");
  });

  test("falls back to claude directory for unknown agent", () => {
    const paths = getRalphSessionPaths("unknown");
    expect(paths.stateFilePath).toBe(".claude/ralph-loop.local.md");
  });

  test("session-specific paths work with all agents", () => {
    const sessionId = "sess_456_xyz";

    const claudePaths = getRalphSessionPaths("claude", sessionId);
    expect(claudePaths.stateFilePath).toBe(".claude/ralph-loop-sess_456_xyz.local.md");

    const opencodePaths = getRalphSessionPaths("opencode", sessionId);
    expect(opencodePaths.stateFilePath).toBe(".opencode/ralph-loop-sess_456_xyz.local.md");

    const copilotPaths = getRalphSessionPaths("copilot", sessionId);
    expect(copilotPaths.stateFilePath).toBe(".github/ralph-loop-sess_456_xyz.local.md");
  });
});

describe("extractSessionId", () => {
  test("extracts session ID from feature list path", () => {
    const id = extractSessionId("research/feature-list-sess_123_abc.json");
    expect(id).toBe("sess_123_abc");
  });

  test("extracts session ID from progress path", () => {
    const id = extractSessionId("research/progress-sess_456_xyz.txt");
    expect(id).toBe("sess_456_xyz");
  });

  test("extracts session ID from state file path", () => {
    const id = extractSessionId(".claude/ralph-loop-sess_789_def.local.md");
    expect(id).toBe("sess_789_def");
  });

  test("returns undefined for default paths without session ID", () => {
    expect(extractSessionId("research/feature-list.json")).toBeUndefined();
    expect(extractSessionId("research/progress.txt")).toBeUndefined();
    expect(extractSessionId(".claude/ralph-loop.local.md")).toBeUndefined();
  });

  test("returns undefined for unrelated paths", () => {
    expect(extractSessionId("some/random/path.txt")).toBeUndefined();
    expect(extractSessionId("")).toBeUndefined();
  });
});
