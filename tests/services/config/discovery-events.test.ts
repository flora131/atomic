import { expect, spyOn, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  buildDiscoveryEventPayload,
  emitDiscoveryEvent,
} from "@/services/config/discovery-events.ts";

interface DiscoveryEventCapture {
  schema: string;
  event: string;
  tags: {
    provider: string;
    installType: string;
    path: string;
    rootId?: string;
    rootTier?: string;
    rootCompatibility?: string;
  };
  data?: {
    [key: string]:
      | string
      | number
      | boolean
      | null
      | readonly string[]
      | readonly number[]
      | readonly boolean[];
  };
}

function parseDiscoveryEventMessage(message: string): DiscoveryEventCapture {
  const prefix = "[discovery.event]";
  return JSON.parse(message.slice(prefix.length).trim()) as DiscoveryEventCapture;
}

test("buildDiscoveryEventPayload returns a machine-parseable v1 discovery payload", () => {
  const projectRoot = process.cwd();
  const userRoot = join(homedir(), ".claude");
  const externalRoot = "/tmp/sensitive-path";

  const payload = buildDiscoveryEventPayload("discovery.plan.generated", {
    tags: {
      provider: "claude",
      installType: "source",
      path: join(projectRoot, ".claude"),
      rootId: "claude_project",
      rootTier: "projectLocal",
      rootCompatibility: "native",
    },
    data: {
      runtimeMode: "nativeConfig",
      rootCount: 3,
      projectRoot,
      userRoot,
      externalRoot,
      warning: `Detected both '${userRoot}' and '${externalRoot}'.`,
      issues: [
        `Path is outside discovery roots: ${externalRoot}`,
        `Failed to load ${join(projectRoot, ".claude", "skills", "broken", "SKILL.md")}`,
      ],
    },
  });

  expect(payload.schema).toBe("atomic.discovery.event.v1");
  expect(payload.event).toBe("discovery.plan.generated");
  expect(payload.tags.provider).toBe("claude");
  expect(payload.tags.installType).toBe("source");
  expect(payload.tags.path).toBe("<project>/.claude");
  expect(payload.tags.rootId).toBe("claude_project");
  expect(payload.tags.rootTier).toBe("projectLocal");
  expect(payload.tags.rootCompatibility).toBe("native");
  expect(payload.data?.runtimeMode).toBe("nativeConfig");
  expect(payload.data?.rootCount).toBe(3);
  expect(payload.data?.projectRoot).toBe("<project>");
  expect(payload.data?.userRoot).toBe("~/.claude");
  expect(payload.data?.externalRoot).toBe("<external-path>");

  const warning = payload.data?.warning;
  expect(typeof warning).toBe("string");
  expect(warning).toContain("~/.claude");
  expect(warning).toContain("<external-path>");
  expect(warning).not.toContain(userRoot);
  expect(warning).not.toContain(externalRoot);

  const issues = payload.data?.issues;
  expect(issues).toEqual([
    "Path is outside discovery roots: <external-path>",
    "Failed to load <project>/.claude/skills/broken/SKILL.md",
  ]);
});

test("emitDiscoveryEvent keeps provider/install/path tags across providers", () => {
  const originalDebug = process.env.DEBUG;
  const debugSpy = spyOn(console, "debug").mockImplementation(() => {});

  try {
    process.env.DEBUG = "1";

    const providers: Array<"claude" | "opencode" | "copilot"> = [
      "claude",
      "opencode",
      "copilot",
    ];

    for (const provider of providers) {
      emitDiscoveryEvent("discovery.plan.generated", {
        tags: {
          provider,
          installType: "source",
          path: `/workspace/project/${provider}`,
        },
        data: {
          rootCount: 1,
        },
      });
    }

    const eventMessages = debugSpy.mock.calls
      .map((call) => call[0])
      .filter((message): message is string => typeof message === "string");

    expect(eventMessages).toHaveLength(providers.length);
    for (const message of eventMessages) {
      expect(message.startsWith("[discovery.event]")).toBe(true);
      const event = parseDiscoveryEventMessage(message);
      expect(event.schema).toBe("atomic.discovery.event.v1");
      expect(event.event).toBe("discovery.plan.generated");
      expect(["claude", "opencode", "copilot"]).toContain(event.tags.provider);
      expect(event.tags.installType).toBe("source");
      expect(event.tags.path).toBe("<external-path>");
      expect(event.tags.path.includes("/workspace/project/")).toBe(false);
    }
  } finally {
    if (originalDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = originalDebug;
    }
    debugSpy.mockRestore();
  }
});
