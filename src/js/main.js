/**
 * Application entry point.
 * Imports all modules and wires the SPA together.
 */
import { artworks } from './data/artworks.js';
import { films } from './data/films.js';
import { libraryItems } from './data/library-items.js';
import { createNavbar } from './Navbar.js';
import { createGalleryGrid } from './GalleryGrid.js';
import { createHotlineEmbed } from './HotlineEmbed.js';
import { createLibrarySection } from './LibrarySection.js';
import { createFilmSection } from './FilmSection.js';
import { createAboutSection } from './AboutSection.js';
import { createFooter } from './Footer.js';
import { initRouter, navigate } from './router.js';

/** All unique library filter categories derived from item data */
const ALL_CATEGORIES = [
  'AI', 'Anatomy', 'Architecture', 'Art', 'Biology', 'Buckhouse',
  'Color', 'Computer Science', 'Dance', 'Design', 'Drawing', 'Film',
  'Game Design', 'History', 'Jobs', 'Music', 'Philosophy', 'Science',
  'Story', 'Tools', 'Typography',
];

// TODO: Implement full app initialization with DOM mounting and route transitions
export function initApp() {
  const app = document.getElementById('app') || document.body;

  const navbar = createNavbar();
  app.appendChild(navbar);

  const main = document.createElement('main');
  main.id = 'main-content';
  app.appendChild(main);

  const footer = createFooter();
  app.appendChild(footer);

  initRouter({
    '#/': () => {
      main.innerHTML = '';
      main.appendChild(createGalleryGrid(artworks));
    },
    '#/design': () => {
      main.innerHTML = '';
      main.appendChild(createHotlineEmbed());
    },
    '#/library': () => {
      main.innerHTML = '';
      main.appendChild(createLibrarySection(libraryItems, ALL_CATEGORIES));
    },
    '#/film': () => {
      main.innerHTML = '';
      main.appendChild(createFilmSection(films));
    },
    '#/about': () => {
      main.innerHTML = '';
      main.appendChild(createAboutSection());
    },
    '#/art/*': () => {
      // TODO: Implement individual artwork detail view
      main.innerHTML = '';
    },
  });
}

export { artworks, films, libraryItems, navigate };

export default initApp;
