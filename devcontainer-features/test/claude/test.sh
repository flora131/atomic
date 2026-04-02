#!/bin/bash
set -e

# shellcheck source=/dev/null
source dev-container-features-test-lib

check "atomic CLI is installed" bash -c "which atomic"

# Run atomic init to trigger runtime tool installation (installs bun, ccc, etc.)
# Global flags (-y, --no-banner) must precede the subcommand for backward
# compatibility with older binaries that used enablePositionalOptions().
atomic -y --no-banner init -a claude

check "bun is installed" bash -c "which bun"
check "cocoindex-code is installed" bash -c "which ccc"
check "playwright-cli is installed" bash -c "which playwright-cli"
check "claude agents dir exists" bash -c "test -d ~/.claude/agents"
check "claude skills dir exists" bash -c "test -d ~/.claude/skills"

reportResults
