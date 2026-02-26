import { beforeEach, describe, expect, test } from "bun:test";
import type { CommandContext } from "./registry.ts";
import { globalRegistry } from "./registry.ts";
import {
    BUILTIN_SKILLS,
    registerBuiltinSkills,
} from "./skill-commands.ts";

function createMockContext(overrides?: Partial<CommandContext>): CommandContext {
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

    test("includes playwright-cli in BUILTIN_SKILLS", () => {
        const skill = BUILTIN_SKILLS.find((entry) => entry.name === "playwright-cli");
        expect(skill).toBeDefined();
        expect(skill?.aliases).toEqual(["pw", "playwright"]);
    });

    test("registerBuiltinSkills registers playwright-cli and aliases", () => {
        registerBuiltinSkills();

        const byName = globalRegistry.get("playwright-cli");
        const byPwAlias = globalRegistry.get("pw");
        const byPlaywrightAlias = globalRegistry.get("playwright");

        expect(byName).toBeDefined();
        expect(byPwAlias?.name).toBe("playwright-cli");
        expect(byPlaywrightAlias?.name).toBe("playwright-cli");
    });

    test("playwright-cli builtin command expands arguments before dispatch", async () => {
        registerBuiltinSkills();

        const sentMessages: string[] = [];
        const context = createMockContext({
            sendSilentMessage: (content: string) => {
                sentMessages.push(content);
            },
        });

        const command = globalRegistry.get("playwright-cli");
        expect(command).toBeDefined();

        const result = await Promise.resolve(
            command!.execute("capture login flow", context),
        );

        expect(result.success).toBe(true);
        expect(result.skillLoaded).toBe("playwright-cli");
        expect(sentMessages).toHaveLength(1);
        expect(sentMessages[0]).toContain('<skill-loaded name="playwright-cli">');
        expect(sentMessages[0]).toContain("User request: capture login flow");
    });
});
