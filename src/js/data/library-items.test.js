import { test, expect, describe } from "bun:test";
import { libraryItems } from "./library-items.js";

describe("libraryItems data", () => {
  test("exports exactly 64 library item objects", () => {
    expect(libraryItems).toHaveLength(64);
  });

  test("every item has id, title, instructor, url, and categories", () => {
    libraryItems.forEach((item, i) => {
      expect(item.id, `item[${i}] missing id`).toBeDefined();
      expect(item.title, `item[${i}] missing title`).toBeDefined();
      expect(item.instructor, `item[${i}] missing instructor`).toBeDefined();
      expect(item.url, `item[${i}] missing url`).toBeDefined();
      expect(item.categories, `item[${i}] missing categories`).toBeDefined();
    });
  });

  test("ids are sequential from 1 to 64", () => {
    libraryItems.forEach((item, i) => {
      expect(item.id).toBe(i + 1);
    });
  });

  test("categories is always a non-empty array", () => {
    libraryItems.forEach((item, i) => {
      expect(Array.isArray(item.categories), `item[${i}] categories should be an array`).toBe(true);
      expect(item.categories.length, `item[${i}] categories should not be empty`).toBeGreaterThan(0);
    });
  });

  test("all urls are valid http/https URLs", () => {
    libraryItems.forEach((item, i) => {
      expect(item.url, `item[${i}] url should start with http`).toMatch(/^https?:\/\//);
    });
  });

  test("James Buckhouse items include 'Buckhouse' in their categories", () => {
    const buckhouseItems = libraryItems.filter((item) => item.instructor === "James Buckhouse");
    buckhouseItems.forEach((item) => {
      expect(item.categories, `"${item.title}" by Buckhouse should have Buckhouse category`).toContain("Buckhouse");
    });
  });

  test("first item is Omens Oracles & Prophecies by Alyssa Goodman", () => {
    expect(libraryItems[0].title).toBe("Omens Oracles & Prophecies");
    expect(libraryItems[0].instructor).toBe("Alyssa Goodman");
  });

  test("last item is Beginner React Nav Bar Tutorial", () => {
    expect(libraryItems[63].title).toBe("Beginner React Nav Bar Tutorial");
    expect(libraryItems[63].instructor).toBe("James Buckhouse");
  });

  test("item #25 'Your Job is Story' is by James Buckhouse with Story category", () => {
    const item = libraryItems[24]; // id: 25, index: 24
    expect(item.id).toBe(25);
    expect(item.title).toBe("Your Job is Story");
    expect(item.instructor).toBe("James Buckhouse");
    expect(item.categories).toContain("Story");
    expect(item.categories).toContain("Buckhouse");
  });
});
