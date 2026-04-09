# CI/CD Pipeline

This document describes the GitHub Actions workflows that power Atomic CLI's continuous integration and delivery pipeline.

## Workflow Overview

```
                        ┌─────────────────────────────────────────────┐
                        │              GitHub Actions CI              │
                        └─────────────────────────────────────────────┘

  ┌──────────────────────────────┐     ┌────────────────────────────────┐
  │     On Pull Request (PR)     │     │   On Merge to main / Release   │
  ├──────────────────────────────┤     ├────────────────────────────────┤
  │                              │     │                                │
  │  CI ..................... ✓  │     │  Publish .................. ✓  │
  │    · TypeScript Checks       │     │    Build → Validate Binaries   │
  │    · Workflow SDK            │     │    → Publish Workflow SDK      │
  │  Code Review ........... ✓   │     │      (npm)                    │
  │  PR Description ........ ✓   │     │    → Release                   │
  │  Bump Version .......... ✓   │     │                                │
  │  Validate Features ..... ✓   │     │  Publish Features ........ ✓  │
  │  Installer Validation .. ✓   │     │    (only on devcontainer       │
  │                              │     │     changes)                   │
  └──────────────────────────────┘     └────────────────────────────────┘
```

---

## Pull Request Workflows

These workflows run when a PR is opened or updated, providing feedback before merge.

### CI (`ci.yml`)

Runs on all PRs to `main` that touch source code, config, or agent definitions. Runs two parallel jobs.

```
  PR opened/updated
  (paths: *.ts, *.tsx, *.js, *.jsx, package.json, bun.lock, tsconfig.json)
         │
         ├──────────────────────────────────────┐
         ▼                                      ▼
  ┌──────────────────────────┐   ┌──────────────────────────────┐
  │   TypeScript Checks      │   │    Workflow SDK              │
  │  ┌────────────────────┐  │   │  ┌────────────────────────┐  │
  │  │ bun ci             │  │   │  │ bun ci                 │  │
  │  │ typecheck          │  │   │  │ typecheck              │  │
  │  │ lint               │  │   │  │ lint                   │  │
  │  └────────────────────┘  │   │  │ test:coverage          │  │
  └──────────────────────────┘   │  │ upload coverage        │  │
                                 │  └────────────────────────┘  │
                                 │  (runs in packages/          │
                                 │   workflow-sdk/)             │
                                 └──────────────────────────────┘
```

### Bump Version (`bump-version.yml`)

Automatically bumps version numbers when a `release/*` or `prerelease/*` PR is opened. Extracts the version from the branch name and updates all versioned files.

```
  PR opened/synchronized
  (branch: release/v* or prerelease/v*)
         │
         ▼
  ┌───────────────────────────────────────┐
  │            Bump Version               │
  │                                       │
  │  ┌─────────────────────────────────┐  │
  │  │ Extract version from branch     │  │
  │  │                                 │  │
  │  │ prerelease/v{version}-{rev}     │  │
  │  │              └► {version}-{rev} │  │
  │  │ release/v{version}              │  │
  │  │              └► {version}       │  │
  │  └────────────────┬────────────────┘  │
  │                   ▼                   │
  │  ┌─────────────────────────────────┐  │
  │  │ bump-version.ts                 │  │
  │  │                                 │  │
  │  │ Updates:                        │  │
  │  │  · package.json                 │  │
  │  │  · packages/workflow-sdk/       │  │
  │  │    package.json                 │  │
  │  └────────────────┬────────────────┘  │
  │                   ▼                   │
  │  ┌─────────────────────────────────┐  │
  │  │ bun install (update lockfile)   │  │
  │  └────────────────┬────────────────┘  │
  │                   ▼                   │
  │  ┌─────────────────────────────────┐  │
  │  │ Commit & push if changed        │  │
  │  └─────────────────────────────────┘  │
  └───────────────────────────────────────┘
```

### Validate Features (`validate-features.yml`)

Validates `devcontainer-feature.json` schemas on any PR that touches `devcontainer-features/**`, or via manual dispatch.

### Installer Validation (`installer-validation.yml`)

Runs syntax and lint checks on `install.sh` (ShellCheck on Linux/macOS via matrix) and `install.ps1` (PSScriptAnalyzer on Windows) when those files change, or via manual dispatch.

### Code Review & PR Description (`code-review.yml`, `pr-description.yml`)

AI-powered workflows that auto-generate PR descriptions and provide code review comments via Claude Code Action.

- **Code Review** — uses Claude Opus, reviews for quality, best practices, bugs, performance, security, and test coverage.
- **PR Description** — uses Claude Sonnet, generates conventional commit-style title and description via `gh pr edit`. Skips dependabot PRs.

### Claude Code Interactive (`claude.yml`)

Responds to `@claude` mentions in issue comments, PR review comments, opened/assigned issues, and submitted PR reviews. Uses Claude Opus with full Bash access.

---

## Release Pipeline

### Trigger

The publish pipeline (`publish.yml`) runs when:
- A `release/*` or `prerelease/*` PR is **merged** into `main`
- A GitHub release is manually published
- Manually via `workflow_dispatch` (requires a tag input, e.g. `v0.1.0`)

Concurrency is enforced per-ref (`publish-${{ github.ref }}`), cancelling in-progress runs.

### Pipeline Flow

```
  release/* or prerelease/* PR merged to main
         │
         ▼
  ┌───────────────────────────────────────────────────────────────────────┐
  │                          Publish Workflow                             │
  │                                                                       │
  │   ┌─────────────────────────────────────────────┐                    │
  │   │  Build Binaries (single ubuntu runner)      │                    │
  │   │                                             │                    │
  │   │  · bun ci                                   │                    │
  │   │  · install cross-platform native modules    │                    │
  │   │    (@opentui/core: --os="*" --cpu="*")      │                    │
  │   │  · tests + typecheck                        │                    │
  │   │  · cross-compile all 6 targets:             │                    │
  │   │    linux-x64, linux-arm64,                  │                    │
  │   │    darwin-x64, darwin-arm64,                │                    │
  │   │    windows-x64, windows-arm64              │                    │
  │   │  · config archives (tar.gz + zip):          │                    │
  │   │    .claude/agents, .opencode/agents,        │                    │
  │   │    .github/agents, .github/lsp.json,        │                    │
  │   │    .atomic/workflows                        │                    │
  │   └────────────────────┬────────────────────────┘                    │
  │                        ▼                                              │
  │   ┌────────────────────────────────────────┐                          │
  │   │  Validate Binaries (6 platform runners)│                          │
  │   │                                        │                          │
  │   │  · linux-x64     (ubuntu-latest)       │                          │
  │   │  · linux-arm64   (ubuntu-24.04-arm)    │                          │
  │   │  · darwin-x64    (macos-15-intel)      │                          │
  │   │  · darwin-arm64  (macos-latest)        │                          │
  │   │  · windows-x64   (windows-latest)      │                          │
  │   │  · windows-arm64 (windows-11-arm)      │                          │
  │   │                                        │                          │
  │   │  Per binary:                           │                          │
  │   │  · --version check (matches pkg ver)   │                          │
  │   │  · --help smoke test                   │                          │
  │   │  · config archive validation:          │                          │
  │   │    ✓ .claude/agents                    │                          │
  │   │    ✓ .opencode/agents                  │                          │
  │   │    ✓ .github/agents                    │                          │
  │   │    ✓ .github/lsp.json                  │                          │
  │   │    ✓ .atomic/workflows                 │                          │
  │   │    ✗ skills dirs (moved to skills CLI) │                          │
  │   └────────────────────┬───────────────────┘                          │
  │                        ▼                                              │
  │   ┌─────────────────────┐                                             │
  │   │  Publish            │   ◄── Permanent, gated by validation        │
  │   │  Workflow SDK       │                                             │
  │   │  (npm)              │                                             │
  │   │                     │                                             │
  │   │  · tests            │                                             │
  │   │  · typecheck        │                                             │
  │   │  · lint             │                                             │
  │   │  · npm publish      │                                             │
  │   │    (tag: latest     │                                             │
  │   │     or next)        │                                             │
  │   │  · OIDC provenance  │                                             │
  │   └──────────┬──────────┘                                             │
  │              ▼                                                        │
  │   ┌────────────────────────────────────────┐                          │
  │   │           Create Release               │   ◄── Overwritable       │
  │   │                                        │                          │
  │   │  · SHA256 checksums                    │                          │
  │   │  · GitHub Release (tag: v{version})     │                          │
  │   │  · Attach binaries + config archives   │                          │
  │   │  · prerelease flag if version has -    │                          │
  │   └────────────────────────────────────────┘                          │
  └───────────────────────────────────────────────────────────────────────┘
```

Devcontainer features are published independently via `publish-features.yml`
when `devcontainer-features/**` files are merged to main or via manual dispatch.
Features are validated via schema checks during PRs and published after merge.

### Why This Order?

```
  ┌──────────────────┐     ┌───────────────┐
  │  Publish SDK     │ ──► │    Release    │
  │  (permanent)     │     │ (overwritable)│
  └──────────────────┘     └───────────────┘
```

1. **Publish SDK first** — npm publishes are permanent (cannot be overwritten) and run with OIDC provenance. Publishing before the release guarantees the `@bastani/atomic-workflows` package is available on npm when users run the install script, since the config archive bundled with the release references it as a dependency.
2. **Release last** — The GitHub release is created after the SDK is on npm so that `bun install` in the install script's workflow setup always succeeds. The release can be deleted and re-created if needed.
3. **Features are independent** — Devcontainer features just pull a released binary, so they're validated during PRs (schema checks) and published in their own workflow triggered by `devcontainer-features/**` changes merging to main.

### Publish Features (`publish-features.yml`)

Publishes devcontainer features to GHCR. Triggers automatically when `devcontainer-features/**` changes are merged to main, or manually via `workflow_dispatch`. Relies on the PR-stage `Validate Features` schema check having passed before merge.

---

## Release vs Prerelease

The pipeline handles both identically, with two differences:

| Aspect         | Release (`release/v{version}`)                 | Prerelease (`prerelease/v{version}-{rev}`)       |
|----------------|------------------------------------------------|--------------------------------------------------|
| Version format | `{version}` (no suffix)                        | `{version}-{rev}` (has `-` suffix)               |
| GitHub Release | `prerelease: false`, `make_latest: true`       | `prerelease: true`, `make_latest: false`         |
| npm tag        | `latest`                                       | `next`                                           |

---

## Full Lifecycle

End-to-end flow for a release, from branch creation to published artifacts:

```
  ① Create branch
     prerelease/v{version}-{rev}
           │
           ▼
  ② Open PR to main ──────────────────────────────────┐
           │                                           │
           │  Automatic:                               │  Also runs:
           ▼                                           ▼
     ┌───────────────┐                          ┌────────────┐
     │ Bump Version  │                          │ CI         │
     │ (commit pushed│                          │ Code Review│
     │  to PR branch)│                          │ Validate   │
     └───────────────┘                          │ Features   │
                                                └────────────┘
           │
           ▼
  ③ Review & merge PR
           │
           ▼
  ④ Publish workflow fires ──────────────────────────────────┐
           │                                                  │
     Build binaries (Linux, macOS, Windows × x64, arm64)      │
           │                                                  │
           ▼                                                  │
     Validate binaries (6 native platform runners)            │
           │                                                  │
           ▼                                                  │
     ┌───────────────────┐                                    │
     │ Publish Workflow  │                                    │
     │ SDK to npm        │                                    │
     │ (permanent, with  │                                    │
     │  OIDC provenance) │                                    │
     └────────┬──────────┘                                    │
              ▼                                               │
     Create GitHub Release (overwritable)                     │
                                                              │
  ⑤ Done ◄───────────────────────────────────────────────────┘
```

Devcontainer features are validated (schema checks) during PRs, then published
independently when `devcontainer-features/**` changes merge to main (not part
of the release pipeline).

---

## Build & Release Scripts

The publish workflow delegates build and packaging to TypeScript scripts that can also be run locally:

| Script                                    | Purpose                                                                 |
|-------------------------------------------|-------------------------------------------------------------------------|
| `src/scripts/build-binaries.ts`           | Cross-compiles Atomic CLI for all 6 platform targets into `dist/`       |
| `src/scripts/create-config-archives.ts`   | Packages agent configs and workflow templates into `dist/` archives      |
| `src/scripts/bump-version.ts`             | Bumps version across all tracked `package.json` files                   |
| `src/scripts/constants.ts`                | Shared constants (`SDK_PACKAGE_NAME`, `CONFIG_DIRS`, `VERSION_FILES`, etc.) |

### Shared Constants (`src/scripts/constants.ts`)

Values that appear across multiple scripts and workflows are centralised in `constants.ts` to reduce drift:

- **`SDK_PACKAGE_NAME`** — the npm package name (`@bastani/atomic-workflows`)
- **`WORKFLOW_SDK_DIR`** — repo-relative path to the SDK package (`packages/workflow-sdk`)
- **`VERSION_FILES`** — `package.json` files bumped together during releases
- **`CONFIG_DIRS`** — agent config directories included in the config archive, derived from the canonical `AGENTS` list exported by the workflow SDK
- **`CONFIG_FILES`** — individual config files included in the archive (e.g. `.github/lsp.json`)

---

## Workflow Files Reference

| File                       | Trigger                                        | Purpose                            |
|----------------------------|------------------------------------------------|------------------------------------|
| `ci.yml`                   | PR (source/config changes)                     | Tests, typecheck, lint, coverage (root + workflow-sdk) |
| `bump-version.yml`        | PR opened/synced (`release/*`, `prerelease/*`) | Auto-bump versions from branch name|
| `validate-features.yml`   | PR (`devcontainer-features/**`), `workflow_dispatch` | Schema validation            |
| `installer-validation.yml`| PR (`install.sh`, `install.ps1`), `workflow_dispatch` | Shell/PowerShell lint        |
| `code-review.yml`         | PR opened/synced                               | AI code review (Claude Opus)       |
| `pr-description.yml`      | PR opened/synced                               | AI PR description (Claude Sonnet)  |
| `claude.yml`              | `@claude` mentions (issues, PRs, reviews)      | Claude Code interactive assistant  |
| `publish.yml`             | Merged `release/*`/`prerelease/*` PR, release published, `workflow_dispatch` | Build, validate, release, publish SDK |
| `publish-features.yml`    | Merged PR (`devcontainer-features/**`), `workflow_dispatch` | Publish features to GHCR |
