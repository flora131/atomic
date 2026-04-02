#!/usr/bin/env bash
set -e

# shellcheck source=/dev/null
source dev-container-features-test-lib

assert_atomic_init_for_agent() {
  local agent="$1"
  local cli="$2"
  local agent_folder="$3"
  local workspace="/tmp/atomic-feature-${agent}"

  check "atomic CLI is installed for ${agent}" bash -lc "command -v atomic"
  check "atomic init succeeds for ${agent}" bash -lc "rm -rf '${workspace}' && mkdir -p '${workspace}' && cd '${workspace}' && atomic --no-banner --yes init --agent '${agent}' --scm github"
  check "bun is installed for ${agent}" bash -lc "command -v bun"
  check "${cli} CLI is installed for ${agent}" bash -lc "command -v ${cli}"
  check "local workflow SDK is installed for ${agent}" bash -lc "test -f '${workspace}/.atomic/workflows/node_modules/@bastani/atomic-workflows/package.json'"
  check "global workflow SDK is installed for ${agent}" bash -lc "test -f \"\$HOME/.atomic/workflows/node_modules/@bastani/atomic-workflows/package.json\""
  check "project skills are configured for ${agent}" bash -lc "test -d '${workspace}/${agent_folder}/skills'"
}

assert_atomic_init_for_agent "opencode" "opencode" ".opencode"

reportResults
