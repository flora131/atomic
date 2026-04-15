import { test, expect, describe } from "bun:test";

describe("module export signatures", () => {
  test("Navbar exports createNavbar function", async () => {
    const mod = await import("./Navbar.js");
    expect(typeof mod.createNavbar).toBe("function");
  });

  test("GalleryGrid exports createGalleryGrid function", async () => {
    const mod = await import("./GalleryGrid.js");
    expect(typeof mod.createGalleryGrid).toBe("function");
  });

  test("ArtworkCard exports createArtworkCard function", async () => {
    const mod = await import("./ArtworkCard.js");
    expect(typeof mod.createArtworkCard).toBe("function");
  });

  test("Lightbox exports openLightbox and closeLightbox functions", async () => {
    const mod = await import("./Lightbox.js");
    expect(typeof mod.openLightbox).toBe("function");
    expect(typeof mod.closeLightbox).toBe("function");
  });

  test("HotlineEmbed exports createHotlineEmbed function", async () => {
    const mod = await import("./HotlineEmbed.js");
    expect(typeof mod.createHotlineEmbed).toBe("function");
  });

  test("LibrarySection exports createLibrarySection function", async () => {
    const mod = await import("./LibrarySection.js");
    expect(typeof mod.createLibrarySection).toBe("function");
  });

  test("LibraryCard exports createLibraryCard function", async () => {
    const mod = await import("./LibraryCard.js");
    expect(typeof mod.createLibraryCard).toBe("function");
  });

  test("FilterBar exports createFilterBar function", async () => {
    const mod = await import("./FilterBar.js");
    expect(typeof mod.createFilterBar).toBe("function");
  });

  test("FilmSection exports createFilmSection function", async () => {
    const mod = await import("./FilmSection.js");
    expect(typeof mod.createFilmSection).toBe("function");
  });

  test("FilmCard exports createFilmCard function", async () => {
    const mod = await import("./FilmCard.js");
    expect(typeof mod.createFilmCard).toBe("function");
  });

  test("AboutSection exports createAboutSection function", async () => {
    const mod = await import("./AboutSection.js");
    expect(typeof mod.createAboutSection).toBe("function");
  });

  test("Footer exports createFooter function", async () => {
    const mod = await import("./Footer.js");
    expect(typeof mod.createFooter).toBe("function");
  });

  test("router exports initRouter and navigate functions", async () => {
    const mod = await import("./router.js");
    expect(typeof mod.initRouter).toBe("function");
    expect(typeof mod.navigate).toBe("function");
  });

  test("main exports initApp function", async () => {
    const mod = await import("./main.js");
    expect(typeof mod.initApp).toBe("function");
  });
});
