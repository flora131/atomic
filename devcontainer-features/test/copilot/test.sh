#!/usr/bin/env bash
set -e

# shellcheck source=/dev/null
source dev-container-features-test-lib
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/../lib/assert-atomic-init.sh"

assert_atomic_init_for_agent "copilot" "copilot" ".github"

reportResults
