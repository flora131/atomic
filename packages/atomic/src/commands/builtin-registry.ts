/**
 * Atomic-CLI-specific registry of builtin workflows.
 *
 * Lives outside the SDK because the set of builtins is an atomic CLI
 * concern: third-party CLIs build their own registries with their own
 * workflows.
 */

import { createRegistry } from "@bastani/atomic-sdk/registry";

// ralph
import ralphClaude from "@bastani/atomic-sdk/workflows/builtin/ralph/claude";
import ralphCopilot from "@bastani/atomic-sdk/workflows/builtin/ralph/copilot";
import ralphOpencode from "@bastani/atomic-sdk/workflows/builtin/ralph/opencode";

// deep-research-codebase
import drcClaude from "@bastani/atomic-sdk/workflows/builtin/deep-research-codebase/claude";
import drcCopilot from "@bastani/atomic-sdk/workflows/builtin/deep-research-codebase/copilot";
import drcOpencode from "@bastani/atomic-sdk/workflows/builtin/deep-research-codebase/opencode";

// open-claude-design
import ocdClaude from "@bastani/atomic-sdk/workflows/builtin/open-claude-design/claude";
import ocdCopilot from "@bastani/atomic-sdk/workflows/builtin/open-claude-design/copilot";
import ocdOpencode from "@bastani/atomic-sdk/workflows/builtin/open-claude-design/opencode";

export function createBuiltinRegistry() {
  return createRegistry()
    .register(ralphClaude)
    .register(ralphCopilot)
    .register(ralphOpencode)
    .register(drcClaude)
    .register(drcCopilot)
    .register(drcOpencode)
    .register(ocdClaude)
    .register(ocdCopilot)
    .register(ocdOpencode);
}
