/**
 * TaskListPartDisplay Component
 *
 * Renders a TaskListPart using the shared TaskListBox bordered container
 * with progress header, progress bar, and task rows.
 */

import React, { useMemo } from "react";
import type { TaskListPart } from "@/state/parts/types.ts";
import { TaskListBox } from "@/components/task-list-panel.tsx";
import { sortTasksTopologically } from "@/components/task-order.ts";
import { SPACING } from "@/theme/spacing.ts";

export interface TaskListPartDisplayProps {
  part: TaskListPart;
  isLast: boolean;
}

export function TaskListPartDisplay({ part }: TaskListPartDisplayProps): React.ReactNode {
  const sortedItems = useMemo(() => sortTasksTopologically(part.items), [part.items]);

  return (
    <box flexDirection="column" paddingLeft={SPACING.INDENT} paddingRight={SPACING.INDENT} marginTop={SPACING.SECTION}>
      <TaskListBox
        items={sortedItems}
        expanded={part.expanded}
        headerTitle="Todo Progress"
      />
    </box>
  );
}

export default TaskListPartDisplay;
