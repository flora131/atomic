import { test, expect, beforeEach } from "bun:test";
import { createPartId, _resetPartCounter } from "@/state/parts/id.ts";

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

test("ID format matches expected composite pattern", () => {
  const id = createPartId();
  // Format: part_<12-hex-composite>
  const pattern = /^part_[0-9a-f]{12,}$/;
  expect(pattern.test(id)).toBe(true);
});

test("counter increments within the same millisecond", () => {
  const id1 = createPartId();
  const id2 = createPartId();
  const id3 = createPartId();

  // Extract composite value (everything after "part_")
  const getComposite = (id: string) => BigInt(`0x${id.slice(5)}`);

  const c1 = getComposite(id1);
  const c2 = getComposite(id2);
  const c3 = getComposite(id3);

  // Within the same ms the composite increments by exactly 1
  expect(c2 - c1).toBe(1n);
  expect(c3 - c2).toBe(1n);
});

test("_resetPartCounter resets counter and timestamp", () => {
  createPartId();
  createPartId();
  createPartId();

  _resetPartCounter();

  const id = createPartId();
  // After reset, the counter portion (lowest 12 bits) should be 0
  const composite = BigInt(`0x${id.slice(5)}`);
  expect(composite & BigInt(0xfff)).toBe(0n);
});

test("_resetPartCounter produces deterministic IDs with mocked Date.now", () => {
  const originalNow = Date.now;
  try {
    Date.now = () => 5000;

    // Advance state: create several IDs to move counter forward
    const firstBatch = Array.from({ length: 5 }, () => createPartId());

    _resetPartCounter();

    // After reset, recreating at the same timestamp must reproduce the same IDs
    const secondBatch = Array.from({ length: 5 }, () => createPartId());

    for (let i = 0; i < 5; i++) {
      expect(secondBatch[i]).toBe(firstBatch[i]);
    }
  } finally {
    Date.now = originalNow;
  }
});

test("_resetPartCounter is idempotent", () => {
  const originalNow = Date.now;
  try {
    Date.now = () => 7000;

    createPartId();
    createPartId();

    _resetPartCounter();
    _resetPartCounter(); // double reset

    const id = createPartId();
    const composite = BigInt(`0x${id.slice(5)}`);
    // Timestamp portion should match the mocked time
    expect(Number(composite / BigInt(0x1000))).toBe(7000);
    // Counter should be 0
    expect(composite & BigInt(0xfff)).toBe(0n);
  } finally {
    Date.now = originalNow;
  }
});

test("timestamp is encoded in the composite", () => {
  const beforeTimestamp = Date.now();
  const id = createPartId();
  const afterTimestamp = Date.now();

  // Extract timestamp from composite: composite / 0x1000
  const composite = BigInt(`0x${id.slice(5)}`);
  const decodedTimestamp = Number(composite / BigInt(0x1000));

  expect(decodedTimestamp).toBeGreaterThanOrEqual(beforeTimestamp);
  expect(decodedTimestamp).toBeLessThanOrEqual(afterTimestamp);
});

test("counter resets when millisecond changes", async () => {
  createPartId();
  createPartId();
  createPartId();

  // Wait for the millisecond to tick over
  await new Promise((resolve) => setTimeout(resolve, 2));

  const id = createPartId();
  // Counter should have reset to 0 for the new millisecond
  const composite = BigInt(`0x${id.slice(5)}`);
  expect(composite & BigInt(0xfff)).toBe(0n);
});

test("supports up to 4096 IDs per millisecond", () => {
  // Create many IDs rapidly (all within the same ms)
  const ids = Array.from({ length: 256 }, () => createPartId());

  // All IDs should match the composite format
  ids.forEach((id) => {
    expect(id).toMatch(/^part_[0-9a-f]{12,}$/);
  });

  // The last ID's counter portion should be 255 (0x0ff)
  const lastComposite = BigInt(`0x${ids[255]!.slice(5)}`);
  expect(lastComposite & BigInt(0xfff)).toBe(255n);
});

test("IDs created in different milliseconds maintain chronological order", async () => {
  const id1 = createPartId();

  // Wait at least 1ms to ensure timestamp changes
  await new Promise((resolve) => setTimeout(resolve, 2));

  const id2 = createPartId();

  expect(id1 < id2).toBe(true);
});
