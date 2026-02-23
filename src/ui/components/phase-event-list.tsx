import React from "react";
import type { PhaseEvent } from "../commands/workflow-commands.ts";
import { STATUS, TASK, TREE } from "../constants/icons.ts";
import { SPACING } from "../constants/spacing.ts";
import type { ThemeColors } from "../theme.tsx";
import { truncateText } from "../utils/format.ts";

export const DEFAULT_MAX_EVENTS = 50;
export const DEFAULT_MAX_CONTENT_LENGTH = 80;

export const PHASE_EVENT_ICONS: Record<PhaseEvent["type"], string> = {
  tool_call: TASK.active,
  tool_result: STATUS.success,
  text: "·",
  agent_spawn: STATUS.background,
  agent_complete: STATUS.success,
  error: STATUS.error,
  progress: TASK.active,
};

export interface PhaseEventListProps {
  events: PhaseEvent[];
  themeColors: Pick<ThemeColors, "border" | "dim" | "error" | "muted">;
  maxEvents?: number;
  maxContentLength?: number;
}

export function getEffectiveMaxEvents(maxEvents?: number): number {
  if (maxEvents === undefined) return DEFAULT_MAX_EVENTS;
  if (!Number.isFinite(maxEvents) || maxEvents < 0) return 0;
  return Math.floor(maxEvents);
}

export function getVisiblePhaseEvents(events: PhaseEvent[], maxEvents?: number): PhaseEvent[] {
  return events.slice(0, getEffectiveMaxEvents(maxEvents));
}

export function getHiddenEventCount(events: PhaseEvent[], maxEvents?: number): number {
  return Math.max(0, events.length - getVisiblePhaseEvents(events, maxEvents).length);
}

export function getEventConnector(index: number, visibleLength: number, hiddenCount: number): string {
  const isLastVisible = index === visibleLength - 1;
  return isLastVisible && hiddenCount === 0 ? TREE.lastBranch : TREE.branch;
}

export function PhaseEventList({
  events,
  themeColors,
  maxEvents = DEFAULT_MAX_EVENTS,
  maxContentLength = DEFAULT_MAX_CONTENT_LENGTH,
}: PhaseEventListProps): React.ReactNode {
  if (events.length === 0) {
    return null;
  }

  const visibleEvents = getVisiblePhaseEvents(events, maxEvents);
  const hiddenCount = getHiddenEventCount(events, maxEvents);

  return (
    <box
      flexDirection="column"
      marginLeft={SPACING.INDENT}
      borderStyle="rounded"
      borderColor={themeColors.border}
      paddingLeft={SPACING.CONTAINER_PAD}
      paddingRight={SPACING.CONTAINER_PAD}
    >
      {visibleEvents.map((event, index) => {
        const connector = getEventConnector(index, visibleEvents.length, hiddenCount);
        const icon = PHASE_EVENT_ICONS[event.type];
        const color = event.type === "error" ? themeColors.error : themeColors.muted;

        return (
          <box key={`${event.timestamp}-${index}`} flexDirection="row">
            <text style={{ fg: themeColors.dim }}>{connector} </text>
            <text style={{ fg: color }}>{icon} </text>
            <text style={{ fg: color }}>{truncateText(event.content, maxContentLength)}</text>
          </box>
        );
      })}
      {hiddenCount > 0 && (
        <box flexDirection="row">
          <text style={{ fg: themeColors.muted }}>{TREE.lastBranch} ...and {hiddenCount} more events</text>
        </box>
      )}
    </box>
  );
}

export default PhaseEventList;
