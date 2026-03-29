#!/bin/bash
set -e

# shellcheck source=/dev/null
source dev-container-features-test-lib

check "atomic CLI is installed" bash -c "which atomic"
check "copilot CLI is installed" bash -c "which copilot"
check "COCOINDEX_CODE_DB_PATH_MAPPING is set" bash -c "echo \$COCOINDEX_CODE_DB_PATH_MAPPING | grep '/workspaces=/tmp/cocoindex-db'"

reportResults
