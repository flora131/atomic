import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { renderSessionList, filterByAgent, filterByScope } from "./session.ts";
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
