import { filterTags } from "./data/library-items.js";

/**
 * Renders the filter bar pill buttons and manages active state.
 *
 * @param {HTMLElement} container - element to render buttons into
 * @param {(tag: string) => void} onFilter - called with the active tag when selection changes
 */
export function initFilterBar(container, onFilter) {
  let activeTag = "All";

  filterTags.forEach((tag) => {
    const btn = document.createElement("button");
    btn.className = "filter-btn";
    btn.type = "button";
    btn.textContent = tag;
    btn.setAttribute("aria-pressed", tag === "All" ? "true" : "false");

    btn.addEventListener("click", () => {
      if (activeTag === tag) return; // already active

      // Deactivate previous
      container.querySelector(`[aria-pressed="true"]`)?.setAttribute("aria-pressed", "false");

      activeTag = tag;
      btn.setAttribute("aria-pressed", "true");
      onFilter(tag);
    });

    container.appendChild(btn);
  });

  // Expose a way for the empty-state clear link to reset to All
  container.dataset.filterBarReady = "true";
}

/**
 * Reset the filter bar to "All" from outside (e.g. empty-state clear link).
 * @param {HTMLElement} container
 * @param {(tag: string) => void} onFilter
 */
export function resetFilterBar(container, onFilter) {
  container.querySelector(`[aria-pressed="true"]`)?.setAttribute("aria-pressed", "false");
  const allBtn = container.querySelector(".filter-btn");
  if (allBtn) {
    allBtn.setAttribute("aria-pressed", "true");
    onFilter("All");
  }
}
