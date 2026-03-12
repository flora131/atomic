import type {
  Event as OpenCodeEvent,
  EventSessionCompacted,
  EventSessionCreated,
  EventSessionError,
  EventSessionIdle,
  EventSessionStatus,
  EventSessionUpdated,
} from "@opencode-ai/sdk/v2/client";
import { setCompactionControlState } from "@/services/agents/clients/opencode/compaction.ts";
import {
  extractOpenCodeErrorMessage,
  parseOpenCodeSessionStatus,
} from "@/services/agents/clients/opencode/shared.ts";
import type { OpenCodeEventMapperContext } from "@/services/agents/clients/opencode/event-mapper-types.ts";

export function handleOpenCodeSessionEvent(
  event: OpenCodeEvent,
  properties: Record<string, unknown> | undefined,
  context: OpenCodeEventMapperContext,
): boolean {
  switch (event.type) {
    case "session.created": {
      const createdInfo = (event as EventSessionCreated).properties.info;
      const createdSessionId = createdInfo.id ?? "";
      context.sessionStateSupport.setSessionParentMapping(
        createdSessionId,
        createdInfo.parentID,
      );
      context.sessionStateSupport.registerActiveSession(createdSessionId);
      context.sessionTitlesById.set(createdSessionId, createdInfo.title);
      context.emitEvent("session.start", createdSessionId, {
        config: {},
        source: "start",
      });
      context.emitProviderEvent("session.start", createdSessionId, {
        config: {},
        sessionParentId: createdInfo.parentID,
        source: "start",
      }, {
        nativeSessionId: createdSessionId,
      });
      return true;
    }

    case "session.updated": {
      const updatedInfo = (event as EventSessionUpdated).properties.info;
      const updatedSessionId = updatedInfo.id ?? "";
      context.sessionStateSupport.setSessionParentMapping(
        updatedSessionId,
        updatedInfo.parentID,
      );
      context.sessionStateSupport.registerActiveSession(updatedSessionId);
      const previousTitle = context.sessionTitlesById.get(updatedSessionId);
      if (previousTitle !== updatedInfo.title) {
        context.sessionTitlesById.set(updatedSessionId, updatedInfo.title);
        context.emitEvent("session.title_changed", updatedSessionId, {
          title: updatedInfo.title,
        });
        context.emitProviderEvent("session.title_changed", updatedSessionId, {
          title: updatedInfo.title,
        }, {
          nativeSessionId: updatedSessionId,
        });
      }
      return true;
    }

    case "session.deleted": {
      const deletedInfo = properties?.info as { id?: string } | undefined;
      const deletedSessionId =
        (properties?.sessionID as string | undefined) ?? deletedInfo?.id ?? "";
      context.sessionStateSupport.unregisterActiveSession(deletedSessionId);
      return true;
    }

    case "session.status": {
      const statusEvent = event as EventSessionStatus;
      const status = statusEvent.properties.status;
      const parsedStatus = parseOpenCodeSessionStatus(status);
      const compatibilityInfo = properties?.info as { id?: string } | undefined;
      const statusSessionId =
        statusEvent.properties.sessionID ?? compatibilityInfo?.id ?? "";
      context.sessionStateSupport.registerActiveSession(statusSessionId);

      if (parsedStatus === "idle") {
        context.emitEvent("session.idle", statusSessionId, {
          reason: "idle",
        });
        context.emitProviderEvent("session.idle", statusSessionId, {
          reason: "idle",
        }, {
          nativeSessionId: statusSessionId,
        });
      } else if (parsedStatus === "retry") {
        const retryStatus =
          typeof status === "object" && status !== null
            ? status as { attempt?: number; message?: string; next?: number }
            : undefined;
        const retryData = {
          attempt: retryStatus?.attempt ?? 1,
          delay: retryStatus?.next ?? 0,
          message: retryStatus?.message ?? "Retrying request",
          nextRetryAt: Date.now() + (retryStatus?.next ?? 0),
        };
        context.emitEvent("session.retry", statusSessionId, retryData);
        context.emitProviderEvent("session.retry", statusSessionId, retryData, {
          nativeSessionId: statusSessionId,
        });
      }
      return true;
    }

    case "session.idle": {
      const idleEvent = event as EventSessionIdle;
      const compatibilityInfo = properties?.info as { id?: string } | undefined;
      const idleSessionId =
        idleEvent.properties.sessionID ?? compatibilityInfo?.id ?? "";
      context.sessionStateSupport.registerActiveSession(idleSessionId);
      context.emitEvent("session.idle", idleSessionId, {
        reason: "idle",
      });
      context.emitProviderEvent("session.idle", idleSessionId, {
        reason: "idle",
      }, {
        nativeSessionId: idleSessionId,
      });
      return true;
    }

    case "session.error": {
      const errorProperties = (event as EventSessionError).properties;
      const fallbackError = (event as { error?: unknown }).error;
      const compatibilityInfo = properties?.info as { id?: string } | undefined;
      const errorSessionId =
        errorProperties?.sessionID ?? compatibilityInfo?.id ?? "";
      context.sessionStateSupport.registerActiveSession(errorSessionId);
      const errorMessage = extractOpenCodeErrorMessage(
        errorProperties?.error ?? fallbackError,
      );
      context.emitEvent("session.error", errorSessionId, {
        error: errorMessage,
      });
      context.emitProviderEvent("session.error", errorSessionId, {
        error: errorMessage,
      }, {
        nativeSessionId: errorSessionId,
      });
      return true;
    }

    case "session.compacted": {
      const compactedSessionId =
        (event as EventSessionCompacted).properties.sessionID ?? "";
      const sessionState = context.sessionStateById.get(compactedSessionId);
      if (
        sessionState
        && (
          sessionState.compaction.control.state === "TERMINAL_ERROR"
          || sessionState.compaction.control.state === "ENDED"
        )
      ) {
        return true;
      }
      const now = Date.now();
      if (
        sessionState
        && !sessionState.compaction.pendingCompactionComplete
        && sessionState.compaction.lastCompactionCompleteAt !== null
        && now - sessionState.compaction.lastCompactionCompleteAt
          <= context.compactionCompleteDedupeWindowMs
      ) {
        return true;
      }
      if (sessionState) {
        sessionState.compaction.pendingCompactionComplete = false;
        sessionState.compaction.lastCompactionCompleteAt = now;
        setCompactionControlState(sessionState, "compaction.complete.success", {
          now,
        });
      }
      context.emitEvent("session.compaction", compactedSessionId, {
        phase: "complete",
        success: true,
      });
      context.emitProviderEvent("session.compaction", compactedSessionId, {
        phase: "complete",
        success: true,
      }, {
        nativeSessionId: compactedSessionId,
        timestamp: now,
      });
      return true;
    }

    default:
      return false;
  }
}
