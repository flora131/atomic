/**
 * Lightbox component.
 * Opens and closes a fullscreen lightbox overlay for artwork detail views.
 */

let lightboxEl = null;

// TODO: Implement full lightbox with keyboard navigation and swipe support
export function openLightbox(artwork) {
  if (!lightboxEl) {
    lightboxEl = document.createElement('div');
    lightboxEl.className = 'lightbox';
    document.body.appendChild(lightboxEl);
  }

  lightboxEl.innerHTML = '';
  lightboxEl.dataset.artworkId = String(artwork.id);

  const img = document.createElement('img');
  img.src = artwork.imageUrl;
  img.alt = artwork.title;
  lightboxEl.appendChild(img);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'lightbox-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', closeLightbox);
  lightboxEl.appendChild(closeBtn);

  lightboxEl.style.display = 'flex';
}

export function closeLightbox() {
  if (lightboxEl) {
    lightboxEl.style.display = 'none';
  }
}

export default { openLightbox, closeLightbox };
