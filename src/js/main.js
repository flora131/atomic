/**
 * main.js — entry point.
 * Initializes all modules after the DOM is ready.
 * Order matters: router must be initialized before section modules.
 */

import { initRouter } from "./router.js";
import { initNavbar } from "./Navbar.js";
import { initGalleryGrid } from "./GalleryGrid.js";
import { initLightbox } from "./Lightbox.js";
import { initFilmSection } from "./FilmSection.js";
import { initLibrarySection } from "./LibrarySection.js";
import { initAboutSection } from "./AboutSection.js";
import { initHotlineEmbed } from "./HotlineEmbed.js";

document.addEventListener("DOMContentLoaded", () => {
  // Foundation
  initRouter();
  initNavbar();
  initLightbox();

  // Section content
  initGalleryGrid();
  initFilmSection();
  initLibrarySection();
  initAboutSection();
  initHotlineEmbed();

  // TODO: initParallax() — requestAnimationFrame loop for scroll parallax at 0.4× rate
  // TODO: initBackdropFilterObserver() — add/remove backdrop-filter class as cards enter viewport
});
