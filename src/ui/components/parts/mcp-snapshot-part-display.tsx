/**
 * McpSnapshotPartDisplay Component
 *
 * Renders MCP server snapshot using the existing McpServerListIndicator.
 */

import React from "react";
import type { McpSnapshotPart } from "../../parts/types.ts";
import { McpServerListIndicator } from "../mcp-server-list.tsx";

export interface McpSnapshotPartDisplayProps {
  part: McpSnapshotPart;
  isLast: boolean;
}

export function McpSnapshotPartDisplay({ part }: McpSnapshotPartDisplayProps): React.ReactNode {
  return (
    <box flexDirection="column">
      <McpServerListIndicator snapshot={part.snapshot} />
    </box>
  );
}

export default McpSnapshotPartDisplay;
