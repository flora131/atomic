#!/usr/bin/env bash
set -e

# shellcheck source=/dev/null
source dev-container-features-test-lib

check "atomic CLI is installed" bash -c "which atomic"

reportResults
