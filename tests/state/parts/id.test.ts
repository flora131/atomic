import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { createPartId, _resetPartCounter } from "@/state/parts/id.ts";

/** Extract the composite bigint from a PartId string. */
const decodeComposite = (id: string): bigint => BigInt(`0x${id.slice(5)}`);

/** Extract the timestamp portion from a composite value. */
const decodeTimestamp = (composite: bigint): number =>
  Number(composite >> 12n); // equivalent to / 0x1000n

/** Extract the counter portion (lower 12 bits) from a composite value. */
const decodeCounter = (composite: bigint): number =>
  Number(composite & 0xfffn);

beforeEach(() => _resetPartCounter());

// ---------------------------------------------------------------------------
// Basic properties
// ---------------------------------------------------------------------------
describe("basic properties", () => {
  test("returns string starting with part_ prefix", () => {
    const id = createPartId();
    expect(id.startsWith("part_")).toBe(true);
  });

  test("sequential IDs are lexicographically ordered", () => {
    const id1 = createPartId();
    const id2 = createPartId();
    expect(id1 < id2).toBe(true);
  });

  test("100 IDs are all unique", () => {
    const ids = new Set(Array.from({ length: 100 }, () => createPartId()));
    expect(ids.size).toBe(100);
  });

  test("format matches part_<12+ lowercase hex digits>", () => {
    const id = createPartId();
    expect(id).toMatch(/^part_[0-9a-f]{12,}$/);
  });
});

// ---------------------------------------------------------------------------
// Composite encoding — bit layout
// ---------------------------------------------------------------------------
describe("composite encoding", () => {
  let originalNow: typeof Date.now;

  beforeEach(() => {
    originalNow = Date.now;
  });

  afterEach(() => {
    Date.now = originalNow;
  });

  test("encodes timestamp in upper bits and counter in lower 12 bits", () => {
    const ts = 1000;
    Date.now = () => ts;

    const id = createPartId();
    const composite = decodeComposite(id);

    expect(decodeTimestamp(composite)).toBe(ts);
    expect(decodeCounter(composite)).toBe(0);
  });

  test("composite equals timestamp * 0x1000 + counter for known values", () => {
    const ts = 42_000;
    Date.now = () => ts;

    for (let i = 0; i < 10; i++) {
      const id = createPartId();
      const expected = BigInt(ts) * 0x1000n + BigInt(i);
      expect(decodeComposite(id)).toBe(expected);
    }
  });

  test("produces exact hex string for a known timestamp and counter", () => {
    // ts=0x1000 (4096), counter=0 → composite = 0x1000 * 0x1000 + 0 = 0x1000000
    Date.now = () => 0x1000;

    const id = createPartId();
    expect(id).toBe("part_000001000000");
  });

  test("counter occupies exactly the lowest 12 bits", () => {
    Date.now = () => 1;

    // First ID: composite = 1 * 0x1000 + 0 = 0x1000
    const id0 = createPartId();
    expect(decodeComposite(id0)).toBe(0x1000n);

    // Second ID: composite = 1 * 0x1000 + 1 = 0x1001
    const id1 = createPartId();
    expect(decodeComposite(id1)).toBe(0x1001n);
  });

  test("12-bit shift leaves no overlap between timestamp and counter", () => {
    Date.now = () => 0xfff; // max value fitting in 12 bits
    const ids = Array.from({ length: 4096 }, () => createPartId());

    // Counter goes 0..4095 — the max counter is 0xFFF
    const lastComposite = decodeComposite(ids[4095]!);
    // timestamp portion: 0xFFF, counter portion: 0xFFF
    expect(decodeTimestamp(lastComposite)).toBe(0xfff);
    expect(decodeCounter(lastComposite)).toBe(0xfff);

    // The composite should be 0xFFF * 0x1000 + 0xFFF = 0xFFF_FFF
    expect(lastComposite).toBe(0xfff_fffn);
  });

  test("handles real-world timestamps (~1.7 trillion ms)", () => {
    const realTs = 1_742_322_033_163; // 2026-03-18 timestamp
    Date.now = () => realTs;

    const id = createPartId();
    const composite = decodeComposite(id);

    expect(decodeTimestamp(composite)).toBe(realTs);
    expect(decodeCounter(composite)).toBe(0);
    // Verify the ID still matches the format
    expect(id).toMatch(/^part_[0-9a-f]{12,}$/);
  });

  test("zero-pads composites to at least 12 hex characters", () => {
    Date.now = () => 1; // very small timestamp

    const id = createPartId();
    const hex = id.slice(5); // strip "part_"
    expect(hex.length).toBeGreaterThanOrEqual(12);
    expect(hex).toBe("000000001000"); // 1 * 0x1000 = 0x1000
  });

  test("large timestamps produce longer hex strings when needed", () => {
    // 0xFFFFFFFFFFFF = 281_474_976_710_655 — 48 bits max
    Date.now = () => 0xf_ffff_ffff_ff; // fits in ~44 bits
    const id = createPartId();
    const hex = id.slice(5);
    // composite = 0xFFFFFFFFFFF * 0x1000 = 0xFFFFFFFFFFF000 (52 bits → 13 hex chars)
    expect(hex.length).toBeGreaterThanOrEqual(12);
    expect(decodeTimestamp(decodeComposite(id))).toBe(0xf_ffff_ffff_ff);
  });

  test("same-ms composites differ by exactly 1", () => {
    Date.now = () => 5000;

    const ids = Array.from({ length: 5 }, () => createPartId());
    for (let i = 1; i < ids.length; i++) {
      const diff = decodeComposite(ids[i]!) - decodeComposite(ids[i - 1]!);
      expect(diff).toBe(1n);
    }
  });

  test("timestamp is decodable from composite using integer division", () => {
    const ts = 1_700_000_000_000;
    Date.now = () => ts;

    createPartId(); // counter=0
    createPartId(); // counter=1
    const id = createPartId(); // counter=2

    const composite = decodeComposite(id);
    // Integer division by 0x1000 discards the counter bits
    expect(Number(composite / 0x1000n)).toBe(ts);
    // Modulo extracts the counter
    expect(Number(composite % 0x1000n)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Counter reset — per-millisecond behavior
// ---------------------------------------------------------------------------
describe("counter reset", () => {
  let originalNow: typeof Date.now;

  beforeEach(() => {
    originalNow = Date.now;
  });

  afterEach(() => {
    Date.now = originalNow;
  });

  test("counter resets to 0 when timestamp changes", () => {
    let ts = 1000;
    Date.now = () => ts;

    createPartId(); // counter=0
    createPartId(); // counter=1
    createPartId(); // counter=2

    // Advance to next millisecond
    ts = 1001;

    const id = createPartId();
    const composite = decodeComposite(id);
    expect(decodeTimestamp(composite)).toBe(1001);
    expect(decodeCounter(composite)).toBe(0);
  });

  test("counter does NOT reset when timestamp stays the same", () => {
    Date.now = () => 5000;

    createPartId(); // counter=0
    createPartId(); // counter=1

    const id = createPartId(); // counter=2
    expect(decodeCounter(decodeComposite(id))).toBe(2);
  });

  test("counter sequence is 0, 1, 2, ... within a single millisecond", () => {
    Date.now = () => 3000;

    for (let i = 0; i < 20; i++) {
      const id = createPartId();
      expect(decodeCounter(decodeComposite(id))).toBe(i);
    }
  });

  test("counter resets across multiple timestamp transitions", () => {
    let ts = 100;
    Date.now = () => ts;

    // First ms: 3 IDs
    for (let i = 0; i < 3; i++) {
      const id = createPartId();
      expect(decodeCounter(decodeComposite(id))).toBe(i);
    }

    // Second ms: 2 IDs
    ts = 101;
    for (let i = 0; i < 2; i++) {
      const id = createPartId();
      expect(decodeCounter(decodeComposite(id))).toBe(i);
    }

    // Third ms: 4 IDs
    ts = 102;
    for (let i = 0; i < 4; i++) {
      const id = createPartId();
      expect(decodeCounter(decodeComposite(id))).toBe(i);
    }
  });

  test("counter resets even after generating many IDs in previous ms", () => {
    let ts = 8000;
    Date.now = () => ts;

    // Generate 500 IDs at ts=8000
    Array.from({ length: 500 }, () => createPartId());

    // Advance timestamp
    ts = 8001;
    const id = createPartId();
    expect(decodeCounter(decodeComposite(id))).toBe(0);
    expect(decodeTimestamp(decodeComposite(id))).toBe(8001);
  });

  test("supports full 4096 IDs per millisecond", () => {
    Date.now = () => 9000;

    const ids = Array.from({ length: 4096 }, () => createPartId());

    // First ID has counter=0, last has counter=4095
    expect(decodeCounter(decodeComposite(ids[0]!))).toBe(0);
    expect(decodeCounter(decodeComposite(ids[4095]!))).toBe(4095);

    // All have the same timestamp
    for (const id of ids) {
      expect(decodeTimestamp(decodeComposite(id))).toBe(9000);
    }
  });

  test("counter resets when ms changes (real timer)", async () => {
    createPartId();
    createPartId();
    createPartId();

    await new Promise((resolve) => setTimeout(resolve, 2));

    const id = createPartId();
    expect(decodeCounter(decodeComposite(id))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Lexicographic ordering invariants
// ---------------------------------------------------------------------------
describe("lexicographic ordering", () => {
  let originalNow: typeof Date.now;

  beforeEach(() => {
    originalNow = Date.now;
  });

  afterEach(() => {
    Date.now = originalNow;
  });

  test("IDs across different ms are ordered even with high counter in earlier ms", () => {
    let ts = 2000;
    Date.now = () => ts;

    // Generate 100 IDs at ts=2000 (counter goes up to 99)
    const idsEarly = Array.from({ length: 100 }, () => createPartId());

    // Advance to ts=2001
    ts = 2001;
    const idLater = createPartId(); // counter=0 at ts=2001

    // The last ID from ts=2000 (counter=99) must still be < first ID from ts=2001 (counter=0)
    expect(idsEarly[99]! < idLater).toBe(true);
  });

  test("string comparison matches numeric composite comparison", () => {
    Date.now = () => 6000;
    const ids = Array.from({ length: 50 }, () => createPartId());

    // String sort and numeric sort should produce the same order
    const stringSorted = [...ids].sort();
    const numericSorted = [...ids].sort((a, b) => {
      const ca = decodeComposite(a);
      const cb = decodeComposite(b);
      return ca < cb ? -1 : ca > cb ? 1 : 0;
    });

    expect(stringSorted).toEqual(numericSorted);
    // And they should already be in generation order
    expect(stringSorted).toEqual(ids);
  });

  test("IDs maintain order across 10 distinct milliseconds", () => {
    let ts = 10_000;
    Date.now = () => ts;

    const allIds: string[] = [];
    for (let ms = 0; ms < 10; ms++) {
      ts = 10_000 + ms;
      for (let i = 0; i < 5; i++) {
        allIds.push(createPartId());
      }
    }

    // All 50 IDs should be strictly increasing
    for (let i = 1; i < allIds.length; i++) {
      expect(allIds[i - 1]! < allIds[i]!).toBe(true);
    }
  });

  test("IDs across different ms maintain order (real timer)", async () => {
    const id1 = createPartId();
    await new Promise((resolve) => setTimeout(resolve, 2));
    const id2 = createPartId();
    expect(id1 < id2).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// _resetPartCounter utility
// ---------------------------------------------------------------------------
describe("_resetPartCounter", () => {
  let originalNow: typeof Date.now;

  beforeEach(() => {
    originalNow = Date.now;
  });

  afterEach(() => {
    Date.now = originalNow;
  });

  test("resets both counter and timestamp state", () => {
    Date.now = () => 3000;
    createPartId();
    createPartId();
    createPartId();

    _resetPartCounter();

    const id = createPartId();
    const composite = decodeComposite(id);
    expect(decodeCounter(composite)).toBe(0);
  });

  test("produces deterministic IDs with mocked Date.now", () => {
    Date.now = () => 5000;

    const firstBatch = Array.from({ length: 5 }, () => createPartId());

    _resetPartCounter();

    const secondBatch = Array.from({ length: 5 }, () => createPartId());

    for (let i = 0; i < 5; i++) {
      expect(secondBatch[i]).toBe(firstBatch[i]);
    }
  });

  test("is idempotent — double reset produces same result", () => {
    Date.now = () => 7000;

    createPartId();
    createPartId();

    _resetPartCounter();
    _resetPartCounter();

    const id = createPartId();
    const composite = decodeComposite(id);
    expect(decodeTimestamp(composite)).toBe(7000);
    expect(decodeCounter(composite)).toBe(0);
  });

  test("allows new timestamp to be tracked after reset", () => {
    Date.now = () => 1000;
    createPartId(); // establishes lastPartTimestamp = 1000

    _resetPartCounter(); // resets lastPartTimestamp to 0

    Date.now = () => 2000;
    const id = createPartId();
    const composite = decodeComposite(id);
    // Should use the new timestamp, not the old one
    expect(decodeTimestamp(composite)).toBe(2000);
    expect(decodeCounter(composite)).toBe(0);
  });

  test("reset mid-sequence restarts counter from 0 at same timestamp", () => {
    Date.now = () => 4000;

    createPartId(); // counter=0
    createPartId(); // counter=1
    createPartId(); // counter=2

    _resetPartCounter();

    // Same timestamp — counter should restart from 0
    const id = createPartId();
    expect(decodeCounter(decodeComposite(id))).toBe(0);
  });
});
