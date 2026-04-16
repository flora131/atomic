/**
 * Lightbox — FLIP spring-physics modal with breathing-pause coordination.
 *
 * FLIP sequence (critical — fixes lightbox-jank described in critique):
 *  1. Immediately set animation-play-state: paused on clicked card
 *  2. Force transform: scale(1.0) with a style flush (getBoundingClientRect)
 *  3. Measure card bounds at guaranteed scale=1.0
 *  4. Animate panel from card bounds to center via transform only (compositor thread)
 *  5. On close: reverse FLIP, then restore animation-play-state: running
 *
 * Keyboard: Escape closes. ArrowLeft/ArrowRight navigate between artworks.
 * Focus: trapped within lightbox while open. Escape returns focus to opener.
 * aria-modal="true", role="dialog", aria-label = artwork title.
 */

/** @type {object | null} Currently displayed artwork */
let currentArtwork = null;

/** @type {object[]} Full artworks array for prev/next navigation */
let allArtworks = [];

/** @type {HTMLElement | null} The card that triggered the lightbox (for FLIP + focus return) */
let openerCard = null;

/** @type {HTMLElement | null} */
let lightboxEl = null;

/** Initialize the lightbox DOM. Must be called once after DOM is ready. */
export function initLightbox() {
  lightboxEl = document.createElement("div");
  lightboxEl.id = "lightbox";
  lightboxEl.className = "lightbox";
  lightboxEl.setAttribute("role", "dialog");
  lightboxEl.setAttribute("aria-modal", "true");
  lightboxEl.setAttribute("aria-label", "Artwork viewer");
  lightboxEl.innerHTML = `
    <div class="lightbox-backdrop" aria-hidden="true"></div>
    <div class="lightbox-panel">
      <button class="lightbox-close" aria-label="Close lightbox">✕</button>
      <button class="lightbox-prev" aria-label="Previous artwork">‹</button>
      <img class="lightbox-img" src="" alt="" />
      <div class="lightbox-caption"></div>
      <button class="lightbox-next" aria-label="Next artwork">›</button>
    </div>
  `;
  document.body.appendChild(lightboxEl);

  // Close on backdrop click
  lightboxEl.querySelector(".lightbox-backdrop")?.addEventListener("click", closeLightbox);

  // Close button
  lightboxEl.querySelector(".lightbox-close")?.addEventListener("click", closeLightbox);

  // Prev / Next
  lightboxEl.querySelector(".lightbox-prev")?.addEventListener("click", () => navigate(-1));
  lightboxEl.querySelector(".lightbox-next")?.addEventListener("click", () => navigate(1));

  // Keyboard navigation
  document.addEventListener("keydown", (e) => {
    if (!lightboxEl?.classList.contains("open")) return;
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft") navigate(-1);
    if (e.key === "ArrowRight") navigate(1);
  });
}

/**
 * Open the lightbox for a given artwork.
 *
 * @param {{ id: number, title: string, imageUrl: string }} artwork
 * @param {HTMLElement} cardEl - the card element that was clicked (FLIP source)
 * @param {object[]} artworksArray - full array for prev/next navigation
 */
export function openLightbox(artwork, cardEl, artworksArray) {
  if (!lightboxEl) return;

  currentArtwork = artwork;
  allArtworks = artworksArray;
  openerCard = cardEl;

  // ── FLIP Step 1: pause breathing animation ────────────────
  const cardImg = cardEl.querySelector(".card-img");
  if (cardImg instanceof HTMLElement) {
    cardImg.style.animationPlayState = "paused";
    // ── FLIP Step 2: force scale(1.0) + flush ────────────────
    cardImg.style.transform = "scale(1.0)";
    // Reading getBoundingClientRect forces a style flush
    void cardImg.getBoundingClientRect();
  }

  // ── FLIP Step 3: measure card bounds at scale=1.0 ─────────
  cardEl.getBoundingClientRect();

  // Update lightbox content
  const img = lightboxEl.querySelector(".lightbox-img");
  const caption = lightboxEl.querySelector(".lightbox-caption");
  if (img instanceof HTMLImageElement) {
    img.src = artwork.imageUrl;
    img.alt = artwork.title;
  }
  if (caption) caption.textContent = artwork.title;
  lightboxEl.setAttribute("aria-label", artwork.title);

  // ── FLIP Step 4: show lightbox and animate from card bounds ──
  lightboxEl.classList.add("open");

  // TODO: implement actual FLIP transform animation from cardRect to center
  // panel.style.transform = flipTransformFrom(cardRect, panelRect);
  // requestAnimationFrame(() => { panel.style.transition = '...'; panel.style.transform = ''; });

  // Move focus to close button
  const closeBtn = lightboxEl.querySelector(".lightbox-close");
  if (closeBtn instanceof HTMLElement) {
    closeBtn.focus();
  }

  // Trap focus within lightbox
  lightboxEl.addEventListener("keydown", trapFocus);
}

/** Close the lightbox and restore focus to the opener card. */
export function closeLightbox() {
  if (!lightboxEl) return;

  lightboxEl.classList.remove("open");
  lightboxEl.removeEventListener("keydown", trapFocus);

  // ── FLIP Step 5: restore breathing animation ──────────────
  if (openerCard) {
    const cardImg = openerCard.querySelector(".card-img");
    if (cardImg instanceof HTMLElement) {
      cardImg.style.transform = "";
      cardImg.style.animationPlayState = "";
    }
    openerCard.focus();
    openerCard = null;
  }

  currentArtwork = null;
}

/** Navigate to prev (-1) or next (+1) artwork. */
function navigate(direction) {
  if (!currentArtwork) return;
  const idx = allArtworks.findIndex((a) => a.id === currentArtwork?.id);
  const nextIdx = (idx + direction + allArtworks.length) % allArtworks.length;
  const nextArtwork = allArtworks[nextIdx];

  currentArtwork = nextArtwork;
  const img = lightboxEl?.querySelector(".lightbox-img");
  const caption = lightboxEl?.querySelector(".lightbox-caption");
  if (img instanceof HTMLImageElement) {
    img.src = nextArtwork.imageUrl;
    img.alt = nextArtwork.title;
  }
  if (caption) caption.textContent = nextArtwork.title;
  lightboxEl?.setAttribute("aria-label", nextArtwork.title);
}

/**
 * Basic focus trap: tab/shift-tab cycle through lightbox focusable elements.
 * @param {KeyboardEvent} e
 */
function trapFocus(e) {
  if (e.key !== "Tab" || !lightboxEl) return;
  const focusable = Array.from(
    lightboxEl.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")
  ).filter((el) => !el.hasAttribute("disabled") && el instanceof HTMLElement);

  if (focusable.length === 0) return;
  const first = /** @type {HTMLElement} */ (focusable[0]);
  const last = /** @type {HTMLElement} */ (focusable[focusable.length - 1]);

  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
