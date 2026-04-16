import { test, expect, describe } from "bun:test";
import { libraryItems, filterTags } from "./library-items.js";

describe("libraryItems data", () => {
  test("has at least 12 library items", () => {
    expect(libraryItems.length).toBeGreaterThanOrEqual(12);
  });

  test("every item has required fields", () => {
    for (const item of libraryItems) {
      expect(item).toHaveProperty("title");
      expect(item).toHaveProperty("description");
      expect(item).toHaveProperty("instructor");
      expect(item).toHaveProperty("category");
      expect(item).toHaveProperty("url");
    }
  });

  test("all fields are non-empty strings", () => {
    for (const item of libraryItems) {
      expect(typeof item.title).toBe("string");
      expect(item.title.length).toBeGreaterThan(0);
      expect(typeof item.description).toBe("string");
      expect(item.description.length).toBeGreaterThan(0);
      expect(typeof item.instructor).toBe("string");
      expect(item.instructor.length).toBeGreaterThan(0);
      expect(typeof item.category).toBe("string");
      expect(item.category.length).toBeGreaterThan(0);
      expect(typeof item.url).toBe("string");
      expect(item.url.length).toBeGreaterThan(0);
    }
  });

  test("all categories are valid filter tags (excluding All)", () => {
    const validCategories = new Set(filterTags.filter(t => t !== "All"));
    for (const item of libraryItems) {
      expect(validCategories.has(item.category)).toBe(true);
    }
  });
});

describe("filterTags", () => {
  test("has exactly 22 tags", () => {
    expect(filterTags).toHaveLength(22);
  });

  test("first tag is All", () => {
    expect(filterTags[0]).toBe("All");
  });

  test("all tags are non-empty strings", () => {
    for (const tag of filterTags) {
      expect(typeof tag).toBe("string");
      expect(tag.length).toBeGreaterThan(0);
    }
  });
});
