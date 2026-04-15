/**
 * LibraryCard component.
 * Creates a single library resource card with title, instructor, and learn more link.
 */

// TODO: Implement category tags display and prerequisites field
export function createLibraryCard(item) {
  const card = document.createElement('div');
  card.className = 'library-card';
  card.dataset.categories = (item.categories || []).join(',');

  const link = document.createElement('a');
  link.href = item.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';

  const title = document.createElement('h3');
  title.textContent = item.title;
  link.appendChild(title);

  const instructor = document.createElement('p');
  instructor.className = 'library-card-instructor';
  instructor.textContent = `Instructor: ${item.instructor}`;
  link.appendChild(instructor);

  const prerequisites = document.createElement('p');
  prerequisites.className = 'library-card-prerequisites';
  prerequisites.textContent = 'Prerequisites: None';
  link.appendChild(prerequisites);

  const learnMore = document.createElement('span');
  learnMore.className = 'library-card-learn-more';
  learnMore.textContent = 'Learn More';
  link.appendChild(learnMore);

  card.appendChild(link);
  return card;
}

export default createLibraryCard;
