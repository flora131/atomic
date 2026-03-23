import type { AgentType } from "@/services/models/index.ts";
import type { CodingAgentClient } from "@/services/agents/types.ts";
import type { EventBus } from "@/services/events/event-bus.ts";
import { OpenCodeStreamAdapter } from "@/services/events/adapters/opencode-adapter.ts";
import { ClaudeStreamAdapter } from "@/services/events/adapters/claude-adapter.ts";
import { CopilotStreamAdapter } from "@/services/events/adapters/copilot-adapter.ts";
import type { SDKStreamAdapter } from "@/services/events/adapters/types.ts";
import type { ChatUIState } from "@/state/runtime/chat-ui-controller-types.ts";

interface CreateStreamAdapterArgs {
  client: CodingAgentClient;
  state: ChatUIState;
  resolvedAgentType?: AgentType;
}

export function createStreamAdapter(args: CreateStreamAdapterArgs): SDKStreamAdapter {
  if (args.resolvedAgentType === "opencode") {
    return new OpenCodeStreamAdapter(
      args.state.bus,
      args.state.session!.id,
      args.client,
    );
  }

  if (args.resolvedAgentType === "claude") {
    return new ClaudeStreamAdapter(
      args.state.bus,
      args.state.session!.id,
      args.client,
    );
  }

  return new CopilotStreamAdapter(args.state.bus, args.client);
}

/**
 * Create an SDK stream adapter for an explicit session.
 *
 * Unlike {@link createStreamAdapter} which reads the session ID from
 * `ChatUIState.session`, this variant accepts the `bus`, `sessionId`,
 * `client`, and `agentType` directly. Used by the workflow conductor
 * to stream stage sessions through the full event pipeline.
 */
export interface CreateSessionStreamAdapterArgs {
  bus: EventBus;
  sessionId: string;
  client: CodingAgentClient;
  agentType?: AgentType;
}

export function createStreamAdapterForSession(args: CreateSessionStreamAdapterArgs): SDKStreamAdapter {
  if (args.agentType === "opencode") {
    return new OpenCodeStreamAdapter(args.bus, args.sessionId, args.client);
  }

  if (args.agentType === "claude") {
    return new ClaudeStreamAdapter(args.bus, args.sessionId, args.client);
  }

  return new CopilotStreamAdapter(args.bus, args.client);
}
