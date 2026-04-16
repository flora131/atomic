/**
 * Factory for a single artwork card DOM element.
 *
 * @param {{ id: number, title: string, imageUrl: string, route: string }} artwork
 * @param {number} index - position in the grid (used for stagger delay)
 * @param {(artwork: object, cardEl: HTMLElement) => void} onOpen - called when card is clicked
 * @returns {HTMLElement}
 */
export function createArtworkCard(artwork, index, onOpen) {
  const card = document.createElement("article");
  card.className = "artwork-card loading reveal-ready";
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  card.setAttribute("aria-label", `Open ${artwork.title}`);
  card.dataset.artworkId = String(artwork.id);

  // Stagger reveal delay: 60ms per item
  card.style.transitionDelay = `${index * 60}ms`;

  const img = document.createElement("img");
  img.className = "card-img breathing";
  img.alt = artwork.title;
  img.loading = "lazy";
  img.decoding = "async";

  // Remove loading class once image loads
  img.addEventListener("load", () => {
    card.classList.remove("loading");
  }, { once: true });

  img.addEventListener("error", () => {
    card.classList.remove("loading");
  }, { once: true });

  // Set src after event listeners are attached — if the image is already cached,
  // the "load" event fires synchronously in some browsers the moment src is assigned.
  // Attaching listeners first ensures we never miss that immediate fire.
  img.src = artwork.imageUrl;

  const title = document.createElement("div");
  title.className = "artwork-card-title";
  title.textContent = artwork.title;

  card.append(img, title);

  // Open lightbox on click or Enter/Space
  const handleOpen = () => onOpen(artwork, card);
  card.addEventListener("click", handleOpen);
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleOpen();
    }
  });

  return card;
}
