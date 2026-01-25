/**
 * Tests for CLI type definitions
 *
 * These tests verify that the CLI option types:
 * 1. Can be properly instantiated with valid values
 * 2. Integrate correctly with existing types (AgentKey)
 * 3. Support the CommandOptions composition pattern
 */

import { test, expect, describe } from "bun:test";
import type {
  GlobalOptions,
  InitOptions,
  UninstallOptions,
  RalphSetupOptions,
  RalphStopOptions,
  CommandOptions,
} from "../../src/types/cli";
import { isValidAgent, type AgentKey } from "../../src/config";

describe("GlobalOptions", () => {
  test("accepts all optional properties", () => {
    const options: GlobalOptions = {
      force: true,
      yes: true,
      noBanner: true,
      uploadTelemetry: true,
    };

    expect(options.force).toBe(true);
    expect(options.yes).toBe(true);
    expect(options.noBanner).toBe(true);
    expect(options.uploadTelemetry).toBe(true);
  });

  test("accepts empty object", () => {
    const options: GlobalOptions = {};
    expect(options.force).toBeUndefined();
    expect(options.yes).toBeUndefined();
  });

  test("accepts partial options", () => {
    const options: GlobalOptions = { force: true };
    expect(options.force).toBe(true);
    expect(options.yes).toBeUndefined();
  });
});

describe("InitOptions", () => {
  test("accepts valid agent key", () => {
    const options: InitOptions = { agent: "claude" };
    expect(options.agent).toBe("claude");
    expect(isValidAgent(options.agent as string)).toBe(true);
  });

  test("accepts empty object", () => {
    const options: InitOptions = {};
    expect(options.agent).toBeUndefined();
  });

  test("agent option integrates with AgentKey type", () => {
    // This test ensures InitOptions.agent is compatible with AgentKey
    const agentKey: AgentKey = "claude";
    const options: InitOptions = { agent: agentKey };
    expect(options.agent).toBe(agentKey);
  });
});

describe("UninstallOptions", () => {
  test("accepts all optional properties", () => {
    const options: UninstallOptions = {
      dryRun: true,
      keepConfig: true,
    };

    expect(options.dryRun).toBe(true);
    expect(options.keepConfig).toBe(true);
  });

  test("accepts empty object", () => {
    const options: UninstallOptions = {};
    expect(options.dryRun).toBeUndefined();
    expect(options.keepConfig).toBeUndefined();
  });

  test("accepts partial options", () => {
    const options: UninstallOptions = { dryRun: true };
    expect(options.dryRun).toBe(true);
    expect(options.keepConfig).toBeUndefined();
  });
});

describe("RalphSetupOptions", () => {
  test("requires agent property", () => {
    const options: RalphSetupOptions = { agent: "claude" };
    expect(options.agent).toBe("claude");
  });

  test("accepts all optional properties", () => {
    const options: RalphSetupOptions = {
      agent: "claude",
      maxIterations: 10,
      completionPromise: "DONE",
      featureList: "custom/features.json",
    };

    expect(options.agent).toBe("claude");
    expect(options.maxIterations).toBe(10);
    expect(options.completionPromise).toBe("DONE");
    expect(options.featureList).toBe("custom/features.json");
  });

  test("maxIterations accepts zero for unlimited", () => {
    const options: RalphSetupOptions = {
      agent: "claude",
      maxIterations: 0,
    };
    expect(options.maxIterations).toBe(0);
  });
});

describe("RalphStopOptions", () => {
  test("requires agent property", () => {
    const options: RalphStopOptions = { agent: "claude" };
    expect(options.agent).toBe("claude");
  });
});

describe("CommandOptions", () => {
  test("combines InitOptions with GlobalOptions", () => {
    type InitCommandOptions = CommandOptions<InitOptions>;

    const options: InitCommandOptions = {
      agent: "claude",
      force: true,
      yes: true,
      noBanner: false,
    };

    // InitOptions property
    expect(options.agent).toBe("claude");

    // GlobalOptions properties
    expect(options.force).toBe(true);
    expect(options.yes).toBe(true);
    expect(options.noBanner).toBe(false);
  });

  test("combines UninstallOptions with GlobalOptions", () => {
    type UninstallCommandOptions = CommandOptions<UninstallOptions>;

    const options: UninstallCommandOptions = {
      dryRun: true,
      keepConfig: false,
      force: true,
      yes: true,
    };

    // UninstallOptions properties
    expect(options.dryRun).toBe(true);
    expect(options.keepConfig).toBe(false);

    // GlobalOptions properties
    expect(options.force).toBe(true);
    expect(options.yes).toBe(true);
  });

  test("supports empty command options with globals only", () => {
    type EmptyCommandOptions = CommandOptions<object>;

    const options: EmptyCommandOptions = {
      force: true,
      yes: false,
    };

    expect(options.force).toBe(true);
    expect(options.yes).toBe(false);
  });
});

describe("Type integration with existing codebase", () => {
  test("InitOptions.agent is assignable to AgentKey parameter", () => {
    const options: InitOptions = { agent: "claude" };

    // Simulate passing to a function that expects AgentKey
    const validateAgent = (agent: AgentKey): boolean => {
      return isValidAgent(agent);
    };

    if (options.agent) {
      expect(validateAgent(options.agent)).toBe(true);
    }
  });

  test("all valid AgentKeys work with InitOptions", () => {
    const validAgents: AgentKey[] = ["claude", "opencode", "copilot"];

    for (const agent of validAgents) {
      const options: InitOptions = { agent };
      expect(options.agent).toBe(agent);
      expect(isValidAgent(options.agent as string)).toBe(true);
    }
  });
});
