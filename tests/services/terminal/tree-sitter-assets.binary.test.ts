import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";

// Binary compilation + execution can be slow, especially on CI or Windows.
setDefaultTimeout(30_000);
import { chmod, mkdtemp, rm, writeFile } from "fs/promises";
import { join, relative, resolve } from "path";
import { realpathSync } from "node:fs";
import { tmpdir } from "os";
import { ensureWebTreeSitterWasmShim } from "@/services/terminal/web-tree-sitter-shim.ts";

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
  let srcTempDir = "";
  let binTempDir = "";

  afterAll(async () => {
    await Promise.all([
      srcTempDir ? rm(srcTempDir, { recursive: true, force: true }) : Promise.resolve(),
      binTempDir ? rm(binTempDir, { recursive: true, force: true }) : Promise.resolve(),
    ]);
  });

  test("markdown highlighting initializes in compiled binary", async () => {
    ensureWebTreeSitterWasmShim();

    // Source script must live under cwd so @opentui/core resolves from node_modules.
    srcTempDir = await mkdtemp(join(process.cwd(), ".tmp-tree-sitter-"));
    // Compiled binary goes to /tmp so the filesystem supports execute permissions.
    binTempDir = await mkdtemp(join(tmpdir(), "tree-sitter-binary-test-"));

    const scriptPath = join(srcTempDir, "tree-sitter-binary-check.ts");
    const binaryPath = join(binTempDir, "tree-sitter-binary-check");
    const treeSitterAssetsPath = join(
      process.cwd(),
      "src",
      "services",
      "terminal",
      "tree-sitter-assets.ts"
    );

    await writeFile(
      scriptPath,
      [
        `import { initTreeSitterAssets } from ${JSON.stringify(treeSitterAssetsPath)};`,
        `import { TreeSitterClient, getDataPaths } from "@opentui/core";`,
        `process.env.OTUI_TREE_SITTER_WORKER_PATH = OTUI_TREE_SITTER_WORKER_PATH;`,
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

    // Run Bun.build from /tmp to avoid virtiofs/fakeowner path resolution
    // issues in DevPod Docker-on-macOS environments (ENOENT on .bun-build temp files).
    const originalCwd = process.cwd();
    process.chdir(tmpdir());
    let build: Awaited<ReturnType<typeof Bun.build>>;
    try {
      build = await Bun.build({
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
    } finally {
      process.chdir(originalCwd);
    }

    expect(build.success).toBe(true);

    await chmod(binaryPath, 0o755);

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
