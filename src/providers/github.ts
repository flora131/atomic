/**
 * GitHub Provider Implementation
 *
 * Standard Git workflow with GitHub CLI integration.
 * This is the default provider for most users.
 */

import type { SourceControlProvider, PrerequisiteResult } from "./provider";
import { commandExists } from "./utils";

/**
 * GitHub source control provider
 *
 * Uses Git for version control and GitHub CLI (gh) for PR operations.
 */
export const GitHubProvider: SourceControlProvider = {
  name: "github",
  displayName: "GitHub (Git)",
  cli: "git",

  commands: {
    // Status & info
    status: "git status --porcelain",
    log: "git log --oneline",
    diff: "git diff",
    branch: "git branch --show-current",

    // Staging & committing
    add: "git add",
    commit: "git commit",
    amend: "git commit --amend",

    // Remote operations
    push: "git push",
    pull: "git pull",

    // PR/code review
    createPR: "gh pr create",
    listPRs: "gh pr list",
    viewPR: "gh pr view",
  },

  allowedTools: [
    "Bash(git add:*)",
    "Bash(git status:*)",
    "Bash(git commit:*)",
    "Bash(git diff:*)",
    "Bash(git log:*)",
    "Bash(git push:*)",
    "Bash(git pull:*)",
    "Bash(git branch:*)",
    "Bash(gh pr:*)",
    "Bash(gh issue:*)",
  ],

  async checkPrerequisites(): Promise<PrerequisiteResult> {
    const missing: string[] = [];

    if (!(await commandExists("git"))) {
      missing.push("git");
    }
    if (!(await commandExists("gh"))) {
      missing.push("gh");
    }

    return {
      satisfied: missing.length === 0,
      missing,
      installInstructions: {
        git: "https://git-scm.com/downloads",
        gh: "brew install gh  # or: https://cli.github.com/",
      },
    };
  },
};
