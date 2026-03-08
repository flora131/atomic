import { describe, expect, spyOn, test } from "bun:test";
import { resolve } from "node:path";
import {
  COPILOT_CANONICAL_USER_ROOT_ID,
  COPILOT_HOME_USER_ROOT_ID,
  emitCopilotPathConflictWarnings,
  resolveCopilotCanonicalUserRoot,
  resolveCopilotUserRoots,
} from "@/services/config/copilot-paths.ts";
import { getProviderDiscoveryRootById } from "@/services/config/provider-discovery-contract.ts";

interface DiscoveryEventCapture {
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

describe("copilot-paths", () => {
  test("resolves canonical root from XDG_CONFIG_HOME on Unix", () => {
    const homeDir = "/home/test-user";
    const xdgConfigHome = "/tmp/custom-xdg";

    expect(
      resolveCopilotCanonicalUserRoot(homeDir, {
        xdgConfigHome,
        platform: "linux",
      }),
    ).toBe(resolve("/tmp/custom-xdg", ".copilot"));
  });

  test("uses ~/.copilot as default root on Unix when XDG is unset", () => {
    const homeDir = "/home/test-user";

    expect(
      resolveCopilotCanonicalUserRoot(homeDir, {
        xdgConfigHome: null,
        platform: "linux",
      }),
    ).toBe(resolve("/home/test-user", ".copilot"));
  });

  test("uses the home root on Windows", () => {
    const homeDir = "/Users/test-user";
    const appDataDir = "/Users/test-user/AppData/Roaming";

    expect(
      resolveCopilotCanonicalUserRoot(homeDir, {
        appDataDir,
        platform: "win32",
      }),
    ).toBe(resolve("/Users/test-user", ".copilot"));
  });

  test("returns contract-aligned home and canonical root mappings", async () => {
    const homeDir = "/home/test-user";
    const resolution = await resolveCopilotUserRoots({
      homeDir,
      xdgConfigHome: null,
      platform: "linux",
    });

    const expectedRoot = resolve("/home/test-user", ".copilot");
    expect(resolution.rootsById[COPILOT_CANONICAL_USER_ROOT_ID]).toBe(
      expectedRoot,
    );
    expect(resolution.rootsById[COPILOT_HOME_USER_ROOT_ID]).toBe(
      expectedRoot,
    );
    expect(resolution.rootsInPrecedenceOrder).toEqual([
      expectedRoot,
      expectedRoot,
    ]);
    expect(resolution.warnings).toEqual([]);

    expect(getProviderDiscoveryRootById("copilot", COPILOT_CANONICAL_USER_ROOT_ID)?.pathTemplate).toBe(
      "<copilot-canonical-user-root>",
    );
  });

  test("emits warning messages through provided handler", () => {
    const receivedMessages: string[] = [];
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    try {
      emitCopilotPathConflictWarnings(
        [
          {
            code: "copilot_user_root_conflict",
            canonicalRoot: "/canonical",
            fallbackRoot: "/fallback",
            message: "Conflict warning",
          },
        ],
        (warning) => {
          receivedMessages.push(warning.message);
        },
      );

      expect(receivedMessages).toEqual(["Conflict warning"]);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("emits structured discovery.path.conflict event with provider/install/path tags", () => {
    const originalDebug = process.env.DEBUG;
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    try {
      process.env.DEBUG = "1";

      emitCopilotPathConflictWarnings([
        {
          code: "copilot_user_root_conflict",
          canonicalRoot: "/canonical",
          fallbackRoot: "/fallback",
          message: "Conflict warning",
        },
      ]);

      const warningMessages = warnSpy.mock.calls
        .map((call) => call[0])
        .filter((message): message is string => typeof message === "string");

      const structuredEventMessage = warningMessages.find((message) =>
        message.startsWith("[discovery.event]"),
      );

      expect(structuredEventMessage).toBeDefined();
      const structuredEvent = parseDiscoveryEventMessage(structuredEventMessage!);

      expect(structuredEvent.event).toBe("discovery.path.conflict");
      expect(structuredEvent.tags.provider).toBe("copilot");
      expect(structuredEvent.tags.installType).toBe("source");
      expect(structuredEvent.tags.path).toBe("<external-path>");
      expect(structuredEvent.tags.rootId).toBe(COPILOT_CANONICAL_USER_ROOT_ID);
      expect(structuredEvent.tags.rootTier).toBe("userGlobal");
      expect(structuredEvent.data?.canonicalRoot).toBe("<external-path>");
      expect(structuredEvent.data?.fallbackRoot).toBe("<external-path>");
    } finally {
      if (originalDebug === undefined) {
        delete process.env.DEBUG;
      } else {
        process.env.DEBUG = originalDebug;
      }
      warnSpy.mockRestore();
    }
  });
});
