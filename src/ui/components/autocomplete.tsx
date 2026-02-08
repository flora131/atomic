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
  const fullName = `${namePrefix}${command.name}`;

  // Calculate column widths based on terminal width
  // Layout: 2 (padding) + cmdCol + 2 (gap) + descCol + 2 (padding)
  const padding = 4; // 2 left + 2 right
  const gap = 2;
  const availableWidth = terminalWidth - padding - gap;

  // Command column gets ~30% of available width, min 18, max 28
  const cmdColWidth = Math.min(28, Math.max(18, Math.floor(availableWidth * 0.3)));
  const descColWidth = availableWidth - cmdColWidth;

  // Truncate command name if needed
  const displayName = fullName.length > cmdColWidth
    ? `${fullName.slice(0, cmdColWidth - 1)}…`
    : fullName.padEnd(cmdColWidth);

  // Truncate description based on remaining terminal width
  const description =
    command.description.length > descColWidth
      ? `${command.description.slice(0, descColWidth - 1)}…`
      : command.description;

  return (
    <box
      flexDirection="row"
      width="100%"
      paddingLeft={2}
      paddingRight={2}
    >
      {/* Command name column */}
      <box width={cmdColWidth}>
        <text fg={fgColor} attributes={isSelected ? 1 : undefined}>{displayName}</text>
      </box>
      {/* Gap between columns */}
      <box width={gap}>
        <text>{" "}</text>
      </box>
      {/* Description column */}
      <box flexGrow={1}>
        <text fg={descColor}>{description}</text>
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
    const matches = globalRegistry.search(input);

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
    >
      <scrollbox
        ref={scrollRef}
        flexGrow={1}
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
