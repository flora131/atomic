/**
 * Navigation Handler — Scroll, History & Autocomplete Navigation
 *
 * Re-exports the navigation handler functions from the parent module.
 * These remain pure functions that take state and return a boolean
 * indicating whether the event was consumed.
 *
 * @module
 */

export {
  handleNavigationKey,
  handleComposeShortcutKey,
  handleAutocompleteSelectionKey,
} from "@/state/chat/keyboard/navigation.ts";
