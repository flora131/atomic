/**
 * GalleryGrid component.
 * Renders a CSS grid of artwork cards from an array of artwork objects.
 */
import { createArtworkCard } from './ArtworkCard.js';

// TODO: Implement full gallery grid with lazy loading and responsive layout
export function createGalleryGrid(artworks) {
  const grid = document.createElement('div');
  grid.className = 'gallery-grid';

  artworks.forEach((artwork) => {
    const card = createArtworkCard(artwork);
    grid.appendChild(card);
  });

  return grid;
}

export default createGalleryGrid;
