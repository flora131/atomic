import { onRouteChange } from "./router.js";

/** @type {Array<{label: string, emoji: string, href: string, external?: boolean}>} */
const NAV_ITEMS = [
  { label: "Art",            emoji: "✎",  href: "#/" },
  { label: "24-Hour Hotline", emoji: "☎", href: "#/design" },
  { label: "Library",        emoji: "📖", href: "#/library" },
  { label: "Film",           emoji: "🎬", href: "#/film" },
  { label: "Buckhouse",      emoji: "👤", href: "#/about" },
];

const NEWSLETTER = {
  label: "Newsletter",
  emoji: "📰",
  href: "https://jamesbuckhouse.substack.com/",
};

/**
 * Renders and mounts the navbar into the element with id="navbar".
 * Manages active link state on route changes and hamburger toggle on mobile.
 */
export function initNavbar() {
  const navbar = document.getElementById("navbar");
  if (!navbar) return;

  navbar.innerHTML = `
    <div class="navbar-inner">
      <ul class="nav-links" role="list">
        ${NAV_ITEMS.map(item => `
          <li>
            <a
              class="nav-link"
              href="${item.href}"
              data-route="${item.href}"
              aria-label="${item.label}"
            >${item.emoji} ${item.label}</a>
          </li>
        `).join("")}
      </ul>

      <a
        class="nav-newsletter"
        href="${NEWSLETTER.href}"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="${NEWSLETTER.label}"
      >${NEWSLETTER.emoji} ${NEWSLETTER.label}</a>

      <button
        class="nav-hamburger"
        aria-label="Open navigation menu"
        aria-expanded="false"
        aria-controls="nav-drawer"
      >
        <span class="nav-hamburger-bar"></span>
        <span class="nav-hamburger-bar"></span>
        <span class="nav-hamburger-bar"></span>
      </button>
    </div>
  `;

  // Mobile drawer (inserted after navbar, before main content)
  const drawer = document.createElement("nav");
  drawer.id = "nav-drawer";
  drawer.className = "nav-drawer";
  drawer.setAttribute("aria-label", "Mobile navigation");
  drawer.innerHTML = NAV_ITEMS.map(item => `
    <a class="nav-link" href="${item.href}" data-route="${item.href}"
    >${item.emoji} ${item.label}</a>
  `).join("");
  navbar.insertAdjacentElement("afterend", drawer);

  // Hamburger toggle
  const hamburger = navbar.querySelector(".nav-hamburger");
  hamburger?.addEventListener("click", () => {
    const isOpen = drawer.classList.toggle("open");
    hamburger.setAttribute("aria-expanded", String(isOpen));
    hamburger.setAttribute("aria-label", isOpen ? "Close navigation menu" : "Open navigation menu");
  });

  // Close drawer on link click
  drawer.addEventListener("click", (e) => {
    if (/** @type {HTMLElement} */ (e.target)?.closest(".nav-link")) {
      drawer.classList.remove("open");
      hamburger?.setAttribute("aria-expanded", "false");
      hamburger?.setAttribute("aria-label", "Open navigation menu");
    }
  });

  // Update active link on route change
  onRouteChange((hash) => {
    const activeRoute = hash.startsWith("#/art/") ? "#/" : hash;
    document.querySelectorAll(".nav-link[data-route]").forEach((link) => {
      const route = link.getAttribute("data-route");
      link.classList.toggle("active", route === activeRoute);
    });
  });
}
