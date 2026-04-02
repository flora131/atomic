import { describe, expect, mock, test, beforeEach } from "bun:test";
import {
  shouldProcessStreamLifecycleEvent,
} from "@/state/chat/exports.ts";
import { isLikelyFilePath } from "@/services/events/session-info-filters.ts";
import { createMessage } from "@/state/chat/shared/helpers/index.ts";
import { STATUS } from "@/theme/icons.ts";
import type { ChatMessage } from "@/state/chat/types.ts";

/**
 * Mirrors the stream.session.info handler in use-session-subscriptions.ts.
 *
 * Extracted to test the lifecycle guard + isLikelyFilePath filtering logic
 * without needing the full bus subscription infrastructure.
 */
function handleSessionInfo(
  state: {
    activeStreamRunIdRef: { current: number | null };
    setMessagesWindowed: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void;
  },
  event: { runId: number; data: { infoType: string; message: string } },
): void {
  if (!shouldProcessStreamLifecycleEvent(state.activeStreamRunIdRef.current, event.runId)) {
    return;
  }

  const { message, infoType } = event.data;
  if (infoType === "cancellation") return;
  if (infoType === "configuration") return;
  if (infoType === "snapshot") return;
  if (!message) return;
  if (isLikelyFilePath(message.trim())) return;

  state.setMessagesWindowed((prev) => [
    ...prev,
    createMessage("system", `${STATUS.active} ${message}`),
  ]);
}

describe("stream.session.info lifecycle guard", () => {
  let setMessagesWindowed: ReturnType<typeof mock>;
  let state: {
    activeStreamRunIdRef: { current: number | null };
    setMessagesWindowed: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void;
  };

  beforeEach(() => {
    setMessagesWindowed = mock();
    state = {
      activeStreamRunIdRef: { current: 5 },
      setMessagesWindowed,
    };
  });

  test("renders info when runId matches active stream run", () => {
    handleSessionInfo(state, {
      runId: 5,
      data: { infoType: "general", message: "Compiling project..." },
    });
    expect(setMessagesWindowed).toHaveBeenCalledTimes(1);
  });

  test("suppresses info when runId is stale (from a previous run)", () => {
    handleSessionInfo(state, {
      runId: 4,
      data: { infoType: "general", message: "Late-arriving info" },
    });
    expect(setMessagesWindowed).not.toHaveBeenCalled();
  });

  test("suppresses info when no active run is bound (null activeStreamRunId)", () => {
    state.activeStreamRunIdRef.current = null;
    handleSessionInfo(state, {
      runId: 5,
      data: { infoType: "general", message: "Orphaned info" },
    });
    expect(setMessagesWindowed).not.toHaveBeenCalled();
  });
});

describe("stream.session.info infoType filtering", () => {
  let setMessagesWindowed: ReturnType<typeof mock>;
  let state: {
    activeStreamRunIdRef: { current: number | null };
    setMessagesWindowed: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void;
  };

  beforeEach(() => {
    setMessagesWindowed = mock();
    state = {
      activeStreamRunIdRef: { current: 5 },
      setMessagesWindowed,
    };
  });

  test("suppresses cancellation infoType", () => {
    handleSessionInfo(state, {
      runId: 5,
      data: { infoType: "cancellation", message: "Cancelled by user" },
    });
    expect(setMessagesWindowed).not.toHaveBeenCalled();
  });

  test("suppresses configuration infoType (e.g. disabled tools)", () => {
    handleSessionInfo(state, {
      runId: 5,
      data: { infoType: "configuration", message: "Some configuration info" },
    });
    expect(setMessagesWindowed).not.toHaveBeenCalled();
  });

  test("suppresses snapshot infoType", () => {
    handleSessionInfo(state, {
      runId: 5,
      data: { infoType: "snapshot", message: "Snapshot data" },
    });
    expect(setMessagesWindowed).not.toHaveBeenCalled();
  });

  test("suppresses empty message", () => {
    handleSessionInfo(state, {
      runId: 5,
      data: { infoType: "general", message: "" },
    });
    expect(setMessagesWindowed).not.toHaveBeenCalled();
  });
});

describe("stream.session.info file path filtering", () => {
  let setMessagesWindowed: ReturnType<typeof mock>;
  let state: {
    activeStreamRunIdRef: { current: number | null };
    setMessagesWindowed: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void;
  };

  beforeEach(() => {
    setMessagesWindowed = mock();
    state = {
      activeStreamRunIdRef: { current: 5 },
      setMessagesWindowed,
    };
  });

  test("suppresses POSIX absolute file paths", () => {
    handleSessionInfo(state, {
      runId: 5,
      data: { infoType: "general", message: "/home/user/project/file.ts" },
    });
    expect(setMessagesWindowed).not.toHaveBeenCalled();
  });

  test("suppresses Windows absolute file paths", () => {
    handleSessionInfo(state, {
      runId: 5,
      data: { infoType: "general", message: "C:\\dev\\project\\file.ts" },
    });
    expect(setMessagesWindowed).not.toHaveBeenCalled();
  });

  test("suppresses home-relative file paths", () => {
    handleSessionInfo(state, {
      runId: 5,
      data: { infoType: "general", message: "~/project/file.ts" },
    });
    expect(setMessagesWindowed).not.toHaveBeenCalled();
  });

  test("suppresses dot-relative file paths", () => {
    handleSessionInfo(state, {
      runId: 5,
      data: { infoType: "general", message: "./src/index.ts" },
    });
    expect(setMessagesWindowed).not.toHaveBeenCalled();
  });

  test("allows normal human-readable messages through", () => {
    handleSessionInfo(state, {
      runId: 5,
      data: { infoType: "general", message: "Reading file /etc/config" },
    });
    expect(setMessagesWindowed).toHaveBeenCalledTimes(1);
  });
});

describe("stream.session.info rendered message format", () => {
  test("rendered message includes status icon prefix", () => {
    let captured: ChatMessage[] = [];
    const state = {
      activeStreamRunIdRef: { current: 5 as number | null },
      setMessagesWindowed: (updater: (prev: ChatMessage[]) => ChatMessage[]) => {
        captured = updater([]);
      },
    };

    handleSessionInfo(state, {
      runId: 5,
      data: { infoType: "general", message: "Installing dependencies" },
    });

    expect(captured).toHaveLength(1);
    const msg = captured[0]!;
    expect(msg.content).toBe(`${STATUS.active} Installing dependencies`);
    expect(msg.role).toBe("system");
  });
});
