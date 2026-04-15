/**
 * LibrarySection component.
 * Creates the library section with heading, intro text, filter bar, and item cards.
 */
import { createFilterBar } from './FilterBar.js';
import { createLibraryCard } from './LibraryCard.js';

// TODO: Implement filtering logic to show/hide cards based on selected category
export function createLibrarySection(items, categories) {
  const section = document.createElement('section');
  section.className = 'library-section';

  const heading = document.createElement('h1');
  heading.textContent = 'Library';
  section.appendChild(heading);

  const intro = document.createElement('p');
  intro.textContent = 'I put together this small athenaeum of courses and resources collected from across the internet. Some of these I\'ve created, others are from other people.';
  section.appendChild(intro);

  const filterBar = createFilterBar(categories, (selectedCategory) => {
    // TODO: filter card visibility based on selectedCategory
  });
  section.appendChild(filterBar);

  const cardList = document.createElement('div');
  cardList.className = 'library-card-list';
  items.forEach((item) => {
    const card = createLibraryCard(item);
    cardList.appendChild(card);
  });
  section.appendChild(cardList);

  return section;
}

export default createLibrarySection;
