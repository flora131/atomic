/**
 * AnimatedBlinkIndicator Component
 *
 * Shared animated blinking indicator that alternates between ● and ·.
 * Used by ParallelAgentsTree, ToolResult, and TaskListIndicator
 * for in-progress/running status display.
 */

import React, { useState, useEffect } from "react";
import { STATUS, MISC } from "../constants/icons.ts";

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
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible((prev) => !prev);
    }, speed);
    return () => clearInterval(interval);
  }, [speed]);

  return <span style={{ fg: color }}>{visible ? STATUS.active : MISC.separator}</span>;
}
