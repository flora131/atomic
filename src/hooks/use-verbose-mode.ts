/**
 * useVerboseMode Hook for Verbose Output Control
 *
 * Manages verbose mode state for the chat interface.
 * Verbose mode controls expanded/collapsed state of tool outputs
 * and sub-agent trees, triggered by Ctrl+O keyboard shortcut.
 *
 * Reference: Feature - Verbose mode toggle for tool output expansion
 */

import { useCallback, useState } from "react";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Return type for the useVerboseMode hook.
 */
export interface UseVerboseModeReturn {
  /** Whether verbose mode is currently enabled */
  isVerbose: boolean;
  /** Toggle verbose mode on/off */
  toggle: () => void;
}

// ============================================================================
// HOOK IMPLEMENTATION
// ============================================================================

/**
 * Hook for managing verbose mode state in the chat interface.
 *
 * Verbose mode controls:
 * - ToolResult expanded/collapsed state
 * - Timestamp display in MessageBubble
 * - Sub-agent tree expansion
 * - Footer status display
 *
 * @param initialValue - Initial verbose mode value (default: false)
 * @returns Verbose mode state and toggle function
 */
export function useVerboseMode(initialValue = false): UseVerboseModeReturn {
  const [isVerbose, setIsVerbose] = useState(initialValue);

  const toggle = useCallback(() => setIsVerbose((prev) => !prev), []);

  return {
    isVerbose,
    toggle,
  };
}

export default useVerboseMode;
