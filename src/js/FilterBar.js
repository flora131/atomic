/**
 * FilterBar component.
 * Creates a row of filter category buttons for the library section.
 */

// TODO: Implement active button state and multi-select support
export function createFilterBar(categories, onFilter) {
  const bar = document.createElement('div');
  bar.className = 'filter-bar';

  const allCategories = ['All', ...categories];

  allCategories.forEach((category) => {
    const btn = document.createElement('button');
    btn.className = 'filter-btn';
    btn.textContent = category;
    btn.dataset.category = category;

    btn.addEventListener('click', () => {
      onFilter(category);
    });

    bar.appendChild(btn);
  });

  return bar;
}

export default createFilterBar;
