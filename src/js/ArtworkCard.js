/**
 * ArtworkCard component.
 * Creates a single artwork card element with image and title overlay.
 */

// TODO: Implement video thumbnail support for card #1 (Maryon Park Installation View)
export function createArtworkCard(artwork) {
  const a = document.createElement('a');
  a.href = artwork.route;
  a.className = 'artwork-card';

  const img = document.createElement('img');
  img.src = artwork.imageUrl;
  img.alt = artwork.title;
  a.appendChild(img);

  const titleOverlay = document.createElement('span');
  titleOverlay.className = 'artwork-card-title';
  titleOverlay.textContent = artwork.title;
  a.appendChild(titleOverlay);

  return a;
}

export default createArtworkCard;
