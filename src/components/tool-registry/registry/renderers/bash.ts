import type { ToolRenderProps, ToolRenderResult, ToolRenderer } from "@/components/tool-registry/registry/types.ts";

function isRecord(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === "object" && !Array.isArray(val);
}

export const bashToolRenderer: ToolRenderer = {
  icon: "$",

  getTitle(props: ToolRenderProps): string {
    const rawCmd = props.input.command ?? props.input.cmd;
    const command = typeof rawCmd === "string" ? rawCmd : undefined;
    if (!command) {
      return "Run command";
    }

    const maxLen = 50;
    return command.length > maxLen ? command.slice(0, maxLen - 3) + "..." : command;
  },

  render(props: ToolRenderProps): ToolRenderResult {
    const rawCmd = props.input.command ?? props.input.cmd;
    const command = typeof rawCmd === "string" ? rawCmd : "";
    let output: string | undefined;

    if (typeof props.output === "string") {
      try {
        const parsed = JSON.parse(props.output);
        if (parsed.stdout) {
          output = parsed.stdout;
        } else if (parsed.output) {
          output = parsed.output;
        } else {
          output = props.output;
        }
      } catch {
        output = props.output;
      }
    } else if (isRecord(props.output)) {
      if (typeof props.output.stdout === "string") {
        output = props.output.stdout;
      } else if (typeof props.output.output === "string") {
        output = props.output.output;
      } else {
        output = JSON.stringify(props.output, null, 2);
      }
    }

    const content = [`$ ${command}`];
    if (output) {
      content.push("");
      content.push(...output.split("\n"));
    }

    return {
      title: command,
      content,
      language: "bash",
      expandable: true,
    };
  },
};
