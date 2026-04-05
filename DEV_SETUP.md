# Developer Setup

## Prerequisites

- [Bun](https://bun.sh/) (latest)
- [Docker](https://docs.docker.com/get-docker/) (Docker Desktop or Docker Engine)
- [Dev Container CLI](https://github.com/devcontainers/cli) — install via Bun:
  ```bash
  bun install -g @devcontainers/cli
  ```
- Git

## Environment Variables

The devcontainer forwards the following environment variables from your host. Set them before building:

| Variable            | Purpose                   |
| ------------------- | ------------------------- |
| `GH_TOKEN`          | GitHub CLI authentication |
| `ANTHROPIC_API_KEY` | Claude agent SDK access   |

Add them to your shell profile (e.g. `~/.zshrc`, `~/.bashrc`) or export them in the current session:

**macOS / Linux:**

```bash
export GH_TOKEN="ghp_..." # requires Copilot Requests scope
export ANTHROPIC_API_KEY="sk-ant-..."
```

**Windows (PowerShell):**

```powershell
$env:GH_TOKEN = "ghp_..." # requires Copilot Requests scope
$env:ANTHROPIC_API_KEY = "sk-ant-..."
```

Alternatively, you can skip setting keys and log in interactively inside the container using each tool's `/login` command in the respective coding agent CLI.

## Getting Started

### 1. Build and start the container

```bash
devcontainer up --workspace-folder .
```

This builds the image defined in `.devcontainer/Dockerfile` (Ubuntu 24.04 base) and installs:

- **Bun** — JS/TS runtime
- **OpenCode CLI** — OpenCode agent
- **Claude CLI** — Claude agent
- **Copilot CLI** — GitHub Copilot agent
- **GitHub CLI** — via devcontainer feature
- **Playwright CLI** — browser automation

After the container starts, `bun install` runs automatically via `postCreateCommand`.

### 2. Open a shell inside the container

```bash
devcontainer exec --workspace-folder . bash
```

You are now inside the container as the `vscode` user with all tools on `$PATH`.

### 3. Verify the setup

```bash
bun test
```

## Development Commands

Run these inside the container:

| Command             | Description                             |
| ------------------- | --------------------------------------- |
| `bun test`          | Run all tests with coverage             |
| `bun test --bail`   | Stop on first failure                   |
| `bun run typecheck` | TypeScript type checking                |
| `bun run lint`      | Run oxlint + sub-module boundary checks |
| `bun run lint:fix`  | Auto-fix linting issues                 |
| `bun run dev`       | Run CLI in development mode             |

## Quick Reference

```bash
# Full lifecycle
devcontainer up --workspace-folder .          # build & start
devcontainer exec --workspace-folder . bash   # open shell
bun test                                      # verify
bun run dev                                   # develop

# Rebuild after Dockerfile changes
devcontainer up --workspace-folder . --rebuild
```
