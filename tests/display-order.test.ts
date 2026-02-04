import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";

/**
 * Unit tests for CLI display ordering
 *
 * These tests verify the correct display order of:
 * 1. Banner (when showBanner=true and terminal large enough)
 * 2. Intro text
 * 3. configNotFoundMessage (when provided)
 * 4. "Configuring..." message
 *
 * Note: Tests use a cancel pattern to exit initCommand before file copying
 * to avoid modifying the actual filesystem.
 */

// Special symbol to indicate cancellation (mimics @clack/prompts behavior)
const CANCEL_SYMBOL = Symbol("cancel");

describe("initCommand display ordering", () => {
  // Track call order
  let callOrder: string[];
  let originalStdoutColumns: number | undefined;
  let originalStdoutRows: number | undefined;
  let originalProcessExit: typeof process.exit;

  beforeEach(() => {
    callOrder = [];
    originalStdoutColumns = process.stdout.columns;
    originalStdoutRows = process.stdout.rows;
    originalProcessExit = process.exit;

    // Mock process.exit to prevent actual exit
    process.exit = ((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;
  });

  afterEach(() => {
    process.stdout.columns = originalStdoutColumns as number;
    process.stdout.rows = originalStdoutRows as number;
    process.exit = originalProcessExit;
    mock.restore();
  });

  describe("configNotFoundMessage display", () => {
    test("configNotFoundMessage displays after intro when provided", async () => {
      // Track log.info and log.step calls to verify message order
      const logInfoCalls: string[] = [];

      // Mock @clack/prompts - confirm returns cancel to exit before file copying
      mock.module("@clack/prompts", () => ({
        intro: (msg: string) => {
          callOrder.push("intro");
        },
        log: {
          message: (msg: string) => {
            callOrder.push(`log.message:${msg.substring(0, 20)}`);
          },
          info: (msg: string) => {
            callOrder.push(`log.info:${msg}`);
            logInfoCalls.push(msg);
          },
          step: (msg: string) => {
            callOrder.push(`log.step:${msg}`);
            logInfoCalls.push(msg);
          },
        },
        select: async () => "claude",
        confirm: async () => CANCEL_SYMBOL, // Return cancel to exit before file operations
        spinner: () => ({
          start: () => {},
          stop: () => {},
        }),
        isCancel: (value: unknown) => value === CANCEL_SYMBOL,
        cancel: () => {
          callOrder.push("cancel");
        },
        note: () => {},
        outro: () => {},
      }));

      // Mock displayBanner
      mock.module("../src/utils/banner", () => ({
        displayBanner: () => {
          callOrder.push("banner");
        },
      }));

      // Import initCommand after mocking
      const { initCommand } = await import("../src/commands/init");

      try {
        await initCommand({
          showBanner: false,
          preSelectedAgent: "claude",
          configNotFoundMessage: ".claude not found. Running setup...",
        });
      } catch (e) {
        // Expected - process.exit is mocked
      }

      // Verify configNotFoundMessage was logged
      expect(logInfoCalls).toContain(".claude not found. Running setup...");

      // Verify order: intro should come before the configNotFoundMessage
      const introIndex = callOrder.findIndex((c) => c === "intro");
      const notFoundIndex = callOrder.findIndex((c) =>
        c.includes(".claude not found")
      );
      const configuringIndex = callOrder.findIndex((c) =>
        c.includes("Configuring")
      );

      expect(introIndex).toBeGreaterThanOrEqual(0);
      expect(notFoundIndex).toBeGreaterThanOrEqual(0);
      expect(configuringIndex).toBeGreaterThanOrEqual(0);

      // intro -> not found -> configuring
      expect(introIndex).toBeLessThan(notFoundIndex);
      expect(notFoundIndex).toBeLessThan(configuringIndex);
    });

    test("configNotFoundMessage is NOT displayed when undefined", async () => {
      const logInfoCalls: string[] = [];

      mock.module("@clack/prompts", () => ({
        intro: () => {
          callOrder.push("intro");
        },
        log: {
          message: () => {},
          info: (msg: string) => {
            callOrder.push(`log.info:${msg}`);
            logInfoCalls.push(msg);
          },
          step: (msg: string) => {
            callOrder.push(`log.step:${msg}`);
            logInfoCalls.push(msg);
          },
        },
        select: async () => "claude",
        confirm: async () => CANCEL_SYMBOL,
        spinner: () => ({
          start: () => {},
          stop: () => {},
        }),
        isCancel: (value: unknown) => value === CANCEL_SYMBOL,
        cancel: () => {},
        note: () => {},
        outro: () => {},
      }));

      mock.module("../src/utils/banner", () => ({
        displayBanner: () => {},
      }));

      const { initCommand } = await import("../src/commands/init");

      try {
        await initCommand({
          showBanner: false,
          preSelectedAgent: "claude",
          // configNotFoundMessage NOT provided
        });
      } catch (e) {
        // Expected
      }

      // "not found" message should NOT appear
      const hasNotFoundMessage = logInfoCalls.some((msg) =>
        msg.includes("not found")
      );
      expect(hasNotFoundMessage).toBe(false);

      // "Configuring" message SHOULD appear
      const hasConfiguringMessage = logInfoCalls.some((msg) =>
        msg.includes("Configuring")
      );
      expect(hasConfiguringMessage).toBe(true);
    });
  });

  describe("banner display", () => {
    test("banner displays when showBanner=true", async () => {
      let bannerCalled = false;

      mock.module("@clack/prompts", () => ({
        intro: () => {
          callOrder.push("intro");
        },
        log: {
          message: () => {},
          info: () => {},
        },
        select: async () => "claude",
        confirm: async () => CANCEL_SYMBOL,
        spinner: () => ({
          start: () => {},
          stop: () => {},
        }),
        isCancel: (value: unknown) => value === CANCEL_SYMBOL,
        cancel: () => {},
        note: () => {},
        outro: () => {},
      }));

      mock.module("../src/utils/banner", () => ({
        displayBanner: () => {
          bannerCalled = true;
          callOrder.push("banner");
        },
      }));

      const { initCommand } = await import("../src/commands/init");

      try {
        await initCommand({
          showBanner: true,
          preSelectedAgent: "claude",
        });
      } catch (e) {
        // Expected
      }

      expect(bannerCalled).toBe(true);
    });

    test("banner does NOT display when showBanner=false", async () => {
      let bannerCalled = false;

      mock.module("@clack/prompts", () => ({
        intro: () => {},
        log: {
          message: () => {},
          info: () => {},
        },
        select: async () => "claude",
        confirm: async () => CANCEL_SYMBOL,
        spinner: () => ({
          start: () => {},
          stop: () => {},
        }),
        isCancel: (value: unknown) => value === CANCEL_SYMBOL,
        cancel: () => {},
        note: () => {},
        outro: () => {},
      }));

      mock.module("../src/utils/banner", () => ({
        displayBanner: () => {
          bannerCalled = true;
        },
      }));

      const { initCommand } = await import("../src/commands/init");

      try {
        await initCommand({
          showBanner: false,
          preSelectedAgent: "claude",
        });
      } catch (e) {
        // Expected
      }

      expect(bannerCalled).toBe(false);
    });

    test("banner displays before intro when showBanner=true", async () => {
      mock.module("@clack/prompts", () => ({
        intro: () => {
          callOrder.push("intro");
        },
        log: {
          message: () => {},
          info: () => {},
        },
        select: async () => "claude",
        confirm: async () => CANCEL_SYMBOL,
        spinner: () => ({
          start: () => {},
          stop: () => {},
        }),
        isCancel: (value: unknown) => value === CANCEL_SYMBOL,
        cancel: () => {},
        note: () => {},
        outro: () => {},
      }));

      mock.module("../src/utils/banner", () => ({
        displayBanner: () => {
          callOrder.push("banner");
        },
      }));

      const { initCommand } = await import("../src/commands/init");

      try {
        await initCommand({
          showBanner: true,
          preSelectedAgent: "claude",
        });
      } catch (e) {
        // Expected
      }

      const bannerIndex = callOrder.indexOf("banner");
      const introIndex = callOrder.indexOf("intro");

      expect(bannerIndex).toBeGreaterThanOrEqual(0);
      expect(introIndex).toBeGreaterThanOrEqual(0);
      expect(bannerIndex).toBeLessThan(introIndex);
    });
  });

  describe("full display order verification", () => {
    test("display order: banner -> intro -> configNotFoundMessage -> configuring", async () => {
      mock.module("@clack/prompts", () => ({
        intro: () => {
          callOrder.push("intro");
        },
        log: {
          message: () => {
            callOrder.push("log.message");
          },
          info: (msg: string) => {
            callOrder.push(`log.info:${msg}`);
          },
          step: (msg: string) => {
            callOrder.push(`log.step:${msg}`);
          },
        },
        select: async () => "claude",
        confirm: async () => CANCEL_SYMBOL,
        spinner: () => ({
          start: () => {},
          stop: () => {},
        }),
        isCancel: (value: unknown) => value === CANCEL_SYMBOL,
        cancel: () => {},
        note: () => {},
        outro: () => {},
      }));

      mock.module("../src/utils/banner", () => ({
        displayBanner: () => {
          callOrder.push("banner");
        },
      }));

      const { initCommand } = await import("../src/commands/init");

      try {
        await initCommand({
          showBanner: true,
          preSelectedAgent: "claude",
          configNotFoundMessage: ".claude not found. Running setup...",
        });
      } catch (e) {
        // Expected
      }

      // Verify the order
      const bannerIndex = callOrder.indexOf("banner");
      const introIndex = callOrder.indexOf("intro");
      const notFoundIndex = callOrder.findIndex((c) =>
        c.includes(".claude not found")
      );
      const configuringIndex = callOrder.findIndex((c) =>
        c.includes("Configuring")
      );

      // All should be present
      expect(bannerIndex).toBeGreaterThanOrEqual(0);
      expect(introIndex).toBeGreaterThanOrEqual(0);
      expect(notFoundIndex).toBeGreaterThanOrEqual(0);
      expect(configuringIndex).toBeGreaterThanOrEqual(0);

      // Verify order: banner -> intro -> not found -> configuring
      expect(bannerIndex).toBeLessThan(introIndex);
      expect(introIndex).toBeLessThan(notFoundIndex);
      expect(notFoundIndex).toBeLessThan(configuringIndex);
    });
  });
});
