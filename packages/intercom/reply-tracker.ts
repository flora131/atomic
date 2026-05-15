import type { Message, SessionInfo } from "./types.ts";

export interface IntercomContext {
  from: SessionInfo;
  message: Message;
  receivedAt: number;
}

function matchesPendingSender(context: IntercomContext, to: string): boolean {
  if (context.from.id === to) {
    return true;
  }

  return context.from.name?.toLowerCase() === to.toLowerCase();
}

export class ReplyTracker {
  private readonly pendingAsks = new Map<string, IntercomContext>();
  private readonly pendingTurnContexts: IntercomContext[] = [];
  private currentTurnContext: IntercomContext | null = null;

  constructor(private readonly askTimeoutMs = 10 * 60 * 1000) {}

  recordIncomingMessage(from: SessionInfo, message: Message, receivedAt = Date.now()): IntercomContext {
    const context = { from, message, receivedAt };
    if (message.expectsReply) {
      this.pendingAsks.set(message.id, context);
    }
    return context;
  }

  queueTurnContext(context: IntercomContext): void {
    this.pendingTurnContexts.push(context);
  }

  beginTurn(now = Date.now()): void {
    this.pruneExpired(now);
    this.currentTurnContext = this.pendingTurnContexts.shift() ?? null;
  }

  endTurn(): void {
    this.currentTurnContext = null;
  }

  reset(): void {
    this.pendingAsks.clear();
    this.pendingTurnContexts.length = 0;
    this.currentTurnContext = null;
  }

  resolveReplyTarget(options: { to?: string }, now = Date.now()): IntercomContext {
    this.pruneExpired(now);

    if (this.currentTurnContext) {
      return this.currentTurnContext;
    }

    const pending = Array.from(this.pendingAsks.values());
    if (pending.length === 1) {
      return pending[0]!;
    }

    if (options.to) {
      const matches = pending.filter((context) => matchesPendingSender(context, options.to!));
      if (matches.length === 1) {
        return matches[0]!;
      }
      if (matches.length > 1) {
        throw new Error(`Multiple pending asks from \"${options.to}\" — use the sender session ID instead.`);
      }
      if (pending.length > 1) {
        throw new Error(`No pending ask from \"${options.to}\"`);
      }
    }

    if (pending.length === 0) {
      throw new Error("No active intercom context to reply to");
    }

    throw new Error("Multiple pending asks — specify `to`");
  }

  markReplied(replyTo: string): void {
    this.pendingAsks.delete(replyTo);
    if (this.currentTurnContext?.message.id === replyTo) {
      this.currentTurnContext = null;
    }
  }

  listPending(now = Date.now()): IntercomContext[] {
    this.pruneExpired(now);
    return Array.from(this.pendingAsks.values()).sort((a, b) => a.receivedAt - b.receivedAt);
  }

  private pruneExpired(now: number): void {
    for (const [messageId, context] of this.pendingAsks) {
      if (now - context.receivedAt > this.askTimeoutMs) {
        this.pendingAsks.delete(messageId);
      }
    }
  }
}
