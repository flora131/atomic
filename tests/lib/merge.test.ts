import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeJsonFile, syncJsonFile } from "../../src/lib/merge.ts";

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "atomic-merge-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function writeJson(path: string, data: unknown): Promise<void> {
  await Bun.write(path, JSON.stringify(data, null, 2) + "\n");
}

async function readJson<T = unknown>(path: string): Promise<T> {
  return (await Bun.file(path).json()) as T;
}

describe("mergeJsonFile excludeKeys", () => {
  test("strips excluded keys from source before merging", async () => {
    const src = join(tmp, "src.json");
    const dest = join(tmp, "dest.json");
    await writeJson(src, {
      env: { A: "1" },
      disabledMcpjsonServers: ["azure-devops"],
    });
    await writeJson(dest, { existing: true });

    await mergeJsonFile(src, dest, ["disabledMcpjsonServers"]);

    const result = await readJson<Record<string, unknown>>(dest);
    expect(result.existing).toBe(true);
    expect(result.env).toEqual({ A: "1" });
    expect("disabledMcpjsonServers" in result).toBe(false);
  });

  test("preserves destination's value for excluded keys", async () => {
    const src = join(tmp, "src.json");
    const dest = join(tmp, "dest.json");
    await writeJson(src, { disabledMcpjsonServers: ["azure-devops"] });
    await writeJson(dest, { disabledMcpjsonServers: ["user-choice"] });

    await mergeJsonFile(src, dest, ["disabledMcpjsonServers"]);

    const result = await readJson<Record<string, unknown>>(dest);
    expect(result.disabledMcpjsonServers).toEqual(["user-choice"]);
  });
});

describe("syncJsonFile excludeKeys", () => {
  test("strips excluded keys when destination does not exist", async () => {
    const src = join(tmp, "src.json");
    const dest = join(tmp, "nested", "dest.json");
    await writeJson(src, {
      env: { A: "1" },
      disabledMcpjsonServers: ["azure-devops"],
    });

    await syncJsonFile(src, dest, true, ["disabledMcpjsonServers"]);

    const result = await readJson<Record<string, unknown>>(dest);
    expect(result.env).toEqual({ A: "1" });
    expect("disabledMcpjsonServers" in result).toBe(false);
  });

  test("copies source as-is when excludeKeys is empty", async () => {
    const src = join(tmp, "src.json");
    const dest = join(tmp, "dest.json");
    await writeJson(src, { disabledMcpjsonServers: ["azure-devops"] });

    await syncJsonFile(src, dest, true, []);

    const result = await readJson<Record<string, unknown>>(dest);
    expect(result.disabledMcpjsonServers).toEqual(["azure-devops"]);
  });
});
