# CI/CD Pipeline

This document describes the GitHub Actions workflows for the Atomic monorepo and the single publishable npm package, `@bastani/atomic`.

`@bastani/atomic` lives in `packages/coding-agent`. It is the Atomic-branded coding-agent CLI package and now bundles the first-party workflows extension plus the companion pi packages into its published tarball under `dist/builtin/`.

No other workspace package is published. In particular, `packages/workflows` is a private workspace package that is copied into `@bastani/atomic` at build time.

## Workflow Overview

```text
Pull request / push
  ├─ bun install --frozen-lockfile
  ├─ bun run typecheck
  ├─ cd packages/coding-agent && bun run build
  ├─ bun run test:unit
  └─ bun run test:integration

Release / prerelease merge
  ├─ validate packages/coding-agent/package.json
  ├─ validate packages/workflows is private
  ├─ cd packages/coding-agent && bun run build
  ├─ validate dist/builtin contains all bundled extensions
  ├─ bun pm pack --dry-run from packages/coding-agent
  ├─ npm publish --provenance from packages/coding-agent
  └─ create GitHub Release
```

## Package Shape

The repository root is a private workspace package named `atomic-monorepo`.

The only publishable workspace package is `packages/coding-agent/package.json`:

- package name: `@bastani/atomic`
- CLI binary: `atomic` → `dist/cli.js`
- `main`: `./dist/index.js`
- `types`: `./dist/index.d.ts`
- package version: shared by all `packages/*` packages

Bundled builtin pi packages copied into `packages/coding-agent/dist/builtin/` during `bun run build`:

- `workflows` from `packages/workflows`
- `pi-subagents`
- `pi-mcp-adapter`
- `pi-web-access`
- `pi-intercom`

`packages/workflows` remains in the workspace for source organization and tests, but is marked `private: true` and must not be published independently.

---

## Pull Request Workflows

### Tests (`test.yml`)

Runs on pushes to `main` and PRs targeting `main`.

Matrix:

- `ubuntu-latest`
- `windows-latest`

Steps:

1. Check out the repository.
2. Set up Bun.
3. Install dependencies with `bun install --frozen-lockfile`.
4. Run `bun run typecheck`.
5. Build `@bastani/atomic` with `cd packages/coding-agent && bun run build`.
6. Run `bun run test:unit`.
7. Run `bun run test:integration`.

### Code Review (`code-review.yml`)

Runs Claude-powered automated code review on pull requests.

### PR Description (`pr-description.yml`)

Generates or updates pull request descriptions.

### Claude Interactive (`claude.yml`)

Responds to `@claude` mentions in issues and pull requests.

---

## Release Pipeline

### Trigger

The publish pipeline (`publish.yml`) runs when:

- a `release/*` or `prerelease/*` PR is merged into `main`
- an existing GitHub Release is manually published
- `workflow_dispatch` is run with a tag input such as `v0.8.0`

For pull request events, the publish job only runs when the PR was merged and the source branch starts with `release/` or `prerelease/`.

### Branch Naming

| Branch type | Pattern | npm tag | GitHub Release |
|-------------|---------|---------|----------------|
| Release | `release/v<version>` | `latest` | normal release, marked latest |
| Prerelease | `prerelease/v<version>` | `next` | prerelease, not marked latest |

Examples:

- `release/v0.8.0` → npm `latest`, GitHub Release `v0.8.0`
- `prerelease/v0.8.0-0` → npm `next`, GitHub prerelease `v0.8.0-0`

The branch version must match `packages/coding-agent/package.json` after removing the leading `v`.

### Version Bump

Use the top-level script:

```sh
bun run scripts/bump-version.ts 0.8.0
bun run scripts/bump-version.ts 0.8.0-0
bun run scripts/bump-version.ts --from-branch
bun install
```

The script updates every `packages/*/package.json` version and any package README version badge. Run `bun install` afterward so `bun.lock` records the same workspace versions.

### Publish Flow

```text
release/* or prerelease/* PR merged to main
       │
       ▼
Publish @bastani/atomic
  · checkout merge commit / requested tag
  · setup Bun
  · setup Node only for npm provenance publish
  · bun install --frozen-lockfile
  · bun run typecheck
  · bun run test:all
  · cd packages/coding-agent && bun run build
  · validate @bastani/atomic metadata
  · validate packages/workflows is private
  · validate dist/builtin has workflows, pi-subagents, pi-mcp-adapter, pi-web-access, pi-intercom
  · determine npm tag: latest or next
  · skip if package version already exists
  · cd packages/coding-agent && bun pm pack --dry-run
  · cd packages/coding-agent && npm publish --provenance --access public
       │
       ▼
Create GitHub Release with softprops/action-gh-release@v3
```

### Why npm Publish Before GitHub Release?

npm versions are immutable. The workflow publishes to npm first so a GitHub Release is only created after the npm package is available.

The GitHub Release contains version metadata and generated release notes only.

### GitHub Release Creation

GitHub Releases are created with `softprops/action-gh-release@v3`, matching the release-action pattern used by `flora131/atomic`. The workflow does not shell out to `gh` for release creation.

For prerelease versions (any version containing `-`):

- `prerelease: true`
- `make_latest: false`
- npm tag: `next`

For stable versions:

- `prerelease: false`
- `make_latest: true`
- npm tag: `latest`

---

## Single-Package Publish Rule

CI must publish exactly one npm package: `@bastani/atomic` from `packages/coding-agent`.

Do not add publish steps for:

- `@bastani/workflows`
- `pi-subagents`
- `pi-mcp-adapter`
- `pi-web-access`
- `pi-intercom`
- any other `packages/*` workspace

Those extensions are bundled into `@bastani/atomic` by `packages/coding-agent/scripts/copy-builtin-packages.ts`.

---

## No Verdaccio Validation

Verdaccio is intentionally not used.

The meaningful pre-publish checks are:

- TypeScript typechecking
- unit and integration tests
- `@bastani/atomic` build output validation
- builtin extension/resource validation under `dist/builtin/`
- `bun pm pack --dry-run` from `packages/coding-agent`

---

## Workflow Files Reference

| File | Trigger | Purpose |
|------|---------|---------|
| `test.yml` | Push to `main`, PR to `main` | Install, typecheck, build `@bastani/atomic`, unit tests, integration tests |
| `publish.yml` | Merged `release/*`/`prerelease/*` PR, published release, manual dispatch | Publish `@bastani/atomic` and create GitHub Release |
| `code-review.yml` | PR events | Claude-powered code review |
| `pr-description.yml` | PR events | PR description generation |
| `claude.yml` | `@claude` mentions and configured issue/PR events | Interactive Claude assistant |

---

## Release Checklist

1. Create a release branch:

   ```sh
   git checkout -b release/v0.8.0
   # or
   git checkout -b prerelease/v0.8.0-0
   ```

2. Bump versions:

   ```sh
   bun run scripts/bump-version.ts --from-branch
   bun install
   ```

3. Run local validation:

   ```sh
   bun run typecheck
   cd packages/coding-agent && bun run build
   cd ../..
   bun run test:unit
   bun run test:integration
   ```

4. Commit:

   ```sh
   git add packages/*/package.json packages/*/README.md bun.lock
   git commit -m "chore(release): bump to v0.8.0"
   ```

5. Open a PR to `main`.
6. Merge after checks pass.
7. Confirm `publish.yml` publishes only `@bastani/atomic` to npm and creates the GitHub Release.
