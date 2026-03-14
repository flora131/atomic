/**
 * UI Utilities
 *
 * Exports genuinely shared utility functions for the UI module.
 */

// Format utilities
export {
  formatDuration,
  formatTimestamp,
  truncateText,
  type FormattedDuration,
  type FormattedTimestamp,
} from "@/lib/ui/format.ts";

// Navigation utilities
export {
  navigateUp,
  navigateDown,
} from "@/lib/ui/navigation.ts";
