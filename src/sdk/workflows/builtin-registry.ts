import { createRegistry } from "../registry";

// ralph
import ralphClaude from "./builtin/ralph/claude";
import ralphCopilot from "./builtin/ralph/copilot";
import ralphOpencode from "./builtin/ralph/opencode";

// deep-research-codebase
import drcClaude from "./builtin/deep-research-codebase/claude";
import drcCopilot from "./builtin/deep-research-codebase/copilot";
import drcOpencode from "./builtin/deep-research-codebase/opencode";

// open-claude-design
import ocdClaude from "./builtin/open-claude-design/claude";
import ocdCopilot from "./builtin/open-claude-design/copilot";
import ocdOpencode from "./builtin/open-claude-design/opencode";

export function createBuiltinRegistry() {
  return createRegistry()
    .register(ralphClaude).register(ralphCopilot).register(ralphOpencode)
    .register(drcClaude).register(drcCopilot).register(drcOpencode)
    .register(ocdClaude).register(ocdCopilot).register(ocdOpencode);
}
