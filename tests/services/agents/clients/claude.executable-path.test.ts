import { describe, expect, test } from "bun:test";
import { resolveClaudeCodeExecutablePath } from "@/services/agents/clients/claude.ts";

interface FakeFs {
    pathExists: (path: string) => boolean;
    resolveRealPath: (path: string) => string;
}

function createFakeFs(
    existingPaths: string[],
    realPathMap: Record<string, string> = {},
): FakeFs {
    const existing = new Set(existingPaths);
    return {
        pathExists: (path: string) => existing.has(path),
        resolveRealPath: (path: string) => {
            const resolved = realPathMap[path];
            if (!resolved) {
                return path;
            }
            if (!existing.has(resolved)) {
                throw new Error(`Missing fake path: ${resolved}`);
            }
            return resolved;
        },
    };
}

describe("resolveClaudeCodeExecutablePath", () => {
    test("prefers native macOS install over Bun/npm shim", () => {
        const homeDir = "/Users/tester";
        const fs = createFakeFs(
            [
                "/opt/homebrew/bin/claude",
                "/opt/homebrew/Caskroom/claude-code/2.0.0/claude",
                `${homeDir}/.bun/bin/claude`,
                `${homeDir}/.bun/install/global/node_modules/@anthropic-ai/claude-code/cli.js`,
                "/repo/node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
            ],
            {
                "/opt/homebrew/bin/claude":
                    "/opt/homebrew/Caskroom/claude-code/2.0.0/claude",
                [`${homeDir}/.bun/bin/claude`]:
                    `${homeDir}/.bun/install/global/node_modules/@anthropic-ai/claude-code/cli.js`,
            },
        );

        const resolved = resolveClaudeCodeExecutablePath({
            platform: "darwin",
            homeDir,
            claudeFromPath: `${homeDir}/.bun/bin/claude`,
            sdkCliPath: "/repo/node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
            envOverridePath: null,
            pathExists: fs.pathExists,
            resolveRealPath: fs.resolveRealPath,
        });

        expect(resolved).toBe("/opt/homebrew/bin/claude");
    });

    test("falls back to PATH Claude shim on macOS when no native install exists", () => {
        const homeDir = "/Users/tester";
        const fs = createFakeFs(
            [
                `${homeDir}/.bun/bin/claude`,
                `${homeDir}/.bun/install/global/node_modules/@anthropic-ai/claude-code/cli.js`,
                "/repo/node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
            ],
            {
                [`${homeDir}/.bun/bin/claude`]:
                    `${homeDir}/.bun/install/global/node_modules/@anthropic-ai/claude-code/cli.js`,
            },
        );

        const resolved = resolveClaudeCodeExecutablePath({
            platform: "darwin",
            homeDir,
            claudeFromPath: `${homeDir}/.bun/bin/claude`,
            sdkCliPath: "/repo/node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
            envOverridePath: null,
            pathExists: fs.pathExists,
            resolveRealPath: fs.resolveRealPath,
        });

        expect(resolved).toBe(`${homeDir}/.bun/bin/claude`);
    });

    test("prefers installed Claude binary on non-macOS", () => {
        const fs = createFakeFs([
            "/usr/bin/claude",
            "/repo/node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
        ]);

        const resolved = resolveClaudeCodeExecutablePath({
            platform: "linux",
            homeDir: "/home/tester",
            claudeFromPath: "/usr/bin/claude",
            sdkCliPath: "/repo/node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
            envOverridePath: null,
            pathExists: fs.pathExists,
            resolveRealPath: fs.resolveRealPath,
        });

        expect(resolved).toBe("/usr/bin/claude");
    });

    test("falls back to SDK bundled CLI on non-macOS when no Claude binary exists", () => {
        const fs = createFakeFs([
            "/repo/node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
        ]);

        const resolved = resolveClaudeCodeExecutablePath({
            platform: "linux",
            homeDir: "/home/tester",
            claudeFromPath: null,
            sdkCliPath: "/repo/node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
            envOverridePath: null,
            pathExists: fs.pathExists,
            resolveRealPath: fs.resolveRealPath,
        });

        expect(resolved).toBe("/repo/node_modules/@anthropic-ai/claude-agent-sdk/cli.js");
    });

    test("uses non-node_modules PATH Claude on macOS when available", () => {
        const fs = createFakeFs([
            "/usr/local/bin/claude",
            "/repo/node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
        ]);

        const resolved = resolveClaudeCodeExecutablePath({
            platform: "darwin",
            homeDir: "/Users/tester",
            claudeFromPath: "/usr/local/bin/claude",
            sdkCliPath: "/repo/node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
            envOverridePath: null,
            pathExists: fs.pathExists,
            resolveRealPath: fs.resolveRealPath,
        });

        expect(resolved).toBe("/usr/local/bin/claude");
    });

    test("honors explicit ATOMIC_CLAUDE_CODE_EXECUTABLE override", () => {
        const fs = createFakeFs([
            "/custom/claude",
            "/usr/local/bin/claude",
            "/repo/node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
        ]);

        const resolved = resolveClaudeCodeExecutablePath({
            platform: "darwin",
            homeDir: "/Users/tester",
            claudeFromPath: "/usr/local/bin/claude",
            sdkCliPath: "/repo/node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
            envOverridePath: "/custom/claude",
            pathExists: fs.pathExists,
            resolveRealPath: fs.resolveRealPath,
        });

        expect(resolved).toBe("/custom/claude");
    });
});
