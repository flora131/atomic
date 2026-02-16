import { test, expect, describe, beforeEach } from "bun:test";
import { binarySearchById, upsertPart, findLastPartIndex } from "./store.ts";
import { createPartId, _resetPartCounter } from "./id.ts";
import type { TextPart, Part, ReasoningPart } from "./types.ts";

function makeTextPart(content: string, id?: string): TextPart {
  return {
    id: (id ?? createPartId()) as any,
    type: "text",
    content,
    isStreaming: false,
    createdAt: new Date().toISOString(),
  };
}

function makeReasoningPart(content: string, id?: string): ReasoningPart {
  return {
    id: (id ?? createPartId()) as any,
    type: "reasoning",
    content,
    isStreaming: false,
    durationMs: 100,
    createdAt: new Date().toISOString(),
  };
}

beforeEach(() => _resetPartCounter());

describe("binarySearchById", () => {
  test("returns index when found at start", () => {
    const parts: Part[] = [
      makeTextPart("first"),
      makeTextPart("second"),
      makeTextPart("third"),
    ];
    
    const idx = binarySearchById(parts, parts[0].id);
    expect(idx).toBe(0);
  });
  
  test("returns index when found in middle", () => {
    const parts: Part[] = [
      makeTextPart("first"),
      makeTextPart("second"),
      makeTextPart("third"),
    ];
    
    const idx = binarySearchById(parts, parts[1].id);
    expect(idx).toBe(1);
  });
  
  test("returns index when found at end", () => {
    const parts: Part[] = [
      makeTextPart("first"),
      makeTextPart("second"),
      makeTextPart("third"),
    ];
    
    const idx = binarySearchById(parts, parts[2].id);
    expect(idx).toBe(2);
  });
  
  test("returns bitwise complement when not found - should insert at start", () => {
    const parts: Part[] = [
      makeTextPart("second", "part_000000000002_0000"),
      makeTextPart("third", "part_000000000003_0000"),
    ];
    
    const idx = binarySearchById(parts, "part_000000000001_0000");
    expect(idx).toBeLessThan(0);
    expect(~idx).toBe(0); // Should insert at position 0
  });
  
  test("returns bitwise complement when not found - should insert in middle", () => {
    const parts: Part[] = [
      makeTextPart("first", "part_000000000001_0000"),
      makeTextPart("third", "part_000000000003_0000"),
    ];
    
    const idx = binarySearchById(parts, "part_000000000002_0000");
    expect(idx).toBeLessThan(0);
    expect(~idx).toBe(1); // Should insert at position 1
  });
  
  test("returns bitwise complement when not found - should insert at end", () => {
    const parts: Part[] = [
      makeTextPart("first", "part_000000000001_0000"),
      makeTextPart("second", "part_000000000002_0000"),
    ];
    
    const idx = binarySearchById(parts, "part_000000000004_0000");
    expect(idx).toBeLessThan(0);
    expect(~idx).toBe(2); // Should insert at position 2 (end)
  });
  
  test("works on empty array", () => {
    const parts: Part[] = [];
    const idx = binarySearchById(parts, "part_000000000001_0000");
    expect(idx).toBeLessThan(0);
    expect(~idx).toBe(0); // Should insert at position 0
  });
  
  test("works on single element array - found", () => {
    const parts: Part[] = [makeTextPart("only", "part_000000000001_0000")];
    const idx = binarySearchById(parts, "part_000000000001_0000");
    expect(idx).toBe(0);
  });
  
  test("works on single element array - not found before", () => {
    const parts: Part[] = [makeTextPart("only", "part_000000000002_0000")];
    const idx = binarySearchById(parts, "part_000000000001_0000");
    expect(idx).toBeLessThan(0);
    expect(~idx).toBe(0);
  });
  
  test("works on single element array - not found after", () => {
    const parts: Part[] = [makeTextPart("only", "part_000000000001_0000")];
    const idx = binarySearchById(parts, "part_000000000002_0000");
    expect(idx).toBeLessThan(0);
    expect(~idx).toBe(1);
  });
  
  test("handles large sorted array", () => {
    const parts: Part[] = Array.from({ length: 1000 }, (_, i) =>
      makeTextPart(`part${i}`, `part_${i.toString(16).padStart(12, "0")}_0000`)
    );
    
    // Search for existing elements
    expect(binarySearchById(parts, parts[0].id)).toBe(0);
    expect(binarySearchById(parts, parts[500].id)).toBe(500);
    expect(binarySearchById(parts, parts[999].id)).toBe(999);
    
    // Search for non-existing element
    const nonExistentId = "part_999999999999_0000";
    const idx = binarySearchById(parts, nonExistentId);
    expect(idx).toBeLessThan(0);
  });
});

describe("upsertPart", () => {
  test("inserts into empty array", () => {
    const parts: Part[] = [];
    const newPart = makeTextPart("first");
    
    const result = upsertPart(parts, newPart);
    
    expect(result.length).toBe(1);
    expect(result[0]).toBe(newPart);
    expect(parts.length).toBe(0); // Original array unchanged
  });
  
  test("updates existing part by ID", () => {
    const id1 = "part_000000000001_0000";
    const id2 = "part_000000000002_0000";
    const id3 = "part_000000000003_0000";
    
    const parts: Part[] = [
      makeTextPart("first", id1),
      makeTextPart("second", id2),
      makeTextPart("third", id3),
    ];
    
    const updatedPart = makeTextPart("UPDATED", id2);
    const result = upsertPart(parts, updatedPart);
    
    expect(result.length).toBe(3);
    expect(result[1].content).toBe("UPDATED");
    expect(result[1].id).toBe(id2);
    expect(parts[1].content).toBe("second"); // Original unchanged
  });
  
  test("maintains sorted order on insert at start", () => {
    const parts: Part[] = [
      makeTextPart("second", "part_000000000002_0000"),
      makeTextPart("third", "part_000000000003_0000"),
    ];
    
    const newPart = makeTextPart("first", "part_000000000001_0000");
    const result = upsertPart(parts, newPart);
    
    expect(result.length).toBe(3);
    expect(result[0].content).toBe("first");
    expect(result[1].content).toBe("second");
    expect(result[2].content).toBe("third");
  });
  
  test("maintains sorted order on insert in middle", () => {
    const parts: Part[] = [
      makeTextPart("first", "part_000000000001_0000"),
      makeTextPart("third", "part_000000000003_0000"),
    ];
    
    const newPart = makeTextPart("second", "part_000000000002_0000");
    const result = upsertPart(parts, newPart);
    
    expect(result.length).toBe(3);
    expect(result[0].content).toBe("first");
    expect(result[1].content).toBe("second");
    expect(result[2].content).toBe("third");
  });
  
  test("maintains sorted order on insert at end", () => {
    const parts: Part[] = [
      makeTextPart("first", "part_000000000001_0000"),
      makeTextPart("second", "part_000000000002_0000"),
    ];
    
    const newPart = makeTextPart("third", "part_000000000003_0000");
    const result = upsertPart(parts, newPart);
    
    expect(result.length).toBe(3);
    expect(result[0].content).toBe("first");
    expect(result[1].content).toBe("second");
    expect(result[2].content).toBe("third");
  });
  
  test("returns new array reference", () => {
    const parts: Part[] = [makeTextPart("first")];
    const newPart = makeTextPart("second");
    
    const result = upsertPart(parts, newPart);
    
    expect(result).not.toBe(parts);
  });
  
  test("handles upsert with different part types", () => {
    const textPart = makeTextPart("text", "part_000000000001_0000");
    const reasoningPart = makeReasoningPart("reasoning", "part_000000000002_0000");
    
    const parts: Part[] = [textPart];
    const result = upsertPart(parts, reasoningPart);
    
    expect(result.length).toBe(2);
    expect(result[0].type).toBe("text");
    expect(result[1].type).toBe("reasoning");
  });
  
  test("handles multiple sequential upserts", () => {
    let parts: Part[] = [];
    
    const part1 = makeTextPart("first", "part_000000000001_0000");
    const part2 = makeTextPart("second", "part_000000000002_0000");
    const part3 = makeTextPart("third", "part_000000000003_0000");
    
    parts = upsertPart(parts, part2);
    parts = upsertPart(parts, part1);
    parts = upsertPart(parts, part3);
    
    expect(parts.length).toBe(3);
    expect(parts[0].content).toBe("first");
    expect(parts[1].content).toBe("second");
    expect(parts[2].content).toBe("third");
  });
  
  test("handles update then insert", () => {
    const id1 = "part_000000000001_0000";
    const parts: Part[] = [makeTextPart("first", id1)];
    
    // Update existing
    const updated = makeTextPart("UPDATED", id1);
    let result = upsertPart(parts, updated);
    expect(result[0].content).toBe("UPDATED");
    
    // Insert new
    const newPart = makeTextPart("second", "part_000000000002_0000");
    result = upsertPart(result, newPart);
    expect(result.length).toBe(2);
    expect(result[1].content).toBe("second");
  });
});

describe("findLastPartIndex", () => {
  test("returns -1 for empty array", () => {
    const parts: Part[] = [];
    const idx = findLastPartIndex(parts, (p) => p.type === "text");
    expect(idx).toBe(-1);
  });
  
  test("finds last matching part", () => {
    const parts: Part[] = [
      makeTextPart("first"),
      makeReasoningPart("reasoning"),
      makeTextPart("second"),
      makeTextPart("third"),
    ];
    
    const idx = findLastPartIndex(parts, (p) => p.type === "text");
    expect(idx).toBe(3);
    expect(parts[idx].content).toBe("third");
  });
  
  test("returns first index when only one match", () => {
    const parts: Part[] = [
      makeReasoningPart("reasoning1"),
      makeTextPart("text"),
      makeReasoningPart("reasoning2"),
    ];
    
    const idx = findLastPartIndex(parts, (p) => p.type === "text");
    expect(idx).toBe(1);
  });
  
  test("returns -1 when no match", () => {
    const parts: Part[] = [
      makeTextPart("first"),
      makeTextPart("second"),
    ];
    
    const idx = findLastPartIndex(parts, (p) => p.type === "reasoning");
    expect(idx).toBe(-1);
  });
  
  test("works with content-based predicate", () => {
    const parts: Part[] = [
      makeTextPart("hello"),
      makeTextPart("world"),
      makeTextPart("hello again"),
    ];
    
    const idx = findLastPartIndex(parts, (p) => p.type === "text" && p.content.includes("hello"));
    expect(idx).toBe(2);
  });
  
  test("works with isStreaming predicate", () => {
    const parts: Part[] = [
      { ...makeTextPart("first"), isStreaming: false },
      { ...makeTextPart("second"), isStreaming: true },
      { ...makeTextPart("third"), isStreaming: false },
      { ...makeTextPart("fourth"), isStreaming: true },
    ];
    
    const idx = findLastPartIndex(parts, (p) => p.type === "text" && p.isStreaming);
    expect(idx).toBe(3);
  });
  
  test("returns last match when all parts match", () => {
    const parts: Part[] = [
      makeTextPart("first"),
      makeTextPart("second"),
      makeTextPart("third"),
    ];
    
    const idx = findLastPartIndex(parts, (p) => p.type === "text");
    expect(idx).toBe(2);
  });
  
  test("handles single element array - match", () => {
    const parts: Part[] = [makeTextPart("only")];
    const idx = findLastPartIndex(parts, (p) => p.type === "text");
    expect(idx).toBe(0);
  });
  
  test("handles single element array - no match", () => {
    const parts: Part[] = [makeTextPart("only")];
    const idx = findLastPartIndex(parts, (p) => p.type === "reasoning");
    expect(idx).toBe(-1);
  });
  
  test("iterates from end to start efficiently", () => {
    // Create large array with match near the end
    const parts: Part[] = [
      ...Array.from({ length: 100 }, () => makeReasoningPart("reasoning")),
      makeTextPart("target"),
      ...Array.from({ length: 10 }, () => makeReasoningPart("reasoning")),
    ];
    
    const idx = findLastPartIndex(parts, (p) => p.type === "text");
    expect(idx).toBe(100);
  });
});
