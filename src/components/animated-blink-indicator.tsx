/**
 * AnimatedBlinkIndicator Component
 *
 * Shared animated blinking indicator that alternates between ● and ·.
 * Used by ParallelAgentsTree, ToolResult, and TaskListIndicator
 * for in-progress/running status display.
 *
 * Uses the shared animation tick provider to avoid creating independent
 * setInterval timers per instance.
 */

import React from "react";
import { STATUS, MISC } from "@/theme/icons.ts";
import { useBlinkAnimation } from "@/hooks/use-animation-tick.tsx";

/**
 * Animated blinking indicator for active/running states.
 * Alternates between ● and · at the given speed.
 */
export function AnimatedBlinkIndicator({
  color,
  speed = 500,
}: {
  color: string;
  speed?: number;
}): React.ReactNode {
  const visible = useBlinkAnimation(speed);

  return <span fg={color}>{visible ? STATUS.active : MISC.separator}</span>;
}
