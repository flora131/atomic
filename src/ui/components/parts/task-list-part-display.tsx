/**
 * TaskListPartDisplay Component
 *
 * Renders a TaskListPart using the shared TaskListBox bordered container
 * with progress header, progress bar, and task rows.
 */

import React from "react";
import type { TaskListPart } from "../../parts/types.ts";
import { TaskListBox } from "../task-list-panel.tsx";
import { SPACING } from "../../constants/spacing.ts";

export interface TaskListPartDisplayProps {
  part: TaskListPart;
  isLast: boolean;
}

export function TaskListPartDisplay({ part }: TaskListPartDisplayProps): React.ReactNode {
  return (
    <box flexDirection="column" paddingLeft={SPACING.INDENT} paddingRight={SPACING.INDENT} marginTop={SPACING.SECTION}>
      <TaskListBox
        items={part.items}
        expanded={part.expanded}
        headerTitle="Todo Progress"
      />
    </box>
  );
}

export default TaskListPartDisplay;
