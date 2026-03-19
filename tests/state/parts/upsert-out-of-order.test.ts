import { beforeEach, describe, expect, test } from "bun:test";
import { upsertPart, binarySearchById } from "@/state/parts/store.ts";
import { createPartId, _resetPartCounter } from "@/state/parts/id.ts";
import type {
  Part,
  TextPart,
  ReasoningPart,
  ToolPart,
} from "@/state/parts/types.ts";
import type { PartId } from "@/state/parts/id.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a deterministic PartId from a numeric value (zero-padded hex). */
function id(n: number): PartId {
  const composite = BigInt(n);
  return `part_${composite.toString(16).padStart(12, "0")}` as PartId;
}

function makeText(content: string, partId: PartId): TextPart {
  return {
    id: partId,
    type: "text",
    content,
    isStreaming: false,
    createdAt: new Date().toISOString(),
  };
}

function makeReasoning(content: string, partId: PartId): ReasoningPart {
  return {
    id: partId,
    type: "reasoning",
    content,
    durationMs: 100,
    isStreaming: false,
    createdAt: new Date().toISOString(),
  };
}

function makeTool(
  toolCallId: string,
  partId: PartId,
  status: "pending" | "running" | "completed" = "running",
): ToolPart {
  return {
    id: partId,
    type: "tool",
    toolCallId,
    toolName: "bash",
    input: { command: "echo test" },
    state:
      status === "completed"
        ? { status: "completed", output: "ok", durationMs: 50 }
        : status === "running"
          ? { status: "running", startedAt: new Date().toISOString() }
          : { status: "pending" },
    createdAt: new Date().toISOString(),
  };
}

/** Assert the array is sorted by ID (lexicographic ascending). */
function expectSorted(parts: ReadonlyArray<Part>): void {
  for (let i = 1; i < parts.length; i++) {
    expect(parts[i]!.id > parts[i - 1]!.id).toBe(true);
  }
}

/** Extract content strings for quick comparison. */
function contents(parts: ReadonlyArray<Part>): string[] {
  return parts.map((p) => {
    if (p.type === "text" || p.type === "reasoning") return p.content;
    if (p.type === "tool") return p.toolCallId;
    return p.type;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => _resetPartCounter());

describe("upsertPart — out-of-order insertion edge cases", () => {
  // -----------------------------------------------------------------------
  // 1. Complete reverse insertion
  // -----------------------------------------------------------------------
  test("fully reversed insertion order sorts correctly", () => {
    const parts: Part[] = [];
    const items = [
      makeText("e", id(5)),
      makeText("d", id(4)),
      makeText("c", id(3)),
      makeText("b", id(2)),
      makeText("a", id(1)),
    ];

    let result: Part[] = parts;
    for (const item of items) {
      result = upsertPart(result, item);
    }

    expect(result).toHaveLength(5);
    expectSorted(result);
    expect(contents(result)).toEqual(["a", "b", "c", "d", "e"]);
  });

  // -----------------------------------------------------------------------
  // 2. Interleaved insertion
  // -----------------------------------------------------------------------
  test("interleaved IDs (1, 5, 3, 2, 4) end up sorted", () => {
    let result: Part[] = [];
    result = upsertPart(result, makeText("one", id(1)));
    result = upsertPart(result, makeText("five", id(5)));
    result = upsertPart(result, makeText("three", id(3)));
    result = upsertPart(result, makeText("two", id(2)));
    result = upsertPart(result, makeText("four", id(4)));

    expect(result).toHaveLength(5);
    expectSorted(result);
    expect(contents(result)).toEqual(["one", "two", "three", "four", "five"]);
  });

  // -----------------------------------------------------------------------
  // 3. Gap-filling — insert between existing parts
  // -----------------------------------------------------------------------
  test("filling gaps between sparsely spaced IDs", () => {
    let result: Part[] = [];
    // Insert endpoints first
    result = upsertPart(result, makeText("first", id(100)));
    result = upsertPart(result, makeText("last", id(500)));
    expect(result).toHaveLength(2);

    // Fill middle gaps
    result = upsertPart(result, makeText("mid", id(300)));
    result = upsertPart(result, makeText("low-mid", id(200)));
    result = upsertPart(result, makeText("high-mid", id(400)));

    expect(result).toHaveLength(5);
    expectSorted(result);
    expect(contents(result)).toEqual([
      "first",
      "low-mid",
      "mid",
      "high-mid",
      "last",
    ]);
  });

  // -----------------------------------------------------------------------
  // 4. Adjacent counter values within the same millisecond
  // -----------------------------------------------------------------------
  test("adjacent counter values (same ms) maintain sort after out-of-order insert", () => {
    // Simulate IDs from same millisecond: timestamp * 0x1000 + counter
    const baseTs = 1710000000000;
    const makeComposite = (counter: number) =>
      id(Number(BigInt(baseTs) * BigInt(0x1000) + BigInt(counter)));

    let result: Part[] = [];
    // Insert counter=3, then 1, then 2, then 0
    result = upsertPart(result, makeText("c3", makeComposite(3)));
    result = upsertPart(result, makeText("c1", makeComposite(1)));
    result = upsertPart(result, makeText("c2", makeComposite(2)));
    result = upsertPart(result, makeText("c0", makeComposite(0)));

    expect(result).toHaveLength(4);
    expectSorted(result);
    expect(contents(result)).toEqual(["c0", "c1", "c2", "c3"]);
  });

  // -----------------------------------------------------------------------
  // 5. Cross-millisecond boundary — parts from two different ms batches
  // -----------------------------------------------------------------------
  test("parts from different milliseconds inserted out of order", () => {
    const ts1 = 1710000000000;
    const ts2 = 1710000000001;
    const comp = (ts: number, ctr: number) =>
      id(Number(BigInt(ts) * BigInt(0x1000) + BigInt(ctr)));

    let result: Part[] = [];
    // Insert ms2 parts first, then ms1 parts
    result = upsertPart(result, makeText("ms2-c0", comp(ts2, 0)));
    result = upsertPart(result, makeText("ms2-c1", comp(ts2, 1)));
    result = upsertPart(result, makeText("ms1-c0", comp(ts1, 0)));
    result = upsertPart(result, makeText("ms1-c1", comp(ts1, 1)));

    expect(result).toHaveLength(4);
    expectSorted(result);
    // ms1 parts sort before ms2 parts
    expect(contents(result)).toEqual(["ms1-c0", "ms1-c1", "ms2-c0", "ms2-c1"]);
  });

  // -----------------------------------------------------------------------
  // 6. Mixed part types inserted out of order
  // -----------------------------------------------------------------------
  test("mixed types (text, reasoning, tool) inserted out of order stay sorted", () => {
    let result: Part[] = [];
    result = upsertPart(result, makeTool("tool_1", id(4)));
    result = upsertPart(result, makeReasoning("think", id(1)));
    result = upsertPart(result, makeText("hello", id(3)));
    result = upsertPart(result, makeTool("tool_0", id(2)));

    expect(result).toHaveLength(4);
    expectSorted(result);
    expect(result[0]!.type).toBe("reasoning");
    expect(result[1]!.type).toBe("tool");
    expect(result[2]!.type).toBe("text");
    expect(result[3]!.type).toBe("tool");
  });

  // -----------------------------------------------------------------------
  // 7. Update after out-of-order insertion preserves position
  // -----------------------------------------------------------------------
  test("updating a part inserted out of order keeps it in correct position", () => {
    let result: Part[] = [];
    // Insert out of order: 3, 1, 2
    result = upsertPart(result, makeText("c", id(3)));
    result = upsertPart(result, makeText("a", id(1)));
    result = upsertPart(result, makeText("b", id(2)));

    expect(contents(result)).toEqual(["a", "b", "c"]);

    // Update the middle part (id=2) — should stay at index 1
    const updated = makeText("B-UPDATED", id(2));
    result = upsertPart(result, updated);

    expect(result).toHaveLength(3);
    expectSorted(result);
    expect(contents(result)).toEqual(["a", "B-UPDATED", "c"]);
  });

  // -----------------------------------------------------------------------
  // 8. Duplicate ID insertion replaces, never creates a second entry
  // -----------------------------------------------------------------------
  test("duplicate IDs always replace, never duplicate", () => {
    const partId = id(42);
    let result: Part[] = [];

    result = upsertPart(result, makeText("v1", partId));
    result = upsertPart(result, makeText("v2", partId));
    result = upsertPart(result, makeText("v3", partId));

    expect(result).toHaveLength(1);
    expect((result[0] as TextPart).content).toBe("v3");
  });

  // -----------------------------------------------------------------------
  // 9. Duplicate IDs interspersed with other inserts
  // -----------------------------------------------------------------------
  test("repeated upserts on same ID interspersed with other inserts", () => {
    const sharedId = id(5);
    let result: Part[] = [];

    result = upsertPart(result, makeText("a", id(1)));
    result = upsertPart(result, makeText("first-version", sharedId));
    result = upsertPart(result, makeText("c", id(10)));
    result = upsertPart(result, makeText("second-version", sharedId));
    result = upsertPart(result, makeText("d", id(3)));
    result = upsertPart(result, makeText("third-version", sharedId));

    expect(result).toHaveLength(4);
    expectSorted(result);
    // The part at id(5) should have the latest content
    const target = result.find((p) => p.id === sharedId) as TextPart;
    expect(target.content).toBe("third-version");
  });

  // -----------------------------------------------------------------------
  // 10. Large-scale random order insertion
  // -----------------------------------------------------------------------
  test("100 parts inserted in random order are fully sorted", () => {
    const count = 100;
    const indices = Array.from({ length: count }, (_, i) => i + 1);

    // Fisher-Yates shuffle with deterministic seed behavior
    const shuffled = [...indices];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = (i * 7 + 3) % (i + 1); // deterministic pseudo-shuffle
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }

    let result: Part[] = [];
    for (const n of shuffled) {
      result = upsertPart(result, makeText(`item-${n}`, id(n)));
    }

    expect(result).toHaveLength(count);
    expectSorted(result);

    // Verify all items present in ascending order
    for (let i = 0; i < count; i++) {
      expect(result[i]!.id).toBe(id(i + 1));
    }
  });

  // -----------------------------------------------------------------------
  // 11. Single element — insert before and after
  // -----------------------------------------------------------------------
  test("insert before sole element", () => {
    let result: Part[] = [makeText("existing", id(10))];
    result = upsertPart(result, makeText("before", id(5)));

    expect(result).toHaveLength(2);
    expectSorted(result);
    expect(contents(result)).toEqual(["before", "existing"]);
  });

  test("insert after sole element", () => {
    let result: Part[] = [makeText("existing", id(5))];
    result = upsertPart(result, makeText("after", id(10)));

    expect(result).toHaveLength(2);
    expectSorted(result);
    expect(contents(result)).toEqual(["existing", "after"]);
  });

  // -----------------------------------------------------------------------
  // 12. createPartId()-generated IDs in reversed insertion order
  // -----------------------------------------------------------------------
  test("createPartId()-generated parts inserted in reverse stay sorted", () => {
    // Generate IDs in order, then insert in reverse
    const partsInOrder = Array.from({ length: 6 }, (_, i) =>
      makeText(`p${i}`, createPartId()),
    );
    const reversed = [...partsInOrder].reverse();

    let result: Part[] = [];
    for (const p of reversed) {
      result = upsertPart(result, p);
    }

    expect(result).toHaveLength(6);
    expectSorted(result);
    // First generated ID should be first in sorted output
    expect(result[0]!.id).toBe(partsInOrder[0]!.id);
    expect(result[5]!.id).toBe(partsInOrder[5]!.id);
  });

  // -----------------------------------------------------------------------
  // 13. Alternating high-low insertion pattern
  // -----------------------------------------------------------------------
  test("alternating high-low insertion (1, 10, 2, 9, 3, 8, …)", () => {
    const order = [1, 10, 2, 9, 3, 8, 4, 7, 5, 6];
    let result: Part[] = [];

    for (const n of order) {
      result = upsertPart(result, makeText(`v${n}`, id(n)));
    }

    expect(result).toHaveLength(10);
    expectSorted(result);
    expect(contents(result)).toEqual(
      Array.from({ length: 10 }, (_, i) => `v${i + 1}`),
    );
  });

  // -----------------------------------------------------------------------
  // 14. Insert-update-insert cycle on boundaries
  // -----------------------------------------------------------------------
  test("insert-update-insert cycle at array boundaries", () => {
    let result: Part[] = [];

    // Insert middle
    result = upsertPart(result, makeText("mid", id(50)));
    // Insert at start
    result = upsertPart(result, makeText("start", id(10)));
    // Update start
    result = upsertPart(result, makeText("START-v2", id(10)));
    // Insert at end
    result = upsertPart(result, makeText("end", id(90)));
    // Update end
    result = upsertPart(result, makeText("END-v2", id(90)));
    // Update middle
    result = upsertPart(result, makeText("MID-v2", id(50)));

    expect(result).toHaveLength(3);
    expectSorted(result);
    expect(contents(result)).toEqual(["START-v2", "MID-v2", "END-v2"]);
  });

  // -----------------------------------------------------------------------
  // 15. Immutability — original array is never mutated
  // -----------------------------------------------------------------------
  test("original array and its elements are never mutated", () => {
    const original: Part[] = [
      makeText("a", id(1)),
      makeText("c", id(3)),
    ];
    const originalCopy = [...original];
    const originalIds = original.map((p) => p.id);

    // Out-of-order insert into middle
    const result = upsertPart(original, makeText("b", id(2)));

    // Original untouched
    expect(original).toHaveLength(2);
    expect(original[0]!.id).toBe(originalIds[0]!);
    expect(original[1]!.id).toBe(originalIds[1]!);
    expect(original).toEqual(originalCopy);

    // Result is correct
    expect(result).toHaveLength(3);
    expectSorted(result);
  });

  // -----------------------------------------------------------------------
  // 16. Streaming part update after out-of-order insert
  // -----------------------------------------------------------------------
  test("streaming text part updated in-place after out-of-order insert", () => {
    let result: Part[] = [];

    // Tool arrives first (higher ID)
    result = upsertPart(result, makeTool("tool_1", id(20)));
    // Then a streaming text arrives with a lower ID (out of order)
    const streamingPart: TextPart = {
      ...makeText("Hello", id(10)),
      isStreaming: true,
    };
    result = upsertPart(result, streamingPart);

    expect(result).toHaveLength(2);
    expect(result[0]!.type).toBe("text");
    expect((result[0] as TextPart).isStreaming).toBe(true);

    // Append more content to streaming part (same ID)
    const appended: TextPart = {
      ...streamingPart,
      content: "Hello, world!",
    };
    result = upsertPart(result, appended);

    expect(result).toHaveLength(2);
    expectSorted(result);
    expect((result[0] as TextPart).content).toBe("Hello, world!");
    expect((result[0] as TextPart).isStreaming).toBe(true);

    // Finalize streaming
    const finalized: TextPart = {
      ...appended,
      isStreaming: false,
    };
    result = upsertPart(result, finalized);

    expect(result).toHaveLength(2);
    expectSorted(result);
    expect((result[0] as TextPart).isStreaming).toBe(false);
    expect((result[0] as TextPart).content).toBe("Hello, world!");
  });

  // -----------------------------------------------------------------------
  // 17. Type change on same ID (replace text with reasoning)
  // -----------------------------------------------------------------------
  test("replacing part type via same ID preserves sort position", () => {
    let result: Part[] = [];
    result = upsertPart(result, makeText("a", id(1)));
    result = upsertPart(result, makeText("placeholder", id(2)));
    result = upsertPart(result, makeText("c", id(3)));

    // Replace the middle text with a reasoning part using the same ID
    result = upsertPart(result, makeReasoning("thinking...", id(2)));

    expect(result).toHaveLength(3);
    expectSorted(result);
    expect(result[1]!.type).toBe("reasoning");
    expect((result[1] as ReasoningPart).content).toBe("thinking...");
  });

  // -----------------------------------------------------------------------
  // 18. Rapid sequential createPartId() — ensures counter-based ordering
  // -----------------------------------------------------------------------
  test("rapid sequential createPartId() calls produce sortable IDs when inserted out of order", () => {
    // Generate many IDs rapidly (likely same ms → counter-differentiated)
    const generated: Part[] = [];
    for (let i = 0; i < 20; i++) {
      generated.push(makeText(`rapid-${i}`, createPartId()));
    }

    // Insert every other part first, then the rest (interleaved out-of-order)
    const evens = generated.filter((_, i) => i % 2 === 0);
    const odds = generated.filter((_, i) => i % 2 === 1);

    let result: Part[] = [];
    for (const p of odds) result = upsertPart(result, p);
    for (const p of evens) result = upsertPart(result, p);

    expect(result).toHaveLength(20);
    expectSorted(result);

    // The original generation order should match the sorted order
    for (let i = 0; i < 20; i++) {
      expect(result[i]!.id).toBe(generated[i]!.id);
    }
  });

  // -----------------------------------------------------------------------
  // 19. binarySearchById returns correct insertion point after out-of-order ops
  // -----------------------------------------------------------------------
  test("binarySearchById finds correct index after out-of-order inserts", () => {
    let result: Part[] = [];
    result = upsertPart(result, makeText("c", id(30)));
    result = upsertPart(result, makeText("a", id(10)));
    result = upsertPart(result, makeText("b", id(20)));

    // Search for each existing ID
    expect(binarySearchById(result, id(10))).toBe(0);
    expect(binarySearchById(result, id(20))).toBe(1);
    expect(binarySearchById(result, id(30))).toBe(2);

    // Search for non-existing ID between existing ones
    const missIdx = binarySearchById(result, id(15));
    expect(missIdx).toBeLessThan(0);
    expect(~missIdx).toBe(1); // should insert between id(10) and id(20)
  });

  // -----------------------------------------------------------------------
  // 20. Worst-case descending order with updates interleaved
  // -----------------------------------------------------------------------
  test("descending insertion with interleaved updates", () => {
    let result: Part[] = [];

    // Insert in descending order
    result = upsertPart(result, makeText("e-v1", id(5)));
    result = upsertPart(result, makeText("d-v1", id(4)));
    result = upsertPart(result, makeText("c-v1", id(3)));

    // Update the last-inserted (which is now at index 0)
    result = upsertPart(result, makeText("c-v2", id(3)));

    // Continue descending insertion
    result = upsertPart(result, makeText("b-v1", id(2)));
    result = upsertPart(result, makeText("a-v1", id(1)));

    // Update a middle element
    result = upsertPart(result, makeText("d-v2", id(4)));

    expect(result).toHaveLength(5);
    expectSorted(result);
    expect(contents(result)).toEqual([
      "a-v1",
      "b-v1",
      "c-v2",
      "d-v2",
      "e-v1",
    ]);
  });
});
