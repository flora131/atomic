/**
 * Mounts the 24-Hour Design Hotline as a Delphi page embed.
 *
 * The Delphi loader (embed.delphi.ai/loader.js) reads `window.delphi.page` and
 * injects an iframe inside `#delphi-container`, anchored relative to the
 * `#delphi-page-script` element. Both elements are rendered in index.html.
 *
 * Idempotent: safe to call multiple times. The loader itself bails out if an
 * iframe is already present in the container.
 *
 * Falls back to a direct link if the loader script fails to load (e.g. blocked
 * by a network filter or offline preview).
 */

const DELPHI_LOADER_URL = "https://embed.delphi.ai/loader.js";
const DELPHI_BOOTSTRAP_ID = "delphi-page-bootstrap";

// Delphi clone configuration — sourced from the live site (jamesbuckhouse.com/#/design).
const DELPHI_CONFIG = {
  page: {
    config: "750b5c63-4cf8-47d5-945d-9ee7f18bf59f",
    overrides: { landingPage: "OVERVIEW" },
    container: { width: "100%", height: "1400px" },
  },
};

export function initHotlineEmbed() {
  const section = document.getElementById("section-design");
  if (!section) return;

  const container = section.querySelector("#delphi-container");
  const anchor = section.querySelector("#delphi-page-script");
  const fallback = section.querySelector(".hotline-fallback");

  if (!container || !anchor) return;

  // Set the global config the loader reads on initialize().
  // Merge if something else already set window.delphi (e.g. a bubble embed).
  window.delphi = { ...window.delphi, ...DELPHI_CONFIG };

  // If an iframe already exists in the container, the loader already ran — done.
  if (container.querySelector("iframe")) return;

  // Avoid injecting the loader script twice across hash-route remounts.
  if (document.getElementById(DELPHI_BOOTSTRAP_ID)) return;

  const script = document.createElement("script");
  script.src = DELPHI_LOADER_URL;
  script.id = DELPHI_BOOTSTRAP_ID;
  script.async = true;

  script.addEventListener("error", () => {
    if (fallback instanceof HTMLElement) fallback.classList.add("visible");
  });

  // Safety net: if the iframe never appears (network blocked, ad-blocker, etc.),
  // surface the direct-link fallback so the section isn't silently empty.
  const timeoutId = setTimeout(() => {
    if (!container.querySelector("iframe") && fallback instanceof HTMLElement) {
      fallback.classList.add("visible");
    }
  }, 8000);

  // Watch the container — clear the timeout the moment Delphi injects its iframe.
  const observer = new MutationObserver(() => {
    if (container.querySelector("iframe")) {
      clearTimeout(timeoutId);
      observer.disconnect();
    }
  });
  observer.observe(container, { childList: true, subtree: true });

  anchor.parentNode?.insertBefore(script, anchor);
}
