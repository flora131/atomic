/**
 * Navigation Utilities
 *
 * Shared wrap-around list navigation helpers used by autocomplete,
 * user-question-dialog, model-selector-dialog, and other list-based UIs.
 */

/**
 * Navigate selection up with wrap-around.
 *
 * @param currentIndex - Current selected index
 * @param totalItems - Total number of items
 * @returns New selected index
 */
export function navigateUp(currentIndex: number, totalItems: number): number {
  if (totalItems === 0) return 0;
  return currentIndex <= 0 ? totalItems - 1 : currentIndex - 1;
}

/**
 * Navigate selection down with wrap-around.
 *
 * @param currentIndex - Current selected index
 * @param totalItems - Total number of items
 * @returns New selected index
 */
export function navigateDown(currentIndex: number, totalItems: number): number {
  if (totalItems === 0) return 0;
  return currentIndex >= totalItems - 1 ? 0 : currentIndex + 1;
}
