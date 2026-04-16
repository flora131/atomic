import { test, expect, describe } from "bun:test";
import { artworks } from "./artworks.js";

describe("artworks data", () => {
  test("has exactly 45 artworks", () => {
    expect(artworks).toHaveLength(45);
  });

  test("every artwork has required fields", () => {
    for (const artwork of artworks) {
      expect(artwork).toHaveProperty("id");
      expect(artwork).toHaveProperty("title");
      expect(artwork).toHaveProperty("imageUrl");
      expect(artwork).toHaveProperty("route");
    }
  });

  test("ids are sequential starting from 1", () => {
    artworks.forEach((artwork, i) => {
      expect(artwork.id).toBe(i + 1);
    });
  });

  test("all imageUrls are non-empty strings", () => {
    for (const artwork of artworks) {
      expect(typeof artwork.imageUrl).toBe("string");
      expect(artwork.imageUrl.length).toBeGreaterThan(0);
    }
  });

  test("all routes follow #/art/:id pattern", () => {
    for (const artwork of artworks) {
      expect(artwork.route).toMatch(/^#\/art\/\d+$/);
      expect(artwork.route).toBe(`#/art/${artwork.id}`);
    }
  });

  test("all titles are non-empty strings", () => {
    for (const artwork of artworks) {
      expect(typeof artwork.title).toBe("string");
      expect(artwork.title.length).toBeGreaterThan(0);
    }
  });

  test("all imageUrls point to jamesbuckhouse.com", () => {
    for (const artwork of artworks) {
      expect(artwork.imageUrl).toMatch(/^https:\/\/jamesbuckhouse\.com\/images\//);
    }
  });
});
