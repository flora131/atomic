/**
 * Autocomplete Component for Slash Commands
 *
 * Displays a dropdown list of command suggestions based on user input.
 * Supports keyboard navigation for selection.
 *
 * Reference: Feature 6 - Create Autocomplete component with two-column layout
 */

import React, { useMemo, useCallback } from "react";
import { useTheme } from "../theme.tsx";
import { globalRegistry, type CommandDefinition } from "../commands/index.ts";
import type { KeyEvent } from "@opentui/core";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Props for the Autocomplete component.
 */
export interface AutocompleteProps {
  /** The current input text (without the leading "/") */
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
}

// ============================================================================
// SUGGESTION ROW COMPONENT
// ============================================================================

/**
 * Renders a single suggestion row with command name and description.
 */
function SuggestionRow({
  command,
  isSelected,
  accentColor,
  foregroundColor,
  mutedColor,
}: SuggestionRowProps): React.ReactNode {
  const bgColor = isSelected ? accentColor : undefined;
  const fgColor = isSelected ? "#000000" : foregroundColor;
  const descColor = isSelected ? "#333333" : mutedColor;

  // Format command name with leading slash
  const commandName = `/${command.name}`;

  // Truncate description if too long (terminal width considerations)
  const maxDescLength = 40;
  const description =
    command.description.length > maxDescLength
      ? `${command.description.slice(0, maxDescLength - 3)}...`
      : command.description;

  return (
    <box
      flexDirection="row"
      width="100%"
      style={{ bg: bgColor }}
      paddingLeft={1}
      paddingRight={1}
    >
      {/* Command name column - fixed width */}
      <box width={20}>
        <text style={{ fg: fgColor, bold: isSelected }}>{commandName}</text>
      </box>
      {/* Description column - flexible */}
      <box flexGrow={1}>
        <text style={{ fg: descColor }}>{description}</text>
      </box>
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
  onSelect,
  onIndexChange,
  maxSuggestions = 8,
}: AutocompleteProps): React.ReactNode {
  const { theme } = useTheme();

  // Get matching commands from the registry
  const suggestions = useMemo(() => {
    if (!visible) return [];

    // Search for commands matching the input prefix
    const matches = globalRegistry.search(input);

    // Limit to maxSuggestions
    return matches.slice(0, maxSuggestions);
  }, [input, visible, maxSuggestions]);

  // Ensure selectedIndex is within bounds
  const validIndex = Math.min(
    Math.max(0, selectedIndex),
    Math.max(0, suggestions.length - 1)
  );

  // Notify parent if index was clamped
  if (validIndex !== selectedIndex && suggestions.length > 0) {
    onIndexChange(validIndex);
  }

  // Don't render if not visible or no suggestions
  if (!visible || suggestions.length === 0) {
    return null;
  }

  return (
    <box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.colors.border}
      style={{ bg: theme.colors.background }}
      width="100%"
      maxHeight={maxSuggestions + 2} // +2 for borders
    >
      {suggestions.map((command, index) => (
        <SuggestionRow
          key={command.name}
          command={command}
          isSelected={index === validIndex}
          accentColor={theme.colors.accent}
          foregroundColor={theme.colors.foreground}
          mutedColor={theme.colors.muted}
        />
      ))}
    </box>
  );
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Navigate the autocomplete selection up.
 * Wraps to bottom when at top.
 *
 * @param currentIndex - Current selected index
 * @param totalItems - Total number of suggestions
 * @returns New selected index
 */
export function navigateUp(currentIndex: number, totalItems: number): number {
  if (totalItems === 0) return 0;
  return currentIndex <= 0 ? totalItems - 1 : currentIndex - 1;
}

/**
 * Navigate the autocomplete selection down.
 * Wraps to top when at bottom.
 *
 * @param currentIndex - Current selected index
 * @param totalItems - Total number of suggestions
 * @returns New selected index
 */
export function navigateDown(currentIndex: number, totalItems: number): number {
  if (totalItems === 0) return 0;
  return currentIndex >= totalItems - 1 ? 0 : currentIndex + 1;
}

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

      const key = event.key;

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
