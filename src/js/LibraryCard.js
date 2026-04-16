/**
 * Category color map — maps category name → hex color.
 * These are the original site values desaturated ~15%.
 */
const CATEGORY_COLORS = {
  History:        "#d45800",
  Science:        "#007fb5",
  Biology:        "#00a85a",
  Story:          "#b5006a",
  Architecture:   "#6b00cc",
  Design:         "#cc003e",
  Art:            "#c47700",
  Tools:          "#4a4a4a",
  Film:           "#4500cc",
  Typography:     "#009ea8",
  Anatomy:        "#cc0054",
  Color:          "#009940",
  // Fallback for unlisted categories
  Default:        "#6b6257",
};

/**
 * Parse a hex color to rgb components.
 * @param {string} hex
 * @returns {{ r: number, g: number, b: number }}
 */
function hexToRgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * Factory for a single library card DOM element.
 *
 * @param {{ title: string, description: string, instructor: string, category: string, url: string }} item
 * @param {number} index
 * @returns {HTMLElement}
 */
export function createLibraryCard(item, index) {
  const color = CATEGORY_COLORS[item.category] ?? CATEGORY_COLORS.Default;
  const { r, g, b } = hexToRgb(color);

  const card = document.createElement("article");
  card.className = "library-card reveal-ready";
  card.style.transitionDelay = `${index * 40}ms`;

  // Category pill badge (upper-right) — NOT a border-left stripe
  const badge = document.createElement("span");
  badge.className = "library-card-badge";
  badge.textContent = item.category;
  badge.style.color = color;
  badge.style.backgroundColor = `rgba(${r}, ${g}, ${b}, 0.12)`;

  const title = document.createElement("h3");
  title.className = "library-card-title";
  title.textContent = item.title;

  const description = document.createElement("p");
  description.className = "library-card-description";
  description.textContent = item.description;

  const instructor = document.createElement("p");
  instructor.className = "library-card-instructor";
  instructor.textContent = item.instructor;

  const link = document.createElement("a");
  link.className = "library-card-link";
  link.href = item.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Learn More";
  link.style.backgroundColor = `rgba(${r}, ${g}, ${b}, 0.10)`;

  card.append(badge, title, description, instructor, link);
  return card;
}
