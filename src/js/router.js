/**
 * Hash-based router.
 * Maps hash routes to section IDs and handles show/hide with crossfade transitions.
 *
 * Routes:
 *   #/          → #section-art
 *   #/design    → #section-design
 *   #/library   → #section-library
 *   #/film      → #section-film
 *   #/about     → #section-about
 *   #/art/:id   → opens lightbox (delegated to GalleryGrid/Lightbox)
 *   <unknown>   → #section-not-found
 */

/** @type {Record<string, string>} hash → section element ID */
const ROUTES = {
  "#/":        "section-art",
  "#/design":  "section-design",
  "#/library": "section-library",
  "#/film":    "section-film",
  "#/about":   "section-about",
};

/** Callbacks registered by other modules to be notified of route changes */
const listeners = /** @type {Array<(route: string) => void>} */ ([]);

/** @param {(route: string) => void} fn */
export function onRouteChange(fn) {
  listeners.push(fn);
}

/** Navigate to a hash route programmatically */
export function navigate(hash) {
  window.location.hash = hash;
}

/** Show the correct section based on current window.location.hash */
function applyRoute() {
  const hash = window.location.hash || "#/";

  // Deactivate all sections
  document.querySelectorAll(".section, .not-found").forEach((el) => {
    el.classList.remove("active", "section-enter");
  });

  if (hash.startsWith("#/art/")) {
    // Lightbox route: keep art section visible, notify listeners
    const artSection = document.getElementById("section-art");
    if (artSection) {
      artSection.classList.add("active");
    }
    listeners.forEach((fn) => fn(hash));
    return;
  }

  const sectionId = ROUTES[hash];
  if (sectionId) {
    const el = document.getElementById(sectionId);
    if (el) {
      el.classList.add("active");
      // requestAnimationFrame ensures the browser commits the "active" class
      // in one paint frame before "section-enter" is added in the next.
      // Without the rAF split, both classes would land in the same style recalc
      // and the CSS animation would have no "from" state to animate from.
      requestAnimationFrame(() => {
        el.classList.add("section-enter");
      });
    }
  } else {
    // 404 — unrecognized route
    const notFound = document.getElementById("section-not-found");
    if (notFound) {
      notFound.classList.add("active");
    }
  }

  listeners.forEach((fn) => fn(hash));
}

/** Initialize router — call once on DOMContentLoaded */
export function initRouter() {
  window.addEventListener("hashchange", applyRoute);

  // Default to #/ if no hash present
  if (!window.location.hash || window.location.hash === "#") {
    window.location.hash = "#/";
  }

  applyRoute();
}
