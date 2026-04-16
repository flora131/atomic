import { test, expect, describe } from "bun:test";
import { films } from "./films.js";

describe("films data", () => {
  test("has exactly 12 films", () => {
    expect(films).toHaveLength(12);
  });

  test("every film has required fields", () => {
    for (const film of films) {
      expect(film).toHaveProperty("title");
      expect(film).toHaveProperty("posterUrl");
      expect(film).toHaveProperty("imdbUrl");
    }
  });

  test("all titles are non-empty strings", () => {
    for (const film of films) {
      expect(typeof film.title).toBe("string");
      expect(film.title.length).toBeGreaterThan(0);
    }
  });

  test("all posterUrls point to jamesbuckhouse.com film-posters", () => {
    for (const film of films) {
      expect(film.posterUrl).toMatch(/^https:\/\/jamesbuckhouse\.com\/images\/film-posters\//);
    }
  });

  test("all imdbUrls point to imdb.com", () => {
    for (const film of films) {
      expect(film.imdbUrl).toMatch(/^https:\/\/www\.imdb\.com\/title\//);
    }
  });

  test("all posterUrls are non-empty strings", () => {
    for (const film of films) {
      expect(typeof film.posterUrl).toBe("string");
      expect(film.posterUrl.length).toBeGreaterThan(0);
    }
  });
});
