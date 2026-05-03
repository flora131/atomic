import { test, expect } from "bun:test";
import { parse } from "yaml";
import { join } from "node:path";

const WORKFLOW_PATH = join(import.meta.dir, "../../.github/workflows/publish.yml");

test("publish workflow invokes per-package publish scripts", async () => {
  const wf = parse(await Bun.file(WORKFLOW_PATH).text());
  const steps = wf.jobs.publish.steps as Array<{ run?: string; uses?: string }>;
  const runs = steps.map(s => s.run ?? "").filter(Boolean);
  expect(runs.some(r => r.includes("bun packages/atomic/script/publish.ts"))).toBe(true);
  expect(runs.some(r => r.includes("bun packages/atomic-sdk/script/publish.ts"))).toBe(true);
});

test("no job runs bare 'npm publish' from the repo root", async () => {
  const wf = parse(await Bun.file(WORKFLOW_PATH).text());
  const offenders: string[] = [];
  for (const [jobName, job] of Object.entries(wf.jobs as Record<string, { steps?: Array<{ run?: string }> }>)) {
    for (const step of job.steps ?? []) {
      const cmd = step.run ?? "";
      // bare npm publish: starts with `npm publish` with no `cd` before it on the same line
      // or contains an unguarded `npm publish` not inside a per-package script invocation
      const lines = cmd.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (/^npm\s+publish\b/.test(trimmed) && !/\bcd\s+/.test(line)) {
          offenders.push(`${jobName}: ${trimmed}`);
        }
      }
    }
  }
  expect(offenders).toEqual([]);
});
