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
  │  Code Review ........... ✓   │     │    Build → Release             │
  │  PR Description ........ ✓   │     │    → Publish SDK (npm)         │
  │  Bump Version .......... ✓   │     │                                │
  │  Validate Features ..... ✓   │     │  Publish Features ........ ✓  │
  │  Test Features* ........ ✓   │     │    (only on devcontainer       │
  │  Installer Validation .. ✓   │     │     changes, independent)      │
  │                              │     │                                │
  │  * only on devcontainer-     │     │                                │
  │    features/** changes       │     │                                │
  └──────────────────────────────┘     └────────────────────────────────┘
```

---

## Pull Request Workflows

These workflows run when a PR is opened or updated, providing feedback before merge.

### CI (`ci.yml`)

Runs on all PRs that touch source code, config, or agent definitions.

```
  PR opened/updated
  (paths: *.ts, *.tsx, *.js, *.jsx, package.json, tsconfig.json, agents/*.md)
         │
         ▼
  ┌──────────────────────────┐
  │    TypeScript Tests      │
  │  ┌────────────────────┐  │
  │  │ bun ci             │  │
  │  │ validate:agents    │  │
  │  │ typecheck          │  │
  │  │ lint               │  │
  │  │ test:coverage      │  │
  │  │ upload coverage    │  │
  │  └────────────────────┘  │
  └──────────────────────────┘
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

Validates `devcontainer-feature.json` schemas on any PR that touches devcontainer feature files.

### Test Features (`test-features.yml`)

Runs Docker-based devcontainer feature tests (install + `atomic init` flow) on any PR that touches `devcontainer-features/**`. Also available as a reusable workflow (`workflow_call`) and manual trigger (`workflow_dispatch`). Automatically sets the Atomic CLI version from `package.json` so tests always validate the matching release.

### Installer Validation (`installer-validation.yml`)

Runs syntax and lint checks on `install.sh` (ShellCheck on Linux/macOS) and `install.ps1` (PSScriptAnalyzer on Windows) when those files change.

### Code Review & PR Description (`code-review.yml`, `pr-description.yml`)

AI-powered workflows that auto-generate PR descriptions and provide code review comments via Claude Code Action.

---

## Release Pipeline

### Trigger

The publish pipeline (`publish.yml`) runs when:
- A `release/*` or `prerelease/*` PR is **merged** into `main`
- A GitHub release is manually published
- Manually via `workflow_dispatch`

### Pipeline Flow

```
  release/* or prerelease/* PR merged to main
         │
         ▼
  ┌───────────────────────────────────────────────────────────────────────┐
  │                          Publish Workflow                             │
  │                                                                       │
  │   ┌───────────────────┐    ┌─────────────────────────┐                │
  │   │  Build Binaries   │    │  Build Windows Binary   │                │
  │   │  (ubuntu)         │    │  (windows)              │                │
  │   │                   │    │                         │                │
  │   │  · bun ci         │    │  · bun ci               │                │
  │   │  · tests          │    │  · build .exe           │                │
  │   │  · typecheck      │    │                         │                │
  │   │  · build x4:      │    └────────────┬────────────┘                │
  │   │    linux-x64      │                 │                             │
  │   │    linux-arm64    │                 │                             │
  │   │    darwin-x64     │                 │                             │
  │   │    darwin-arm64   │                 │                             │
  │   │  · config archive │                 │                             │
  │   └────────┬──────────┘                 │                             │
  │            │                            │                             │
  │            └───────────┬────────────────┘                             │
  │                        ▼                                              │
  │   ┌────────────────────────────────────────┐                          │
  │   │       Validate Binaries (6 platforms)  │                          │
  │   └────────────────────┬───────────────────┘                          │
  │                        ▼                                              │
  │   ┌────────────────────────────────────────┐                          │
  │   │           Create Release               │   ◄── Overwritable       │
  │   │                                        │                          │
  │   │  · Checksums                           │                          │
  │   │  · GitHub Release (tag: v{version})     │                          │
  │   │  · Attach binaries + config archives   │                          │
  │   │  · prerelease flag if version has -    │                          │
  │   └────────────────────┬───────────────────┘                          │
  │                        ▼                                              │
  │   ┌─────────────────────┐                                             │
  │   │  Publish            │   ◄── Permanent, gated by release           │
  │   │  Workflow SDK       │                                             │
  │   │  (npm)              │                                             │
  │   │                     │                                             │
  │   │  · tests            │                                             │
  │   │  · typecheck        │                                             │
  │   │  · lint             │                                             │
  │   │  · npm publish      │                                             │
  │   │    (tag: latest     │                                             │
  │   │     or next)        │                                             │
  │   └─────────────────────┘                                             │
  └───────────────────────────────────────────────────────────────────────┘
```

Devcontainer features are published independently via `publish-features.yml`
when `devcontainer-features/**` files are merged to main or via manual dispatch.

### Why This Order?

```
  ┌───────────────┐     ┌──────────────────┐
  │    Release    │ ──► │  Publish SDK     │
  │ (overwritable)│     │  (permanent)     │
  └───────────────┘     └──────────────────┘
```

1. **Release first** — The GitHub release is created early because install scripts download binaries from it. The release can be deleted and re-created if needed.
2. **Publish SDK last** — npm publishes are permanent (cannot be overwritten) and are gated behind a successful release.
3. **Features are independent** — Devcontainer features just pull a released binary, so they're tested and published in their own workflow triggered by `devcontainer-features/**` changes.

### Manual Publish Features (`publish-features.yml`)

Publishes devcontainer features to GHCR. Triggers automatically when `devcontainer-features/**` changes are merged to main, or manually via `workflow_dispatch`. Runs the full test suite before publishing.

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
     Build binaries (Linux, macOS, Windows)                   │
           │                                                  │
           ▼                                                  │
     Validate binaries (6 platforms)                          │
           │                                                  │
           ▼                                                  │
     Create GitHub Release (overwritable)                     │
           │                                                  │
           ▼                                                  │
     ┌───────────────────┐                                    │
     │ Publish Workflow  │                                    │
     │ SDK to npm        │                                    │
     │ (permanent)       │                                    │
     └───────────────────┘                                    │
                                                              │
  ⑤ Done ◄───────────────────────────────────────────────────┘
```

Devcontainer features are tested and published independently when
`devcontainer-features/**` files change (not part of the release pipeline).

---

## Workflow Files Reference

| File                       | Trigger                                        | Purpose                            |
|----------------------------|------------------------------------------------|------------------------------------|
| `ci.yml`                   | PR (source/config changes)                     | Tests, typecheck, lint, coverage   |
| `bump-version.yml`        | PR opened/synced (`release/*`, `prerelease/*`) | Auto-bump versions from branch name|
| `validate-features.yml`   | PR (`devcontainer-features/**`)                | Schema validation                  |
| `test-features.yml`       | PR (`devcontainer-features/**`), `workflow_call`, `workflow_dispatch` | Feature install + init flow tests |
| `installer-validation.yml`| PR (`install.sh`, `install.ps1`)               | Shell/PowerShell lint              |
| `code-review.yml`         | PR opened/synced                               | AI code review                     |
| `pr-description.yml`      | PR opened/synced                               | AI PR description                  |
| `claude.yml`              | `@claude` mentions                             | Claude Code assistant              |
| `publish.yml`             | Merged `release/*`/`prerelease/*` PR           | Build, release, publish SDK        |
| `publish-features.yml`    | Merged PR (`devcontainer-features/**`), `workflow_dispatch` | Test + publish features to GHCR |
