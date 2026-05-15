import { describe, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import packageJson from "../../package.json" with { type: "json" };

function markdownFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort();
}

describe("package metadata", () => {
  test("ships workflow, skill, and bundled agent assets through npm metadata", () => {
    assert.ok(packageJson.files.includes("skills/**/*"));
    assert.ok(packageJson.files.includes("agents/"));
    assert.deepEqual(packageJson.pi.skills, ["./skills"]);
    assert.deepEqual(packageJson.pi.workflows, ["./workflows"]);
  });

  test("bundled agents mirror the project-local .pi agents", () => {
    const bundledAgents = markdownFiles("agents");
    assert.deepEqual(bundledAgents, markdownFiles(".pi/agents"));

    for (const fileName of bundledAgents) {
      assert.equal(
        readFileSync(`agents/${fileName}`, "utf-8"),
        readFileSync(`.pi/agents/${fileName}`, "utf-8"),
        `${fileName} should match its .pi/agents source`,
      );
    }
  });
});
