import { test, expect, describe } from "bun:test";
import { films } from "./films.js";

describe("films data", () => {
  test("exports exactly 12 film objects", () => {
    expect(films).toHaveLength(12);
  });

  test("every film has id, title, posterUrl, and imdbUrl", () => {
    films.forEach((film, i) => {
      expect(film.id, `film[${i}] missing id`).toBeDefined();
      expect(film.title, `film[${i}] missing title`).toBeDefined();
      expect(film.posterUrl, `film[${i}] missing posterUrl`).toBeDefined();
      expect(film.imdbUrl, `film[${i}] missing imdbUrl`).toBeDefined();
    });
  });

  test("ids are sequential from 1 to 12", () => {
    films.forEach((film, i) => {
      expect(film.id).toBe(i + 1);
    });
  });

  test("all posterUrls point to jamesbuckhouse.com film-posters", () => {
    films.forEach((film) => {
      expect(film.posterUrl).toMatch(/^https:\/\/jamesbuckhouse\.com\/images\/film-posters\//);
    });
  });

  test("all imdbUrls point to imdb.com", () => {
    films.forEach((film) => {
      expect(film.imdbUrl).toMatch(/^https:\/\/www\.imdb\.com\/title\//);
    });
  });

  test("first film is Carmen", () => {
    expect(films[0].title).toBe("Carmen");
    expect(films[0].posterUrl).toBe("https://jamesbuckhouse.com/images/film-posters/carmen.jpg");
    expect(films[0].imdbUrl).toBe("https://www.imdb.com/title/tt6875952/");
  });

  test("last film is The Peacemaker", () => {
    expect(films[11].title).toBe("The Peacemaker");
    expect(films[11].posterUrl).toBe("https://jamesbuckhouse.com/images/film-posters/peacemaker.jpg");
  });
});
