import type {
  Session,
  CodingAgentClient,
} from "@/services/agents/types.ts";
import type { EventBus } from "@/services/events/event-bus.ts";
import type {
  SDKStreamAdapter,
  StreamAdapterOptions,
} from "@/services/events/adapters/types.ts";
import { createCopilotStreamAdapterState } from "@/services/events/adapters/providers/copilot/state.ts";
import {
  disposeCopilotStreamAdapter,
  startCopilotStreaming,
} from "@/services/events/adapters/providers/copilot/runtime.ts";
import type { CopilotStreamAdapterDeps } from "@/services/events/adapters/providers/copilot/types.ts";

/**
 * Copilot SDK Stream Adapter
 *
 * Consumer-side adapter that bridges Copilot SDK EventEmitter-based streaming
 * to the event bus. The top-level adapter is intentionally thin; the
 * provider-specific routing, buffering, and event normalization live in
 * focused helper modules under `providers/copilot/`.
 */
export class CopilotStreamAdapter implements SDKStreamAdapter {
  private deps: CopilotStreamAdapterDeps;
  private state = createCopilotStreamAdapterState();

  constructor(bus: EventBus, client: CodingAgentClient) {
    this.deps = { bus, client };
  }

  async startStreaming(
    session: Session,
    message: string,
    options: StreamAdapterOptions,
  ): Promise<void> {
    await startCopilotStreaming(this.deps, this.state, session, message, options);
  }

  dispose(): void {
    disposeCopilotStreamAdapter(this.deps, this.state);
  }
}
