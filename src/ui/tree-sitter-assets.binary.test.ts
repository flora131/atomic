import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join, relative, resolve } from "path";
import { realpathSync } from "node:fs";

async function runCommand(command: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  const [stdoutBuffer, stderrBuffer] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  return {
    stdout: stdoutBuffer,
    stderr: stderrBuffer,
    exitCode,
  };
}

describe("tree-sitter assets in compiled binaries", () => {
  let tempDir = "";

  afterAll(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("markdown highlighting initializes in compiled binary", async () => {
    tempDir = await mkdtemp(join(process.cwd(), ".tmp-tree-sitter-"));

    const scriptPath = join(tempDir, "tree-sitter-binary-check.ts");
    const binaryPath = join(tempDir, "tree-sitter-binary-check");
    const treeSitterAssetsPath = join(process.cwd(), "src", "ui", "tree-sitter-assets.ts");

    await writeFile(
      scriptPath,
      [
        `import { initTreeSitterAssets } from ${JSON.stringify(treeSitterAssetsPath)};`,
        `import { TreeSitterClient, getDataPaths } from "@opentui/core";`,
        `initTreeSitterAssets();`,
        `const client = new TreeSitterClient({ dataPath: getDataPaths().globalDataPath });`,
        `await client.initialize();`,
        `const result = await client.highlightOnce("# Title\\n\\n- one\\n- two", "markdown");`,
        `await client.destroy();`,
        `console.log(JSON.stringify({ hasHighlights: Boolean(result.highlights), error: result.error, warning: result.warning, count: result.highlights?.length ?? 0 }));`,
      ].join("\n"),
      "utf8"
    );

    const parserWorkerPath = realpathSync(
      resolve(process.cwd(), "node_modules/@opentui/core/parser.worker.js")
    );
    const bunfsRoot = process.platform === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/";
    const workerRelativePath = relative(process.cwd(), parserWorkerPath).replaceAll("\\", "/");

    const build = await Bun.build({
      entrypoints: [scriptPath, parserWorkerPath],
      compile: {
        outfile: binaryPath,
        autoloadDotenv: false,
        autoloadBunfig: false,
      },
      define: {
        OTUI_TREE_SITTER_WORKER_PATH: JSON.stringify(`${bunfsRoot}${workerRelativePath}`),
      },
    });

    expect(build.success).toBe(true);

    const run = await runCommand([binaryPath]);
    expect(run.exitCode).toBe(0);
    expect(run.stderr).not.toContain("TreeSitter worker error");

    const outputLine = run.stdout
      .trim()
      .split("\n")
      .findLast((line) => line.startsWith("{"));

    expect(outputLine).toBeDefined();
    const parsed = JSON.parse(outputLine ?? "{}");
    expect(parsed.hasHighlights).toBe(true);
    expect(parsed.error).toBeUndefined();
    expect(parsed.count).toBeGreaterThan(0);
  });
});
