# About Agent Skills

Agent Skills enhance the ability of Copilot coding agent, the GitHub Copilot CLI and Visual Studio Code Insiders to perform specialized tasks.

## About Agent Skills

Agent Skills are folders of instructions, scripts, and resources that Copilot can load when relevant to improve its performance in specialized tasks. Agent Skills is an [open standard](https://github.com/agentskills/agentskills), used by a range of different agents.

Agent Skills work with Copilot coding agent, the GitHub Copilot CLI and agent mode in Visual Studio Code Insiders. Support in the stable version of VS Code is coming soon.

You can create your own skills to teach Copilot to perform tasks in a specific, repeatable way—or use skills shared online, for example in the [`anthropics/skills`](https://github.com/anthropics/skills) repository or GitHub's community created [`github/awesome-copilot`](https://github.com/github/awesome-copilot) collection.

Copilot supports:

* Project skills, stored in your repository (`.github/skills` or `.claude/skills`)
* Personal skills, stored in your home directory and shared across projects (`~/.copilot/skills` or `~/.claude/skills`) (Copilot coding agent and GitHub Copilot CLI only)

Support for organization-level and enterprise-level skills is coming soon.

> \[!NOTE]
> GitHub Copilot CLI is in public preview with [data protection](https://gh.io/dpa) and subject to change.

## Creating and adding skills

1. Create a subdirectory for your new skill. Each skill should have its own directory (for example, `.github/skills/webapp-testing`). Skill directory names should be lowercase, use hyphens for spaces, and typically match the `name` in the `SKILL.md` frontmatter.

   For project skills, specific to a single repository, store your skill under `.github/skills` or `.claude/skills`.

   For personal skills, shared across projects, store your skill under `~/.copilot/skills` or `~/.claude/skills`.

2. Create a `SKILL.md` file with your skill's instructions.

   > \[!NOTE]
   > Skill files must be named `SKILL.md`.

   `SKILL.md` files are Markdown files with YAML frontmatter. In their simplest form, they include:

   * YAML frontmatter
     * **name** (required): A unique identifier for the skill. This must be lowercase, using hyphens for spaces.
     * **description** (required): A description of what the skill does, and when Copilot should use it.
     * **license** (optional): A description of the license that applies to this skill.
   * A Markdown body, with the instructions, examples and guidelines for Copilot to follow.

3. Optionally, add scripts, examples or other resources to your skill's directory. For example, if you were writing a skill for converting images between different formats, you might include a script for converting SVG images to PNG.

### Example `SKILL.md` file

For a project skill, this file would be located in the `/path/to/repository/.github/skills/github-actions-failure-debugging` directory.

For a personal skill, this file would be located in the `~/.copilot/skills/github-actions-failure-debugging` directory.

```markdown copy
---
name: github-actions-failure-debugging
description: Guide for debugging failing GitHub Actions workflows. Use this when asked to debug failing GitHub Actions workflows.
---

To debug failing GitHub Actions workflows in a pull request, follow this process, using tools provided from the GitHub MCP Server:

1. Use the `list_workflow_runs` tool to look up recent workflow runs for the pull request and their status
2. Use the `summarize_job_log_failures` tool to get an AI summary of the logs for failed jobs, to understand what went wrong without filling your context windows with thousands of lines of logs
3. If you still need more information, use the `get_job_logs` or `get_workflow_run_logs` tool to get the full, detailed failure logs
4. Try to reproduce the failure yourself in your own environment.
5. Fix the failing build. If you were able to reproduce the failure yourself, make sure it is fixed before committing your changes.
```

## How Copilot uses skills

When performing tasks, Copilot will decide when to use your skills based on your prompt and the skill's description.

When Copilot chooses to use a skill, the `SKILL.md` file will be injected in the agent's context, giving the agent access to your instructions. It can then follow those instructions, and use any scripts or examples you may have included in the skill's directory.

## Skills versus custom instructions

You can use both skills and custom instructions to teach Copilot how to work in your repository and how to perform specific tasks.

We recommend using custom instructions for simple instructions relevant to almost every task (for example information about your repository's coding standards), and skills for more detailed instructions that Copilot should access when relevant.

To learn more about repository custom instructions, see [Adding repository custom instructions for GitHub Copilot](/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions).