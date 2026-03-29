#!/bin/bash
set -e

# shellcheck source=/dev/null
source dev-container-features-test-lib

check "atomic CLI is installed" bash -c "which atomic"
check "bun is installed" bash -c "which bun"
check "claude CLI is installed" bash -c "which claude"
check "opencode CLI is installed" bash -c "which opencode"
check "copilot CLI is installed" bash -c "which copilot"
check "cocoindex-code is installed" bash -c "which ccc"
check "playwright-cli is installed" bash -c "which playwright-cli"
check "COCOINDEX_CODE_DB_PATH_MAPPING is set" bash -c "echo \$COCOINDEX_CODE_DB_PATH_MAPPING | grep '/workspaces=/tmp/cocoindex-db'"

reportResults
