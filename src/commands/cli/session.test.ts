import { describe, test, expect, beforeAll, afterAll, beforeEach, mock } from "bun:test";
import {
  renderSessionList,
  filterByAgent,
  filterByScope,
  sessionListCommand,
  sessionConnectCommand,
  sessionPickerCommand,
} from "./session.ts";
import type { SessionDeps } from "./session.ts";
import type { TmuxSession } from "../../sdk/runtime/tmux.ts";

// Force plain-text output so assertions match readable substrings.
let originalNoColor: string | undefined;
beforeAll(() => {
  originalNoColor = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
});
afterAll(() => {
  if (originalNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = originalNoColor;
});

// ─── renderSessionList ─────────────────────────────────────────────────────

describe("renderSessionList", () => {
  test("empty state teaches user how to start a session", () => {
    const output = renderSessionList([]);
    expect(output).toContain("no sessions running");
    expect(output).toContain("atomic chat -a <agent>");
    expect(output).toContain("atomic workflow -n <name> -a <agent>");
  });

  test("renders a single session with name and status", () => {
    const sessions: TmuxSession[] = [
      {
        name: "atomic-chat-claude-abc12345",
        windows: 1,
        created: new Date().toISOString(),
        attached: false,
        type: "chat",
        agent: "claude",
      },
    ];
    const output = renderSessionList(sessions);
    expect(output).toContain("1 session");
    expect(output).toContain("atomic-chat-claude-abc12345");
    expect(output).toContain("○"); // unattached indicator
  });

  test("renders agent badge when agent field is present", () => {
    const sessions: TmuxSession[] = [
      {
        name: "atomic-chat-claude-abc12345",
        windows: 1,
        created: new Date().toISOString(),
        attached: false,
        type: "chat",
        agent: "claude",
      },
    ];
    const output = renderSessionList(sessions);
    expect(output).toContain("[claude]");
  });

  test("omits agent badge when agent field is undefined", () => {
    const sessions: TmuxSession[] = [
      {
        name: "atomic-chat-abc12345",
        windows: 1,
        created: new Date().toISOString(),
        attached: false,
      },
    ];
    const output = renderSessionList(sessions);
    expect(output).not.toMatch(/\[.*\]/);
  });

  test("renders attached sessions with the filled indicator", () => {
    const sessions: TmuxSession[] = [
      {
        name: "my-session",
        windows: 2,
        created: new Date().toISOString(),
        attached: true,
      },
    ];
    const output = renderSessionList(sessions);
    expect(output).toContain("●"); // attached indicator
    expect(output).toContain("attached");
  });

  test("pluralises 'sessions' for multiple entries", () => {
    const sessions: TmuxSession[] = [
      { name: "a", windows: 1, created: new Date().toISOString(), attached: false },
      { name: "b", windows: 1, created: new Date().toISOString(), attached: false },
    ];
    const output = renderSessionList(sessions);
    expect(output).toContain("2 sessions");
  });

  test("shows relative age for recent sessions", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const sessions: TmuxSession[] = [
      { name: "recent", windows: 1, created: fiveMinAgo, attached: false },
    ];
    const output = renderSessionList(sessions);
    expect(output).toContain("5m ago");
  });

  test("shows connect hint in footer", () => {
    const sessions: TmuxSession[] = [
      { name: "s", windows: 1, created: new Date().toISOString(), attached: false },
    ];
    const output = renderSessionList(sessions);
    expect(output).toContain("atomic session connect");
  });
});

// ─── filterByScope ────────────────────────────────────────────────────────

describe("filterByScope", () => {
  const now = new Date().toISOString();
  const sessions: TmuxSession[] = [
    { name: "atomic-chat-claude-aaa11111", windows: 1, created: now, attached: false, type: "chat", agent: "claude" },
    { name: "atomic-chat-copilot-bbb22222", windows: 1, created: now, attached: false, type: "chat", agent: "copilot" },
    { name: "atomic-wf-claude-ralph-ccc33333", windows: 3, created: now, attached: false, type: "workflow", agent: "claude" },
    { name: "atomic-wf-opencode-gen-spec-ddd44444", windows: 2, created: now, attached: false, type: "workflow", agent: "opencode" },
    { name: "unrelated-session", windows: 1, created: now, attached: false }, // no type
  ];

  test("returns all sessions when scope is 'all'", () => {
    expect(filterByScope(sessions, "all")).toEqual(sessions);
  });

  test("filters to chat sessions only", () => {
    const result = filterByScope(sessions, "chat");
    expect(result).toHaveLength(2);
    expect(result.every((s) => s.type === "chat")).toBe(true);
  });

  test("filters to workflow sessions only", () => {
    const result = filterByScope(sessions, "workflow");
    expect(result).toHaveLength(2);
    expect(result.every((s) => s.type === "workflow")).toBe(true);
  });

  test("excludes sessions with no type when scope is chat", () => {
    const result = filterByScope(sessions, "chat");
    expect(result.find((s) => s.name === "unrelated-session")).toBeUndefined();
  });

  test("excludes sessions with no type when scope is workflow", () => {
    const result = filterByScope(sessions, "workflow");
    expect(result.find((s) => s.name === "unrelated-session")).toBeUndefined();
  });
});

// ─── filterByAgent ────────────────────────────────────────────────────────

describe("filterByAgent", () => {
  const now = new Date().toISOString();
  const sessions: TmuxSession[] = [
    { name: "atomic-chat-claude-aaa11111", windows: 1, created: now, attached: false, type: "chat", agent: "claude" },
    { name: "atomic-chat-copilot-bbb22222", windows: 1, created: now, attached: false, type: "chat", agent: "copilot" },
    { name: "atomic-wf-opencode-ralph-ccc33333", windows: 1, created: now, attached: false, type: "workflow", agent: "opencode" },
    { name: "unrelated-session", windows: 1, created: now, attached: false }, // no agent
  ];

  test("returns all sessions when agents array is empty", () => {
    expect(filterByAgent(sessions, [])).toEqual(sessions);
  });

  test("filters to a single agent", () => {
    const result = filterByAgent(sessions, ["claude"]);
    expect(result).toHaveLength(1);
    expect(result[0]!.agent).toBe("claude");
  });

  test("filters to multiple agents", () => {
    const result = filterByAgent(sessions, ["copilot", "opencode"]);
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.agent)).toEqual(["copilot", "opencode"]);
  });

  test("matching is case-insensitive", () => {
    const result = filterByAgent(sessions, ["CLAUDE"]);
    expect(result).toHaveLength(1);
    expect(result[0]!.agent).toBe("claude");
  });

  test("excludes sessions with no agent field", () => {
    const result = filterByAgent(sessions, ["claude", "copilot", "opencode"]);
    expect(result).toHaveLength(3);
    expect(result.every((s) => s.agent !== undefined)).toBe(true);
  });

  test("returns empty array when no agents match", () => {
    expect(filterByAgent(sessions, ["nonexistent"])).toEqual([]);
  });
});

// ─── renderSessionList — formatAge branches ─────────────────────────────

describe("renderSessionList — formatAge edge cases", () => {
  test("shows hours-ago for sessions older than 60 minutes", () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const sessions: TmuxSession[] = [
      { name: "old-session", windows: 1, created: threeHoursAgo, attached: false },
    ];
    const output = renderSessionList(sessions);
    expect(output).toContain("3h ago");
  });

  test("shows days-ago for sessions older than 24 hours", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const sessions: TmuxSession[] = [
      { name: "ancient-session", windows: 1, created: twoDaysAgo, attached: false },
    ];
    const output = renderSessionList(sessions);
    expect(output).toContain("2d ago");
  });

  test("shows raw string for unparseable dates", () => {
    const sessions: TmuxSession[] = [
      { name: "bad-date", windows: 1, created: "not-a-date", attached: false },
    ];
    const output = renderSessionList(sessions);
    expect(output).toContain("not-a-date");
  });

  test("shows 'just now' for future timestamps", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const sessions: TmuxSession[] = [
      { name: "future-session", windows: 1, created: future, attached: false },
    ];
    const output = renderSessionList(sessions);
    expect(output).toContain("just now");
  });
});

// ─── filterByScope + filterByAgent combined ───────────────────────────────

describe("filterByScope + filterByAgent combined", () => {
  const now = new Date().toISOString();
  const sessions: TmuxSession[] = [
    { name: "atomic-chat-claude-aaa11111", windows: 1, created: now, attached: false, type: "chat", agent: "claude" },
    { name: "atomic-chat-copilot-bbb22222", windows: 1, created: now, attached: false, type: "chat", agent: "copilot" },
    { name: "atomic-wf-claude-ralph-ccc33333", windows: 3, created: now, attached: false, type: "workflow", agent: "claude" },
    { name: "atomic-wf-opencode-gen-spec-ddd44444", windows: 2, created: now, attached: false, type: "workflow", agent: "opencode" },
  ];

  test("scope=chat + agent=claude returns only claude chat sessions", () => {
    const result = filterByAgent(filterByScope(sessions, "chat"), ["claude"]);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("atomic-chat-claude-aaa11111");
  });

  test("scope=workflow + agent=claude returns only claude workflow sessions", () => {
    const result = filterByAgent(filterByScope(sessions, "workflow"), ["claude"]);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("atomic-wf-claude-ralph-ccc33333");
  });

  test("scope=all + agent=claude returns both chat and workflow claude sessions", () => {
    const result = filterByAgent(filterByScope(sessions, "all"), ["claude"]);
    expect(result).toHaveLength(2);
  });
});

// ─── Command functions (dependency-injected mocks) ──────────────────────────
//
// Instead of mock.module (which leaks across test files in Bun — see
// https://github.com/oven-sh/bun/issues/12823), each command function
// receives its tmux/prompt dependencies via a `SessionDeps` parameter.
// This keeps the mocks scoped to these tests without polluting the
// module registry for other test files that import from tmux.ts.

const tmuxMocks = {
  isTmuxInstalled: mock<() => boolean>(() => true),
  sessionExists: mock<(name: string) => boolean>(() => true),
  listSessions: mock<() => TmuxSession[]>(() => []),
  isInsideAtomicSocket: mock<() => boolean>(() => false),
  isInsideTmux: mock<() => boolean>(() => false),
  switchClient: mock<(name: string) => void>(() => {}),
  detachAndAttachAtomic: mock<(name: string) => void>(() => {}),
  spawnMuxAttach: mock(() => ({ exited: Promise.resolve(0) }) as never),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  select: mock<(...args: any[]) => Promise<string | symbol>>(() => Promise.resolve("my-session")),
  isCancel: ((v: unknown) => typeof v === "symbol") as SessionDeps["isCancel"],
};

/** Build a deps object from the current mock state. */
function makeDeps(): SessionDeps {
  return tmuxMocks as unknown as SessionDeps;
}

function resetTmuxMocks(): void {
  tmuxMocks.isTmuxInstalled.mockReset().mockReturnValue(true);
  tmuxMocks.sessionExists.mockReset().mockReturnValue(true);
  tmuxMocks.listSessions.mockReset().mockReturnValue([]);
  tmuxMocks.isInsideAtomicSocket.mockReset().mockReturnValue(false);
  tmuxMocks.isInsideTmux.mockReset().mockReturnValue(false);
  tmuxMocks.switchClient.mockReset();
  tmuxMocks.detachAndAttachAtomic.mockReset();
  tmuxMocks.spawnMuxAttach.mockReset().mockReturnValue({ exited: Promise.resolve(0) } as never);
  tmuxMocks.select.mockReset().mockResolvedValue("my-session");
}

// ─── sessionListCommand ─────────────────────────────────────────────────

describe("sessionListCommand", () => {
  beforeEach(resetTmuxMocks);

  test("returns 0 and prints 'no sessions' when tmux is not installed", async () => {
    tmuxMocks.isTmuxInstalled.mockReturnValue(false);
    const chunks: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = ((c: string) => { chunks.push(c); return true; }) as typeof process.stdout.write;
    try {
      const code = await sessionListCommand([], "all", makeDeps());
      expect(code).toBe(0);
      const output = chunks.join("");
      expect(output).toContain("no sessions running");
      expect(output).toContain("tmux is not installed");
    } finally {
      process.stdout.write = origWrite;
    }
  });

  test("returns 0 and prints session list when tmux is installed", async () => {
    const now = new Date().toISOString();
    tmuxMocks.listSessions.mockReturnValue([
      { name: "atomic-chat-claude-aaa11111", windows: 1, created: now, attached: false, type: "chat" as const, agent: "claude" },
    ]);
    const chunks: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = ((c: string) => { chunks.push(c); return true; }) as typeof process.stdout.write;
    try {
      const code = await sessionListCommand([], "all", makeDeps());
      expect(code).toBe(0);
      const output = chunks.join("");
      expect(output).toContain("1 session");
      expect(output).toContain("atomic-chat-claude-aaa11111");
    } finally {
      process.stdout.write = origWrite;
    }
  });

  test("filters by scope and agent", async () => {
    const now = new Date().toISOString();
    tmuxMocks.listSessions.mockReturnValue([
      { name: "chat-1", windows: 1, created: now, attached: false, type: "chat" as const, agent: "claude" },
      { name: "wf-1", windows: 1, created: now, attached: false, type: "workflow" as const, agent: "opencode" },
    ]);
    const chunks: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = ((c: string) => { chunks.push(c); return true; }) as typeof process.stdout.write;
    try {
      const code = await sessionListCommand(["claude"], "chat", makeDeps());
      expect(code).toBe(0);
      const output = chunks.join("");
      expect(output).toContain("chat-1");
      expect(output).not.toContain("wf-1");
    } finally {
      process.stdout.write = origWrite;
    }
  });
});

// ─── sessionConnectCommand ──────────────────────────────────────────────

describe("sessionConnectCommand", () => {
  beforeEach(resetTmuxMocks);

  test("returns 1 when tmux is not installed", async () => {
    tmuxMocks.isTmuxInstalled.mockReturnValue(false);
    const origWrite = process.stderr.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;
    try {
      const code = await sessionConnectCommand("my-session", makeDeps());
      expect(code).toBe(1);
    } finally {
      process.stderr.write = origWrite;
    }
  });

  test("returns 1 when session does not exist", async () => {
    tmuxMocks.sessionExists.mockReturnValue(false);
    const origWrite = process.stderr.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;
    try {
      const code = await sessionConnectCommand("missing", makeDeps());
      expect(code).toBe(1);
    } finally {
      process.stderr.write = origWrite;
    }
  });

  test("lists available sessions when target not found", async () => {
    tmuxMocks.sessionExists.mockReturnValue(false);
    const now = new Date().toISOString();
    tmuxMocks.listSessions.mockReturnValue([
      { name: "existing", windows: 1, created: now, attached: false },
    ]);
    const chunks: string[] = [];
    const origWrite = process.stderr.write;
    process.stderr.write = ((c: string) => { chunks.push(c); return true; }) as typeof process.stderr.write;
    try {
      await sessionConnectCommand("missing", makeDeps());
      const output = chunks.join("");
      expect(output).toContain("existing");
    } finally {
      process.stderr.write = origWrite;
    }
  });

  test("uses switch-client when inside atomic socket", async () => {
    tmuxMocks.isInsideAtomicSocket.mockReturnValue(true);
    const code = await sessionConnectCommand("my-session", makeDeps());
    expect(code).toBe(0);
    expect(tmuxMocks.switchClient).toHaveBeenCalledWith("my-session");
  });

  test("uses detach-and-attach when inside non-atomic tmux", async () => {
    tmuxMocks.isInsideTmux.mockReturnValue(true);
    const code = await sessionConnectCommand("my-session", makeDeps());
    expect(code).toBe(0);
    expect(tmuxMocks.detachAndAttachAtomic).toHaveBeenCalledWith("my-session");
  });

  test("spawns attach when outside tmux", async () => {
    const code = await sessionConnectCommand("my-session", makeDeps());
    expect(code).toBe(0);
    expect(tmuxMocks.spawnMuxAttach).toHaveBeenCalledWith("my-session");
  });
});

// ─── sessionPickerCommand ──────────────────────────────────────────────

describe("sessionPickerCommand", () => {
  beforeEach(resetTmuxMocks);

  test("returns 1 when tmux is not installed", async () => {
    tmuxMocks.isTmuxInstalled.mockReturnValue(false);
    const origWrite = process.stderr.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;
    try {
      const code = await sessionPickerCommand([], "all", makeDeps());
      expect(code).toBe(1);
    } finally {
      process.stderr.write = origWrite;
    }
  });

  test("prints empty state and returns 0 when no sessions exist", async () => {
    const chunks: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = ((c: string) => { chunks.push(c); return true; }) as typeof process.stdout.write;
    try {
      const code = await sessionPickerCommand([], "all", makeDeps());
      expect(code).toBe(0);
      const output = chunks.join("");
      expect(output).toContain("no sessions running");
    } finally {
      process.stdout.write = origWrite;
    }
  });

  test("shows picker and connects to selected session", async () => {
    const now = new Date().toISOString();
    tmuxMocks.listSessions.mockReturnValue([
      { name: "my-session", windows: 1, created: now, attached: false },
    ]);
    tmuxMocks.select.mockResolvedValue("my-session");
    const code = await sessionPickerCommand([], "all", makeDeps());
    expect(code).toBe(0);
    expect(tmuxMocks.spawnMuxAttach).toHaveBeenCalledWith("my-session");
  });

  test("returns 0 when user cancels picker", async () => {
    const now = new Date().toISOString();
    tmuxMocks.listSessions.mockReturnValue([
      { name: "a-session", windows: 1, created: now, attached: false },
    ]);
    tmuxMocks.select.mockResolvedValue(Symbol("cancel"));
    const code = await sessionPickerCommand([], "all", makeDeps());
    expect(code).toBe(0);
    expect(tmuxMocks.spawnMuxAttach).not.toHaveBeenCalled();
  });
});
