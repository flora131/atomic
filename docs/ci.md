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
  │    · typecheck/lint/test     │     │    · typecheck + tests         │
  │  Code Review ........... ✓   │     │    · publish @bastani/atomic   │
  │  PR Description ........ ✓   │     │    · Create GitHub Release     │
  │  Bump Version .......... ✓   │     │                                │
  │  Validate Features ..... ✓   │     │  Publish Features ........ ✓  │
  │                              │     │    (only on devcontainer       │
  │                              │     │     changes)                   │
  └──────────────────────────────┘     └────────────────────────────────┘
```

Atomic is distributed exclusively as a single npm package (`@bastani/atomic`)
that exposes both the CLI binary (`atomic`) and the workflow SDK (via the
`@bastani/atomic/workflows` package export). There are no platform-specific
compiled binaries — installation happens through `bun install -g @bastani/atomic`.

---

## Pull Request Workflows

These workflows run when a PR is opened or updated, providing feedback before merge.

### CI (`ci.yml`)

Runs on all PRs to `main` that touch source code or config. A single `Checks`
job runs against the consolidated `@bastani/atomic` package.

```
  PR opened/updated
  (paths: *.ts, *.tsx, *.js, *.jsx, package.json, bun.lock, tsconfig.json)
         │
         ▼
  ┌──────────────────────────────────┐
  │              Checks              │
  │  ┌────────────────────────────┐  │
  │  │ bun install                │  │
  │  │ bun run typecheck          │  │
  │  │ bun run lint               │  │
  │  │ bun test                   │  │
  │  └────────────────────────────┘  │
  └──────────────────────────────────┘
```

The CLI source, the workflow SDK source (`src/sdk/`), and SDK tests
(`tests/sdk/`) all live in the same package, so a single job covers
everything.

### Bump Version (`bump-version.yml`)

Automatically bumps the version when a `release/*` or `prerelease/*` PR is
opened. Extracts the version from the branch name and updates
`package.json` (the only file tracked in `VERSION_FILES`).

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
  ┌─────────────────────────────────────────────────────────────────┐
  │                        Publish Workflow                         │
  │                                                                 │
  │   ┌─────────────────────────────────────────────┐              │
  │   │  Publish to npm (ubuntu-latest)             │              │
  │   │                                             │              │
  │   │  · bun install                              │              │
  │   │  · bun run typecheck                        │              │
  │   │  · bun test                                 │              │
  │   │  · determine npm tag                        │              │
  │   │      version has '-' → next                 │              │
  │   │      otherwise       → latest               │              │
  │   │  · setup Node for npm registry              │              │
  │   │  · npm publish                              │              │
  │   │      --provenance --access public           │              │
  │   │      --tag {latest|next}                    │              │
  │   └────────────────────┬────────────────────────┘              │
  │                        ▼                                        │
  │   ┌─────────────────────────────────────────────┐              │
  │   │  Create Release          ◄── Overwritable   │              │
  │   │                                             │              │
  │   │  · Read version from package.json           │              │
  │   │  · GitHub Release (tag: v{version})         │              │
  │   │  · prerelease flag if version has '-'       │              │
  │   │  · generate_release_notes: true             │              │
  │   └─────────────────────────────────────────────┘              │
  └─────────────────────────────────────────────────────────────────┘
```

Devcontainer features are published independently via `publish-features.yml`
when `devcontainer-features/**` files are merged to main or via manual dispatch.
Features are validated via schema checks during PRs and published after merge.

### Why npm-Only?

Atomic ships as a single npm package. The `atomic` bin (keyed by command
name in `package.json`'s `bin` field) points at `src/cli.ts` and is run by
Bun at install time, so there are no platform-specific binaries to compile,
validate, or attach to a release. This eliminates a large amount of CI
complexity that used to live in this pipeline:

- No `build-binaries` cross-compilation step (6 targets removed)
- No 6-platform binary validation matrix (linux/darwin/windows × x64/arm64)
- No config archive packaging or per-platform validation
- No `installer-validation.yml` workflow (`install.sh` / `install.ps1` are
  now thin wrappers around `bun install -g @bastani/atomic`)
- No separate workflow SDK package or publish step — the SDK is exposed as
  the `@bastani/atomic/workflows` subpath export of the same package

### Why Publish Before Release?

```
  ┌──────────────────┐     ┌───────────────┐
  │   npm publish    │ ──► │    Release    │
  │   (permanent)    │     │ (overwritable)│
  └──────────────────┘     └───────────────┘
```

1. **npm publish first** — npm publishes are permanent (cannot be
   overwritten) and run with OIDC provenance. Publishing before the GitHub
   release guarantees the `@bastani/atomic` package is on npm before any
   consumer reads the release notes or runs the install script.
2. **Release last** — The GitHub release is created after the npm publish
   succeeds. The release can be deleted and re-created if needed.
3. **Features are independent** — Devcontainer features just install the
   published `@bastani/atomic` package, so they're validated during PRs
   (schema checks) and published in their own workflow triggered by
   `devcontainer-features/**` changes merging to main.

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
     Publish to npm (permanent, OIDC provenance)              │
           │                                                  │
           ▼                                                  │
     Create GitHub Release (overwritable, auto-generated     │
     release notes)                                           │
                                                              │
  ⑤ Done ◄───────────────────────────────────────────────────┘
```

Devcontainer features are validated (schema checks) during PRs, then published
independently when `devcontainer-features/**` changes merge to main (not part
of the release pipeline).

---

## Build & Release Scripts

The publish workflow is intentionally thin. The only release-time script that
runs locally is the version bumper:

| Script                          | Purpose                                                    |
|---------------------------------|------------------------------------------------------------|
| `src/scripts/bump-version.ts`   | Bumps version across all tracked `package.json` files      |
| `src/scripts/constants.ts`      | Shared constants (`SDK_PACKAGE_NAME`, `CONFIG_DIRS`, etc.) |
| `src/scripts/constants-base.ts` | Dependency-free constants (`SDK_PACKAGE_NAME`, `VERSION_FILES`) safe to import before `bun install` |

### Shared Constants

Values that appear across multiple scripts are centralised to reduce drift:

- **`SDK_PACKAGE_NAME`** — the npm package name (`@bastani/atomic`)
- **`VERSION_FILES`** — `package.json` files bumped together during releases (currently just the root `package.json`)
- **`CONFIG_DIRS`** — agent config directories, derived from the canonical `AGENTS` list exported by the workflow SDK (`src/sdk/workflows.ts`)
- **`CONFIG_FILES`** — individual config files (e.g. `.github/lsp.json`)

`constants-base.ts` is intentionally free of heavy dependencies so it can be
imported by `bump-version.ts` before `bun install` has run in CI.

---

## Workflow Files Reference

| File                       | Trigger                                        | Purpose                            |
|----------------------------|------------------------------------------------|------------------------------------|
| `ci.yml`                   | PR (source/config changes)                     | Typecheck, lint, tests             |
| `bump-version.yml`         | PR opened/synced (`release/*`, `prerelease/*`) | Auto-bump version from branch name |
| `validate-features.yml`    | PR (`devcontainer-features/**`), `workflow_dispatch` | Schema validation            |
| `code-review.yml`          | PR opened/synced                               | AI code review (Claude Opus)       |
| `pr-description.yml`       | PR opened/synced                               | AI PR description (Claude Sonnet)  |
| `claude.yml`               | `@claude` mentions (issues, PRs, reviews)      | Claude Code interactive assistant  |
| `publish.yml`              | Merged `release/*`/`prerelease/*` PR, release published, `workflow_dispatch` | Publish to npm + create GitHub release |
| `publish-features.yml`     | Merged PR (`devcontainer-features/**`), `workflow_dispatch` | Publish features to GHCR |
