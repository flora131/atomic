import { describe, expect, spyOn, test } from "bun:test";
import {
  footerCommand,
  renderFooterFrame,
  runFooterRenderer,
} from "../../../src/commands/cli/footer.tsx";

type FooterTestStream = {
  columns: number;
  writes: string[];
  write(chunk: string | Uint8Array): boolean;
};

function createFooterTestStream(columns: number): FooterTestStream {
  return {
    columns,
    writes: [],
    write(chunk: string | Uint8Array): boolean {
      this.writes.push(String(chunk));
      return true;
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  predicate: () => boolean,
  message: string,
  timeoutMs = 1000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await delay(10);
  }
  throw new Error(message);
}

function newListeners(eventName: string, previous: Function[]): Function[] {
  return process.listeners(eventName).filter((listener) => !previous.includes(listener));
}

function invokeNewListeners(eventName: string, previous: Function[]): void {
  for (const listener of newListeners(eventName, previous)) {
    listener();
  }
}

describe("headless footer frame", () => {
  test("renders the OpenTUI footer without terminal capability probes", async () => {
    const frame = await renderFooterFrame({
      name: "atomic-chat-copilot-abcd1234",
      agentType: "copilot",
      width: 120,
    });

    expect(frame).toContain("COPILOT");
    expect(frame).toContain("atomic-chat-copilot-abcd1234");
    expect(frame).toContain("ctrl+b d");
    expect(frame).toContain("detach");
    expect(frame).not.toContain("\x1b[?");
    expect(frame).not.toContain("\x1b]");
    expect(frame).not.toContain("\x1b_");
  });

  test("sanitizes control characters from rendered footer text", async () => {
    const frame = await renderFooterFrame({
      name: "b\x1b]x\x07o",
      width: 80,
    });

    expect(frame).toContain("b");
    expect(frame).toContain("o");
    expect(frame).not.toContain("\x1b]x");
    expect(frame).not.toContain("\x07");
  });

  test.serial("repaints on resize and tears down on a process signal", async () => {
    const stdout = createFooterTestStream(36);
    const previousSigtermListeners = process.listeners("SIGTERM");
    const previousSigwinchListeners = process.listeners("SIGWINCH");
    let rendererReady = false;
    const renderer = runFooterRenderer({
      name: "atomic-chat-claude-long-session-name",
      agentType: "claude",
      stdout,
      onReady: () => {
        rendererReady = true;
      },
    });

    try {
      await waitFor(
        () =>
          stdout.writes.length > 0 &&
          rendererReady,
        "footer renderer did not start",
      );

      const writeCountBeforeResize = stdout.writes.length;
      stdout.columns = 120;
      invokeNewListeners("SIGWINCH", previousSigwinchListeners);

      await waitFor(
        () => stdout.writes.length > writeCountBeforeResize,
        "footer renderer did not repaint after resize",
      );

      invokeNewListeners("SIGTERM", previousSigtermListeners);
      await renderer;
    } finally {
      invokeNewListeners("SIGTERM", previousSigtermListeners);
    }

    expect(newListeners("SIGTERM", previousSigtermListeners)).toHaveLength(0);
    expect(newListeners("SIGWINCH", previousSigwinchListeners)).toHaveLength(0);
    expect(stdout.writes.join("")).toContain("CLAUDE");
    expect(stdout.writes.join("")).toContain("atomic-chat-claude-long-session-name");
  });

  test.serial("footer command exits successfully after renderer teardown", async () => {
    const previousSigtermListeners = process.listeners("SIGTERM");
    const stdoutChunks: string[] = [];
    let rendererReady = false;
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(
      (chunk: unknown) => {
        stdoutChunks.push(String(chunk));
        return true;
      },
    );
    const command = footerCommand("atomic-chat-opencode-abcd1234", "opencode", {
      onReady: () => {
        rendererReady = true;
      },
    });

    try {
      await waitFor(
        () => rendererReady,
        "footer command did not start renderer",
      );

      invokeNewListeners("SIGTERM", previousSigtermListeners);
      await expect(command).resolves.toBe(0);
    } finally {
      stdoutSpy.mockRestore();
      invokeNewListeners("SIGTERM", previousSigtermListeners);
    }

    expect(stdoutChunks.join("")).toContain("OPENCODE");
    expect(stdoutChunks.join("")).toContain("atomic-chat-opencode-abcd1234");
  });
});
