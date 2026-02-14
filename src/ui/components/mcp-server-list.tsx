/**
 * McpServerListIndicator Component
 *
 * Renders Codex-style /mcp output in the assistant transcript.
 */

import React from "react";
import { useTheme } from "../theme.tsx";
import type { McpSnapshotView } from "../utils/mcp-output.ts";

// ============================================================================
// TYPES
// ============================================================================

export interface McpServerListIndicatorProps {
  snapshot: McpSnapshotView;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function McpServerListIndicator({
  snapshot,
}: McpServerListIndicatorProps): React.ReactNode {
  const { theme } = useTheme();
  const colors = theme.colors;

  const formatResources = (items: Array<{ label: string; uri: string }>): string =>
    items.map((item) => `${item.label} (${item.uri})`).join(", ");

  const formatTemplates = (items: Array<{ label: string; uriTemplate: string }>): string =>
    items.map((item) => `${item.label} (${item.uriTemplate})`).join(", ");

  return (
    <box flexDirection="column">
      <text style={{ fg: colors.foreground, attributes: 1 }}>{snapshot.heading}</text>
      <text>{""}</text>

      {!snapshot.hasConfiguredServers && (
        <box flexDirection="column">
          <text style={{ fg: colors.muted }}>{`  • No MCP servers configured.`}</text>
          <text style={{ fg: colors.muted }}>{`    ${snapshot.docsHint}`}</text>
        </box>
      )}

      {snapshot.hasConfiguredServers && snapshot.noToolsAvailable && (
        <box flexDirection="column">
          <text style={{ fg: colors.muted }}>{`  • No MCP tools available.`}</text>
          <text>{""}</text>
        </box>
      )}

      {snapshot.servers.map((server) => {
        if (!server.enabled) {
          return (
            <box key={server.name} flexDirection="column" marginBottom={1}>
              <box flexDirection="row">
                <text style={{ fg: colors.foreground }}>{`  • ${server.name} `}</text>
                <text style={{ fg: colors.error }}>(disabled)</text>
              </box>
              {server.disabledReason && (
                <text style={{ fg: colors.muted }}>{`    • Reason: ${server.disabledReason}`}</text>
              )}
            </box>
          );
        }

        return (
          <box key={server.name} flexDirection="column" marginBottom={1}>
            <text style={{ fg: colors.foreground }}>{`  • ${server.name}`}</text>
            <box flexDirection="row">
              <text style={{ fg: colors.foreground }}>{`    • Status: `}</text>
              <text style={{ fg: colors.success }}>enabled</text>
            </box>
            <text style={{ fg: colors.foreground }}>{`    • Auth: ${server.authStatus}`}</text>

            {server.transport.kind === "stdio" && (
              <box flexDirection="column">
                <text style={{ fg: colors.foreground }}>{`    • Command: ${server.transport.commandLine ?? "(none)"}`}</text>
                {server.transport.cwd && (
                  <text style={{ fg: colors.foreground }}>{`    • Cwd: ${server.transport.cwd}`}</text>
                )}
                {server.transport.env && server.transport.env !== "-" && (
                  <text style={{ fg: colors.foreground }}>{`    • Env: ${server.transport.env}`}</text>
                )}
              </box>
            )}

            {(server.transport.kind === "http" || server.transport.kind === "sse") && (
              <box flexDirection="column">
                <text style={{ fg: colors.foreground }}>{`    • URL: ${server.transport.url ?? "(none)"}`}</text>
                {server.transport.httpHeaders && server.transport.httpHeaders !== "-" && (
                  <text style={{ fg: colors.foreground }}>{`    • HTTP headers: ${server.transport.httpHeaders}`}</text>
                )}
                {server.transport.envHttpHeaders && server.transport.envHttpHeaders !== "-" && (
                  <text style={{ fg: colors.foreground }}>{`    • Env HTTP headers: ${server.transport.envHttpHeaders}`}</text>
                )}
              </box>
            )}

            <text style={{ fg: colors.foreground }}>
              {`    • Tools: ${server.tools.length === 1 && server.tools[0] === "*" ? "(all)" : server.tools.length > 0 ? server.tools.join(", ") : "(none)"}`}
            </text>
            <text style={{ fg: colors.foreground }}>
              {`    • Resources: ${server.resources.length > 0 ? formatResources(server.resources) : "(none)"}`}
            </text>
            <text style={{ fg: colors.foreground }}>
              {`    • Resource templates: ${server.resourceTemplates.length > 0 ? formatTemplates(server.resourceTemplates) : "(none)"}`}
            </text>
          </box>
        );
      })}
    </box>
  );
}
