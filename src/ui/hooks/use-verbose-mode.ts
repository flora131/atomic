/**
 * useVerboseMode Hook for Verbose Output Control
 *
 * Manages verbose mode state for the chat interface.
 * Verbose mode controls expanded/collapsed state of tool outputs
 * and sub-agent trees, triggered by Ctrl+O keyboard shortcut.
 *
 * Reference: Feature - Verbose mode toggle for tool output expansion
 */

import { useState, useCallback } from "react";

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
  /** Set verbose mode to a specific value */
  setVerboseMode: (value: boolean) => void;
  /** Enable verbose mode */
  enable: () => void;
  /** Disable verbose mode */
  disable: () => void;
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
 * @returns Verbose mode state and control functions
 *
 * @example
 * ```tsx
 * const { isVerbose, toggle, setVerboseMode } = useVerboseMode();
 *
 * // Toggle verbose mode (e.g., on Ctrl+O)
 * toggle();
 *
 * // Set explicitly
 * setVerboseMode(true);
 *
 * // Use in component props
 * <ToolResult {...props} verbose={isVerbose} />
 * ```
 */
export function useVerboseMode(initialValue = false): UseVerboseModeReturn {
  const [isVerbose, setIsVerbose] = useState(initialValue);

  /**
   * Toggle verbose mode on/off.
   */
  const toggle = useCallback(() => {
    setIsVerbose((prev) => !prev);
  }, []);

  /**
   * Set verbose mode to a specific value.
   */
  const setVerboseMode = useCallback((value: boolean) => {
    setIsVerbose(value);
  }, []);

  /**
   * Enable verbose mode.
   */
  const enable = useCallback(() => {
    setIsVerbose(true);
  }, []);

  /**
   * Disable verbose mode.
   */
  const disable = useCallback(() => {
    setIsVerbose(false);
  }, []);

  return {
    isVerbose,
    toggle,
    setVerboseMode,
    enable,
    disable,
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default useVerboseMode;
