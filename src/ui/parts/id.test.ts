import { test, expect, beforeEach } from "bun:test";
import { createPartId, _resetPartCounter } from "./id.ts";

beforeEach(() => _resetPartCounter());

test("createPartId returns string starting with part_", () => {
  const id = createPartId();
  expect(id.startsWith("part_")).toBe(true);
});

test("sequential IDs are lexicographically ordered", () => {
  const id1 = createPartId();
  const id2 = createPartId();
  expect(id1 < id2).toBe(true);
});

test("IDs are unique", () => {
  const ids = new Set(Array.from({ length: 100 }, () => createPartId()));
  expect(ids.size).toBe(100);
});

test("ID format matches expected pattern", () => {
  const id = createPartId();
  // Format: part_<12-hex-timestamp>_<4-hex-counter>
  const pattern = /^part_[0-9a-f]{12}_[0-9a-f]{4}$/;
  expect(pattern.test(id)).toBe(true);
});

test("counter increments for each ID", () => {
  const id1 = createPartId();
  const id2 = createPartId();
  const id3 = createPartId();
  
  // Extract counter portion (last 4 hex digits)
  const getCounter = (id: string) => id.slice(-4);
  
  const counter1 = parseInt(getCounter(id1), 16);
  const counter2 = parseInt(getCounter(id2), 16);
  const counter3 = parseInt(getCounter(id3), 16);
  
  expect(counter2).toBe(counter1 + 1);
  expect(counter3).toBe(counter2 + 1);
});

test("_resetPartCounter resets to zero", () => {
  createPartId();
  createPartId();
  createPartId();
  
  _resetPartCounter();
  
  const id = createPartId();
  const counter = parseInt(id.slice(-4), 16);
  expect(counter).toBe(0);
});

test("timestamp is encoded in hex format", () => {
  const beforeTimestamp = Date.now();
  const id = createPartId();
  const afterTimestamp = Date.now();
  
  // Extract timestamp portion (12 hex digits after "part_")
  const timestampHex = id.slice(5, 17);
  const decodedTimestamp = parseInt(timestampHex, 16);
  
  expect(decodedTimestamp).toBeGreaterThanOrEqual(beforeTimestamp);
  expect(decodedTimestamp).toBeLessThanOrEqual(afterTimestamp);
});

test("large counter values are padded correctly", () => {
  _resetPartCounter();
  
  // Create many IDs to test counter padding
  const ids = Array.from({ length: 256 }, () => createPartId());
  
  // All IDs should maintain the same format
  ids.forEach((id) => {
    expect(id).toMatch(/^part_[0-9a-f]{12}_[0-9a-f]{4}$/);
  });
  
  // Last ID should have counter = 255 (0x00ff)
  const lastId = ids[255];
  expect(lastId).toBeDefined();
  const lastCounter = parseInt(lastId!.slice(-4), 16);
  expect(lastCounter).toBe(255);
});

test("IDs created in different milliseconds maintain chronological order", async () => {
  const id1 = createPartId();
  
  // Wait at least 1ms to ensure timestamp changes
  await new Promise((resolve) => setTimeout(resolve, 2));
  
  const id2 = createPartId();
  
  expect(id1 < id2).toBe(true);
});
