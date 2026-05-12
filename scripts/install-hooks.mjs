import { spawnSync } from "node:child_process";

const truthy = new Set(["1", "true", "yes"]);
const installDisabled = truthy.has(
  (process.env.PREK_DISABLE_INSTALL ?? "").toLowerCase(),
);
const isCi =
  truthy.has((process.env.CI ?? "").toLowerCase()) ||
  truthy.has((process.env.GITHUB_ACTIONS ?? "").toLowerCase());

if (installDisabled || isCi) {
  console.log("Skipping prek hook installation.");
  process.exit(0);
}

const result = spawnSync("prek", ["install", "--prepare-hooks"], {
  shell: process.platform === "win32",
  stdio: "inherit",
});

process.exit(result.status ?? 1);
