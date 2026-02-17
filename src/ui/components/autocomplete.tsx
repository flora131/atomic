/**
 * Autocomplete Component for Slash Commands
 *
 * Displays a dropdown list of command suggestions based on user input.
 * Supports keyboard navigation for selection.
 *
 * Reference: Feature 6 - Create Autocomplete component with two-column layout
 */

import React, { useMemo, useCallback, useRef, useEffect } from "react";
import { useTerminalDimensions } from "@opentui/react";
import { useTheme } from "../theme.tsx";
import { globalRegistry, type CommandDefinition } from "../commands/index.ts";
import type { KeyEvent, ScrollBoxRenderable } from "@opentui/core";
import { navigateUp, navigateDown } from "../utils/navigation.ts";
import { SPACING } from "../constants/spacing.ts";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Props for the Autocomplete component.
 */
export interface AutocompleteProps {
  /** The current input text (without the leading "/" or "@") */
  input: string;
  /** Whether the autocomplete dropdown is visible */
  visible: boolean;
  /** Index of the currently selected suggestion (0-based) */
  selectedIndex: number;
  /** Callback when a suggestion is selected (Tab/Enter) */
  onSelect: (command: CommandDefinition, action: "complete" | "execute") => void;
  /** Callback to update the selected index */
  onIndexChange: (index: number) => void;
  /** Maximum number of suggestions to display (default: 8) */
  maxSuggestions?: number;
  /** Prefix character for display (default: "/") */
  namePrefix?: string;
  /** External suggestions to use instead of searching globalRegistry */
  externalSuggestions?: CommandDefinition[];
}

/**
 * A single suggestion row in the autocomplete dropdown.
 */
interface SuggestionRowProps {
  /** The command definition */
  command: CommandDefinition;
  /** Whether this row is selected */
  isSelected: boolean;
  /** Accent color for selected state */
  accentColor: string;
  /** Foreground color for normal state */
  foregroundColor: string;
  /** Muted color for description */
  mutedColor: string;
  /** Terminal width for dynamic truncation */
  terminalWidth: number;
  /** Prefix character for display ("/" or "@") */
  namePrefix: string;
}

// ============================================================================
// SUGGESTION ROW COMPONENT
// ============================================================================

/**
 * Renders a single suggestion row with command name and description.
 * Styled to match Claude Code's elegant autocomplete appearance.
 * Uses text color (not background) for selection indication.
 */
function SuggestionRow({
  command,
  isSelected,
  accentColor,
  foregroundColor,
  mutedColor,
  terminalWidth,
  namePrefix,
}: SuggestionRowProps): React.ReactNode {
  // Selection uses accent color for text, not background
  const fgColor = isSelected ? accentColor : foregroundColor;
  const descColor = isSelected ? accentColor : mutedColor;

  // Format command name with leading prefix
  // In mention mode (@), use category-specific symbols: * for agents, + for files/folders
  const effectivePrefix = namePrefix === "@"
    ? (command.category === "agent" ? "* " : "+ ")
    : namePrefix;
  const fullName = `${effectivePrefix}${command.name}`;

  // Calculate column widths based on terminal width
  // Layout: 2 (padding) + cmdCol + 2 (gap) + descCol + 2 (padding)
  const padding = 4; // 2 left + 2 right
  const rawDesc = command.description.replace(/\n/g, " ").trim();
  const hasDescription = rawDesc.length > 0;
  const gap = hasDescription ? 2 : 0;
  const availableWidth = terminalWidth - padding - gap;

  // When no description (e.g. file/folder mentions), name gets the full row width.
  // Otherwise two-column layout: command column gets ~30%, min 18, max 28.
  const cmdColWidth = hasDescription
    ? Math.min(28, Math.max(18, Math.floor(availableWidth * 0.3)))
    : availableWidth;
  const descColWidth = availableWidth - cmdColWidth;

  // Truncate command name if needed — use "..." for clean display
  const displayName = fullName.length > cmdColWidth
    ? `${fullName.slice(0, cmdColWidth - 3)}...`
    : hasDescription ? fullName.padEnd(cmdColWidth) : fullName;

  // Truncate description to single line — use "..." for clean display
  const description = hasDescription
    ? (rawDesc.length > descColWidth
      ? `${rawDesc.slice(0, descColWidth - 3)}...`
      : rawDesc)
    : "";

  return (
    <box
      flexDirection="row"
      width="100%"
      height={1}
      paddingLeft={SPACING.INDENT}
      paddingRight={SPACING.INDENT}
    >
      {/* Command name column */}
      <box width={hasDescription ? cmdColWidth : undefined} flexGrow={hasDescription ? undefined : 1} height={1}>
        <text fg={fgColor} attributes={isSelected ? 1 : undefined}>{displayName}</text>
      </box>
      {hasDescription && (
        <>
          {/* Gap between columns */}
          <box width={gap} height={1}>
            <text>{" "}</text>
          </box>
          {/* Description column */}
          <box flexGrow={1} height={1}>
            <text fg={descColor}>{description}</text>
          </box>
        </>
      )}
    </box>
  );
}

// ============================================================================
// AUTOCOMPLETE COMPONENT
// ============================================================================

/**
 * Autocomplete dropdown for slash commands.
 *
 * Displays a list of commands matching the current input prefix.
 * Supports selection via keyboard navigation (handled by parent).
 *
 * @example
 * ```tsx
 * <Autocomplete
 *   input="hel"
 *   visible={showAutocomplete}
 *   selectedIndex={selectedIdx}
 *   onSelect={(cmd, action) => handleSelect(cmd, action)}
 *   onIndexChange={setSelectedIdx}
 *   maxSuggestions={5}
 * />
 * ```
 */
export function Autocomplete({
  input,
  visible,
  selectedIndex,
  onSelect: _onSelect,
  onIndexChange,
  maxSuggestions = 8,
  namePrefix = "/",
  externalSuggestions,
}: AutocompleteProps): React.ReactNode {
  const { theme } = useTheme();
  const { width: terminalWidth } = useTerminalDimensions();
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const itemHeight = 1; // Each suggestion row is 1 line tall

  // Get matching commands from the registry or use external suggestions
  const suggestions = useMemo(() => {
    if (!visible) return [];

    if (externalSuggestions) return externalSuggestions;

    // Search for commands matching the input prefix
    // Filter out agents - they are only accessible via @ mentions, not slash commands
    const matches = globalRegistry.search(input).filter(cmd => cmd.category !== "agent");

    // Return all matches - scrollbox handles overflow display
    return matches;
  }, [input, visible, externalSuggestions]);

  // Ensure selectedIndex is within bounds
  const validIndex = Math.min(
    Math.max(0, selectedIndex),
    Math.max(0, suggestions.length - 1)
  );

  // Notify parent if index was clamped
  if (validIndex !== selectedIndex && suggestions.length > 0) {
    onIndexChange(validIndex);
  }

  // Scroll to keep selected item visible
  useEffect(() => {
    if (!scrollRef.current || suggestions.length === 0) return;

    const scrollBox = scrollRef.current;
    const selectedTop = validIndex * itemHeight;
    const selectedBottom = selectedTop + itemHeight;
    const viewportHeight = maxSuggestions;

    // Check if selected item is above viewport
    if (selectedTop < scrollBox.scrollTop) {
      scrollBox.scrollTo(selectedTop);
    }
    // Check if selected item is below viewport
    else if (selectedBottom > scrollBox.scrollTop + viewportHeight) {
      scrollBox.scrollTo(selectedBottom - viewportHeight);
    }
  }, [validIndex, suggestions.length, maxSuggestions]);

  // Don't render if not visible or no suggestions
  if (!visible || suggestions.length === 0) {
    return null;
  }

  // Calculate display height - min of suggestions or maxSuggestions
  // No borders for cleaner Claude Code-style look
  const displayHeight = Math.min(suggestions.length, maxSuggestions);

  return (
    <box
      flexDirection="column"
      width="100%"
      height={displayHeight}
      marginTop={SPACING.NONE}
      marginBottom={SPACING.NONE}
    >
      <scrollbox
        ref={scrollRef}
        height={displayHeight}
        scrollY={true}
        scrollX={false}
      >
        {suggestions.map((command, index) => (
          <SuggestionRow
            key={command.name}
            command={command}
            isSelected={index === validIndex}
            accentColor={theme.colors.accent}
            foregroundColor={theme.colors.foreground}
            mutedColor={theme.colors.muted}
            terminalWidth={terminalWidth}
            namePrefix={namePrefix}
          />
        ))}
      </scrollbox>
    </box>
  );
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/** @deprecated Use navigateUp/navigateDown from utils/navigation.ts directly */
export { navigateUp, navigateDown };

// ============================================================================
// KEYBOARD NAVIGATION HOOK
// ============================================================================

/**
 * Result of keyboard event handling.
 */
export interface KeyboardHandlerResult {
  /** Whether the key event was handled */
  handled: boolean;
  /** Action to take (if any) */
  action?: "complete" | "execute" | "hide";
}

/**
 * Options for the useAutocompleteKeyboard hook.
 */
export interface UseAutocompleteKeyboardOptions {
  /** Whether autocomplete is visible */
  visible: boolean;
  /** Current selected index */
  selectedIndex: number;
  /** Total number of suggestions */
  totalSuggestions: number;
  /** Callback to update selected index */
  onIndexChange: (index: number) => void;
  /** Callback when Tab is pressed (complete) */
  onComplete: () => void;
  /** Callback when Enter is pressed (execute) */
  onExecute: () => void;
  /** Callback when Escape is pressed (hide) */
  onHide: () => void;
}

/**
 * Hook for handling autocomplete keyboard navigation.
 *
 * Returns a key handler function that can be passed to useKeyboard.
 * Handles Up/Down arrows, Tab, Enter, and Escape keys.
 *
 * @param options - Configuration options
 * @returns Key handler function
 *
 * @example
 * ```tsx
 * const handleAutocompleteKey = useAutocompleteKeyboard({
 *   visible: showAutocomplete,
 *   selectedIndex,
 *   totalSuggestions: suggestions.length,
 *   onIndexChange: setSelectedIndex,
 *   onComplete: () => completeCommand(),
 *   onExecute: () => executeCommand(),
 *   onHide: () => setShowAutocomplete(false),
 * });
 *
 * useKeyboard((event) => {
 *   const result = handleAutocompleteKey(event);
 *   if (result.handled) return;
 *   // Handle other keys...
 * });
 * ```
 */
export function useAutocompleteKeyboard(
  options: UseAutocompleteKeyboardOptions
): (event: KeyEvent) => KeyboardHandlerResult {
  const {
    visible,
    selectedIndex,
    totalSuggestions,
    onIndexChange,
    onComplete,
    onExecute,
    onHide,
  } = options;

  return useCallback(
    (event: KeyEvent): KeyboardHandlerResult => {
      // Don't handle if not visible
      if (!visible) {
        return { handled: false };
      }

      const key = event.name;

      // Up arrow - navigate up
      if (key === "up") {
        const newIndex = navigateUp(selectedIndex, totalSuggestions);
        onIndexChange(newIndex);
        return { handled: true };
      }

      // Down arrow - navigate down
      if (key === "down") {
        const newIndex = navigateDown(selectedIndex, totalSuggestions);
        onIndexChange(newIndex);
        return { handled: true };
      }

      // Tab - complete the selected command
      if (key === "tab") {
        if (totalSuggestions > 0) {
          onComplete();
          return { handled: true, action: "complete" };
        }
        return { handled: false };
      }

      // Enter - execute the selected command
      if (key === "return") {
        if (totalSuggestions > 0) {
          onExecute();
          return { handled: true, action: "execute" };
        }
        return { handled: false };
      }

      // Escape - hide autocomplete
      if (key === "escape") {
        onHide();
        return { handled: true, action: "hide" };
      }

      return { handled: false };
    },
    [visible, selectedIndex, totalSuggestions, onIndexChange, onComplete, onExecute, onHide]
  );
}
