import type { AgentType } from "@/services/telemetry/types.ts";
import type { CodingAgentClient } from "@/services/agents/types.ts";
import type { Theme } from "@/app.tsx";
import { supportsTrueColor } from "@/services/system/detect.ts";

export async function createClientForAgentType(agentType: AgentType): Promise<CodingAgentClient> {
  switch (agentType) {
    case "claude": {
      const { createClaudeAgentClient } = await import("@/services/agents/clients/claude.ts");
      return createClaudeAgentClient();
    }
    case "opencode": {
      const { createOpenCodeClient } = await import("@/services/agents/clients/opencode.ts");
      return createOpenCodeClient({
        directory: process.cwd(),
        port: 0,
        reuseExistingServer: false,
      });
    }
    case "copilot": {
      const { createCopilotClient } = await import("@/services/agents/clients/copilot.ts");
      return createCopilotClient();
    }
    default:
      throw new Error(`Unknown agent type: ${agentType}`);
  }
}

export function getAgentDisplayName(agentType: AgentType): string {
  const names: Record<AgentType, string> = {
    claude: "Claude",
    opencode: "OpenCode",
    copilot: "Copilot",
  };
  return names[agentType] ?? agentType;
}

export async function getTheme(themeName: "dark" | "light"): Promise<Theme> {
  const { darkTheme, lightTheme, darkThemeAnsi, lightThemeAnsi } = await import("@/app.tsx");
  const truecolor = supportsTrueColor();
  if (themeName === "light") {
    return truecolor ? lightTheme : lightThemeAnsi;
  }
  return truecolor ? darkTheme : darkThemeAnsi;
}
