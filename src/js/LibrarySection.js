import { libraryItems } from "./data/library-items.js";
import { createLibraryCard } from "./LibraryCard.js";
import { initFilterBar, resetFilterBar } from "./FilterBar.js";

/**
 * Renders library heading, intro, filter bar, and all cards.
 * Manages filter logic and empty state.
 */
export function initLibrarySection() {
  const section = document.getElementById("section-library");
  if (!section) return;

  const filterBarEl = section.querySelector(".filter-bar");
  const grid = section.querySelector(".library-grid");
  const emptyState = section.querySelector(".library-empty");
  if (!filterBarEl || !grid || !(filterBarEl instanceof HTMLElement)) return;

  // Render all cards initially
  let cardEls = libraryItems.map((item, index) => {
    const card = createLibraryCard(item, index);
    grid.appendChild(card);
    return { item, card };
  });

  // IntersectionObserver — staggered scroll reveals
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("revealed");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.05 }
  );

  cardEls.forEach(({ card }) => observer.observe(card));

  // Filter logic
  const applyFilter = (tag) => {
    let visibleCount = 0;
    cardEls.forEach(({ item, card }) => {
      const visible = tag === "All" || item.category === tag;
      card.hidden = !visible;
      if (visible) visibleCount++;
    });

    // Empty state
    if (emptyState) {
      emptyState.hidden = visibleCount > 0;
    }
  };

  initFilterBar(filterBarEl, applyFilter);

  // Empty-state clear link
  const clearLink = emptyState?.querySelector(".filter-clear");
  clearLink?.addEventListener("click", (e) => {
    e.preventDefault();
    resetFilterBar(filterBarEl, applyFilter);
  });
}
