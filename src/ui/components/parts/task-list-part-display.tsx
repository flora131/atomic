/**
 * TaskListPartDisplay Component
 *
 * Renders a TaskListPart using the existing TaskListIndicator component.
 */

import React from "react";
import type { TaskListPart } from "../../parts/types.ts";
import { TaskListIndicator } from "../task-list-indicator.tsx";
import { SPACING } from "../../constants/spacing.ts";

export interface TaskListPartDisplayProps {
  part: TaskListPart;
  isLast: boolean;
}

export function TaskListPartDisplay({ part }: TaskListPartDisplayProps): React.ReactNode {
  return (
    <box flexDirection="column" marginTop={SPACING.SECTION}>
      <TaskListIndicator
        items={part.items}
        expanded={part.expanded}
      />
    </box>
  );
}

export default TaskListPartDisplay;
