---
name: init
description: Generate CLAUDE.md and AGENTS.md by exploring the codebase
---

# Generate CLAUDE.md and AGENTS.md

You are tasked with exploring the current codebase with the codebase-analyzer, codebase-locator, codebase-pattern-finder sub-agents, detecting the primary project languages, checking whether the corresponding language servers already exist on the user's machine, optionally installing any missing language servers after explicit user confirmation, and then generating populated `CLAUDE.md` and `AGENTS.md` files at the project root. These files provide coding agents with the context they need to work effectively in this repository.

## Steps

1. **Explore the codebase to discover project metadata:**
    - Read `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `Gemfile`, `pom.xml`, or similar manifest files
    - Scan the top-level directory structure (`src/`, `lib/`, `app/`, `tests/`, `docs/`, etc.)
    - Check for existing config files: `.eslintrc`, `tsconfig.json`, `biome.json`, `oxlint.json`, `.prettierrc`, CI configs (`.github/workflows/`, `.gitlab-ci.yml`), etc.
    - Read `README.md` if it exists for project description and setup instructions
    - Check for `.env.example`, `.env.local`, or similar environment files
    - Identify the package manager (bun, npm, yarn, pnpm, cargo, go, pip, etc.)
    - Identify the primary project languages from manifests, lockfiles, and source file extensions
    - Inspect editor/tooling config such as `.vscode`, language-specific config files, or existing LSP settings when present

2. **Identify key project attributes:**
    - **Project name**: From manifest file or directory name
    - **Project purpose**: 1-2 sentence description from README or manifest
    - **Project structure**: Key directories and their purposes
    - **Tech stack**: Language, framework, runtime
    - **Detected languages**: The main implementation languages in the repo
    - **Recommended LSPs**: The language servers that best match those languages
    - **Commands**: dev, build, test, lint, typecheck, format (from scripts in manifest)
    - **Environment setup**: Required env vars, env example files
    - **Verification command**: The command to run before commits (usually lint + typecheck + test)
    - **Existing documentation**: Links to docs within the repo

3. **Detect installed language servers and prepare an installation plan:**
    - For each detected language, choose the most standard LSP for that ecosystem and prefer already configured tooling when the repo clearly indicates a preference
    - Check whether each LSP is already available by using non-destructive discovery commands such as `command -v`, `--version`, or equivalent read-only checks
    - Use this default mapping unless the repo clearly points to a different choice:
      - TypeScript / JavaScript -> `typescript-language-server` (and ensure `typescript` is available when required)
      - Python -> `pyright`
      - Go -> `gopls`
      - Rust -> `rust-analyzer`
      - Ruby -> `ruby-lsp`
      - PHP -> `intelephense`
      - Lua -> `lua-language-server`
      - Bash / shell -> `bash-language-server`
      - YAML -> `yaml-language-server`
      - Docker -> `dockerfile-language-server-nodejs`
      - Terraform -> `terraform-ls`
      - Java -> `jdtls`
      - Kotlin -> `kotlin-language-server`
      - C / C++ -> `clangd`
      - C# -> `csharp-ls`
    - If an LSP is missing, prepare the safest install command that fits the user's available tooling and platform; do not guess a package manager that is not installed
    - If the required runtime or package manager is missing, stop short of installation and report what is needed instead

4. **Ask for confirmation before installing anything:**
    - Summarize the detected languages, the LSPs already present, the LSPs that are missing, and the exact install commands you plan to run
    - Ask the user for confirmation before running any install command
    - If the user declines, skip installation and continue with documentation generation
    - After installation, verify each newly installed LSP with a version check or binary lookup and mention any failures clearly

5. **Populate the template below** with discovered values. Replace every `{{placeholder}}` with actual values from the repo. Delete sections that don't apply (e.g., Environment if there are no env files). Remove the "How to Fill This Template" meta-section entirely.

6. **Write the populated content** to both `CLAUDE.md` and `AGENTS.md` at the project root with identical content.

## Template

```markdown
# {{PROJECT_NAME}}

## Overview

{{1-2 sentences describing the project purpose}}

## Project Structure

| Path         | Type     | Purpose     |
| ------------ | -------- | ----------- |
| \`{{path}}\` | {{type}} | {{purpose}} |

## Quick Reference

### Languages and Tooling

- Languages: {{comma-separated detected languages}}
- LSPs: {{comma-separated installed or recommended language servers}}

### Commands

\`\`\`bash
{{dev_command}} # Start dev server / all services
{{build_command}} # Build the project
{{test_command}} # Run tests
{{lint_command}} # Lint & format check
{{typecheck_command}} # Type-check (if applicable)
\`\`\`

### Environment

- Copy \`{{env_example_file}}\` → \`{{env_local_file}}\` for local development
- Required vars: {{comma-separated list of required env vars}}

## Progressive Disclosure

Read relevant docs before starting:
| Topic | Location |
| ----- | -------- |
| {{topic}} | \`{{path_to_doc}}\` |

## Universal Rules

1. Run \`{{verify_command}}\` before commits
2. Keep PRs focused on a single concern
3. {{Add any project-specific universal rules}}

## Code Quality

Formatting and linting are handled by automated tools:

- \`{{lint_command}}\` — {{linter/formatter names}}
- \`{{format_command}}\` — Auto-fix formatting (if separate from lint)

Run before committing. Don't manually check style—let tools do it.
```

## Important Notes

- **Keep it under 100 lines** (ideally under 60) after populating
- **Every instruction must be universally applicable** to all tasks in the repo
- **No code style rules** — delegate to linters/formatters
- **No task-specific instructions** — use the progressive disclosure table
- **No code snippets** — use `file:line` pointers instead
- **Include verification commands** the agent can run to validate work
- **Never install tooling without an explicit user confirmation first**
- **Prefer read-only discovery before installation** and verify any installed LSP afterward
- Delete any section from the template that doesn't apply to this project
- Do NOT include the "How to Fill This Template" section in the output
- Write identical content to both `CLAUDE.md` and `AGENTS.md` at the project root
