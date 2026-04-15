/**
 * Hash-based client-side router.
 * Supports hash routes like #/, #/design, #/library, #/film, #/about, #/art/{id}.
 */

/** @type {Map<string, () => void>} */
let routeMap = new Map();

/**
 * Match a hash path against registered route patterns.
 * Supports exact matches and simple wildcard prefix matches (e.g. '#/art/').
 *
 * @param {string} hash - The current location.hash value
 * @returns {(() => void) | undefined} The matched route handler, if any
 */
function matchRoute(hash) {
  if (routeMap.has(hash)) {
    return routeMap.get(hash);
  }

  // Try prefix matches for parameterized routes (e.g. #/art/1)
  for (const [pattern, handler] of routeMap.entries()) {
    if (pattern.endsWith('*') && hash.startsWith(pattern.slice(0, -1))) {
      return handler;
    }
  }

  return undefined;
}

// TODO: Implement full route parameter extraction and middleware support
/**
 * Initialize the router with a map of hash routes to handler functions.
 *
 * @param {{ [route: string]: () => void }} routes - Route pattern to handler map
 */
export function initRouter(routes) {
  routeMap = new Map(Object.entries(routes));

  const handleHashChange = () => {
    const hash = window.location.hash || '#/';
    const handler = matchRoute(hash);
    if (handler) {
      handler();
    }
  };

  window.addEventListener('hashchange', handleHashChange);
  handleHashChange();
}

/**
 * Programmatically navigate to a given hash route.
 *
 * @param {string} hash - The hash route to navigate to (e.g. '#/library')
 */
export function navigate(hash) {
  window.location.hash = hash;
}

export default { initRouter, navigate };
