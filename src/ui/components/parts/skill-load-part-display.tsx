/**
 * SkillLoadPartDisplay Component
 *
 * Renders skill loading status using the existing SkillLoadIndicator.
 */

import React from "react";
import type { SkillLoadPart } from "../../parts/types.ts";
import { SkillLoadIndicator } from "../skill-load-indicator.tsx";

export interface SkillLoadPartDisplayProps {
  part: SkillLoadPart;
  isLast: boolean;
}

export function SkillLoadPartDisplay({ part }: SkillLoadPartDisplayProps): React.ReactNode {
  return (
    <box flexDirection="column">
      {part.skills.map((skill, idx) => (
        <SkillLoadIndicator
          key={`${skill.skillName}-${idx}`}
          skillName={skill.skillName}
          status={skill.status}
          errorMessage={skill.errorMessage}
        />
      ))}
    </box>
  );
}

export default SkillLoadPartDisplay;
