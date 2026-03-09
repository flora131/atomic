import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { CommandContext } from "@/commands/tui/registry.ts";
import { globalRegistry } from "@/commands/tui/registry.ts";
import {
    discoverAndRegisterDiskSkills,
    getRuntimeCompatibleSkillDiscoveryPaths,
    validateDiskSkillDefinitionIntegrity,
} from "@/commands/tui/skill-commands.ts";
import {
    collectDefinitionDiscoveryMatches,
    createAllProviderDiscoveryPlans,
    filterDefinitionMatchesByRuntimeCompatibility,
} from "@/commands/tui/definition-integrity.ts";
import { buildProviderDiscoveryPlan } from "@/services/config/provider-discovery-plan.ts";

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

function parseDiscoveryEventMessages(
    messages: readonly string[],
): DiscoveryEventCapture[] {
    const prefix = "[discovery.event]";
    return messages
        .filter((message) => message.startsWith(prefix))
        .map(
            (message) =>
                JSON.parse(
                    message.slice(prefix.length).trim(),
                ) as DiscoveryEventCapture,
        );
}

function getDiscoveryEventDataString(
    event: DiscoveryEventCapture | undefined,
    key: string,
): string | undefined {
    const value = event?.data?.[key];
    return typeof value === "string" ? value : undefined;
}

function createMockContext(
    overrides?: Partial<CommandContext>,
): CommandContext {
    return {
        session: null,
        state: {
            isStreaming: false,
            messageCount: 0,
        },
        addMessage: () => {},
        setStreaming: () => {},
        sendMessage: () => {},
        sendSilentMessage: () => {},
        spawnSubagent: async () => ({ success: true, output: "" }),
        streamAndWait: async () => ({ content: "", wasInterrupted: false }),
        clearContext: async () => {},
        setTodoItems: () => {},
        setWorkflowSessionDir: () => {},
        setWorkflowSessionId: () => {},
        setWorkflowTaskIds: () => {},
        waitForUserInput: async () => "",
        updateWorkflowState: () => {},
        ...overrides,
    };
}

describe("skill-commands builtins", () => {
    beforeEach(() => {
        globalRegistry.clear();
    });

    test("disk skill invokes native slash skill with provided arguments", async () => {
        const originalCwd = process.cwd();
        const originalHome = process.env.HOME;
        const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

        const tempRoot = mkdtempSync(
            join(tmpdir(), "skill-missing-arguments-"),
        );
        const homeDir = join(tempRoot, "home");
        const projectRoot = join(homeDir, "project");
        const xdgConfigHome = join(homeDir, ".config");

        try {
            mkdirSync(
                join(projectRoot, ".claude", "skills", "prompt-engineer-safe"),
                {
                    recursive: true,
                },
            );
            writeFileSync(
                join(
                    projectRoot,
                    ".claude",
                    "skills",
                    "prompt-engineer-safe",
                    "SKILL.md",
                ),
                [
                    "---",
                    "name: prompt-engineer-safe",
                    "description: Prompt skill without explicit arguments placeholder",
                    "---",
                    "",
                    "# Prompt Engineer",
                    "Refine and improve user prompts.",
                ].join("\n"),
                "utf-8",
            );

            process.env.HOME = homeDir;
            process.env.XDG_CONFIG_HOME = xdgConfigHome;
            process.chdir(projectRoot);

            const claudePlan = buildProviderDiscoveryPlan("claude", {
                projectRoot,
                homeDir,
                xdgConfigHome,
            });

            await discoverAndRegisterDiskSkills(claudePlan);
            const command = globalRegistry.get("prompt-engineer-safe");
            expect(command).toBeDefined();

            const sentMessages: string[] = [];
            const context = createMockContext({
                sendSilentMessage: (content: string) => {
                    sentMessages.push(content);
                },
            });

            const result = await Promise.resolve(
                command!.execute(
                    "Refine my prompt: add debugging output to all critical functions",
                    context,
                ),
            );

            expect(result.success).toBe(true);
            expect(sentMessages).toHaveLength(1);
            expect(sentMessages[0]).toBe(
                "/prompt-engineer-safe Refine my prompt: add debugging output to all critical functions",
            );
        } finally {
            process.chdir(originalCwd);
            if (originalHome === undefined) {
                delete process.env.HOME;
            } else {
                process.env.HOME = originalHome;
            }
            if (originalXdgConfigHome === undefined) {
                delete process.env.XDG_CONFIG_HOME;
            } else {
                process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
            }
            rmSync(tempRoot, { recursive: true, force: true });
            globalRegistry.clear();
        }
    });

    test("rejects malformed or incompatible disk skill definitions", () => {
        const plans = createAllProviderDiscoveryPlans({
            homeDir: "/home/tester",
            projectRoot: "/workspace/repo",
            xdgConfigHome: "/home/tester/.config",
        });

        const result = validateDiskSkillDefinitionIntegrity(
            {
                name: "bad skill",
                description: "",
                skillFilePath: "/tmp/outside/skill.md",
                source: "project",
                aliases: ["bad alias"],
                requiredArguments: ["valid", "bad arg"],
            },
            { discoveryPlans: plans },
        );

        expect(result.valid).toBe(false);
        expect(
            result.issues.some((issue) => issue.includes("Invalid skill name")),
        ).toBe(true);
        expect(
            result.issues.some((issue) => issue.includes("Invalid alias")),
        ).toBe(true);
        expect(
            result.issues.some((issue) =>
                issue.includes("outside configured skill discovery roots"),
            ),
        ).toBe(true);
    });

    test("accepts valid disk skill definitions in configured roots", () => {
        const plans = createAllProviderDiscoveryPlans({
            homeDir: "/home/tester",
            projectRoot: "/workspace/repo",
            xdgConfigHome: "/home/tester/.config",
        });

        const result = validateDiskSkillDefinitionIntegrity(
            {
                name: "code-review",
                description: "Review code changes",
                skillFilePath:
                    "/workspace/repo/.claude/skills/code-review/SKILL.md",
                source: "project",
                aliases: ["review"],
                requiredArguments: ["target"],
                argumentHint: "[target]",
            },
            { discoveryPlans: plans },
        );

        expect(result.valid).toBe(true);
        expect(result.discoveryMatches.length).toBeGreaterThan(0);
        expect(
            result.discoveryMatches.some(
                (match) =>
                    match.provider === "claude" &&
                    match.rootId === "claude_project",
            ),
        ).toBe(true);
    });

    test("runtime filtering only includes Copilot AGENTS.md roots", () => {
        const plans = createAllProviderDiscoveryPlans({
            homeDir: "/home/tester",
            projectRoot: "/workspace/repo",
        });

        const copilotPlan = plans.find((plan) => plan.provider === "copilot");
        if (!copilotPlan) {
            throw new Error("Expected copilot discovery plan");
        }

        const discoveryMatches = collectDefinitionDiscoveryMatches(
            "/workspace/repo/.github/skills/shared/SKILL.md",
            "skill",
            plans,
        );
        const runtimeCompatibleMatches =
            filterDefinitionMatchesByRuntimeCompatibility(discoveryMatches, [
                copilotPlan,
            ]);

        expect(
            runtimeCompatibleMatches.some(
                (match) =>
                    match.provider === "copilot" &&
                    match.rootId === "copilot_project",
            ),
        ).toBe(true);
    });

    test("builds runtime-compatible skill search paths from OpenCode discovery plan", () => {
        const projectRoot = "/workspace/repo";
        const homeDir = "/home/tester";
        const xdgConfigHome = "/home/tester/.config";
        const opencodePlan = buildProviderDiscoveryPlan("opencode", {
            projectRoot,
            homeDir,
            xdgConfigHome,
            pathExists: () => false,
            platform: "linux",
        });

        const searchPaths = getRuntimeCompatibleSkillDiscoveryPaths([
            opencodePlan,
        ]);

        expect(searchPaths).toContain(resolve("/workspace/repo/.opencode/skills"));
        expect(searchPaths).toContain(resolve("/home/tester/.config/.opencode/skills"));
        expect(searchPaths).toContain(resolve("/home/tester/.opencode/skills"));
        expect(searchPaths).toHaveLength(3);
    });

    test("accepts user home skill roots for OpenCode", () => {
        const plans = createAllProviderDiscoveryPlans({
            homeDir: "/home/tester",
            projectRoot: "/workspace/repo",
        });

        const result = validateDiskSkillDefinitionIntegrity(
            {
                name: "shared-legacy-skill",
                description: "Shared compatibility skill",
                skillFilePath:
                    "/home/tester/.opencode/skills/shared-legacy-skill/SKILL.md",
                source: "user",
            },
            { discoveryPlans: plans },
        );

        expect(result.valid).toBe(true);
        expect(result.issues).toHaveLength(0);
    });

    test("runtime filtering excludes skills incompatible with Claude runtime", () => {
        const plans = createAllProviderDiscoveryPlans({
            homeDir: "/home/tester",
            projectRoot: "/workspace/repo",
        });

        const claudePlan = plans.find((plan) => plan.provider === "claude");
        if (!claudePlan) {
            throw new Error("Expected claude discovery plan");
        }

        const discoveryMatches = collectDefinitionDiscoveryMatches(
            "/workspace/repo/.github/skills/copilot-only/SKILL.md",
            "skill",
            plans,
        );
        const runtimeCompatibleMatches =
            filterDefinitionMatchesByRuntimeCompatibility(discoveryMatches, [
                claudePlan,
            ]);

        expect(runtimeCompatibleMatches).toHaveLength(0);
    });

    test("discoverAndRegisterDiskSkills skips malformed and incompatible skills with reasons", async () => {
        const originalCwd = process.cwd();
        const originalHome = process.env.HOME;
        const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
        const originalDebug = process.env.DEBUG;

        const tempRoot = mkdtempSync(join(tmpdir(), "skill-skip-reasons-"));
        const homeDir = join(tempRoot, "home");
        const projectRoot = join(homeDir, "project");
        const xdgConfigHome = join(homeDir, ".config");

        const writeSkill = (skillFilePath: string, content: string): void => {
            mkdirSync(dirname(skillFilePath), { recursive: true });
            writeFileSync(skillFilePath, content);
        };

        const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

        try {
            mkdirSync(projectRoot, { recursive: true });
            mkdirSync(xdgConfigHome, { recursive: true });
            process.env.HOME = homeDir;
            process.env.XDG_CONFIG_HOME = xdgConfigHome;
            process.env.DEBUG = "1";
            process.chdir(projectRoot);

            writeSkill(
                join(
                    projectRoot,
                    ".claude",
                    "skills",
                    "claude-skill",
                    "SKILL.md",
                ),
                "Use this skill for claude tasks.",
            );
            writeSkill(
                join(
                    projectRoot,
                    ".claude",
                    "skills",
                    "broken-frontmatter",
                    "SKILL.md",
                ),
                "---\nname: broken-frontmatter\ndescription: missing closing delimiter",
            );
            writeSkill(
                join(
                    projectRoot,
                    ".github",
                    "skills",
                    "copilot-only",
                    "SKILL.md",
                ),
                "Copilot-only skill instructions.",
            );

            const claudePlan = buildProviderDiscoveryPlan("claude", {
                projectRoot,
                homeDir,
                xdgConfigHome,
            });

            await discoverAndRegisterDiskSkills(claudePlan);

            expect(globalRegistry.has("claude-skill")).toBe(true);
            expect(globalRegistry.has("broken-frontmatter")).toBe(false);
            expect(globalRegistry.has("copilot-only")).toBe(false);

            const warningMessages = warnSpy.mock.calls
                .map((call) => call[0])
                .filter(
                    (message): message is string => typeof message === "string",
                );
            const discoveryEvents =
                parseDiscoveryEventMessages(warningMessages);
            const serializedDiscoveryEvents = JSON.stringify(discoveryEvents);

            expect(serializedDiscoveryEvents.includes(projectRoot)).toBe(false);
            expect(serializedDiscoveryEvents.includes(homeDir)).toBe(false);

            const malformedSkipEvent = discoveryEvents.find(
                (event) =>
                    event.event === "discovery.definition.skipped" &&
                    getDiscoveryEventDataString(event, "reason") ===
                        "parse_failed" &&
                    event.tags.path.endsWith("broken-frontmatter/SKILL.md"),
            );

            expect(malformedSkipEvent?.tags.provider).toBe("claude");
            expect(malformedSkipEvent?.tags.installType).toBe("source");
            expect(malformedSkipEvent?.tags.rootTier).toBe("projectLocal");

            const compatibilityFilteredEvent = discoveryEvents.find(
                (event) =>
                    event.event === "discovery.compatibility.filtered" &&
                    getDiscoveryEventDataString(event, "kind") === "skill" &&
                    event.tags.path.endsWith("copilot-only/SKILL.md"),
            );

            expect(compatibilityFilteredEvent).toBeUndefined();

            expect(
                warningMessages.some(
                    (message) =>
                        message.includes("broken-frontmatter/SKILL.md") &&
                        message.includes("Invalid markdown frontmatter block"),
                ),
            ).toBe(true);

            expect(
                warningMessages.some((message) =>
                    message.includes("copilot-only/SKILL.md"),
                ),
            ).toBe(false);
        } finally {
            warnSpy.mockRestore();
            process.chdir(originalCwd);
            if (originalHome === undefined) {
                delete process.env.HOME;
            } else {
                process.env.HOME = originalHome;
            }
            if (originalXdgConfigHome === undefined) {
                delete process.env.XDG_CONFIG_HOME;
            } else {
                process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
            }
            if (originalDebug === undefined) {
                delete process.env.DEBUG;
            } else {
                process.env.DEBUG = originalDebug;
            }
            rmSync(tempRoot, { recursive: true, force: true });
            globalRegistry.clear();
        }
    });
});
