/**
 * McpServerListIndicator Component
 *
 * Renders a colored list of discovered MCP servers with status indicators.
 * Uses theme colors for green (enabled) and red (disabled) indicators.
 *
 * Layout:
 *   ● MCP Servers
 *     ● deepwiki (stdio) — npx
 *     ○ disabled-server (http) — https://example.com
 *   Use /mcp enable <name> or /mcp disable <name> to toggle.
 */

import React from "react";
import { useTheme } from "../theme.tsx";
import type { McpServerConfig } from "../../sdk/types.ts";

// ============================================================================
// TYPES
// ============================================================================

export interface McpServerListIndicatorProps {
  servers: McpServerConfig[];
}

// ============================================================================
// COMPONENT
// ============================================================================

export function McpServerListIndicator({
  servers,
}: McpServerListIndicatorProps): React.ReactNode {
  const { theme } = useTheme();
  const colors = theme.colors;

  if (servers.length === 0) {
    return (
      <box flexDirection="column">
        <text style={{ fg: colors.muted }}>
          No MCP servers found.
        </text>
        <text style={{ fg: colors.muted }}>
          {"\n"}Add servers via .mcp.json, .copilot/mcp-config.json, .github/mcp-config.json, or .opencode/opencode.json.
        </text>
      </box>
    );
  }

  return (
    <box flexDirection="column">
      <text style={{ fg: colors.foreground, attributes: 1 }}>MCP Servers</text>
      <text>{""}</text>
      {servers.map((server) => {
        const isEnabled = server.enabled !== false;
        const statusColor = isEnabled ? colors.success : colors.error;
        const statusIcon = isEnabled ? "●" : "○";
        const statusLabel = isEnabled ? "enabled" : "disabled";
        const transport = server.type ?? (server.url ? "http" : "stdio");
        const target = server.url ?? server.command ?? "—";

        return (
          <box key={server.name} flexDirection="column" marginBottom={0}>
            <box flexDirection="row">
              <text style={{ fg: statusColor }}>{`  ${statusIcon} `}</text>
              <text style={{ fg: colors.foreground, attributes: 1 }}>{server.name}</text>
              <text style={{ fg: colors.muted }}>{` (${transport}) `}</text>
              <text style={{ fg: statusColor }}>{statusLabel}</text>
            </box>
            <text style={{ fg: colors.muted }}>{`    ${target}`}</text>
          </box>
        );
      })}
      <text>{""}</text>
      <text style={{ fg: colors.muted }}>
        Use /mcp enable {"<name>"} or /mcp disable {"<name>"} to toggle.
      </text>
    </box>
  );
}
