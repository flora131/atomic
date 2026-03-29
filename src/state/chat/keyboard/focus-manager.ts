/**
 * Focus Manager — Keyboard Ownership State Tracking
 *
 * Provides a pure function to determine the current UI mode from
 * observable state. The mode drives strategy selection inside
 * {@link useKeyboardOwnership}.
 *
 * This module intentionally has **no side effects** and no React
 * dependencies so it can be unit-tested in isolation.
 */

import type { UserQuestion } from "@/state/chat/shared/types/index.ts";
import type { UIMode } from "@/state/chat/keyboard/types.ts";

/**
 * Derive the current keyboard ownership mode from UI state.
 *
 * Priority order:
 * 1. If a HITL dialog is active → `"dialog"`
 * 2. If the model selector is open → `"model-selector"`
 * 3. Otherwise → `"chat"` (normal input)
 *
 * @param activeQuestion - The currently active user question, or null.
 * @param showModelSelector - Whether the model selector dialog is visible.
 * @returns The keyboard {@link UIMode} that should own key events.
 */
export function determineUIMode(
  activeQuestion: UserQuestion | null,
  showModelSelector: boolean,
): UIMode {
  if (activeQuestion) return "dialog";
  if (showModelSelector) return "model-selector";
  return "chat";
}
