/**
 * ContextInfoPartDisplay Component
 *
 * Renders context window info using the existing ContextInfoDisplay.
 */

import React from "react";
import type { ContextInfoPart } from "../../parts/types.ts";
import { ContextInfoDisplay } from "../context-info-display.tsx";

export interface ContextInfoPartDisplayProps {
  part: ContextInfoPart;
  isLast: boolean;
}

export function ContextInfoPartDisplay({ part }: ContextInfoPartDisplayProps): React.ReactNode {
  return (
    <box flexDirection="column">
      <ContextInfoDisplay contextInfo={part.info} />
    </box>
  );
}

export default ContextInfoPartDisplay;
