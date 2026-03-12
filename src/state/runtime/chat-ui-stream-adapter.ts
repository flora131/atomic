import type { AgentType } from "@/services/models/index.ts";
import type { CodingAgentClient } from "@/services/agents/types.ts";
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
