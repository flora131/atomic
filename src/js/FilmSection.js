import { films } from "./data/films.js";
import { createFilmCard } from "./FilmCard.js";

/**
 * Renders the film intro paragraph and all 12 film cards.
 * Sets up IntersectionObserver for staggered scroll reveals.
 */
export function initFilmSection() {
  const section = document.getElementById("section-film");
  if (!section) return;

  // Intro paragraph — verbatim from the design brief (markup preserved)
  const intro = section.querySelector(".film-section-intro");
  if (intro) {
    intro.innerHTML = `I got my start lensing shots, crafting character arcs, and punching up story
      for some of the biggest franchises in popular entertainment, including
      <strong>Shrek</strong>, <strong>Madagascar</strong>, and <strong>The Matrix</strong>
      trilogies. Today I collaborate with some of Hollywood's best directors, producers,
      writers, and showrunners to create new stories and new experiences for stage,
      screen, and stream.`;
  }

  const grid = section.querySelector(".film-grid");
  if (!grid) return;

  films.forEach((film, index) => {
    const card = createFilmCard(film, index);
    grid.appendChild(card);
  });

  // IntersectionObserver — staggered scroll reveals
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("revealed");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1 }
  );

  grid.querySelectorAll(".film-card").forEach((card) => observer.observe(card));
}
