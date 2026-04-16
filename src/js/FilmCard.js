/**
 * Factory for a single film card DOM element.
 *
 * @param {{ title: string, posterUrl: string, imdbUrl: string }} film
 * @param {number} index - position in grid (stagger delay)
 * @returns {HTMLAnchorElement}
 */
export function createFilmCard(film, index) {
  const card = document.createElement("a");
  card.className = "film-card reveal-ready";
  card.href = film.imdbUrl;
  card.target = "_blank";
  card.rel = "noopener noreferrer";
  card.setAttribute("aria-label", `${film.title} on IMDB`);

  // Stagger delay
  card.style.transitionDelay = `${index * 60}ms`;

  const img = document.createElement("img");
  img.className = "film-card-poster breathing-film";
  img.src = film.posterUrl;
  img.alt = film.title;
  img.loading = "lazy";
  img.decoding = "async";

  img.addEventListener("load", () => {
    card.classList.remove("loading");
  }, { once: true });

  img.addEventListener("error", () => {
    card.classList.remove("loading");
  }, { once: true });

  // Apply loading state until image loads
  card.classList.add("loading");

  const title = document.createElement("h3");
  title.className = "film-card-title";
  title.textContent = film.title;

  card.append(img, title);
  return card;
}
