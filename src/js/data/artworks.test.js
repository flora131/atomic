import { test, expect, describe } from "bun:test";
import { artworks } from "./artworks.js";

describe("artworks data", () => {
  test("exports exactly 45 artwork objects", () => {
    expect(artworks).toHaveLength(45);
  });

  test("every artwork has id, title, imageUrl, and route", () => {
    artworks.forEach((artwork, i) => {
      expect(artwork.id, `artwork[${i}] missing id`).toBeDefined();
      expect(artwork.title, `artwork[${i}] missing title`).toBeDefined();
      expect(artwork.imageUrl, `artwork[${i}] missing imageUrl`).toBeDefined();
      expect(artwork.route, `artwork[${i}] missing route`).toBeDefined();
    });
  });

  test("ids are sequential from 1 to 45", () => {
    artworks.forEach((artwork, i) => {
      expect(artwork.id).toBe(i + 1);
    });
  });

  test("all imageUrls point to jamesbuckhouse.com", () => {
    artworks.forEach((artwork) => {
      expect(artwork.imageUrl).toMatch(/^https:\/\/jamesbuckhouse\.com\/images\//);
    });
  });

  test("all routes follow #/art/{id} pattern", () => {
    artworks.forEach((artwork) => {
      expect(artwork.route).toBe(`#/art/${artwork.id}`);
    });
  });

  test("artwork #1 has a videoUrl for Maryon Park Installation View", () => {
    const first = artworks[0];
    expect(first.title).toBe("Maryon Park Installation View");
    expect(first.videoUrl).toBe("https://jamesbuckhouse.com/images/video/mayron_install.mp4");
  });

  test("artworks without videoUrl do not have that property set", () => {
    const artworksWithoutVideo = artworks.filter((a) => a.id !== 1);
    artworksWithoutVideo.forEach((artwork) => {
      expect(artwork.videoUrl).toBeUndefined();
    });
  });

  test("first artwork is Maryon Park Installation View", () => {
    expect(artworks[0].title).toBe("Maryon Park Installation View");
    expect(artworks[0].imageUrl).toBe("https://jamesbuckhouse.com/images/image_66.jpg");
  });

  test("last artwork is Drawing Table", () => {
    expect(artworks[44].title).toBe("Drawing Table");
    expect(artworks[44].imageUrl).toBe("https://jamesbuckhouse.com/images/image_54.jpg");
  });
});
