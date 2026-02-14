import { describe, expect, test } from "bun:test";
import type { McpRuntimeSnapshot } from "./types.ts";
import { OpenCodeClient } from "./opencode-client.ts";

interface OpenCodeSnapshotHarness {
  sdkClient: unknown;
  buildOpenCodeMcpSnapshot: () => Promise<McpRuntimeSnapshot | null>;
}

describe("OpenCode MCP runtime snapshot", () => {
  test("builds snapshot from status, tool ids, and resources", async () => {
    const client = new OpenCodeClient({ directory: "/tmp/project" });
    const harness = client as unknown as OpenCodeSnapshotHarness;

    harness.sdkClient = {
      mcp: {
        status: async () => ({
          data: {
            deepwiki: { status: "needs_auth" },
            filesystem: { status: "connected" },
          },
        }),
      },
      tool: {
        ids: async () => ({
          data: [
            "Read",
            "mcp__deepwiki__ask_question",
            "mcp__filesystem__list",
            "mcp__deepwiki__ask_question",
          ],
        }),
      },
      experimental: {
        resource: {
          list: async () => ({
            data: {
              a: { name: "Guide", uri: "file://guide.md", client: "deepwiki" },
              b: { name: "Root", uri: "file:///", client: "filesystem" },
            },
          }),
        },
      },
    };

    const snapshot = await harness.buildOpenCodeMcpSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.servers.deepwiki?.authStatus).toBe("Not logged in");
    expect(snapshot?.servers.deepwiki?.tools).toEqual(["mcp__deepwiki__ask_question"]);
    expect(snapshot?.servers.deepwiki?.resources).toEqual([
      { name: "Guide", uri: "file://guide.md" },
    ]);
    expect(snapshot?.servers.filesystem?.tools).toEqual(["mcp__filesystem__list"]);
    expect(snapshot?.servers.filesystem?.resources).toEqual([
      { name: "Root", uri: "file:///" },
    ]);
  });

  test("returns partial snapshot when only one source succeeds", async () => {
    const client = new OpenCodeClient({ directory: "/tmp/project" });
    const harness = client as unknown as OpenCodeSnapshotHarness;

    harness.sdkClient = {
      mcp: {
        status: async () => {
          throw new Error("status unavailable");
        },
      },
      tool: {
        ids: async () => ({
          data: ["mcp__deepwiki__ask_question"],
        }),
      },
      experimental: {
        resource: {
          list: async () => ({
            error: "resource unavailable",
          }),
        },
      },
    };

    const snapshot = await harness.buildOpenCodeMcpSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.servers.deepwiki?.tools).toEqual(["mcp__deepwiki__ask_question"]);
  });

  test("returns null when all sources fail", async () => {
    const client = new OpenCodeClient({ directory: "/tmp/project" });
    const harness = client as unknown as OpenCodeSnapshotHarness;

    harness.sdkClient = {
      mcp: {
        status: async () => {
          throw new Error("status unavailable");
        },
      },
      tool: {
        ids: async () => ({
          error: "tool ids unavailable",
        }),
      },
      experimental: {
        resource: {
          list: async () => {
            throw new Error("resource unavailable");
          },
        },
      },
    };

    const snapshot = await harness.buildOpenCodeMcpSnapshot();
    expect(snapshot).toBeNull();
  });
});
