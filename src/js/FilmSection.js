/**
 * FilmSection component.
 * Creates the film section with introductory paragraph and film poster grid.
 */
import { createFilmCard } from './FilmCard.js';

// TODO: Implement responsive grid layout matching the design spec
export function createFilmSection(films) {
  const section = document.createElement('section');
  section.className = 'film-section';

  const intro = document.createElement('p');
  intro.className = 'film-intro';
  intro.innerHTML = 'I got my start lensing shots, crafting character arcs, and punching up story for some of the biggest franchises in popular entertainment, including <strong>Shrek</strong>, <strong>Madagascar</strong>, and <strong>The Matrix</strong> trilogies. Today I collaborate with some of Hollywood\'s best directors, producers, writers, and showrunners to create new stories and new experiences for stage, screen, and stream.';
  section.appendChild(intro);

  const grid = document.createElement('div');
  grid.className = 'film-grid';

  films.forEach((film) => {
    const card = createFilmCard(film);
    grid.appendChild(card);
  });

  section.appendChild(grid);
  return section;
}

export default createFilmSection;
