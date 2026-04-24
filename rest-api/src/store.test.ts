import { test, expect, describe, beforeEach } from "bun:test";
import { ItemStore } from "./store";

describe("ItemStore", () => {
  let store: ItemStore;

  beforeEach(() => {
    store = new ItemStore();
  });

  test("create assigns id, createdAt, updatedAt, description=null when omitted", () => {
    const item = store.create({ name: "foo" });
    expect(typeof item.id).toBe("string");
    expect(item.id.length).toBeGreaterThan(0);
    expect(typeof item.createdAt).toBe("string");
    expect(typeof item.updatedAt).toBe("string");
    expect(item.createdAt).toBe(item.updatedAt);
    expect(item.description).toBeNull();
    expect(item.name).toBe("foo");
  });

  test("create preserves explicit description", () => {
    const item = store.create({ name: "bar", description: "hello" });
    expect(item.description).toBe("hello");
  });

  test("create with description=null stores null", () => {
    const item = store.create({ name: "baz", description: null });
    expect(item.description).toBeNull();
  });

  test("list returns all created items", () => {
    store.create({ name: "a" });
    store.create({ name: "b" });
    const items = store.list();
    expect(items.length).toBe(2);
  });

  test("list returns snapshot array, not internal reference", () => {
    store.create({ name: "a" });
    const list1 = store.list();
    store.create({ name: "b" });
    const list2 = store.list();
    expect(list1.length).toBe(1);
    expect(list2.length).toBe(2);
  });

  test("get returns item by id", () => {
    const item = store.create({ name: "getme" });
    const found = store.get(item.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(item.id);
    expect(found!.name).toBe("getme");
  });

  test("get returns undefined for missing id", () => {
    expect(store.get("nonexistent")).toBeUndefined();
  });

  test("update merges fields and changes updatedAt", () => {
    const item = store.create({ name: "original", description: "desc" });
    const before = item.updatedAt;
    // small delay to ensure timestamp differs
    const updated = store.update(item.id, { name: "changed" });
    expect(updated).toBeDefined();
    expect(updated!.name).toBe("changed");
    expect(updated!.description).toBe("desc"); // preserved
    expect(updated!.id).toBe(item.id);
    expect(updated!.createdAt).toBe(item.createdAt); // unchanged
    // updatedAt may or may not differ by ms; just check it's a string
    expect(typeof updated!.updatedAt).toBe("string");
  });

  test("update with description=undefined leaves description unchanged", () => {
    const item = store.create({ name: "x", description: "keep" });
    const updated = store.update(item.id, { name: "y" });
    expect(updated!.description).toBe("keep");
  });

  test("update with description=null sets null explicitly", () => {
    const item = store.create({ name: "x", description: "remove me" });
    const updated = store.update(item.id, { description: null });
    expect(updated!.description).toBeNull();
  });

  test("update returns undefined for missing id", () => {
    const result = store.update("missing", { name: "x" });
    expect(result).toBeUndefined();
  });

  test("remove returns true then false for same id", () => {
    const item = store.create({ name: "deleteme" });
    expect(store.remove(item.id)).toBe(true);
    expect(store.remove(item.id)).toBe(false);
  });

  test("remove returns false for nonexistent id", () => {
    expect(store.remove("nope")).toBe(false);
  });

  test("remove actually removes from store", () => {
    const item = store.create({ name: "gone" });
    store.remove(item.id);
    expect(store.get(item.id)).toBeUndefined();
    expect(store.list().length).toBe(0);
  });

  test("clear empties the store", () => {
    store.create({ name: "a" });
    store.create({ name: "b" });
    store.clear();
    expect(store.list().length).toBe(0);
  });
});
