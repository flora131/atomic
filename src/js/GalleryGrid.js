import { artworks } from "./data/artworks.js";
import { createArtworkCard } from "./ArtworkCard.js";
import { openLightbox } from "./Lightbox.js";

/**
 * Renders all 45 artwork cards into the gallery grid and sets up
 * IntersectionObserver for staggered scroll reveals.
 */
export function initGalleryGrid() {
  const grid = document.querySelector(".gallery-grid");
  if (!grid) return;

  // Render all cards
  artworks.forEach((artwork, index) => {
    const card = createArtworkCard(artwork, index, (artworkData, cardEl) => {
      openLightbox(artworkData, cardEl, artworks);
    });
    grid.appendChild(card);
  });

  // IntersectionObserver for staggered scroll reveals.
  // threshold: 0.1 — triggers when just 10% of the card is visible, so the
  //   reveal fires as soon as the card peeks in rather than waiting for full visibility.
  // rootMargin: "0px 0px -40px 0px" — shrinks the detection zone by 40px at the
  //   bottom, preventing cards that are barely off-screen from revealing prematurely
  //   and ensuring a noticeable scroll-into-view moment.
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("revealed");
          observer.unobserve(entry.target); // unobserve immediately — reveal is one-shot
        }
      });
    },
    {
      threshold: 0.1,
      rootMargin: "0px 0px -40px 0px",
    }
  );

  grid.querySelectorAll(".artwork-card").forEach((card) => {
    observer.observe(card);
  });
}
