import React from "react";
import type { TaskResultPart } from "@/state/parts/types.ts";
import { useThemeColors } from "@/theme/index.tsx";
import { SPACING } from "@/theme/spacing.ts";
import { STATUS } from "@/theme/icons.ts";

export interface TaskResultPartDisplayProps {
  part: TaskResultPart;
  isLast: boolean;
}

export function TaskResultPartDisplay({ part }: TaskResultPartDisplayProps): React.ReactNode {
  const colors = useThemeColors();
  const isError = part.status === "error";
  const statusColor = isError ? colors.error : colors.success;
  const statusLabel = isError ? "error" : "completed";
  const statusIcon = isError ? STATUS.error : STATUS.success;
  const output = part.outputText.trim();

  return (
    <box flexDirection="column">
      <text fg={statusColor}>
        {`${statusIcon} Task result ${part.taskId} (${statusLabel})`}
      </text>
      <box marginLeft={SPACING.INDENT}>
        <text fg={colors.foreground}>{part.title}</text>
      </box>
      {output.length > 0 && (
        <box marginLeft={SPACING.INDENT}>
          <text fg={colors.muted}>{output}</text>
        </box>
      )}
      {isError && part.error && (
        <box marginLeft={SPACING.INDENT}>
          <text fg={colors.error}>{part.error}</text>
        </box>
      )}
    </box>
  );
}

export default TaskResultPartDisplay;
