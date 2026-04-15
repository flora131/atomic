/**
 * FilmCard component.
 * Creates a single film poster card linking to IMDB.
 */

// TODO: Implement hover effects and accessibility attributes
export function createFilmCard(film) {
  const a = document.createElement('a');
  a.href = film.imdbUrl;
  a.className = 'film-card';
  a.target = '_blank';
  a.rel = 'noopener noreferrer';

  const img = document.createElement('img');
  img.src = film.posterUrl;
  img.alt = `${film.title} poster`;
  a.appendChild(img);

  const title = document.createElement('h3');
  title.textContent = film.title;
  a.appendChild(title);

  return a;
}

export default createFilmCard;
