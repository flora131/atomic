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
  │  PR Description ........ ✓   │     │    → Test Features             │
  │  Bump Version .......... ✓   │     │    → Publish Features (GHCR)   │
  │  Validate Features ..... ✓   │     │    → Publish SDK (npm)         │
  │  Installer Validation .. ✓   │     │                                │
  │                              │     │                                │
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
  │  │  · claude/devcontainer-feature  │  │
  │  │  · copilot/devcontainer-feature │  │
  │  │  · opencode/devcontainer-feature│  │
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
  │   │           Create Release               │   ◄── Overwritable       │
  │   │                                        │                          │
  │   │  · Checksums                           │                          │
  │   │  · GitHub Release (tag: v{version})     │                          │
  │   │  · Attach binaries + config archives   │                          │
  │   │  · prerelease flag if version has -    │                          │
  │   └────────────────────┬───────────────────┘                          │
  │                        ▼                                              │
  │   ┌────────────────────────────────────────┐                          │
  │   │      Test Devcontainer Features        │   ◄── Requires release   │
  │   │                                        │       binaries to exist  │
  │   │  · 3 features × 2 base images          │                          │
  │   │  · Scenario tests per feature          │                          │
  │   │  · Global cross-feature scenarios      │                          │
  │   └────────┬───────────────────┬───────────┘                          │
  │            │                   │                                      │
  │            ▼                   ▼                                      │
  │   ┌─────────────────┐  ┌─────────────────────┐                        │
  │   │  Publish        │  │  Publish            │   ◄── Permanent,       │
  │   │  Features       │  │  Workflow SDK       │       gated by tests   │
  │   │  (GHCR)         │  │  (npm)              │                        │
  │   │                 │  │                     │                        │
  │   │  · Sync         │  │  · tests            │                        │
  │   │    versions     │  │  · typecheck        │                        │
  │   │  · Publish      │  │  · lint             │                        │
  │   │    to GHCR      │  │  · npm publish      │                        │
  │   │                 │  │    (tag: latest     │                        │
  │   │                 │  │     or next)        │                        │
  │   └─────────────────┘  └─────────────────────┘                        │
  └───────────────────────────────────────────────────────────────────────┘
```

### Why This Order?

```
  ┌───────────────┐     ┌───────────────┐     ┌────────────────────────────┐
  │    Release    │ ──► │ Test Features │ ──► │ Publish Features + SDK     │
  │ (overwritable)│     │  (validates)  │     │ (permanent / hard to undo) │
  └───────────────┘     └───────────────┘     └────────────────────────────┘
```

1. **Release first** — The GitHub release is created early because devcontainer feature install scripts download binaries from it. The release can be deleted and re-created if needed.
2. **Test features second** — Feature tests run after the release exists so the install scripts can successfully download binaries. If tests fail, the pipeline stops here.
3. **Publish last** — npm publishes are permanent (cannot be overwritten) and GHCR feature tags should only go out once validated. Both are gated behind passing feature tests.

### Manual Publish Features (`publish-features.yml`)

A standalone workflow for manually re-publishing devcontainer features to GHCR via `workflow_dispatch`. Runs the full test suite before publishing.

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
     Create GitHub Release (overwritable)                     │
           │                                                  │
           ▼                                                  │
     Test devcontainer features (install from release)        │
           │                                                  │
           ├────────── FAIL ──► Pipeline stops.               │
           │                    Release exists but nothing    │
           │                    is published. Fix and re-run. │
           │                                                  │
           ▼                                                  │
     ┌──────────────┐    ┌───────────────────┐                │
     │ Publish      │    │ Publish Workflow  │                │
     │ Features     │    │ SDK to npm        │                │
     │ to GHCR      │    │ (permanent)       │                │
     └──────────────┘    └───────────────────┘                │
                                                              │
  ⑤ Done ◄───────────────────────────────────────────────────┘
```

---

## Workflow Files Reference

| File                       | Trigger                                        | Purpose                            |
|----------------------------|------------------------------------------------|------------------------------------|
| `ci.yml`                   | PR (source/config changes)                     | Tests, typecheck, lint, coverage   |
| `bump-version.yml`        | PR opened/synced (`release/*`, `prerelease/*`) | Auto-bump versions from branch name|
| `validate-features.yml`   | PR (`devcontainer-features/**`)                | Schema validation                  |
| `test-features.yml`       | PR (`devcontainer-features/**`), `workflow_call`| Feature install + scenario tests   |
| `installer-validation.yml`| PR (`install.sh`, `install.ps1`)               | Shell/PowerShell lint              |
| `code-review.yml`         | PR opened/synced                               | AI code review                     |
| `pr-description.yml`      | PR opened/synced                               | AI PR description                  |
| `claude.yml`              | `@claude` mentions                             | Claude Code assistant              |
| `publish.yml`             | Merged `release/*`/`prerelease/*` PR           | Build, release, test, publish      |
| `publish-features.yml`    | `workflow_dispatch`                            | Manual feature re-publish          |
