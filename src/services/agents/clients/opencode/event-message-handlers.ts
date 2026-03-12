import type {
  Event as OpenCodeEvent,
  EventMessagePartDelta,
  EventMessageUpdated,
} from "@opencode-ai/sdk/v2/client";
import type { ProviderStreamEventDataMap } from "@/services/agents/provider-events.ts";
import type { OpenCodeEventMapperContext } from "@/services/agents/clients/opencode/event-mapper-types.ts";

export function handleOpenCodeMessageUpdated(
  event: EventMessageUpdated,
  context: OpenCodeEventMapperContext,
): void {
  const info = event.properties.info;
  const infoRole = info.role;
  const infoMessageId = info.id ?? "";
  const infoSessionId = info.sessionID ?? "";

  if (
    (infoRole === "user" || infoRole === "assistant")
    && infoMessageId.length > 0
    && infoSessionId.length > 0
  ) {
    context.sessionStateSupport.setMessageRole(infoSessionId, infoMessageId, infoRole);
  }

  if (info.role !== "assistant" || infoSessionId.length === 0) {
    return;
  }

  const messageData = {
    message: {
      type: "text",
      content: "",
      role: "assistant",
    },
  } satisfies ProviderStreamEventDataMap["message.complete"];
  context.emitEvent("message.complete", infoSessionId, messageData);
  context.emitProviderEvent("message.complete", infoSessionId, {
    ...messageData,
    nativeMessageId: info.id,
  }, {
    nativeSessionId: infoSessionId,
  });

  const msgTokens = info.tokens;
  if (!msgTokens || (!msgTokens.input && !msgTokens.output)) {
    return;
  }

  context.emitEvent("usage", infoSessionId, {
    inputTokens: msgTokens.input ?? 0,
    outputTokens: msgTokens.output ?? 0,
  });
  context.emitProviderEvent("usage", infoSessionId, {
    inputTokens: msgTokens.input ?? 0,
    outputTokens: msgTokens.output ?? 0,
    reasoningTokens: msgTokens.reasoning ?? 0,
    cacheReadTokens: msgTokens.cache?.read ?? 0,
    cacheWriteTokens: msgTokens.cache?.write ?? 0,
    costUsd: typeof info.cost === "number" ? info.cost : undefined,
  }, {
    nativeSessionId: infoSessionId,
  });
}

export function handleOpenCodeMessagePartDelta(
  event: EventMessagePartDelta,
  properties: Record<string, unknown> | undefined,
  context: OpenCodeEventMapperContext,
): void {
  const partDelta = event.properties.delta;
  const compatibilityProperties = properties as {
    partId?: string;
    part?: { id?: string; type?: string; messageID?: string };
  };
  const partId = event.properties.partID
    ?? compatibilityProperties.partId
    ?? compatibilityProperties.part?.id;
  const field = event.properties.field;
  const deltaSessionId = event.properties.sessionID;
  if (field && field !== "text") {
    return;
  }
  if (!partDelta || partDelta.length === 0) {
    return;
  }

  const inlinePartType = compatibilityProperties.part?.type?.toLowerCase();
  const isReasoningDelta = inlinePartType === "reasoning"
    || inlinePartType === "thinking"
    || (partId ? context.reasoningPartIds.has(partId) : false);
  if (isReasoningDelta) {
    context.emitEvent("message.delta", deltaSessionId, {
      delta: partDelta,
      contentType: "thinking",
      thinkingSourceKey: partId ?? "reasoning",
    });
    context.emitProviderEvent("reasoning.delta", deltaSessionId, {
      delta: partDelta,
      reasoningId: partId ?? "reasoning",
    }, {
      nativeSessionId: deltaSessionId,
    });
    return;
  }

  context.emitEvent("message.delta", deltaSessionId, {
    delta: partDelta,
    contentType: "text",
  });
  context.emitProviderEvent("message.delta", deltaSessionId, {
    delta: partDelta,
    contentType: "text",
    nativePartId: partId,
    nativeMessageId: event.properties.messageID ?? compatibilityProperties.part?.messageID,
  }, {
    nativeSessionId: deltaSessionId,
  });
}

export function isOpenCodeIgnoredSdkEvent(event: OpenCodeEvent): boolean {
  switch (event.type) {
    case "installation.updated":
    case "installation.update-available":
    case "project.updated":
    case "server.instance.disposed":
    case "server.connected":
    case "global.disposed":
    case "lsp.client.diagnostics":
    case "lsp.updated":
    case "file.edited":
    case "file.watcher.updated":
    case "todo.updated":
    case "tui.prompt.append":
    case "tui.command.execute":
    case "tui.toast.show":
    case "tui.session.select":
    case "mcp.tools.changed":
    case "mcp.browser.open.failed":
    case "command.executed":
    case "session.diff":
    case "vcs.branch.updated":
    case "workspace.ready":
    case "workspace.failed":
    case "pty.created":
    case "pty.updated":
    case "pty.exited":
    case "pty.deleted":
    case "worktree.ready":
    case "worktree.failed":
      return true;
    default:
      return false;
  }
}
