import { test, expect, describe } from "bun:test";
import {
  validateCreateItemInput,
  validateUpdateItemInput,
  parseCreateItemInput,
  parseUpdateItemInput,
} from "./types";

describe("validateCreateItemInput", () => {
  test("rejects non-object body", () => {
    const result = validateCreateItemInput("hello");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("body must be an object");
  });

  test("rejects null body", () => {
    const result = validateCreateItemInput(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("body must be an object");
  });

  test("rejects array body", () => {
    const result = validateCreateItemInput([]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("body must be an object");
  });

  test("rejects missing name", () => {
    const result = validateCreateItemInput({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("name must be a non-empty string");
  });

  test("rejects empty name", () => {
    const result = validateCreateItemInput({ name: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("name must be a non-empty string");
  });

  test("rejects whitespace-only name", () => {
    const result = validateCreateItemInput({ name: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("name must be a non-empty string");
  });

  test("rejects non-string name", () => {
    const result = validateCreateItemInput({ name: 42 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("name must be a non-empty string");
  });

  test("rejects non-string description", () => {
    const result = validateCreateItemInput({ name: "foo", description: 123 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("description must be a string");
  });

  test("accepts valid name only, trims it", () => {
    const result = validateCreateItemInput({ name: "  hello  " });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("hello");
      expect(result.value.description).toBeUndefined();
    }
  });

  test("accepts valid name + description", () => {
    const result = validateCreateItemInput({ name: "item", description: "desc" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("item");
      expect(result.value.description).toBe("desc");
    }
  });
});

describe("validateUpdateItemInput", () => {
  test("rejects non-object body", () => {
    const result = validateUpdateItemInput(42);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("body must be an object");
  });

  test("rejects null body", () => {
    const result = validateUpdateItemInput(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("body must be an object");
  });

  test("rejects empty object (no fields)", () => {
    const result = validateUpdateItemInput({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("at least one of name or description must be provided");
  });

  test("rejects non-string name", () => {
    const result = validateUpdateItemInput({ name: 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("name must be a non-empty string");
  });

  test("rejects empty name", () => {
    const result = validateUpdateItemInput({ name: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("name must be a non-empty string");
  });

  test("rejects non-string description", () => {
    const result = validateUpdateItemInput({ description: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("description must be a string");
  });

  test("accepts name only, trims it", () => {
    const result = validateUpdateItemInput({ name: " updated " });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("updated");
      expect(result.value.description).toBeUndefined();
    }
  });

  test("accepts description only", () => {
    const result = validateUpdateItemInput({ description: "new desc" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.description).toBe("new desc");
      expect(result.value.name).toBeUndefined();
    }
  });

  test("accepts both name and description", () => {
    const result = validateUpdateItemInput({ name: "n", description: "d" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("n");
      expect(result.value.description).toBe("d");
    }
  });
});

describe("parseCreateItemInput", () => {
  test("throws on non-object body", () => {
    expect(() => parseCreateItemInput("hello")).toThrow("Invalid request body: body must be an object");
  });

  test("throws on null", () => {
    expect(() => parseCreateItemInput(null)).toThrow("Invalid request body: body must be an object");
  });

  test("throws on array", () => {
    expect(() => parseCreateItemInput([])).toThrow("Invalid request body: body must be an object");
  });

  test("throws on missing name", () => {
    expect(() => parseCreateItemInput({})).toThrow("Invalid request body: name is required");
  });

  test("throws on empty name", () => {
    expect(() => parseCreateItemInput({ name: "" })).toThrow("Invalid request body: name must be a non-empty string");
  });

  test("throws on whitespace-only name", () => {
    expect(() => parseCreateItemInput({ name: "   " })).toThrow("Invalid request body: name must be a non-empty string");
  });

  test("throws on name exceeding 200 chars", () => {
    expect(() => parseCreateItemInput({ name: "a".repeat(201) })).toThrow("Invalid request body: name must not exceed 200 characters");
  });

  test("throws on non-string name", () => {
    expect(() => parseCreateItemInput({ name: 42 })).toThrow("Invalid request body: name must be a non-empty string");
  });

  test("throws on non-string non-null description", () => {
    expect(() => parseCreateItemInput({ name: "foo", description: 123 })).toThrow("Invalid request body: description must be a string or null");
  });

  test("throws on description exceeding 2000 chars", () => {
    expect(() => parseCreateItemInput({ name: "foo", description: "a".repeat(2001) })).toThrow("Invalid request body: description must not exceed 2000 characters");
  });

  test("throws on unknown field", () => {
    expect(() => parseCreateItemInput({ name: "foo", extra: "bar" })).toThrow("Invalid request body: unknown field extra");
  });

  test("returns valid CreateItemInput with trimmed name", () => {
    const result = parseCreateItemInput({ name: "  hello  " });
    expect(result.name).toBe("hello");
    expect(result.description).toBeUndefined();
  });

  test("accepts null description", () => {
    const result = parseCreateItemInput({ name: "foo", description: null });
    expect(result.description).toBeNull();
  });

  test("accepts string description", () => {
    const result = parseCreateItemInput({ name: "foo", description: "desc" });
    expect(result.description).toBe("desc");
  });

  test("name exactly 200 chars is valid", () => {
    const result = parseCreateItemInput({ name: "a".repeat(200) });
    expect(result.name).toBe("a".repeat(200));
  });

  test("description exactly 2000 chars is valid", () => {
    const result = parseCreateItemInput({ name: "foo", description: "a".repeat(2000) });
    expect(result.description).toBe("a".repeat(2000));
  });
});

describe("parseUpdateItemInput", () => {
  test("throws on non-object body", () => {
    expect(() => parseUpdateItemInput(42)).toThrow("Invalid request body: body must be an object");
  });

  test("throws on null", () => {
    expect(() => parseUpdateItemInput(null)).toThrow("Invalid request body: body must be an object");
  });

  test("throws on empty name", () => {
    expect(() => parseUpdateItemInput({ name: "" })).toThrow("Invalid request body: name must be a non-empty string");
  });

  test("throws on name exceeding 200 chars", () => {
    expect(() => parseUpdateItemInput({ name: "a".repeat(201) })).toThrow("Invalid request body: name must not exceed 200 characters");
  });

  test("throws on non-string non-null description", () => {
    expect(() => parseUpdateItemInput({ description: true })).toThrow("Invalid request body: description must be a string or null");
  });

  test("throws on description exceeding 2000 chars", () => {
    expect(() => parseUpdateItemInput({ name: "foo", description: "a".repeat(2001) })).toThrow("Invalid request body: description must not exceed 2000 characters");
  });

  test("throws on unknown field", () => {
    expect(() => parseUpdateItemInput({ name: "foo", weird: 1 })).toThrow("Invalid request body: unknown field weird");
  });

  test("returns valid UpdateItemInput with trimmed name", () => {
    const result = parseUpdateItemInput({ name: " updated " });
    expect(result.name).toBe("updated");
  });

  test("accepts null description", () => {
    const result = parseUpdateItemInput({ description: null });
    expect(result.description).toBeNull();
  });

  test("accepts name and description", () => {
    const result = parseUpdateItemInput({ name: "n", description: "d" });
    expect(result.name).toBe("n");
    expect(result.description).toBe("d");
  });

  test("accepts empty object (no fields required on update)", () => {
    const result = parseUpdateItemInput({});
    expect(result).toEqual({});
  });
});
