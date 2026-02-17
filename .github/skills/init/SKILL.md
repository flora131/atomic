---
name: init
description: Generate CLAUDE.md and AGENTS.md by exploring the codebase
---
# Generate CLAUDE.md and AGENTS.md

You are tasked with exploring the current codebase with the codebase-analyzer, codebase-locator, codebase-pattern-finder sub-agents and generating populated `CLAUDE.md` and `AGENTS.md` files at the project root. These files provide coding agents with the context they need to work effectively in this repository.

## Steps

1. **Explore the codebase to discover project metadata:**
   - Read `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `Gemfile`, `pom.xml`, or similar manifest files
   - Scan the top-level directory structure (`src/`, `lib/`, `app/`, `tests/`, `docs/`, etc.)
   - Check for existing config files: `.eslintrc`, `tsconfig.json`, `biome.json`, `oxlint.json`, `.prettierrc`, CI configs (`.github/workflows/`, `.gitlab-ci.yml`), etc.
   - Read `README.md` if it exists for project description and setup instructions
   - Check for `.env.example`, `.env.local`, or similar environment files
   - Identify the package manager (bun, npm, yarn, pnpm, cargo, go, pip, etc.)

2. **Identify key project attributes:**
   - **Project name**: From manifest file or directory name
   - **Project purpose**: 1-2 sentence description from README or manifest
   - **Project structure**: Key directories and their purposes
   - **Tech stack**: Language, framework, runtime
   - **Commands**: dev, build, test, lint, typecheck, format (from scripts in manifest)
   - **Environment setup**: Required env vars, env example files
   - **Verification command**: The command to run before commits (usually lint + typecheck + test)
   - **Existing documentation**: Links to docs within the repo

3. **Populate the template below** with discovered values. Replace every `{{placeholder}}` with actual values from the repo. Delete sections that don't apply (e.g., Environment if there are no env files). Remove the "How to Fill This Template" meta-section entirely.

4. **Write the populated content** to both `CLAUDE.md` and `AGENTS.md` at the project root with identical content.

## Template

```markdown
# {{PROJECT_NAME}}

## Overview

{{1-2 sentences describing the project purpose}}

## Project Structure

| Path       | Type     | Purpose     |
| ---------- | -------- | ----------- |
| \`{{path}}\` | {{type}} | {{purpose}} |

## Quick Reference

### Commands

\`\`\`bash
{{dev_command}}              # Start dev server / all services
{{build_command}}            # Build the project
{{test_command}}             # Run tests
{{lint_command}}             # Lint & format check
{{typecheck_command}}        # Type-check (if applicable)
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
- Delete any section from the template that doesn't apply to this project
- Do NOT include the "How to Fill This Template" section in the output
- Write identical content to both `CLAUDE.md` and `AGENTS.md` at the project root