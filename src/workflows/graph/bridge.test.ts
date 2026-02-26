/**
 * Unit tests for WorkflowBridge and createTUIBridge
 */

import { test, expect, describe, mock } from "bun:test";
import { createTUIBridge } from "./bridge.ts";
import type { SubagentSpawnOptions, SubagentResult } from "./subagent-bridge.ts";

describe("createTUIBridge", () => {
    test("returns a WorkflowBridge with spawn and spawnParallel methods", () => {
        const mockContext = {
            spawnSubagentParallel: mock(async () => []),
        };

        const bridge = createTUIBridge(mockContext as any);

        expect(bridge).toBeDefined();
        expect(typeof bridge.spawn).toBe("function");
        expect(typeof bridge.spawnParallel).toBe("function");
    });

    test("spawn delegates to context.spawnSubagentParallel with single agent", async () => {
        const mockResult: SubagentResult = {
            agentId: "test-agent-id",
            success: true,
            output: "test output",
            toolUses: 0,
            durationMs: 100,
        };

        const mockContext = {
            spawnSubagentParallel: mock(async (agents: SubagentSpawnOptions[]) => {
                return [mockResult];
            }),
        };

        const bridge = createTUIBridge(mockContext as any);

        const agent: SubagentSpawnOptions = {
            agentId: "test-agent-id",
            agentName: "test-agent",
            task: "test message",
            systemPrompt: "test prompt",
        };

        const result = await bridge.spawn(agent);

        expect(result).toEqual(mockResult);
        expect(mockContext.spawnSubagentParallel).toHaveBeenCalledTimes(1);
        
        // Verify it was called with array containing single agent
        const callArgs = mockContext.spawnSubagentParallel.mock.calls[0];
        expect(callArgs).toBeDefined();
        expect(callArgs![0]).toHaveLength(1);
        expect(callArgs![0][0]!.agentName).toBe("test-agent");
        expect(callArgs![0][0]!.task).toBe("test message");
    });

    test("spawn passes abortSignal through to spawnSubagentParallel", async () => {
        const mockResult: SubagentResult = {
            agentId: "test-agent-id",
            success: true,
            output: "test output",
            toolUses: 0,
            durationMs: 100,
        };

        const mockContext = {
            spawnSubagentParallel: mock(async (agents: SubagentSpawnOptions[], abortSignal?: AbortSignal) => [mockResult]),
        };

        const bridge = createTUIBridge(mockContext as any);
        const abortController = new AbortController();
        const agent: SubagentSpawnOptions = {
            agentId: "test-agent-id",
            agentName: "test-agent",
            task: "test message",
        };

        await bridge.spawn(agent, abortController.signal);

        expect(mockContext.spawnSubagentParallel).toHaveBeenCalledTimes(1);
        const callArgs = mockContext.spawnSubagentParallel.mock.calls[0];
        expect(callArgs).toBeDefined();
        // Verify abortSignal was passed as second argument
        expect(callArgs![1]).toBe(abortController.signal);
    });

    test("spawnParallel delegates directly to context.spawnSubagentParallel", async () => {
        const mockResults: SubagentResult[] = [
            { agentId: "agent-1", success: true, output: "output 1", toolUses: 0, durationMs: 100 },
            { agentId: "agent-2", success: true, output: "output 2", toolUses: 0, durationMs: 100 },
            { agentId: "agent-3", success: true, output: "output 3", toolUses: 0, durationMs: 100 },
        ];

        const mockContext = {
            spawnSubagentParallel: mock(async (agents: SubagentSpawnOptions[]) => {
                return mockResults;
            }),
        };

        const bridge = createTUIBridge(mockContext as any);

        const agents: SubagentSpawnOptions[] = [
            { agentId: "agent-1", agentName: "agent-1", task: "message 1" },
            { agentId: "agent-2", agentName: "agent-2", task: "message 2" },
            { agentId: "agent-3", agentName: "agent-3", task: "message 3" },
        ];

        const results = await bridge.spawnParallel(agents);

        expect(results).toEqual(mockResults);
        expect(mockContext.spawnSubagentParallel).toHaveBeenCalledTimes(1);
        
        // Verify it was called with the same array of agents
        const callArgs = mockContext.spawnSubagentParallel.mock.calls[0];
        expect(callArgs).toBeDefined();
        expect(callArgs![0]).toEqual(agents);
    });

    test("spawnParallel passes abortSignal through to spawnSubagentParallel", async () => {
        const mockResults: SubagentResult[] = [
            { agentId: "agent-1", success: true, output: "output 1", toolUses: 0, durationMs: 100 },
        ];

        const mockContext = {
            spawnSubagentParallel: mock(async (agents: SubagentSpawnOptions[], abortSignal?: AbortSignal) => mockResults),
        };

        const bridge = createTUIBridge(mockContext as any);
        const abortController = new AbortController();
        const agents: SubagentSpawnOptions[] = [
            { agentId: "agent-1", agentName: "agent-1", task: "message 1" },
        ];

        await bridge.spawnParallel(agents, abortController.signal);

        expect(mockContext.spawnSubagentParallel).toHaveBeenCalledTimes(1);
        const callArgs = mockContext.spawnSubagentParallel.mock.calls[0];
        expect(callArgs).toBeDefined();
        // Verify abortSignal was passed as second argument
        expect(callArgs![1]).toBe(abortController.signal);
    });
});
