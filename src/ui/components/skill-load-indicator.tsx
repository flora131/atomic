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
import { STATUS, MISC } from "../constants/icons.ts";

// ============================================================================
// TYPES
// ============================================================================

export type SkillLoadStatus = "loading" | "loaded" | "error";

export interface SkillLoadIndicatorProps {
  skillName: string;
  status: SkillLoadStatus;
  errorMessage?: string;
}

export type SkillStatusColorKey = "accent" | "success" | "error";

export function getSkillStatusColorKey(status: SkillLoadStatus): SkillStatusColorKey {
  if (status === "loading") return "accent";
  if (status === "loaded") return "success";
  return "error";
}

export function getSkillStatusIcon(status: SkillLoadStatus): string {
  return status === "error" ? STATUS.error : STATUS.active;
}

export function getSkillStatusMessage(
  status: SkillLoadStatus,
  errorMessage?: string,
): string {
  if (status === "loading") return "Loading skill...";
  if (status === "loaded") return "Successfully loaded skill";
  return `Failed to load skill: ${errorMessage ?? "unknown error"}`;
}

export function shouldShowSkillLoad(
  skillName: string | undefined,
  errorMessage: string | undefined,
  loadedSkills: Set<string>,
): boolean {
  if (!skillName) return false;
  if (errorMessage) return true;
  return !loadedSkills.has(skillName);
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

  const statusColor = colors[getSkillStatusColorKey(status)];
  const icon = getSkillStatusIcon(status);
  const message = getSkillStatusMessage(status, errorMessage);

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
      {visible ? STATUS.active : MISC.separator}
    </text>
  );
}
