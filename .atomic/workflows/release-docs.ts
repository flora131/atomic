import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineWorkflow, Type } from "@bastani/workflows";
import deepResearchCodebase from "../../packages/workflows/builtin/deep-research-codebase.js";

const staleDocTaskSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  owner_docs: Type.Array(Type.String()),
  reason: Type.String(),
  source_refs: Type.Array(Type.String()),
  update_instructions: Type.String(),
  acceptance_criteria: Type.Array(Type.String()),
});

type StaleDocTask = {
  id: string;
  title: string;
  owner_docs: string[];
  reason: string;
  source_refs: string[];
  update_instructions: string;
  acceptance_criteria: string[];
};

type CommandResult = {
  command: string;
  ok: boolean;
  output: string;
};

const repoRoot = () => process.cwd();

const run = (command: string, args: string[], cwd = repoRoot()): string =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const runResult = (command: string, args: string[], cwd = repoRoot()): CommandResult => {
  const rendered = [command, ...args].join(" ");
  try {
    const output = run(command, args, cwd);
    return { command: rendered, ok: true, output };
  } catch (error) {
    const failure = error as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    const stdout = String(failure.stdout ?? "");
    const stderr = String(failure.stderr ?? "");
    const message = String(failure.message ?? "");
    return { command: rendered, ok: false, output: [stdout, stderr, message].filter(Boolean).join("\n") };
  }
};

const runGit = (args: string[]): string => run("git", args);

const gitOk = (args: string[]): boolean => runResult("git", args).ok;

const ensureCleanWorkingTree = (): void => {
  const status = runGit(["status", "--porcelain=v1"]);
  if (status.length > 0) {
    throw new Error(
      [
        "release-docs refuses to start on a dirty working tree because it creates a release docs branch before editing.",
        "Commit, stash, or discard existing changes first.",
        "Current status:",
        status,
      ].join("\n"),
    );
  }
};

const latestStableTag = (): string => {
  const tags = runGit(["tag", "--list", "--sort=-v:refname"])
    .split("\n")
    .map((tag) => tag.trim())
    .filter((tag) => /^v?\d+\.\d+\.\d+$/.test(tag));
  const tag = tags[0];
  if (!tag) {
    throw new Error("release-docs could not find a stable semver release tag like 0.8.25.");
  }
  return tag;
};

const inferReleaseVersion = (targetRef: string): string => {
  const match = /v?(\d+\.\d+\.\d+)(?:[-+][0-9A-Za-z.-]+)?/.exec(targetRef);
  const version = match?.[1];
  if (!version) {
    throw new Error(
      `release-docs could not infer a MAJOR.MINOR.PATCH release version from target_ref "${targetRef}".`,
    );
  }
  return version;
};

const sanitizeSegment = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";

const switchToDocsBranch = (branchName: string): void => {
  const remoteBranch = `origin/${branchName}`;
  if (gitOk(["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`])) {
    runGit(["switch", branchName]);
    return;
  }

  if (gitOk(["rev-parse", "--verify", `${remoteBranch}^{commit}`])) {
    runGit(["switch", "--track", "-c", branchName, remoteBranch]);
    return;
  }

  runGit(["switch", "-c", branchName]);
};

const prepareBranch = (targetRef: string): { baselineTag: string; branchName: string; releaseVersion: string } => {
  ensureCleanWorkingTree();
  runGit(["fetch", "--tags", "--prune", "origin"]);

  if (!gitOk(["rev-parse", "--verify", `${targetRef}^{commit}`])) {
    throw new Error(`release-docs could not resolve target_ref "${targetRef}" to a commit after fetching origin tags.`);
  }

  const releaseVersion = inferReleaseVersion(targetRef);
  const baselineTag = latestStableTag();
  const branchName = `docs/release-docs-${releaseVersion}`;
  switchToDocsBranch(branchName);

  return { baselineTag, branchName, releaseVersion };
};

const extractJsonArray = (text: string): StaleDocTask[] => {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const jsonText = fenced?.[1]?.trim() ?? trimmed;
  const parsed = JSON.parse(jsonText) as StaleDocTask[];
  if (!Array.isArray(parsed)) {
    throw new Error("stale-doc detector did not return a JSON array.");
  }
  return parsed.map((task, index) => ({
    id: sanitizeSegment(String(task.id || `doc-task-${index + 1}`)),
    title: String(task.title || `Documentation task ${index + 1}`),
    owner_docs: Array.isArray(task.owner_docs) ? task.owner_docs.map(String) : [],
    reason: String(task.reason || ""),
    source_refs: Array.isArray(task.source_refs) ? task.source_refs.map(String) : [],
    update_instructions: String(task.update_instructions || ""),
    acceptance_criteria: Array.isArray(task.acceptance_criteria) ? task.acceptance_criteria.map(String) : [],
  }));
};

const runDocsChecks = (): { ok: boolean; markdown: string } => {
  const checks = [
    {
      label: "Hosted docs route/internal-link validation",
      command: "bun",
      args: ["run", "docs:check"],
      cwd: join(repoRoot(), "packages/coding-agent"),
    },
    {
      label: "Mintlify syntax validation",
      command: "bunx",
      args: ["--bun", "mintlify@latest", "validate"],
      cwd: join(repoRoot(), "packages/coding-agent/docs"),
    },
    {
      label: "Mintlify broken-link validation",
      command: "bunx",
      args: ["--bun", "mintlify@latest", "broken-links"],
      cwd: join(repoRoot(), "packages/coding-agent/docs"),
    },
  ];

  const results = checks.map((check) => ({ ...check, result: runResult(check.command, check.args, check.cwd) }));
  const ok = results.every((check) => check.result.ok);
  const markdown = results
    .map((check) =>
      [
        `## ${check.label}`,
        "",
        `Command: \`${check.result.command}\``,
        `Cwd: \`${check.cwd}\``,
        `Status: ${check.result.ok ? "pass" : "fail"}`,
        "",
        "```text",
        check.result.output || "(no output)",
        "```",
      ].join("\n"),
    )
    .join("\n\n");

  return { ok, markdown };
};

const writeJson = (path: string, value: object): void => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

export default defineWorkflow("release-docs")
  .description("Prepare Atomic release docs updates, validate Mintlify docs, and open a PR.")
  .input("target_ref", Type.String({ description: "Target release ref/tag/branch/commit to compare against the latest stable release tag." }))
  .output("result", Type.String({ description: "Human-readable release docs workflow summary." }))
  .output(
    "status",
    Type.Union([Type.Literal("pr_created"), Type.Literal("no_changes"), Type.Literal("needs_investigation")], {
      description: "Final workflow status.",
    }),
  )
  .output("target_ref", Type.String({ description: "Target ref supplied by the caller." }))
  .output("baseline_tag", Type.String({ description: "Latest stable release tag used as the comparison baseline." }))
  .output("release_version", Type.String({ description: "Release version inferred from target_ref." }))
  .output("branch_name", Type.String({ description: "Docs branch created or reused by the workflow." }))
  .output("research_doc_path", Type.String({ description: "Research artifact path from the codebase research child workflow." }))
  .output("stale_doc_task_count", Type.Number({ description: "Number of grouped stale-doc update tasks found." }))
  .output("stale_doc_tasks", Type.Array(staleDocTaskSchema, { description: "Grouped stale-doc update tasks." }))
  .output("validation_report_path", Type.String({ description: "Validation report artifact path." }))
  .output("pr_summary", Type.Optional(Type.String({ description: "PR creation summary or no-op explanation." })))
  .run(async (ctx) => {
    const targetRef = ctx.inputs.target_ref.trim();
    const { baselineTag, branchName, releaseVersion } = prepareBranch(targetRef);
    const artifactRoot = join(".atomic", "workflows", "runs", "release-docs", releaseVersion);
    const updatesRoot = join(artifactRoot, "updates");
    mkdirSync(updatesRoot, { recursive: true });

    const metadataPath = join(artifactRoot, "release-metadata.json");
    const staleTasksPath = join(artifactRoot, "stale-doc-tasks.json");
    const validationPath = join(artifactRoot, "validation.md");
    const prPath = join(artifactRoot, "pr.md");

    writeJson(metadataPath, {
      target_ref: targetRef,
      baseline_tag: baselineTag,
      comparison_range: `${baselineTag}..${targetRef}`,
      release_version: releaseVersion,
      branch_name: branchName,
      docs_root: "packages/coding-agent/docs",
      pr_base: "main",
    });

    await ctx.stage("prepare-release-docs-branch", { noTools: "all" }).prompt(
      [
        "Release docs branch preparation is complete.",
        `Baseline tag: ${baselineTag}`,
        `Target ref: ${targetRef}`,
        `Release version: ${releaseVersion}`,
        `Branch: ${branchName}`,
        `Metadata artifact: ${metadataPath}`,
        "Reply exactly: RELEASE_DOCS_BRANCH_READY",
        "Do not ask questions. Do not call tools.",
      ].join("\n"),
    );

    const research = await ctx.workflow(deepResearchCodebase, {
      stageName: "research-release-code-changes",
      inputs: {
        prompt: [
          "Research Atomic code changes for release documentation updates.",
          `Compare the latest stable baseline tag ${baselineTag} to target ref ${targetRef}.`,
          "Use git diff/name-status/log evidence for that range and inspect the changed code paths.",
          "Focus on developer-facing and user-facing behavior that should be reflected in docs under packages/coding-agent/docs.",
          "Document concrete file paths, symbols, CLI/workflow/settings behavior, and docs implications.",
          "Do not edit files; this stage is research only.",
        ].join("\n"),
        max_partitions: 100,
        max_concurrency: 8,
      },
    });

    const researchDocPath = String(research.outputs.research_doc_path);

    await ctx.task("identify-stale-docs", {
      prompt: [
        "Identify stale Atomic docs entries for release prep.",
        `Release metadata artifact: ${metadataPath}`,
        `Research artifact: ${researchDocPath}`,
        "Read the metadata and research artifacts before inspecting docs.",
        "Docs scope is strictly packages/coding-agent/docs.",
        "Inspect docs against the baseline-to-target changes and emit grouped, non-overlapping update tasks.",
        "Group stale entries by owning docs files so parallel update workers do not edit the same file concurrently.",
        "If multiple stale entries touch the same docs file, put them in the same task.",
        "If no stale docs are found, write exactly [].",
        "Write ONLY a JSON array to the output file. Do not wrap it in prose unless JSON fences are unavoidable.",
        "Each array item must have this shape:",
        "{",
        "  \"id\": \"short-kebab-id\",",
        "  \"title\": \"short human title\",",
        "  \"owner_docs\": [\"packages/coding-agent/docs/path.mdx\"],",
        "  \"reason\": \"why the current docs are stale\",",
        "  \"source_refs\": [\"code or research references\"],",
        "  \"update_instructions\": \"specific docs update instructions\",",
        "  \"acceptance_criteria\": [\"observable criteria for this docs task\"]",
        "}",
      ].join("\n"),
      reads: [metadataPath, researchDocPath],
      output: staleTasksPath,
      outputMode: "file-only",
      context: "fresh",
    });

    const staleTasks = extractJsonArray(readFileSync(staleTasksPath, "utf8"));
    writeJson(staleTasksPath, staleTasks);

    if (staleTasks.length === 0) {
      const result = [
        `No stale docs entries were found for ${baselineTag}..${targetRef}.`,
        "No docs changes were made, so no PR was opened.",
        `Research artifact: ${researchDocPath}`,
        `Stale-doc task artifact: ${staleTasksPath}`,
      ].join("\n");
      writeFileSync(validationPath, "Validation skipped because no stale docs tasks were found.\n");
      return {
        result,
        status: "no_changes" as const,
        target_ref: targetRef,
        baseline_tag: baselineTag,
        release_version: releaseVersion,
        branch_name: branchName,
        research_doc_path: researchDocPath,
        stale_doc_task_count: 0,
        stale_doc_tasks: staleTasks,
        validation_report_path: validationPath,
        pr_summary: "No docs changes; PR skipped.",
      };
    }

    const updateArtifacts = staleTasks.map((task) => join(updatesRoot, `${sanitizeSegment(task.id)}.md`));
    await ctx.parallel(
      staleTasks.map((task, index) => ({
        name: `update-docs-${sanitizeSegment(task.id)}`,
        prompt: [
          "Update Atomic release docs for one grouped stale-doc task.",
          `Release metadata artifact: ${metadataPath}`,
          `Research artifact: ${researchDocPath}`,
          `Full stale-doc task list: ${staleTasksPath}`,
          "Assigned stale-doc task JSON:",
          JSON.stringify(task, null, 2),
          "Read the listed artifacts and then edit only the owner_docs files unless a directly adjacent docs link/index must be fixed.",
          "Do not edit code, changelogs, package manifests, or docs outside packages/coding-agent/docs.",
          "Do not commit, push, or create a PR.",
          "When finished, summarize changed files, evidence used, and residual risks.",
        ].join("\n"),
        reads: [metadataPath, researchDocPath, staleTasksPath, ...task.owner_docs.filter((path) => existsSync(path))],
        output: updateArtifacts[index],
        outputMode: "file-only" as const,
        context: "fresh" as const,
      })),
      { concurrency: Math.min(4, staleTasks.length), failFast: false },
    );

    await ctx.task("validate-and-repair-release-docs", {
      prompt: [
        "Validate the release docs updates and repair docs-only validation failures.",
        `Release metadata artifact: ${metadataPath}`,
        `Research artifact: ${researchDocPath}`,
        `Stale-doc task artifact: ${staleTasksPath}`,
        "First discover the docs validation commands from package scripts and docs/ci.md.",
        "The expected validation contract is:",
        "1. cd packages/coding-agent && bun run docs:check",
        "2. cd packages/coding-agent/docs && bunx --bun mintlify@latest validate",
        "3. cd packages/coding-agent/docs && bunx --bun mintlify@latest broken-links",
        "Run the checks with Bun/Bunx. If they fail, fix docs issues under packages/coding-agent/docs and rerun all checks.",
        "Do not commit, push, or create a PR.",
        "If failures remain after reasonable docs-only repairs, write INVESTIGATION REQUIRED with the exact failing command and output.",
        "If all checks pass, write VALIDATION PASSED and summarize commands run.",
      ].join("\n"),
      reads: [metadataPath, researchDocPath, staleTasksPath, ...updateArtifacts],
      output: validationPath,
      outputMode: "file-only",
      context: "fork",
    });

    const validation = runDocsChecks();
    writeFileSync(
      validationPath,
      [readFileSync(validationPath, "utf8"), "\n\n# Deterministic validation replay\n\n", validation.markdown].join(""),
    );

    if (!validation.ok) {
      const result = [
        `Docs validation still fails for ${baselineTag}..${targetRef}.`,
        "The workflow stopped before commit, push, and PR creation. Investigation is required.",
        `Validation report: ${validationPath}`,
      ].join("\n");
      return {
        result,
        status: "needs_investigation" as const,
        target_ref: targetRef,
        baseline_tag: baselineTag,
        release_version: releaseVersion,
        branch_name: branchName,
        research_doc_path: researchDocPath,
        stale_doc_task_count: staleTasks.length,
        stale_doc_tasks: staleTasks,
        validation_report_path: validationPath,
        pr_summary: "Validation failed; PR skipped.",
      };
    }

    const pr = await ctx.task("commit-push-open-release-docs-pr", {
      prompt: [
        "Create the release docs PR now that deterministic validation passed.",
        `Branch: ${branchName}`,
        "PR base: main",
        `Release version: ${releaseVersion}`,
        `Comparison range: ${baselineTag}..${targetRef}`,
        `Research artifact: ${researchDocPath}`,
        `Validation report: ${validationPath}`,
        "Start by inspecting git status --short.",
        "If there are no changes, do not commit, push, or create a PR; summarize the no-op result.",
        "If there are changes, stage only docs/workflow-run artifacts that are appropriate for the PR, commit with message:",
        `docs: update release docs for ${releaseVersion}`,
        "Push the branch to origin and create or update a GitHub PR targeting main using gh.",
        "Use a PR title like:",
        `docs: update release docs for ${releaseVersion}`,
        "Include baseline, target, research artifact, stale-doc task count, and validation commands in the PR body.",
        "Do not tag or publish a release.",
      ].join("\n"),
      reads: [metadataPath, researchDocPath, staleTasksPath, validationPath, ...updateArtifacts],
      output: prPath,
      outputMode: "file-only",
      context: "fork",
    });

    const prSummary = readFileSync(prPath, "utf8").trim() || pr.text;
    const status = runGit(["status", "--porcelain=v1", "packages/coding-agent/docs"]);
    const finalStatus = status.length > 0 ? "needs_investigation" : "pr_created";
    const result = [
      finalStatus === "pr_created"
        ? `Release docs PR stage completed for ${releaseVersion}.`
        : `Release docs PR stage left uncommitted docs changes for ${releaseVersion}; investigation is required.`,
      `Baseline: ${baselineTag}`,
      `Target: ${targetRef}`,
      `Branch: ${branchName}`,
      `Research artifact: ${researchDocPath}`,
      `Validation report: ${validationPath}`,
      `PR summary artifact: ${prPath}`,
    ].join("\n");

    return {
      result,
      status: finalStatus,
      target_ref: targetRef,
      baseline_tag: baselineTag,
      release_version: releaseVersion,
      branch_name: branchName,
      research_doc_path: researchDocPath,
      stale_doc_task_count: staleTasks.length,
      stale_doc_tasks: staleTasks,
      validation_report_path: validationPath,
      pr_summary: prSummary,
    };
  })
  .compile();
