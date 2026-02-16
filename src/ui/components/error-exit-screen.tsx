/**
 * Error Exit Screen Component
 *
 * A styled error boundary that catches React errors and displays
 * a graceful error dialog with exit instructions.
 * Follows Catppuccin theming for consistent visual style.
 */

import React, { useState, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { getCatppuccinPalette, type CatppuccinPalette } from "../theme.tsx";
import { SPACING } from "../constants/spacing.ts";

// ============================================================================
// ERROR SCREEN (FUNCTIONAL - supports hooks for keyboard handling)
// ============================================================================

interface ErrorScreenProps {
  error: Error;
  onExit: () => void;
  isDark?: boolean;
}

/**
 * Styled error screen with keyboard exit support.
 * Renders a bordered error dialog with the error message and stack trace,
 * plus clear instructions to press any key to exit.
 */
function ErrorScreen({ error, onExit, isDark = true }: ErrorScreenProps): React.ReactNode {
  const palette: CatppuccinPalette = getCatppuccinPalette(isDark);

  useKeyboard(() => {
    onExit();
  });

  // Truncate stack to first few meaningful lines
  const stack = error.stack ?? error.message;
  const stackLines = stack.split("\n").slice(0, 12);

  return (
    <box
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
      flexGrow={1}
    >
      <box
        flexDirection="column"
        border
        borderStyle="rounded"
        borderColor={palette.red}
        paddingLeft={SPACING.INDENT}
        paddingRight={SPACING.INDENT}
        paddingTop={SPACING.CONTAINER_PAD}
        paddingBottom={SPACING.CONTAINER_PAD}
        minWidth={60}
        maxWidth={100}
      >
        {/* Header */}
        <text style={{ fg: palette.red, attributes: 1 }}>
          {"  Error"}
        </text>
        <text>{" "}</text>

        {/* Error message */}
        <text style={{ fg: palette.text }}>
          {error.message}
        </text>
        <text>{" "}</text>

        {/* Stack trace (dimmed) */}
        {stackLines.slice(1).map((line, i) => (
          <text key={i} style={{ fg: palette.overlay0 }}>
            {line.trim()}
          </text>
        ))}
        <text>{" "}</text>

        {/* Exit instruction */}
        <box flexDirection="row">
          <text style={{ fg: palette.subtext0 }}>
            Press any key to exit
          </text>
        </box>
      </box>
    </box>
  );
}

// ============================================================================
// ERROR BOUNDARY (CLASS COMPONENT)
// ============================================================================

interface ErrorBoundaryProps {
  children: React.ReactNode;
  onExit: () => void;
  isDark?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Custom error boundary that displays a styled error screen
 * instead of OpenTUI's default raw error dump.
 *
 * Wraps the application and catches any React rendering errors,
 * showing a user-friendly dialog with keyboard exit support.
 */
export class AppErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override render(): React.ReactNode {
    if (this.state.hasError && this.state.error) {
      return (
        <ErrorScreen
          error={this.state.error}
          onExit={this.props.onExit}
          isDark={this.props.isDark}
        />
      );
    }
    return this.props.children;
  }
}

export default AppErrorBoundary;
