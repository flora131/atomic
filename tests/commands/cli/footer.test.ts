import { describe, expect, test } from "bun:test";
import { createFooterStdout } from "../../../src/commands/cli/footer.tsx";

function createFakeStdout({
  columns,
  rows,
  chunks = [],
}: {
  columns?: number;
  rows?: number;
  chunks?: string[];
}): {
  readonly columns?: number;
  readonly rows?: number;
  write: NodeJS.WriteStream["write"];
} {
  return {
    get columns() {
      return columns;
    },
    get rows() {
      return rows;
    },
    write: ((chunk: string | Uint8Array) => {
      chunks.push(chunk.toString());
      return true;
    }) as NodeJS.WriteStream["write"],
  };
}

describe("footer renderer stdout", () => {
  test("pins OpenTUI geometry to the one-row footer pane", () => {
    const stdout = createFakeStdout({ columns: 132, rows: 24 });
    const footerStdout = createFooterStdout(stdout);

    expect(footerStdout.rows).toBe(1);
    expect(footerStdout.columns).toBe(132);
  });

  test("falls back to a safe width when the pane width is unavailable", () => {
    const stdout = createFakeStdout({});
    const footerStdout = createFooterStdout(stdout);

    expect(footerStdout.rows).toBe(1);
    expect(footerStdout.columns).toBe(80);
  });

  test("delegates writes to the original stdout stream", () => {
    const chunks: string[] = [];
    const stdout = createFakeStdout({ columns: 80, rows: 24, chunks });
    const footerStdout = createFooterStdout(stdout);

    footerStdout.write("visible footer");

    expect(chunks.join("")).toBe("visible footer");
  });
});
