#!/bin/bash
set -e

# shellcheck source=/dev/null
source dev-container-features-test-lib

check "atomic CLI is installed" bash -c "which atomic"

# Run atomic init to trigger runtime tool installation (installs bun, ccc, etc.)
atomic init -a copilot -y --no-banner

check "bun is installed" bash -c "which bun"
check "cocoindex-code is installed" bash -c "which ccc"
check "playwright-cli is installed" bash -c "which playwright-cli"
check "copilot agents dir exists" bash -c "test -d ~/.copilot/agents"
check "copilot skills dir exists" bash -c "test -d ~/.copilot/skills"

reportResults
