import { describe, expect, test } from "bun:test";
import type { AgentMessage, Session, SessionConfig } from "../../sdk/types.ts";
import { ProviderRegistry, type AgentProvider } from "./provider-registry.ts";

function createMockSession(id: string): Session {
  return {
    id,
    async send(message: string): Promise<AgentMessage> {
      return { type: "text", content: message, role: "assistant" };
    },
    async *stream(message: string): AsyncIterable<AgentMessage> {
      yield { type: "text", content: message, role: "assistant" };
    },
    async summarize(): Promise<void> {},
    async getContextUsage() {
      return {
        inputTokens: 1,
        outputTokens: 1,
        maxTokens: 1000,
        usagePercentage: 0.2,
      };
    },
    getSystemToolsTokens(): number {
      return 0;
    },
    async destroy(): Promise<void> {},
  };
}

function createProvider(name: string): AgentProvider {
  return {
    name,
    async createSession(_config: SessionConfig): Promise<Session> {
      return createMockSession(`${name}-session`);
    },
    supportedModels(): string[] {
      return [`${name}-model`];
    },
  };
}

describe("ProviderRegistry", () => {
  test("returns undefined from get() for unknown providers", () => {
    const registry = new ProviderRegistry({
      claude: createProvider("claude"),
    });

    expect(registry.get("missing")).toBeUndefined();
  });

  test("stores and resolves providers by name", async () => {
    const registry = new ProviderRegistry({
      claude: createProvider("claude"),
      copilot: createProvider("copilot"),
    });

    expect(registry.has("claude")).toBe(true);
    expect(registry.has("copilot")).toBe(true);
    expect(registry.has("opencode")).toBe(false);

    const provider = registry.get("claude");
    expect(provider?.name).toBe("claude");

    const session = await provider?.createSession({ model: "claude-sonnet" });
    expect(session?.id).toBe("claude-session");
  });

  test("returns provider names from list()", () => {
    const registry = new ProviderRegistry({
      claude: createProvider("claude"),
      opencode: createProvider("opencode"),
    });

    expect(registry.list()).toEqual(["claude", "opencode"]);
  });

  test("does not change when source record mutates after construction", () => {
    const providers: Record<string, AgentProvider> = {
      claude: createProvider("claude"),
    };
    const registry = new ProviderRegistry(providers);

    providers.opencode = createProvider("opencode");

    expect(registry.has("opencode")).toBe(false);
    expect(registry.list()).toEqual(["claude"]);
  });

  test("list() returns a copy, not internal mutable state", () => {
    const registry = new ProviderRegistry({
      claude: createProvider("claude"),
    });

    const providers = registry.list();
    providers.push("opencode");

    expect(registry.list()).toEqual(["claude"]);
  });
});
