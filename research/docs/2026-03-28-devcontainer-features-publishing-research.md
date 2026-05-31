# Devcontainer Features: Publishing Reusable Components to OCI Registries

**Date**: 2026-03-28
**Purpose**: Research devcontainer features mechanism for publishing reusable development container components to OCI registries like ghcr.io.

---

## Summary

Dev Container Features are self-contained, shareable units of installation code and dev container configuration. They are published as OCI artifacts to registries like ghcr.io, and users reference them in `devcontainer.json` with a simple URI + options syntax. A single repository can publish multiple features (e.g., `atomic-claude`, `atomic-opencode`, `atomic-copilot`) using a standardized directory structure and a single GitHub Actions workflow.

---

## 1. Directory Structure

### Required Repository Layout

A Feature collection repository follows this exact structure:

```
.
├── README.md
├── src/
│   ├── feature-a/
│   │   ├── devcontainer-feature.json    # Required: metadata + options
│   │   ├── install.sh                   # Required: installation entrypoint
│   │   └── ...                          # Optional: helper scripts, bins
│   ├── feature-b/
│   │   ├── devcontainer-feature.json
│   │   ├── install.sh
│   │   └── ...
│   └── feature-c/
│       ├── devcontainer-feature.json
│       ├── install.sh
│       └── ...
├── test/
│   ├── _global/                         # Optional: cross-feature tests
│   │   ├── scenarios.json
│   │   └── *.sh
│   ├── feature-a/
│   │   ├── test.sh                      # Default test (no options)
│   │   ├── scenarios.json               # Named test scenarios
│   │   └── *.sh                         # Scenario test scripts
│   └── feature-b/
│       ├── test.sh
│       ├── scenarios.json
│       └── *.sh
└── .github/
    └── workflows/
        ├── release.yaml                 # Publish features to GHCR
        ├── test.yaml                    # CI test workflow
        └── validate.yml                 # Schema validation
```

**Key rules:**
- Each feature subdirectory name under `src/` **must match** the `id` field in its `devcontainer-feature.json`.
- Only files within a feature's subdirectory are included in the published tarball. Files outside (e.g., root README) are excluded.
- The `install.sh` script is the entrypoint executed by implementing tools during container build.

### Can a Single Repo Publish Multiple Features?

**Yes.** The `devcontainers/features` repository itself publishes dozens of features (dotnet, node, python, go, docker-in-docker, etc.) from a single repo. Each feature gets its own OCI package under the shared namespace. For example, from repo `owner/repo`:

```
ghcr.io/owner/repo/feature-a:1
ghcr.io/owner/repo/feature-b:1
ghcr.io/owner/repo/feature-c:1
```

A third "metadata" collection package is also published at the bare namespace:
```
ghcr.io/owner/repo:latest
```
This contains a `devcontainer-collection.json` with metadata for all features, useful for discovery tools.

---

## 2. devcontainer-feature.json

### Full Schema

All properties are optional **except** `id`, `version`, and `name`.

```jsonc
{
    // === REQUIRED ===
    "id": "my-feature",           // Must match directory name
    "version": "1.0.0",          // Semver
    "name": "My Feature",        // Human-readable display name

    // === OPTIONAL METADATA ===
    "description": "Installs my-feature along with needed dependencies.",
    "documentationURL": "https://github.com/owner/repo/tree/main/src/my-feature",
    "licenseURL": "https://github.com/owner/repo/blob/main/LICENSE",
    "keywords": ["my-feature", "tool"],
    "deprecated": false,

    // === OPTIONS (user-configurable) ===
    "options": {
        "version": {
            "type": "string",
            "proposals": ["latest", "lts", "1.0", "2.0"],
            "default": "latest",
            "description": "Select a version to install"
        },
        "variant": {
            "type": "string",
            "enum": ["claude", "opencode", "copilot"],
            "default": "claude",
            "description": "Choose the agent variant"
        },
        "installExtras": {
            "type": "boolean",
            "default": false,
            "description": "Install extra utilities"
        }
    },

    // === ENVIRONMENT VARIABLES ===
    "containerEnv": {
        "PATH": "/usr/local/my-feature/bin:${PATH}"
    },

    // === IDE CUSTOMIZATIONS ===
    "customizations": {
        "vscode": {
            "extensions": ["publisher.extension-id"],
            "settings": {
                "my-feature.enabled": true
            }
        }
    },

    // === INSTALLATION ORDER ===
    "installsAfter": [
        "ghcr.io/devcontainers/features/common-utils"
    ],
    "dependsOn": {
        "ghcr.io/devcontainers/features/node:1": {}
    },

    // === CONTAINER CONFIGURATION ===
    "privileged": false,
    "init": false,
    "capAdd": [],
    "securityOpt": [],
    "entrypoint": "",
    "mounts": [],

    // === LIFECYCLE HOOKS ===
    "onCreateCommand": "",
    "postCreateCommand": "",
    "postStartCommand": "",
    "postAttachCommand": ""
}
```

### Option Types

There are three option types:

1. **String with proposals** (suggestions, not enforced):
```json
"version": {
    "type": "string",
    "proposals": ["latest", "lts", "8.0", "7.0"],
    "default": "latest",
    "description": "Select or enter a version"
}
```

2. **String with enum** (strict, only listed values allowed):
```json
"variant": {
    "type": "string",
    "enum": ["claude", "opencode", "copilot"],
    "default": "claude",
    "description": "Choose the agent variant"
}
```

3. **Boolean**:
```json
"installExtras": {
    "type": "boolean",
    "default": false,
    "description": "Install extra utilities?"
}
```

### Option Resolution

Options are passed to `install.sh` as **uppercase environment variables**. The option name is capitalized and sanitized:
- `version` becomes `$VERSION`
- `favorite` becomes `$FAVORITE`
- `installExtras` becomes `$INSTALLEXTRAS`
- `nodeGypDependencies` becomes `$NODEGYPDEPENDENCIES`

---

## 3. install.sh Pattern

### Typical Structure

```bash
#!/bin/sh
set -e

echo "Activating feature 'my-feature'"

# Options are passed as uppercase env vars
VERSION=${VERSION:-"latest"}
VARIANT=${VARIANT:-"claude"}
INSTALLEXTRAS=${INSTALLEXTRAS:-"false"}

# The install.sh script always runs as root.
# These env vars are provided by the dev container CLI:
# $_REMOTE_USER       - the effective remoteUser
# $_REMOTE_USER_HOME  - the remoteUser's home directory
# $_CONTAINER_USER    - the effective containerUser
# $_CONTAINER_USER_HOME - the containerUser's home directory

# 1. Detect OS/architecture
ARCHITECTURE="$(dpkg --print-architecture)"
. /etc/os-release

# 2. Install dependencies
apt-get update
apt-get install -y --no-install-recommends \
    curl \
    ca-certificates

# 3. Download and install the tool
if [ "$VERSION" = "latest" ]; then
    VERSION=$(curl -s https://api.github.com/repos/owner/tool/releases/latest | grep tag_name | cut -d '"' -f 4)
fi

curl -fsSL "https://github.com/owner/tool/releases/download/${VERSION}/tool-${ARCHITECTURE}.tar.gz" \
    | tar -xz -C /usr/local/bin

chmod +x /usr/local/bin/tool

# 4. Configure for the non-root user
if [ "$INSTALLEXTRAS" = "true" ]; then
    echo "Installing extras..."
fi

# 5. Cleanup
apt-get clean
rm -rf /var/lib/apt/lists/*

echo "Done!"
```

### Real-World Example (from feature-starter `hello`):

```bash
#!/bin/sh
set -e

echo "Activating feature 'hello'"

GREETING=${GREETING:-undefined}
echo "The provided greeting is: $GREETING"

echo "The effective dev container remoteUser is '$_REMOTE_USER'"
echo "The effective dev container remoteUser's home directory is '$_REMOTE_USER_HOME'"

cat > /usr/local/bin/hello \
<< EOF
#!/bin/sh
RED='\033[0;91m'
NC='\033[0m' # No Color
echo "\${RED}${GREETING}, \$(whoami)!\${NC}"
EOF

chmod +x /usr/local/bin/hello
```

---

## 4. Publishing to ghcr.io as OCI Artifacts

### OCI Artifact Format

Each feature is published as an OCI artifact (not a Docker image) with custom media types:

| Component | Media Type |
|-----------|-----------|
| Manifest | `application/vnd.oci.image.manifest.v1+json` |
| Config layer | `application/vnd.devcontainers` (empty `{}`) |
| Feature tarball layer | `application/vnd.devcontainers.layer.v1+tar` |
| Collection metadata | `application/vnd.devcontainers.collection.layer.v1+json` |

**Example OCI manifest:**
```json
{
    "schemaVersion": 2,
    "mediaType": "application/vnd.oci.image.manifest.v1+json",
    "config": {
        "mediaType": "application/vnd.devcontainers",
        "digest": "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "size": 0
    },
    "layers": [
        {
            "mediaType": "application/vnd.devcontainers.layer.v1+tar",
            "digest": "sha256:738af5504b253dc6...",
            "size": 3584,
            "annotations": {
                "org.opencontainers.image.title": "devcontainer-feature-myFeature.tgz"
            }
        }
    ],
    "annotations": {
        "dev.containers.metadata": "{\"name\":\"My Feature\",\"id\":\"myFeature\",\"version\":\"1.0.0\"...}",
        "com.github.package.type": "devcontainer_feature"
    }
}
```

The `com.github.package.type: devcontainer_feature` annotation is specific to ghcr.io and enables proper UI presentation in the GitHub Packages interface.

### Packaging Steps

1. The entire contents of `src/<feature-name>/` are packaged into a tarball: `devcontainer-feature-<id>.tgz`
2. The tarball is pushed as an OCI layer with the custom media type
3. An OCI manifest is created with the `dev.containers.metadata` annotation containing the full `devcontainer-feature.json`
4. The manifest is tagged with multiple semantic version tags

### Naming Convention

```
<registry>/<namespace>/<id>:<version>
```

Example:
```
ghcr.io/devcontainers/features/go:1.2.3
```

Where:
- `ghcr.io` = OCI registry
- `devcontainers/features` = namespace (typically `<owner>/<repo>`)
- `go` = feature id
- `1.2.3` = version tag

---

## 5. Semantic Versioning

When a feature at version `X.Y.Z` is published, the following tags are generated:

| Tag | Condition |
|-----|-----------|
| `X.Y.Z` | Always created (exact version) |
| `X.Y` | Created if `X.Y.Z` is the highest patch for this minor |
| `X` | Created if `X.Y.Z` is the highest version for this major |
| `latest` | Created if `X.Y.Z` is the highest version overall |

**Example:** Publishing version `1.2.3` when the existing highest is `1.2.2`:
- Tags created: `1.2.3`, `1.2`, `1`, `latest`

**Example:** Publishing version `1.1.5` when `1.2.3` already exists:
- Tags created: `1.1.5`, `1.1` (but NOT `1` or `latest`, since `1.2.3` is higher)

The version is determined from the `version` field in `devcontainer-feature.json`. Tooling will **not republish** if that exact version already exists in the registry.

---

## 6. GitHub Actions Workflow for Publishing

### The `devcontainers/action` GitHub Action

**Repository:** [devcontainers/action](https://github.com/devcontainers/action)

This is the official GitHub Action for publishing features. It wraps the `devcontainer features publish` CLI command.

#### Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `publish-features` | No | `false` | Enable publishing features |
| `base-path-to-features` | No | `""` | Relative path to features folder |
| `oci-registry` | No | (ghcr.io) | OCI registry hostname |
| `features-namespace` | No | `<owner>/<repo>` | Namespace prefix for feature IDs |
| `generate-docs` | No | `false` | Auto-generate README.md per feature |
| `validate-only` | No | `false` | Only validate schemas, don't publish |
| `disable-schema-validation` | No | `false` | Skip schema validation |
| `disable-repo-tagging` | No | `false` | Skip git repo tags per release |
| `devcontainer-cli-version` | No | latest | Pin devcontainer CLI version |
| `publish-templates` | No | `false` | Enable publishing templates |
| `base-path-to-templates` | No | `""` | Relative path to templates folder |

#### Required Permissions

```yaml
permissions:
  packages: write       # Push to GHCR
  contents: write       # Create git tags
  pull-requests: write  # Auto-generated docs PR
```

### Complete Release Workflow

**File: `.github/workflows/release.yaml`**

```yaml
name: "Release dev container features & Generate Documentation"
on:
  workflow_dispatch:

jobs:
  deploy:
    if: ${{ github.ref == 'refs/heads/main' }}
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      packages: write
    steps:
      - uses: actions/checkout@v4

      - name: "Publish Features"
        uses: devcontainers/action@v1
        with:
          publish-features: "true"
          base-path-to-features: "./src"
          generate-docs: "true"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Create PR for Documentation
        id: push_image_info
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          set -e
          echo "Start."
          git config --global user.email github-actions[bot]@users.noreply.github.com
          git config --global user.name github-actions[bot]
          git config pull.rebase false
          branch=automated-documentation-update-$GITHUB_RUN_ID
          git checkout -b $branch
          message='Automated documentation update'
          git add */**/README.md
          git commit -m 'Automated documentation update [skip ci]' || export NO_UPDATES=true
          if [ "$NO_UPDATES" != "true" ] ; then
              git push origin "$branch"
              gh pr create --title "$message" --body "$message"
          fi
```

### Test Workflow

**File: `.github/workflows/test.yaml`**

```yaml
name: "CI - Test Features"
on:
  push:
    branches:
      - main
  pull_request:
  workflow_dispatch:

jobs:
  test-autogenerated:
    runs-on: ubuntu-latest
    continue-on-error: true
    strategy:
      matrix:
        features:
          - feature-a
          - feature-b
          - feature-c
        baseImage:
          - debian:latest
          - ubuntu:latest
          - mcr.microsoft.com/devcontainers/base:ubuntu
    steps:
      - uses: actions/checkout@v4
      - name: "Install latest devcontainer CLI"
        run: npm install -g @devcontainers/cli
      - name: "Generating tests for '${{ matrix.features }}' against '${{ matrix.baseImage }}'"
        run: devcontainer features test --skip-scenarios -f ${{ matrix.features }} -i ${{ matrix.baseImage }} .

  test-scenarios:
    runs-on: ubuntu-latest
    continue-on-error: true
    strategy:
      matrix:
        features:
          - feature-a
          - feature-b
          - feature-c
    steps:
      - uses: actions/checkout@v4
      - name: "Install latest devcontainer CLI"
        run: npm install -g @devcontainers/cli
      - name: "Generating tests for '${{ matrix.features }}' scenarios"
        run: devcontainer features test -f ${{ matrix.features }} --skip-autogenerated --skip-duplicated .

  test-global:
    runs-on: ubuntu-latest
    continue-on-error: true
    steps:
      - uses: actions/checkout@v4
      - name: "Install latest devcontainer CLI"
        run: npm install -g @devcontainers/cli
      - name: "Testing global scenarios"
        run: devcontainer features test --global-scenarios-only .
```

### Validation Workflow

**File: `.github/workflows/validate.yml`**

```yaml
name: "Validate devcontainer-feature.json files"
on:
  workflow_dispatch:
  pull_request:

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: "Validate devcontainer-feature.json files"
        uses: devcontainers/action@v1
        with:
          validate-only: "true"
          base-path-to-features: "./src"
```

---

## 7. How Users Consume Features

### In devcontainer.json

```jsonc
{
    "image": "mcr.microsoft.com/devcontainers/base:ubuntu",
    "features": {
        // With specific version tag and options
        "ghcr.io/owner/repo/my-feature:1": {
            "variant": "claude",
            "installExtras": true
        },
        // With exact version
        "ghcr.io/owner/repo/my-feature:1.2.3": {
            "variant": "opencode"
        },
        // Without version (defaults to :latest)
        "ghcr.io/owner/repo/my-feature": {},
        // Shorthand: string value maps to "version" option
        "ghcr.io/owner/repo/my-feature:1": "2.0"
        // ^^^ equivalent to: { "version": "2.0" }
    }
}
```

### Reference Formats

| Format | Example |
|--------|---------|
| OCI registry (recommended) | `ghcr.io/owner/repo/feature:1` |
| OCI with digest | `ghcr.io/owner/repo/feature@sha256:abc123...` |
| Direct HTTPS tarball | `https://github.com/owner/repo/releases/devcontainer-feature-go.tgz` |
| Local relative path | `./myLocalFeature` |

### Private Features in Codespaces

For private GHCR packages, add permissions in `devcontainer.json`:
```jsonc
{
    "features": {
        "ghcr.io/my-org/private-features/hello:1": {
            "greeting": "Hello"
        }
    },
    "customizations": {
        "codespaces": {
            "repositories": {
                "my-org/private-features": {
                    "permissions": {
                        "packages": "read",
                        "contents": "read"
                    }
                }
            }
        }
    }
}
```

---

## 8. Testing Features

### Test Structure

```
test/
├── _global/                    # Cross-feature integration tests
│   ├── scenarios.json          # Defines multi-feature scenarios
│   └── scenario_name.sh        # Test script per scenario
├── feature-a/
│   ├── test.sh                 # Default test (no custom options)
│   ├── scenarios.json          # Named scenarios with custom options
│   └── scenario_name.sh        # Test script per scenario
```

### scenarios.json Format

```json
{
    "scenario_name": {
        "image": "mcr.microsoft.com/devcontainers/base:ubuntu",
        "features": {
            "feature-id": {
                "option1": "value1",
                "option2": true
            }
        }
    }
}
```

### Test Script Pattern

```bash
#!/bin/bash
set -e

# Import test library from devcontainer CLI
source dev-container-features-test-lib

# check <LABEL> <cmd> [args...]
check "tool is installed" bash -c "which my-tool"
check "tool version" bash -c "my-tool --version | grep '1.0'"
check "config exists" bash -c "test -f /etc/my-tool/config"

# Report results (fails if any check had non-zero exit)
reportResults
```

### Running Tests Locally

```bash
# Install devcontainer CLI
npm install -g @devcontainers/cli

# Test a specific feature with auto-generated config
devcontainer features test --skip-scenarios -f my-feature -i ubuntu:latest .

# Test named scenarios for a feature
devcontainer features test -f my-feature --skip-autogenerated --skip-duplicated .

# Test global (cross-feature) scenarios
devcontainer features test --global-scenarios-only .
```

---

## 9. CLI Command Reference

### `devcontainer features publish`

```bash
devcontainer features publish \
    --registry ghcr.io \
    --namespace owner/repo \
    ./src
```

**Flags:**
| Flag | Description |
|------|-------------|
| `--registry`, `-r` | OCI registry hostname (e.g., `ghcr.io`) |
| `--namespace`, `-n` | Organization/namespace path |
| `--log-level` | Logging verbosity level |

**Process:**
1. Packages each feature subdirectory into `devcontainer-feature-<id>.tgz`
2. Fetches existing published tags from the registry
3. Determines semantic version tags (`X`, `X.Y`, `X.Y.Z`, `latest`)
4. Generates OCI manifest with proper media types and annotations
5. Checks for existing blobs (deduplication)
6. Uploads config blob and tarball blob
7. Pushes manifest with all determined tags

---

## 10. Practical Example: Multi-Feature Atomic Repo

For publishing `atomic-claude`, `atomic-opencode`, and `atomic-copilot` features:

### Directory Structure

```
src/
├── atomic-claude/
│   ├── devcontainer-feature.json
│   └── install.sh
├── atomic-opencode/
│   ├── devcontainer-feature.json
│   └── install.sh
└── atomic-copilot/
    ├── devcontainer-feature.json
    └── install.sh
```

### Example devcontainer-feature.json (atomic-claude)

```json
{
    "id": "atomic-claude",
    "version": "1.0.0",
    "name": "Atomic CLI (Claude Agent)",
    "description": "Installs the Atomic CLI configured for Claude Code agent",
    "options": {
        "version": {
            "type": "string",
            "proposals": ["latest", "0.4.44"],
            "default": "latest",
            "description": "Atomic CLI version to install"
        }
    },
    "containerEnv": {
        "PATH": "/usr/local/atomic/bin:${PATH}"
    },
    "installsAfter": [
        "ghcr.io/devcontainers/features/common-utils",
        "ghcr.io/devcontainers/features/node"
    ]
}
```

### User Consumption

```jsonc
{
    "image": "mcr.microsoft.com/devcontainers/base:ubuntu",
    "features": {
        "ghcr.io/owner/atomic/atomic-claude:1": {
            "version": "latest"
        }
    }
}
```

### Published Packages

After publishing, the following OCI packages would exist:
```
ghcr.io/owner/atomic/atomic-claude:1.0.0
ghcr.io/owner/atomic/atomic-claude:1.0
ghcr.io/owner/atomic/atomic-claude:1
ghcr.io/owner/atomic/atomic-claude:latest
ghcr.io/owner/atomic/atomic-opencode:1.0.0
ghcr.io/owner/atomic/atomic-opencode:1
ghcr.io/owner/atomic/atomic-opencode:latest
ghcr.io/owner/atomic/atomic-copilot:1.0.0
ghcr.io/owner/atomic/atomic-copilot:1
ghcr.io/owner/atomic/atomic-copilot:latest
ghcr.io/owner/atomic:latest   # collection metadata
```

---

## References

| Source | URL |
|--------|-----|
| Feature Specification | https://containers.dev/implementors/features/ |
| Feature Distribution Specification | https://containers.dev/implementors/features-distribution/ |
| devcontainer-feature.json Schema | https://containers.dev/implementors/features/#devcontainer-feature-json-properties |
| devcontainers/features (official features) | https://github.com/devcontainers/features |
| devcontainers/feature-starter (template) | https://github.com/devcontainers/feature-starter |
| devcontainers/action (GitHub Action) | https://github.com/devcontainers/action |
| devcontainers/cli (CLI tool) | https://github.com/devcontainers/cli |
| OCI Distribution Spec | https://github.com/opencontainers/distribution-spec |
| DeepWiki: Feature Anatomy | https://deepwiki.com/wiki/devcontainers/features#1.2 |
| DeepWiki: OCI Registry Integration | https://deepwiki.com/wiki/devcontainers/cli#6 |
| DeepWiki: OCI Distribution | https://deepwiki.com/wiki/devcontainers/cli#6.2 |

---

## Gaps and Limitations

1. **GHCR visibility**: By default, packages published to GHCR are **private**. Each feature package must be manually set to "public" via the GitHub Packages settings UI at `https://github.com/users/<owner>/packages/container/<repo>%2F<featureName>/settings`.

2. **Trigger mechanism**: The `feature-starter` template uses `workflow_dispatch` (manual trigger). For automated releases, you could add triggers on tags or main branch pushes with path filters.

3. **Custom namespace**: The `features-namespace` input on `devcontainers/action` allows overriding the default `<owner>/<repo>` namespace, useful if you want shorter URIs.

4. **Feature discovery**: To appear in the public index at containers.dev/features, a PR must be opened to modify `collection-index.yml` at `devcontainers/devcontainers.github.io`.
