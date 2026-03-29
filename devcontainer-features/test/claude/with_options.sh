#!/bin/bash
set -e

source dev-container-features-test-lib

check "atomic CLI is installed" bash -c "which atomic"
check "claude CLI is installed" bash -c "which claude"
check "COCOINDEX_CODE_DB_PATH_MAPPING is set" bash -c "echo \$COCOINDEX_CODE_DB_PATH_MAPPING | grep '/workspaces=/tmp/cocoindex-db'"

reportResults
