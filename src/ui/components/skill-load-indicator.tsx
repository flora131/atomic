/**
 * SkillLoadIndicator Component
 *
 * Renders an inline status indicator when a skill command is invoked,
 * showing loading → loaded/error states. Matches the layout:
 *
 * ● Skill(skill-name)
 *   └ Successfully loaded skill
 */

import React, { useState, useEffect } from "react";
import { useTheme } from "../theme.tsx";

// ============================================================================
// TYPES
// ============================================================================

export type SkillLoadStatus = "loading" | "loaded" | "error";

export interface SkillLoadIndicatorProps {
  skillName: string;
  status: SkillLoadStatus;
  errorMessage?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function SkillLoadIndicator({
  skillName,
  status,
  errorMessage,
}: SkillLoadIndicatorProps): React.ReactNode {
  const { theme } = useTheme();
  const colors = theme.colors;

  const statusColor =
    status === "loading"
      ? colors.accent
      : status === "loaded"
        ? colors.success
        : colors.error;

  const icon = status === "error" ? "✕" : "●";
  const message =
    status === "loading"
      ? "Loading skill..."
      : status === "loaded"
        ? "Successfully loaded skill"
        : `Failed to load skill: ${errorMessage ?? "unknown error"}`;

  return (
    <box flexDirection="column">
      <box flexDirection="row">
        <box flexShrink={0}>
          {status === "loading" ? (
            <AnimatedDot color={statusColor} />
          ) : (
            <text style={{ fg: statusColor }}>{icon}</text>
          )}
        </box>
        <box flexShrink={0}>
          <text> </text>
        </box>
        <box flexShrink={0}>
          <text style={{ fg: colors.foreground }}>
            Skill({skillName})
          </text>
        </box>
      </box>
      <box flexDirection="row">
        <box flexShrink={0}>
          <text style={{ fg: colors.muted }}>  └ </text>
        </box>
        <text style={{ fg: colors.muted }}>{message}</text>
      </box>
    </box>
  );
}

function AnimatedDot({ color }: { color: string }): React.ReactNode {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible((prev) => !prev);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <text style={{ fg: color }}>
      {visible ? "●" : "·"}
    </text>
  );
}
