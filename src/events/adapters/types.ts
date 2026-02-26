import type { Session } from "../../sdk/types.ts";

/**
 * Interface for SDK stream adapters that consume native SDK streaming APIs
 * and publish normalized BusEvents to the event bus.
 *
 * Each SDK has a different streaming pattern:
 * - OpenCode: AsyncGenerator from sdk.event.subscribe()
 * - Claude: AsyncIterable from session.stream()
 * - Copilot: EventEmitter via session.on() handlers
 *
 * Adapters are the SOLE consumers of SDK events — no other code subscribes
 * to SDK events directly. All events flow through the adapter to the bus.
 */
export interface SDKStreamAdapter {
  /**
   * Consume the SDK stream and publish all events to the bus.
   * This is the only path for SDK events into the event bus.
   *
   * @param session - Active SDK session to stream from
   * @param message - User message that initiated the stream
   * @param options - Additional options for the stream
   */
  startStreaming(
    session: Session,
    message: string,
    options: StreamAdapterOptions,
  ): Promise<void>;

  /**
   * Clean up any adapter-internal state (unregister SDK event handlers, etc.)
   */
  dispose(): void;
}

/**
 * Options passed to adapter.startStreaming()
 */
export interface StreamAdapterOptions {
  /** Run ID for staleness detection (monotonically increasing per stream) */
  runId: number;
  /** Message ID to associate with text events */
  messageId: string;
  /** Optional agent name for sub-agent dispatch (used by OpenCode) */
  agent?: string;
}
